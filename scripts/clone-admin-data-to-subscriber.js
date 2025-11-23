#!/usr/bin/env node
/**
 * Clone core Swash data from the global/admin namespace into a subscriber tenant.
 *
 * Usage:
 *   set GOOGLE_APPLICATION_CREDENTIALS=path\to\serviceAccount.json
 *   node scripts/clone-admin-data-to-subscriber.js --from ADMIN_UID --to SUBSCRIBER_UID [--only quotes,customers,...] [--merge] [--dry-run]
 *
 * Flags:
 *   --from   Firebase Auth UID for the existing admin (used for user-scoped docs like areas)
 *   --to     Target subscriber UID that should receive the copied data (required)
 *   --only   Comma separated list of keys to copy (e.g. "quotes,customers,repLogs")
 *   --merge  Use Firestore merge semantics instead of overwriting target docs
 *   --dry-run  Log what would be copied without writing to Firestore
 *
 * Prerequisites:
 *   1. Create a Firebase service account and download JSON credentials.
 *   2. Set the GOOGLE_APPLICATION_CREDENTIALS environment variable to its path.
 *   3. Run this script from the project root with Node 18+.
 */

const admin = require("firebase-admin");

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      args._.push(token);
      continue;
    }
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
    } else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

function ensureServiceAccount() {
  if (admin.apps.length) return;
  try {
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
    });
  } catch (error) {
    console.error("Failed to initialize Firebase Admin SDK. Make sure GOOGLE_APPLICATION_CREDENTIALS is set.");
    throw error;
  }
}

function collectionRef(db, path) {
  const segments = path.split("/").filter(Boolean);
  if (segments.length % 2 === 0) {
    throw new Error(`Collection path must have an odd number of segments: ${path}`);
  }
  let ref = db.collection(segments[0]);
  for (let i = 1; i < segments.length; i += 2) {
    ref = ref.doc(segments[i]).collection(segments[i + 1]);
  }
  return ref;
}

function documentRef(db, path) {
  const segments = path.split("/").filter(Boolean);
  if (segments.length % 2 !== 0) {
    throw new Error(`Document path must have an even number of segments: ${path}`);
  }
  let ref = db.doc(segments.slice(0, 2).join("/"));
  for (let i = 2; i < segments.length; i += 2) {
    ref = ref.collection(segments[i]).doc(segments[i + 1]);
  }
  return ref;
}

async function copyDocumentSnapshot(docSnap, targetDocRef, opts) {
  if (!docSnap.exists) return;
  if (opts.dryRun) {
    console.log(`[dry-run] would write ${targetDocRef.path}`);
  } else {
    await targetDocRef.set(docSnap.data(), { merge: opts.merge });
  }
  const subcollections = await docSnap.ref.listCollections();
  for (const sub of subcollections) {
    await copyCollectionRecursive(sub, targetDocRef.collection(sub.id), opts);
  }
}

async function copyCollectionRecursive(sourceColRef, targetColRef, opts) {
  const snapshot = await sourceColRef.get();
  if (snapshot.empty) {
    console.log(`(skip) ${sourceColRef.path} has no documents`);
    return;
  }
  console.log(`Copying ${snapshot.size} docs from ${sourceColRef.path} → ${targetColRef.path}`);
  let processed = 0;
  for (const docSnap of snapshot.docs) {
    const targetDocRef = targetColRef.doc(docSnap.id);
    await copyDocumentSnapshot(docSnap, targetDocRef, opts);
    processed += 1;
    if (processed % 25 === 0) {
      console.log(`  …${processed}/${snapshot.size}`);
    }
  }
}

async function copyCollectionPath(db, sourcePath, targetPath, opts) {
  const source = collectionRef(db, sourcePath);
  const target = collectionRef(db, targetPath);
  await copyCollectionRecursive(source, target, opts);
}

async function copyDocumentPath(db, sourcePath, targetPath, opts, options = {}) {
  const sourceDocRef = documentRef(db, sourcePath);
  const docSnap = await sourceDocRef.get();
  if (!docSnap.exists) {
    if (options.optional) {
      console.log(`(skip) optional doc ${sourcePath} not found`);
      return;
    }
    throw new Error(`Source document ${sourcePath} does not exist`);
  }
  const targetDocRef = documentRef(db, targetPath);
  console.log(`Copying doc ${sourcePath} → ${targetPath}`);
  await copyDocumentSnapshot(docSnap, targetDocRef, opts);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const subscriberUid = args.to || args.subscriber || args.target;
  if (!subscriberUid) {
    throw new Error("Missing --to SUBSCRIBER_UID argument");
  }

  const adminUid = args.from || args.admin;
  if (!adminUid) {
    console.warn("⚠️  No --from ADMIN_UID provided. Admin-scoped docs (areas, etc.) will be skipped.");
  }

  const only = args.only
    ? new Set(String(args.only)
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean))
    : null;

  const opts = {
    merge: Boolean(args.merge && args.merge !== "false"),
    dryRun: Boolean(args["dry-run"] || args.dryRun),
  };

  ensureServiceAccount();
  const db = admin.firestore();

  const collectionMappings = [
    { key: "quotes", source: "quotes", target: (sub) => `subscribers/${sub}/quotes` },
    { key: "customers", source: "customers", target: (sub) => `subscribers/${sub}/customers` },
    { key: "cleaners", source: "cleaners", target: (sub) => `subscribers/${sub}/cleaners` },
    { key: "doorsknocked", source: "doorsknocked", target: (sub) => `subscribers/${sub}/doorsknocked` },
    { key: "repLocations", source: "repLocations", target: (sub) => `subscribers/${sub}/repLocations` },
    { key: "repShifts", source: "repShifts", target: (sub) => `subscribers/${sub}/repShifts` },
    { key: "repLogs", source: "repLogs", target: (sub) => `subscribers/${sub}/repLogs` },
    { key: "territories", source: "territories", target: (sub) => `subscribers/${sub}/territories` },
  ];

  const documentMappings = [
    {
      key: "areas",
      requiresAdmin: true,
      optional: true,
      source: (adminId) => `users/${adminId}/areas/all`,
      target: (sub) => `subscribers/${sub}/areas/all`,
    },
  ];

  for (const mapping of collectionMappings) {
    if (only && !only.has(mapping.key)) continue;
    await copyCollectionPath(db, mapping.source, mapping.target(subscriberUid), opts);
  }

  for (const mapping of documentMappings) {
    if (only && !only.has(mapping.key)) continue;
    if (mapping.requiresAdmin && !adminUid) {
      console.log(`(skip) ${mapping.key} requires --from ADMIN_UID`);
      continue;
    }
    const sourcePath = mapping.source(adminUid);
    const targetPath = mapping.target(subscriberUid);
    await copyDocumentPath(db, sourcePath, targetPath, opts, { optional: mapping.optional });
  }

  console.log("✅ Copy complete");
  if (opts.dryRun) {
    console.log("Dry run only – no data was written");
  }
}

main().catch((error) => {
  console.error("Clone failed", error);
  process.exitCode = 1;
});
