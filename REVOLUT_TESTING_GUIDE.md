# Revolut Payment Integration Testing Guide

This guide helps you test the Revolut payment integration before going live.

## Pre-Deployment Testing

### 1. Local Function Testing

Test the webhook signature verification locally:

```bash
cd functions
node test-webhook.js
```

Expected output: All 4 tests should pass (✓ PASS).

### 2. Deploy to Firebase

```bash
# Deploy Cloud Functions
firebase deploy --only functions

# Note the function URL from the output
# Example: https://us-central1-swash-app-436a1.cloudfunctions.net/revolutWebhook
```

### 3. Configure Signing Secret

Before the webhook can work, set the signing secret:

```bash
# Replace YOUR_SECRET with the actual secret from Revolut
firebase functions:config:set revolut.signing_secret="YOUR_SECRET"

# Redeploy to apply the config
firebase deploy --only functions
```

### 4. Verify Function Deployment

Check that the function is running:

```bash
# View recent logs
firebase functions:log --only revolutWebhook --limit 10

# Check function status in Firebase Console
# Go to: Firebase Console > Functions > revolutWebhook
```

## Revolut Sandbox Testing

### 1. Set Up Revolut Sandbox

1. Log in to [Revolut Business Sandbox](https://sandbox-business.revolut.com/)
2. Go to **Settings** > **API** > **Webhooks**
3. Click **Create webhook**

### 2. Configure Webhook

- **Webhook URL**: `https://YOUR_REGION-YOUR_PROJECT.cloudfunctions.net/revolutWebhook`
- **Events**: Select `TransactionCreated`
- **Description**: "Swash payment notifications (sandbox)"
- **Save** and copy the **signing secret**

### 3. Update Signing Secret

If you haven't already, configure the signing secret:

```bash
firebase functions:config:set revolut.signing_secret="YOUR_SANDBOX_SECRET"
firebase deploy --only functions
```

### 4. Create Test Quote

1. Go to your Swash quote calculator
2. Create a test quote
3. Note the **reference code** (e.g., "ABC123")
4. The quote status should be "Pending Payment"

### 5. Simulate Payment in Sandbox

In Revolut Sandbox:

1. Go to **Payments** > **Make a payment**
2. Select your sandbox account
3. Enter payment details:
   - **Amount**: Match the quote amount
   - **Reference**: Use the exact reference code from the quote
   - **Currency**: GBP (or as appropriate)
4. Confirm the payment

### 6. Verify Webhook Received

Check Firebase logs:

```bash
firebase functions:log --only revolutWebhook --limit 5
```

Expected log entries:
- "Received Revolut webhook: TransactionCreated"
- "Successfully processed payment for quote..."

### 7. Verify Quote Updated

1. Open the admin dashboard: `https://system.swashcleaning.co.uk/admin.html`
2. Find the test quote
3. Verify:
   - Status changed to "Paid - Awaiting Booking"
   - Filter by "Paid" shows the quote
   - Blue border/pill appears
4. Click on the quote to expand details
5. Verify payment information section shows:
   - ✓ Paid status
   - Paid date
   - Transaction ID
   - Payment amount

## Manual Reconciliation Testing

Test the manual "Mark as Paid" feature:

### 1. Create Test Quote

Create another test quote that will NOT receive automatic payment.

### 2. Mark as Paid Manually

1. Select the quote in admin dashboard
2. Click **Actions** > **Mark as paid**
3. Enter optional details:
   - Transaction ID: "MANUAL-TEST-001"
   - Amount: Match quote amount
   - Currency: GBP
4. Click **Mark as Paid**

### 3. Verify Manual Reconciliation

1. Quote status should update to "Paid - Awaiting Booking"
2. Payment details should show:
   - Transaction ID: "MANUAL-TEST-001"
   - Payment amount as entered
   - Current date as paid date

## Production Testing

### 1. Production Webhook Setup

⚠️ **Important**: Only do this after successful sandbox testing!

1. Log in to [Revolut Business (Production)](https://business.revolut.com/)
2. Go to **Settings** > **API** > **Webhooks**
3. Create webhook with **production** function URL
4. Copy the **production signing secret**

### 2. Update Production Secret

```bash
# Use production signing secret
firebase functions:config:set revolut.signing_secret="YOUR_PRODUCTION_SECRET"
firebase deploy --only functions
```

### 3. Small Value Test

1. Create a test quote with small value (e.g., £0.01)
2. Make an actual payment with the reference code
3. Verify webhook received and quote updated
4. If successful, proceed with normal operations

## Monitoring in Production

### Daily Monitoring

Check webhook health:

```bash
# View recent webhook activity
firebase functions:log --only revolutWebhook --limit 50

# Check for errors
firebase functions:log --only revolutWebhook --limit 50 | grep -i error
```

### Metrics to Monitor

In Firebase Console > Functions > revolutWebhook:

1. **Invocation count**: Should match expected payment volume
2. **Error rate**: Should be < 1%
3. **Execution time**: Should be < 2 seconds
4. **Memory usage**: Should be stable

### Common Issues

#### Webhook Not Received

**Symptoms**: Payment made but quote not updated

**Checks**:
1. Verify webhook URL is correct in Revolut
2. Check Firebase Functions logs for errors
3. Verify signing secret is configured
4. Check Revolut webhook delivery logs

**Fix**:
```bash
# Re-verify configuration
firebase functions:config:get

# Redeploy if needed
firebase deploy --only functions
```

#### Signature Verification Fails

**Symptoms**: Log shows "Invalid webhook signature"

**Checks**:
1. Verify signing secret matches Revolut
2. Check if webhook URL changed
3. Verify payload format

**Fix**:
```bash
# Update signing secret
firebase functions:config:set revolut.signing_secret="CORRECT_SECRET"
firebase deploy --only functions
```

#### Quote Not Found

**Symptoms**: Log shows "No quote found with refCode"

**Causes**:
- Customer used wrong reference code
- Reference code has typo or extra spaces
- Quote was deleted

**Solution**: Use manual reconciliation

#### Already Paid

**Symptoms**: Log shows "Quote already marked as paid"

**Cause**: Duplicate webhook delivery (Revolut retries)

**Action**: No action needed - idempotent handling

## Rollback Procedure

If issues occur in production:

### 1. Disable Webhook

In Revolut Business:
1. Go to Settings > API > Webhooks
2. Click on the webhook
3. Click **Disable** or **Delete**

### 2. Revert Deployment

```bash
# List recent deployments
firebase functions:list

# Revert if needed (manual process)
# Contact Firebase support for rollback assistance
```

### 3. Manual Processing

While webhook is disabled:
1. Payments will still be received by Revolut
2. Use manual "Mark as Paid" in admin dashboard
3. Match payments to quotes using Revolut transaction history

## Performance Expectations

- **Webhook latency**: < 2 seconds from payment to quote update
- **Success rate**: > 99%
- **Signature verification**: 100% for valid webhooks
- **Memory usage**: < 256 MB per invocation
- **Cold start**: < 3 seconds

## Security Checklist

- [x] Signature verification implemented (HMAC-SHA256)
- [x] Signing secret stored in Firebase Config (not in code)
- [x] HTTPS only for webhook endpoint
- [x] Admin authentication required for manual reconciliation
- [x] Audit trail (timestamps, transaction IDs) recorded
- [x] Idempotent webhook handling (duplicate delivery safe)

## Support Contacts

- **Firebase Issues**: Firebase Console > Support
- **Revolut API Issues**: Revolut Business > Help > API Support
- **Swash System Issues**: Contact admin team

## Next Steps After Testing

Once testing is complete and successful:

1. ✅ Document webhook URL for team reference
2. ✅ Set up monitoring alerts in Firebase
3. ✅ Train admin staff on manual reconciliation
4. ✅ Create customer communication about payment process
5. ✅ Set up regular audit of payment records
6. ✅ Schedule monthly review of webhook metrics

## Testing Checklist

Before going live, verify:

- [ ] Sandbox webhook receives and processes test payments
- [ ] Quote status updates automatically
- [ ] Payment details display correctly in admin dashboard
- [ ] Manual reconciliation works for edge cases
- [ ] Filters correctly show paid vs pending quotes
- [ ] Payment information section shows in details panel
- [ ] Signature verification rejects invalid webhooks
- [ ] Error handling logs issues without crashing
- [ ] Production webhook configured with correct URL
- [ ] Production signing secret configured
- [ ] Small value test payment successful
- [ ] Team trained on monitoring and troubleshooting
