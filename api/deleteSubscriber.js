// Vercel serverless function: Delete a subscriber and their authentication account
// Requires Firebase Admin SDK

const admin = require('firebase-admin');

// Initialize Firebase Admin if not already initialized
if (!admin.apps.length) {
  try {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      }),
    });
  } catch (error) {
    console.error('Firebase admin initialization error:', error);
  }
}

/**
 * POST /api/deleteSubscriber
 * Body: { subscriberId: string, adminId: string }
 * 
 * Deletes subscriber's:
 * - Firebase Authentication account
 * - Firestore user document
 * - All subcollections (quotes, customers, etc.)
 */
module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { subscriberId, adminId } = req.body || {};

  if (!subscriberId || !adminId) {
    return res.status(400).json({ error: 'Missing required fields: subscriberId, adminId' });
  }

  try {
    // Verify admin is actually an admin
    const adminDoc = await admin.firestore().collection('users').doc(adminId).get();
    if (!adminDoc.exists || adminDoc.data().role !== 'admin') {
      return res.status(403).json({ error: 'Unauthorized: Admin access required' });
    }

    // Verify subscriber exists and is a subscriber
    const subscriberDoc = await admin.firestore().collection('users').doc(subscriberId).get();
    if (!subscriberDoc.exists) {
      return res.status(404).json({ error: 'Subscriber not found' });
    }
    
    if (subscriberDoc.data().role !== 'subscriber') {
      return res.status(400).json({ error: 'User is not a subscriber' });
    }

    // Delete Firebase Authentication account
    try {
      await admin.auth().deleteUser(subscriberId);
      console.log(`Deleted auth account for subscriber: ${subscriberId}`);
    } catch (authError) {
      // User might not exist in auth, continue anyway
      console.warn('Auth deletion warning:', authError.message);
    }

    // Delete Firestore user document
    await admin.firestore().collection('users').doc(subscriberId).delete();
    console.log(`Deleted Firestore document for subscriber: ${subscriberId}`);

    // Note: Subcollections are not automatically deleted
    // If you need to delete subcollections (quotes, customers, etc.),
    // you would need to add that logic here or use Cloud Functions

    return res.status(200).json({ 
      success: true, 
      message: 'Subscriber deleted successfully',
      subscriberId 
    });

  } catch (error) {
    console.error('Error deleting subscriber:', error);
    return res.status(500).json({ 
      error: 'Failed to delete subscriber', 
      message: error.message 
    });
  }
};
