// Swash AutoDeploy – automatically deploys to Firebase Hosting when files change
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

watcher.on("change", (path) => {
  console.log(`🟡 Change detected in ${path}`);

  if (deployTimer) clearTimeout(deployTimer);

  deployTimer = setTimeout(() => {
    console.log("🚀 Deploying updated files to Firebase Hosting...\n");

    exec("firebase deploy --only hosting", (err, stdout) => {
      if (err) {
        console.error("❌ Deployment error:", err.message);
        notifier.notify({
          title: "Swash AutoDeploy",
          message: "❌ Deployment failed — check VS Code terminal.",
          sound: true,
        });
      } else {
        console.log(stdout);
        console.log("✅ Deployment complete!");
        console.log("🌍 Live at: https://system.swashcleaning.co.uk\n");
        notifier.notify({
          title: "Swash AutoDeploy",
          message: "✅ Site live at https://system.swashcleaning.co.uk",
          sound: false,
        });
      }
    });
  }, 15000); // 15 s debounce delay
});
