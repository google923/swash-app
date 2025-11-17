// Swash AutoDeploy – automatically deploys to Firebase Hosting and Vercel when files change
import { exec } from "child_process";
import chokidar from "chokidar";
import notifier from "node-notifier";

console.clear();
console.log("👀 Swash AutoDeploy is active");
console.log("📂 Watching for file changes (15s cooldown before deploy)\n");

let deployTimer = null;

const watcher = chokidar.watch(".", {
  ignored: [
    /(^|[\/\\])\../,           // hidden files (.git, .firebase, etc)
    /firebase-debug.*\.log/,   // any Firebase debug logs
    /node_modules/,            // dependencies
  ],
  persistent: true,
  ignoreInitial: true,
});

function run(cmd, label) {
  return new Promise((resolve) => {
    console.log(`➡️  ${label}: ${cmd}`);
    const child = exec(cmd, { maxBuffer: 1024 * 1024 * 10 }, (err, stdout, stderr) => {
      if (err) {
        console.error(`❌ ${label} failed:`, err.message);
        if (stderr) console.error(stderr);
        resolve({ ok: false, stdout, stderr, err });
      } else {
        if (stdout) console.log(stdout);
        console.log(`✅ ${label} complete`);
        resolve({ ok: true, stdout });
      }
    });
    child.stdout?.pipe(process.stdout);
    child.stderr?.pipe(process.stderr);
  });
}

async function deployAll() {
  console.log("🚀 Deploying updated files...\n");
  // 1) Firebase Hosting
  const fb = await run("firebase deploy --only hosting", "Firebase Hosting");
  if (fb.ok) {
    notifier.notify({
      title: "Swash AutoDeploy",
      message: "✅ Firebase hosting updated",
      sound: false,
    });
    console.log("🌍 Firebase: https://app.swashcleaning.co.uk\n");
  } else {
    notifier.notify({ title: "Swash AutoDeploy", message: "❌ Firebase deploy failed", sound: true });
  }

  // 2) Vercel (optional)
  const vercelEnabled = process.env.VERCEL_ENABLED !== "0"; // set VERCEL_ENABLED=0 to disable
  if (vercelEnabled) {
    const tokenArg = process.env.VERCEL_TOKEN ? ` --token ${process.env.VERCEL_TOKEN}` : "";
    const scopeArg = process.env.VERCEL_SCOPE ? ` --scope ${process.env.VERCEL_SCOPE}` : "";
    const projectArg = process.env.VERCEL_PROJECT ? ` --project ${process.env.VERCEL_PROJECT}` : "";
    // Use npx to avoid requiring a global install
    const vercelCmd = `npx vercel --prod --yes${tokenArg}${scopeArg}${projectArg}`;
    const vz = await run(vercelCmd, "Vercel deploy");
    if (vz.ok) {
      notifier.notify({ title: "Swash AutoDeploy", message: "✅ Vercel site updated", sound: false });
      console.log("🌐 Vercel: deployment complete (prod). If you test primarily on the Vercel domain, reload now.\n");
    } else {
      console.log("ℹ️  Skipped/failed Vercel deploy. Ensure Vercel CLI is linked and authenticated.\n" +
        "   - Login: npx vercel login\n" +
        "   - Link: npx vercel link --yes\n" +
        "   - Optional env: VERCEL_TOKEN, VERCEL_SCOPE, VERCEL_PROJECT");
      notifier.notify({ title: "Swash AutoDeploy", message: "⚠️ Vercel deploy failed or not linked", sound: false });
    }
  } else {
    console.log("⏭️  Vercel deploy disabled (VERCEL_ENABLED=0)\n" +
      "🚩 Reminder: If you test on the Vercel domain, deploy with:\n" +
      "   npx vercel --prod --yes\n");
  }
}

watcher.on("change", (path) => {
  console.log(`🟡 Change detected in ${path}`);

  if (deployTimer) clearTimeout(deployTimer);

  deployTimer = setTimeout(() => {
    deployAll();
  }, 15000); // 15 s debounce delay
});
