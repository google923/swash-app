// Central billing hook for recording seat changes and other billing events
// This module logs events to Firestore so your billing provider (or a backend job)
// can reconcile and apply charges. Swap this out later for a direct API call.

import { db } from './firebase-init.js';
import {
  collection,
  addDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

/**
 * Record a billing seat delta for the subscriber.
 * @param {string} subscriberId - The tenant/subscriber owner uid
 * @param {number} delta - Positive to add seats, negative to remove seats, 0 to no-op
 * @param {string} reason - Short reason code, e.g. 'cleaner-added', 'cleaner-deleted', 'cleaner-status-changed'
 * @param {object} context - Optional extra context, e.g. { cleanerId, cleanerName }
 */
export async function updateBillingSeatDelta(subscriberId, delta, reason, context = {}) {
  try {
    if (!subscriberId) throw new Error('Missing subscriberId');
    if (!Number.isFinite(delta)) throw new Error('Delta must be a number');
    if (!reason) reason = 'unspecified';
    if (delta === 0) return; // No-op

    const eventsRef = collection(db, `subscribers/${subscriberId}/billingEvents`);
    await addDoc(eventsRef, {
      type: 'seat-delta',
      delta,
      reason,
      context,
      createdAt: serverTimestamp(),
    });

    console.log(`[Billing] Seat delta recorded: sub=${subscriberId} delta=${delta} reason=${reason}`);
  } catch (err) {
    console.warn('[Billing] Failed to record seat delta', err?.message || err);
  }
}
