#!/usr/bin/env node
/*
 Enrichment script: adds repName to existing doorsknocked docs where missing.
 Usage:
   node scripts/enrich-doorsknocked-repname.js
 Requires:
   - GOOGLE_APPLICATION_CREDENTIALS set to service account json
   - firebase-admin installed
*/
const admin = require('firebase-admin');

try {
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    projectId: 'swash-app-436a1'
  });
} catch (e) {
  console.error('Failed to init firebase-admin:', e);
  process.exit(1);
}

const db = admin.firestore();

(async function main(){
  console.log('Loading rep names from users...');
  const repNameMap = {};
  try {
    const users = await db.collection('users').get();
    users.forEach(u => {
      const d = u.data() || {};
      const role = String(d.role || '').toLowerCase();
      if (role === 'rep') repNameMap[u.id] = d.name || d.repName || d.displayName || u.id;
    });
  } catch (e) {
    console.warn('Could not load users:', e.message || e);
  }
  const defaultName = id => repNameMap[id] || id;

  console.log('Querying doorsknocked without repName...');
  // Firestore has no IS NULL query; we scan and update where missing/empty
  const snap = await db.collection('doorsknocked').get();
  const bulk = db.bulkWriter();
  let toUpdate = 0, updated = 0;
  bulk.onWriteError(err => {
    if (err.failedAttempts < 5) return true; return false;
  });

  snap.forEach(docSnap => {
    const d = docSnap.data() || {};
    const rn = d.repName;
    const repId = d.repId;
    if (!repId) return; // nothing we can do
    if (typeof rn !== 'string' || rn.trim() === '') {
      toUpdate++;
      const repName = defaultName(repId);
      bulk.update(docSnap.ref, { repName });
    }
  });

  console.log(`Queued ${toUpdate} updates...`);
  await bulk.close();
  console.log('Enrichment complete.');
})();
