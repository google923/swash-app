/**
 * Firebase Cloud Functions for Swash Window Cleaning Management System
 * 
 * Revolut Payment Webhook Integration
 * Handles incoming payment notifications from Revolut Business API
 */

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const crypto = require('crypto');

admin.initializeApp();

const db = admin.firestore();

/**
 * Verify Revolut webhook signature
 * @param {string} payload - Raw request body as string
 * @param {string} signature - X-Revolut-Signature header value
 * @param {string} signingSecret - Webhook signing secret from Revolut
 * @returns {boolean} - True if signature is valid
 */
function verifyRevolutSignature(payload, signature, signingSecret) {
  if (!signature || !signingSecret) {
    console.warn('Missing signature or signing secret');
    return false;
  }

  try {
    // Revolut uses HMAC-SHA256 for signature verification
    const hmac = crypto.createHmac('sha256', signingSecret);
    hmac.update(payload);
    const expectedSignature = hmac.digest('hex');
    
    // Use timing-safe comparison to prevent timing attacks
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    );
  } catch (error) {
    console.error('Signature verification error:', error);
    return false;
  }
}

/**
 * Process payment and update customer quote status
 * @param {Object} transaction - Transaction data from Revolut webhook
 * @returns {Promise<Object>} - Result of the operation
 */
async function processPayment(transaction) {
  const { id: transactionId, reference, amount, currency, state } = transaction;

  if (!reference) {
    console.warn('Transaction missing reference code:', transactionId);
    return { success: false, error: 'No reference code provided' };
  }

  // Only process completed transactions
  if (state !== 'completed' && state !== 'COMPLETED') {
    console.log(`Transaction ${transactionId} state is ${state}, skipping`);
    return { success: false, error: `Transaction state is ${state}` };
  }

  try {
    // Query Firestore for quote with matching refCode
    const quotesRef = db.collection('quotes');
    const querySnapshot = await quotesRef
      .where('refCode', '==', reference.toUpperCase())
      .limit(1)
      .get();

    if (querySnapshot.empty) {
      console.warn(`No quote found with refCode: ${reference}`);
      return { success: false, error: 'Quote not found' };
    }

    const quoteDoc = querySnapshot.docs[0];
    const quoteData = quoteDoc.data();

    // Check if already marked as paid
    if (quoteData.paymentStatus === 'Paid') {
      console.log(`Quote ${quoteDoc.id} already marked as paid`);
      return { success: true, alreadyPaid: true };
    }

    // Update quote with payment information
    const updateData = {
      paymentStatus: 'Paid',
      paidDate: admin.firestore.FieldValue.serverTimestamp(),
      transactionId: transactionId,
      paymentAmount: parseFloat(amount),
      paymentCurrency: currency,
      status: 'Paid - Awaiting Booking',
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    await quoteDoc.ref.update(updateData);

    console.log(`Successfully processed payment for quote ${quoteDoc.id}`, {
      refCode: reference,
      transactionId,
      amount,
      currency
    });

    return {
      success: true,
      quoteId: quoteDoc.id,
      refCode: reference,
      amount,
      currency
    };

  } catch (error) {
    console.error('Error processing payment:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Revolut Webhook Endpoint
 * Receives payment notifications from Revolut Business API
 * 
 * Setup in Revolut Business:
 * 1. Go to Settings > API > Webhooks
 * 2. Create webhook with URL: https://YOUR_REGION-YOUR_PROJECT.cloudfunctions.net/revolutWebhook
 * 3. Subscribe to event: TransactionCreated
 * 4. Save the signing secret and store it in Firebase Config:
 *    firebase functions:config:set revolut.signing_secret="YOUR_SIGNING_SECRET"
 */
exports.revolutWebhook = functions.https.onRequest(async (req, res) => {
  // Only accept POST requests
  if (req.method !== 'POST') {
    console.warn('Non-POST request received');
    return res.status(405).send('Method Not Allowed');
  }

  try {
    // Get signing secret from Firebase config
    const signingSecret = functions.config().revolut?.signing_secret;
    
    if (!signingSecret) {
      console.error('Revolut signing secret not configured');
      return res.status(500).send('Webhook not configured');
    }

    // Get signature from header
    const signature = req.headers['x-revolut-signature'];
    
    // Verify webhook signature
    const rawBody = JSON.stringify(req.body);
    if (!verifyRevolutSignature(rawBody, signature, signingSecret)) {
      console.warn('Invalid webhook signature');
      return res.status(401).send('Invalid signature');
    }

    const payload = req.body;
    console.log('Received Revolut webhook:', {
      event: payload.event,
      timestamp: payload.timestamp
    });

    // Handle TransactionCreated event
    if (payload.event === 'TransactionCreated') {
      const transaction = payload.data || payload.transaction;
      
      if (!transaction) {
        console.warn('No transaction data in payload');
        return res.status(400).send('Invalid payload');
      }

      // Process the payment
      const result = await processPayment(transaction);

      if (result.success) {
        console.log('Payment processed successfully:', result);
        return res.status(200).json({ 
          received: true, 
          processed: true,
          quoteId: result.quoteId 
        });
      } else {
        console.warn('Payment processing failed:', result.error);
        // Still return 200 to acknowledge receipt
        return res.status(200).json({ 
          received: true, 
          processed: false,
          error: result.error 
        });
      }
    }

    // For other events, just acknowledge receipt
    console.log('Event not processed:', payload.event);
    return res.status(200).json({ received: true, processed: false });

  } catch (error) {
    console.error('Webhook handler error:', error);
    return res.status(500).send('Internal server error');
  }
});

/**
 * Manual payment reconciliation endpoint (admin only)
 * Allows manual matching of payments to quotes
 */
exports.manualPaymentReconciliation = functions.https.onCall(async (data, context) => {
  // Check authentication
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
  }

  // Check if user is admin
  const userDoc = await db.collection('users').doc(context.auth.uid).get();
  const userData = userDoc.data();
  
  if (!userData || userData.role !== 'admin') {
    throw new functions.https.HttpsError('permission-denied', 'Only admins can reconcile payments');
  }

  const { refCode, transactionId, amount, currency } = data;

  if (!refCode) {
    throw new functions.https.HttpsError('invalid-argument', 'refCode is required');
  }

  try {
    const quotesRef = db.collection('quotes');
    const querySnapshot = await quotesRef
      .where('refCode', '==', refCode.toUpperCase())
      .limit(1)
      .get();

    if (querySnapshot.empty) {
      throw new functions.https.HttpsError('not-found', `No quote found with refCode: ${refCode}`);
    }

    const quoteDoc = querySnapshot.docs[0];
    
    await quoteDoc.ref.update({
      paymentStatus: 'Paid',
      paidDate: admin.firestore.FieldValue.serverTimestamp(),
      transactionId: transactionId || 'MANUAL',
      paymentAmount: amount || null,
      paymentCurrency: currency || null,
      status: 'Paid - Awaiting Booking',
      manualReconciliation: true,
      reconciledBy: context.auth.uid,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    return {
      success: true,
      quoteId: quoteDoc.id,
      message: 'Payment reconciled successfully'
    };

  } catch (error) {
    console.error('Manual reconciliation error:', error);
    throw new functions.https.HttpsError('internal', error.message);
  }
});
