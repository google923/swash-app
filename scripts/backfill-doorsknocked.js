#!/usr/bin/env node
/*
 Backfill script: copies historical doorLogs into flat doorsknocked collection.
 Usage:
   node scripts/backfill-doorsknocked.js --days=180

 Requires:
   - Application Default Credentials (set GOOGLE_APPLICATION_CREDENTIALS to a service account key JSON)
   - firebase-admin dependency

 Fields mapped:
   repId, date (YYYY-MM-DD), timestamp (ISO), gpsLat, gpsLng, status,
   territoryId, houseNumber, roadName, notes

 Skips documents already existing (by original door log document ID).
 Uses BulkWriter for speed and retry handling.
*/

const admin = require('firebase-admin');
const path = require('path');

// Initialize admin SDK
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
const args = process.argv.slice(2);
const daysArg = args.find(a => a.startsWith('--days='));
const DAYS = daysArg ? parseInt(daysArg.split('=')[1], 10) : 180;

(async function main() {
  console.log(`Starting backfill for last ${DAYS} days...`);
  const since = new Date(Date.now() - DAYS * 86400000);
  const startDay = new Date(since.getFullYear(), since.getMonth(), since.getDate());
  const today = new Date();

  // Load rep names from users collection (best effort)
  const repNameMap = {};
  try {
    const usersSnap = await db.collection('users').get();
    usersSnap.forEach(u => {
      const d = u.data() || {};
      const role = String(d.role || '').toLowerCase();
      if (role === 'rep') {
        repNameMap[u.id] = d.name || d.repName || d.displayName || u.id;
      }
    });
    console.log(`Loaded ${Object.keys(repNameMap).length} rep names`);
  } catch (e) {
    console.warn('Warning: could not fetch users for repName mapping; continuing without names');
  }

  // Discover reps by listing repLogs root documents
  console.log('Listing rep IDs from repLogs root...');
  const repDocs = await db.collection('repLogs').listDocuments();
  const repIds = repDocs.map(d => d.id);
  console.log(`Found ${repIds.length} reps: ${repIds.join(', ')}`);

  const bulk = db.bulkWriter();
  let processed = 0;
  let skippedExists = 0;
  let errors = 0;

  bulk.onWriteError(err => {
    errors++;
    console.warn('Write error:', err);
    // Retry up to a few times
    if (err.failedAttempts < 5) {
      return true;
    }
    return false;
  });

  for (const repId of repIds) {
    console.log(`\nRep ${repId}...`);
    for (let d = new Date(startDay); d <= today; d = new Date(d.getTime() + 86400000)) {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      const dateKey = `${y}-${m}-${day}`;
      const doorLogsCol = db.collection('repLogs').doc(repId).collection('dates').doc(dateKey).collection('doorLogs');
      let snap;
      try {
        snap = await doorLogsCol.get();
      } catch (e) {
        continue; // missing date doc, ignore
      }
      if (snap.empty) continue;

      for (const docSnap of snap.docs) {
        const data = docSnap.data();
        if (typeof data.gpsLat !== 'number' || typeof data.gpsLng !== 'number') continue;
        const targetRef = db.collection('doorsknocked').doc(docSnap.id);
        const existing = await targetRef.get();
        if (existing.exists) { skippedExists++; continue; }
        const ts = data.timestamp || `${dateKey}T00:00:00.000Z`;
        const payload = {
          repId,
          repName: repNameMap[repId] || repId,
          date: dateKey,
          timestamp: ts,
          gpsLat: data.gpsLat,
            gpsLng: data.gpsLng,
          status: data.status || 'Unknown',
          territoryId: data.territoryId || null,
          houseNumber: data.houseNumber || data.doorNumber || '',
          roadName: data.roadName || data.street || '',
          notes: data.note || '',
          backfilled: true
        };
        bulk.set(targetRef, payload);
        processed++;
      }
    }
  }

  await bulk.close();
  console.log('\nBackfill complete');
  console.log(`Written: ${processed}`);
  console.log(`Skipped existing: ${skippedExists}`);
  console.log(`Write errors: ${errors}`);
})();
