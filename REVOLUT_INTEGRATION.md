# Revolut Payment Integration Guide

This document explains how to set up and use the Revolut Business API integration for automatic payment tracking in the Swash window cleaning management system.

## Overview

When a customer makes a payment to your Revolut Business account with their reference code (e.g., "ABC123"), the system automatically:
1. Receives a webhook notification from Revolut
2. Matches the payment to the customer's quote using the reference code
3. Updates the quote status to "Paid"
4. Records payment details (amount, date, transaction ID)

## Prerequisites

- Revolut Business account
- Firebase project with Cloud Functions enabled (Blaze plan required)
- Admin access to Swash admin dashboard

## Setup Instructions

### 1. Deploy Firebase Cloud Functions

The webhook handler is implemented as a Firebase Cloud Function. Deploy it:

```bash
# Install Firebase CLI if not already installed
npm install -g firebase-tools

# Login to Firebase
firebase login

# Deploy the functions
firebase deploy --only functions
```

After deployment, note the function URL. It will be something like:
```
https://us-central1-swash-app-436a1.cloudfunctions.net/revolutWebhook
```

### 2. Configure the Signing Secret

Firebase Functions need a signing secret to verify webhook authenticity:

```bash
# Set the signing secret (you'll get this from Revolut in step 3)
firebase functions:config:set revolut.signing_secret="YOUR_SIGNING_SECRET_HERE"

# Redeploy to apply the config
firebase deploy --only functions
```

### 3. Create Webhook in Revolut Business

1. Log in to your Revolut Business account
2. Go to **Settings** > **API** > **Webhooks**
3. Click **Create webhook**
4. Configure the webhook:
   - **URL**: Your Cloud Function URL from step 1
   - **Events**: Select `TransactionCreated`
   - **Description**: "Swash payment notifications"
5. Save the webhook
6. **Important**: Copy the **signing secret** provided by Revolut
7. Use the signing secret in step 2 above if you haven't already

### 4. Test the Integration

#### Test with Revolut Sandbox (Recommended)

1. Use Revolut's sandbox environment for testing
2. Create a test transaction with a reference code matching a quote in your system
3. Check Firebase Functions logs to verify webhook received:
   ```bash
   firebase functions:log
   ```
4. Check the admin dashboard to see the quote status updated to "Paid"

#### Test with Real Payment (Production)

1. Create a test quote in the system and note the reference code
2. Make a small payment to your Revolut Business account using that reference code
3. Verify the quote status updates automatically

## Payment Flow

### Customer Payment Process

1. Customer receives quote with unique reference code (e.g., "XYZ789")
2. Customer makes bank transfer to your Revolut Business account
3. Customer includes the reference code in the payment reference field
4. Revolut processes the payment and sends webhook to your system
5. System automatically:
   - Finds the matching quote by reference code
   - Updates status to "Paid - Awaiting Booking"
   - Records payment amount, date, and transaction ID

### Admin Dashboard

The admin dashboard now shows payment status:
- **Filter by status**: Use the "Status" filter to view:
  - Pending Payment - Awaiting customer payment
  - Paid - Payment received, awaiting booking
  - Needs Booking - Ready to be scheduled
  - Booked - Scheduled for cleaning
  - Cancelled - Archived/cancelled quotes

- **Visual indicators**:
  - Blue border/pill: Paid status
  - Orange border/pill: Pending payment
  - Green border/pill: Booked
  - Red border/pill: Cancelled

## Manual Payment Reconciliation

If a payment doesn't automatically match (e.g., customer used wrong reference code), admins can manually reconcile:

1. Note the transaction details from Revolut
2. In the admin dashboard, use the browser console:
   ```javascript
   const reconcile = firebase.functions().httpsCallable('manualPaymentReconciliation');
   reconcile({
     refCode: 'ABC123',
     transactionId: 'transaction-id-from-revolut',
     amount: 150.00,
     currency: 'GBP'
   }).then(result => {
     console.log('Reconciled:', result.data);
   });
   ```

## Data Model

New fields added to the `quotes` collection in Firestore:

| Field | Type | Description |
|-------|------|-------------|
| `paymentStatus` | string | "Paid" or null |
| `paidDate` | timestamp | When payment was received |
| `transactionId` | string | Revolut transaction ID |
| `paymentAmount` | number | Amount paid |
| `paymentCurrency` | string | Currency code (e.g., "GBP") |
| `manualReconciliation` | boolean | True if manually reconciled |
| `reconciledBy` | string | User ID who reconciled (if manual) |

## Troubleshooting

### Webhook Not Receiving Events

1. Check Firebase Functions logs:
   ```bash
   firebase functions:log --only revolutWebhook
   ```
2. Verify the webhook URL is correct in Revolut
3. Ensure the signing secret is configured correctly
4. Check that Firebase project is on Blaze plan (required for external requests)

### Payment Not Matching Quote

Common issues:
- **Wrong reference code**: Customer didn't use the exact reference code
- **Case sensitivity**: System converts to uppercase, but check original
- **Extra characters**: Customer added spaces or extra text
- **Quote not in system**: Reference code doesn't exist in Firestore

Solution: Use manual reconciliation (see above)

### Signature Verification Failing

1. Verify signing secret is correct:
   ```bash
   firebase functions:config:get
   ```
2. Check that secret matches what Revolut provided
3. Ensure webhook payload hasn't been modified in transit
4. Check Revolut IP allowlist if you have network restrictions

## Security Considerations

1. **Signature Verification**: All webhooks are verified using HMAC-SHA256 with the signing secret
2. **HTTPS Only**: Webhook endpoint uses HTTPS for encrypted communication
3. **Idempotency**: System handles duplicate webhook deliveries safely
4. **Admin Access**: Manual reconciliation requires admin authentication
5. **Audit Trail**: All payment updates are timestamped and logged

## Monitoring

Monitor webhook performance:
```bash
# View recent function executions
firebase functions:log --only revolutWebhook --limit 50

# Monitor function metrics in Firebase Console
# Go to: Firebase Console > Functions > revolutWebhook > Metrics
```

Key metrics to watch:
- Invocation count
- Error rate
- Execution time
- Memory usage

## Support

For issues or questions:
1. Check Firebase Functions logs first
2. Review Revolut webhook delivery logs in their dashboard
3. Verify quote exists in Firestore with correct refCode
4. Check system status in Firebase Console

## Future Enhancements

Potential improvements:
- Email notifications to customers when payment received
- SMS notifications for payment confirmation
- Payment history view for customers
- Automated refund handling
- Multi-currency support
- Payment plan tracking
