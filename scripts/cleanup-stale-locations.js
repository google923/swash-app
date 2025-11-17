/**
 * Cleanup Script: Remove stale repLocation documents
 * Run with: node scripts/cleanup-stale-locations.js
 * 
 * This removes repLocation documents older than 15 minutes to prevent
 * offline reps from appearing as "online not tracking" on admin map.
 * 
 * Requires: firebase-admin (install with: npm install firebase-admin)
 * Or use: firebase firestore:delete repLocations/[repId] --project swash-app-436a1
 */

import admin from 'firebase-admin';

// Initialize with application default credentials (uses Firebase CLI login)
admin.initializeApp({
  projectId: 'swash-app-436a1'
});

const db = admin.firestore();

const STALE_THRESHOLD_MS = 15 * 60 * 1000; // 15 minutes

async function cleanupStaleLocations() {
  console.log('[Cleanup] Checking repLocations collection...');
  
  try {
    const snapshot = await db.collection('repLocations').get();
    let deletedCount = 0;
    let keptCount = 0;
    
    for (const docSnap of snapshot.docs) {
      const data = docSnap.data();
      const repId = data.repId || docSnap.id;
      
      if (!data.timestamp) {
        console.log(`⚠️  ${repId}: No timestamp found, keeping for safety`);
        keptCount++;
        continue;
      }
      
      const locationAge = Date.now() - new Date(data.timestamp).getTime();
      const ageMinutes = Math.round(locationAge / 60000);
      
      if (locationAge > STALE_THRESHOLD_MS) {
        console.log(`🗑️  Deleting ${repId} (${ageMinutes} min old)`);
        await docSnap.ref.delete();
        deletedCount++;
      } else {
        console.log(`✓  Keeping ${repId} (${ageMinutes} min old)`);
        keptCount++;
      }
    }
    
    console.log(`\n[Cleanup Complete]`);
    console.log(`  Deleted: ${deletedCount} stale locations`);
    console.log(`  Kept: ${keptCount} active locations`);
    
  } catch (error) {
    console.error('[Cleanup Failed]', error);
    process.exit(1);
  }
  
  process.exit(0);
}

cleanupStaleLocations();
