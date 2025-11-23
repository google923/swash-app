# Quote Sending Workflow - Testing Checklist

## Critical Path: Rep Sends Quote to Customer

### 1. Access & Authentication
- [ ] Log in with rep credentials at `/rep/add-new-customer.html`
- [ ] Verify "Rep Code" is prefilled with your username
- [ ] Verify "Quote Date" shows today's date (DD/MM/YYYY format)
- [ ] Verify menu button works and shows navigation
- [ ] Verify "Sign out" button works

### 2. Quote Calculation
- [ ] Select Service Tier (e.g., Gold)
- [ ] Verify tier description updates
- [ ] Select House Type (e.g., Detached)
- [ ] Select House Size (e.g., 4 bed)
- [ ] (Optional) Check Conservatory or Extension
- [ ] (Optional) Adjust Roof Lanterns or Skylights sliders
- [ ] Click **Calculate Quote**
- [ ] Verify quote displays: "Price per clean" and "Three cleans upfront"
- [ ] Verify customer details form appears below

### 3. Quote Submission
- [ ] Fill in Customer Details:
  - [ ] Full Name (required)
  - [ ] Address (required)
  - [ ] Mobile (required)
  - [ ] Email (required - valid email format)
- [ ] Click **Send Quote**
- [ ] Verify success message appears (one of):
  - "Quote emailed to..." (email sent successfully)
  - "Quote will need to be sent manually" (saved but email failed)
  - "Email queued. We will send automatically when online" (offline mode)
  - "Quote saved offline. Will sync automatically when back online" (offline mode)

### 4. Verify Quote in Firestore
- [ ] Open Firebase Console: https://console.firebase.google.com/project/swash-app-436a1
- [ ] Go to Firestore → Collections → **quotes**
- [ ] Look for newest document with your test customer details
- [ ] Verify fields match:
  - `repCode` = your username
  - `customerName` = entered name
  - `email` = entered email
  - `tier` = selected tier
  - `pricePerClean` = calculated amount
  - `price` (upfront) = 3x per clean
  - `refCode` = 6-character unique reference
  - `status` = "Pending Payment"

### 5. Verify Email Sent (if online)
- [ ] Check the customer's inbox for email from system
- [ ] Verify email contains:
  - [ ] Customer name
  - [ ] Address
  - [ ] Quote price
  - [ ] Payment reference code (refCode)
  - [ ] Next steps / payment instructions

### 6. Offline Testing (if needed)
- [ ] Open DevTools → Network → Offline
- [ ] Fill quote form and submit
- [ ] Verify offline message appears
- [ ] Go back online
- [ ] Verify offline queue appears or auto-syncs
- [ ] Verify quote appears in Firestore after sync

## Expected Email Template
Template ID: `template_rqdf3xf`
Service ID: `service_cdy739m`

Email should include:
- Customer name
- House type and size
- Plan (Silver/Gold/Gold For Silver)
- Extras (Conservatory, Extension, Lanterns, Skylights)
- Price per clean
- Total upfront amount
- Payment reference code

## Known Issues to Watch For
1. Quote date not showing → Check if readonly field is being populated
2. Calculate button not showing result → Check browser console for errors
3. Email not sending → Verify network is online
4. Menu doesn't open → Check dropdown CSS has `show` class handler

## Success Criteria
✅ Quote calculated correctly
✅ Customer details captured
✅ Quote saved to Firestore
✅ Email sent to customer (or queued if offline)
✅ Payment reference generated
✅ Visible success message to rep
