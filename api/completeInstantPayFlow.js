// Vercel serverless function: Complete a GoCardless Billing Request flow after redirect
// Called when the customer returns from Instant Bank Pay checkout so the payment can be submitted.

const admin = require('firebase-admin');

if (!admin.apps.length) {
  try {
    admin.initializeApp();
  } catch (error) {
    console.warn('[completeInstantPayFlow] Firebase admin init failed', error);
  }
}

const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;
function applyCors(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400');
  return true;
}

function getGcHost() {
  const env = (process.env.GC_ENV || '').toLowerCase();
  return env === 'sandbox' ? 'https://api-sandbox.gocardless.com' : 'https://api.gocardless.com';
}

async function applySandboxCredits({ billingRequestId, subscriberId, creditsOverride, tolerateMissingPurchase }) {
  if (!billingRequestId) return { applied: false };
  try {
    let purchasesSnap = await db.collectionGroup('smsPurchases')
      .where('billingRequestId', '==', billingRequestId)
      .get();

    if (purchasesSnap.empty && subscriberId) {
      purchasesSnap = await db.collection('subscribers').doc(subscriberId).collection('smsPurchases')
        .where('billingRequestId', '==', billingRequestId)
        .get();
    }

    if (purchasesSnap.empty) {
      if (!tolerateMissingPurchase) {
        console.warn('[completeInstantPayFlow] No purchases found for billing request', billingRequestId);
        return { applied: false };
      }

      if (!subscriberId) {
        return { applied: false, error: 'Missing purchase and subscriberId' };
      }

      const creditsToApply = Number(creditsOverride) || 0;
      if (!creditsToApply) {
        return { applied: false, error: 'Missing purchase and no credits override provided' };
      }

      const fallbackSettingsRef = db.collection('subscribers').doc(subscriberId).collection('private').doc('smsSettings');
      await db.runTransaction(async (tx) => {
        tx.set(fallbackSettingsRef, {
          creditsBalance: FieldValue.increment(creditsToApply),
          lastTopUpAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
      });

      return { applied: true, autoCompleted: true };
    }

    let updated = 0;
    for (const docSnap of purchasesSnap.docs) {
      const ref = docSnap.ref;
      const segments = ref.path.split('/');
      const idx = segments.indexOf('subscribers');
      const resolvedSubscriberId = idx > -1 && segments[idx + 1] ? segments[idx + 1] : subscriberId;
      if (!resolvedSubscriberId) continue;

      await db.runTransaction(async (tx) => {
        const latest = await tx.get(ref);
        if (!latest.exists) return;
        const data = latest.data() || {};
        const creditsValue = Number(data.credits) || Number(creditsOverride) || 0;
        if (creditsValue <= 0) return;
        if ((data.status || '').toLowerCase() === 'completed') return;

        const settingsRef = db.collection('subscribers').doc(resolvedSubscriberId).collection('private').doc('smsSettings');
        tx.set(settingsRef, {
          creditsBalance: FieldValue.increment(creditsValue),
          lastTopUpAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });

        tx.set(ref, {
          status: 'completed',
          completedAt: FieldValue.serverTimestamp(),
          sandboxAutoCompleted: true,
        }, { merge: true });
      });
      updated += 1;
    }

    return { applied: updated > 0, autoCompleted: updated > 0 };
  } catch (error) {
    console.error('[completeInstantPayFlow] Failed to apply sandbox credits', error);
    return { applied: false, error: error?.message || String(error) };
  }
}

module.exports = async (req, res) => {
  const corsAllowed = applyCors(req, res);

  if (req.method === 'OPTIONS') {
    if (!corsAllowed) {
      return res.status(403).json({ error: 'Origin not allowed' });
    }
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!corsAllowed) {
    return res.status(403).json({ error: 'Origin not allowed' });
  }

  const apiKey = process.env.GC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Missing GoCardless credentials (GC_API_KEY)' });
  }

  const {
    redirectFlowId,
    billingRequestId: billingRequestIdFromClient,
    subscriberId,
    credits: creditsFromClient,
    sandboxForce,
  } = req.body || {};
  if (!redirectFlowId || typeof redirectFlowId !== 'string') {
    return res.status(400).json({ error: 'redirectFlowId is required' });
  }

  const host = getGcHost();
  const headers = {
    'Authorization': `Bearer ${apiKey}`,
    'GoCardless-Version': '2015-07-06',
    'Content-Type': 'application/json',
  };

  try {
    const response = await fetch(`${host}/billing_request_flows/${redirectFlowId}/actions/complete`, {
      method: 'POST',
      headers,
      body: JSON.stringify({}),
    });

    if (!response.ok) {
      const text = await response.text();
      return res.status(response.status || 502).json({ error: 'Failed to complete billing request flow', details: text });
    }

    const data = await response.json().catch(() => ({}));
    const flow = data && (data.billing_request_flows || data.billing_request_flow || data.data);
    const billingRequest = billingRequestIdFromClient || flow && (flow.links?.billing_request || flow.billing_request_id || flow.billing_request);

    let sandboxResult = { applied: false };
    if ((process.env.GC_ENV || '').toLowerCase() === 'sandbox' && billingRequest) {
      sandboxResult = await applySandboxCredits({
        billingRequestId: billingRequest,
        subscriberId,
        creditsOverride: creditsFromClient,
        tolerateMissingPurchase: Boolean(sandboxForce),
      });
    }

    return res.status(200).json({
      success: true,
      billing_request_id: billingRequest || null,
      flow,
      sandboxApplied: sandboxResult.applied,
      sandboxError: sandboxResult.error || null,
      sandboxAutoCompleted: sandboxResult.autoCompleted || false,
    });
  } catch (error) {
    return res.status(500).json({ error: 'Unexpected error completing billing request flow', message: error?.message || String(error) });
  }
};
