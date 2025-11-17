# Unread Message Badges - Testing Guide

## Overview
This guide walks through testing the live unread message notification badges feature in the Scheduler. Badges should appear in real-time as inbound emails arrive and disappear when the communications modal is opened.

## Prerequisite Setup
- Deploy completed: `firebase deploy --only hosting` ✅
- Firestore rules deployed (allow counter updates and message read flag) ✅
- Chat modal is functional and can send/receive messages ✅
- Zoho webhook is active and configured to post to `/api/zohoInboundEmail` ✅

## Feature Architecture
```
Inbound Email (Zoho Webhook)
  ↓
api/zohoInboundEmail.js
  - Stores message with read: false
  - Increments customers/{customerId}/counters.unreadCount
  ↓
scheduler.js (subscribeToCustomerUnreadCount)
  - onSnapshot listener on customer doc
  - Reads counters.unreadCount
  - Renders .badge-unread span (red, top-left)
  ↓
User Opens Communications Modal
  ↓
chat-controller.js (markCustomerMessagesAsRead)
  - Queries messages where read == false
  - Batch updates to read: true
  - Decrements counters.unreadCount atomically
  ↓
Badge Auto-Hides (count → 0)
```

## Test Cases

### Test 1: Live Badge Display
**Objective**: Verify badge appears on customer card in real-time when inbound email arrives.

**Steps**:
1. Open https://app.swashcleaning.co.uk/rep/scheduler.html
2. Navigate to a week with scheduled customers
3. Pick a customer with a booked job (has card on screen)
4. In another browser tab/window, trigger an inbound email to that customer:
   ```powershell
   # From PowerShell
   $uri = "https://app.swashcleaning.co.uk/api/zohoInboundEmail"
   $body = @{
       from = "john.smith@gmail.com"
       to = "support@swashcleaning.co.uk"
       subject = "Follow up on quote"
       body = "Hi, interested in booking the window cleaning service"
   } | ConvertTo-Json
   Invoke-WebRequest -Uri $uri -Method Post -Body $body -ContentType "application/json"
   ```
5. **Expected**: A small red badge with count "1" appears in top-left corner of customer card

**Pass Criteria**:
- ✅ Badge appears within 2 seconds of email arrival (via Firestore listener)
- ✅ Badge text displays "1"
- ✅ Badge styling: red background (#e11d48), white text, circular (18px), positioned top-left
- ✅ No page refresh required

---

### Test 2: Badge Auto-Hides When Modal Opens
**Objective**: Verify messages are marked read and badge disappears when communications modal is opened.

**Steps**:
1. From Test 1 setup: customer card has badge showing "1"
2. Click the customer card to open communications modal
3. **Expected**: 
   - Modal opens showing customer details and messages
   - Badge disappears from card (or hides immediately)
   - Firestore: verify `counters.unreadCount` decremented to 0
   - Firestore: verify message `read` field changed from `false` → `true`

**Pass Criteria**:
- ✅ Badge disappears within 1 second of modal opening
- ✅ Modal displays customer communications
- ✅ Firestore `customers/{customerId}/counters.unreadCount` = 0
- ✅ Firestore `customers/{customerId}/messages/{messageId}.read` = true

**Verify in Firestore Console**:
1. Go to Firebase Console > Firestore > customers > [customerId] > counters
2. Confirm `unreadCount: 0`
3. Go to messages subcollection
4. Click the message sent in Test 1
5. Confirm `read: true`

---

### Test 3: Badge Count Increments on Multiple Emails
**Objective**: Verify badge count increases as more unread emails arrive.

**Steps**:
1. Open scheduler with customer card visible (badge hidden or count 0)
2. Send first inbound email (same as Test 1)
   - **Expected**: Badge shows "1"
3. Send second inbound email
   - **Expected**: Badge updates to "2" in real-time
4. Send third inbound email
   - **Expected**: Badge updates to "3"

**Pass Criteria**:
- ✅ Badge appears after 1st email: "1"
- ✅ Badge updates to "2" after 2nd email (no refresh needed)
- ✅ Badge updates to "3" after 3rd email (no refresh needed)
- ✅ Each update visible within 1-2 seconds

---

### Test 4: Multiple Customer Cards Update Independently
**Objective**: Verify badges on different customer cards update independently.

**Steps**:
1. Open scheduler week with 3+ different customers visible
2. Send inbound email to Customer A
   - **Expected**: Only Customer A's card shows badge "1"; others hidden
3. Send inbound email to Customer B
   - **Expected**: Customer A shows "1", Customer B shows "1"
4. Send two more emails to Customer A
   - **Expected**: Customer A shows "3", Customer B still shows "1"

**Pass Criteria**:
- ✅ Each customer card has independent Firestore listener
- ✅ Badge displays correct count for each customer
- ✅ Updates to one customer don't affect others

---

### Test 5: Cross-Tab Real-Time Sync
**Objective**: Verify badge updates appear in real-time across multiple browser tabs without refresh.

**Steps**:
1. Open scheduler in **Tab 1** and **Tab 2** (same customer visible in both)
2. In **Tab 1**: Verify badge is hidden (count = 0)
3. In **Tab 2**: Verify badge is hidden
4. Send inbound email to the customer
5. **Expected**: Badge "1" appears in **both tabs** within 1-2 seconds (no refresh)
6. In **Tab 1**: Open communications modal
7. **Expected**: 
   - Badge disappears in **Tab 1** immediately
   - Badge disappears in **Tab 2** immediately (Firestore listener triggers)
   - No manual refresh needed in either tab

**Pass Criteria**:
- ✅ Tab 1 and Tab 2 receive Firestore updates independently
- ✅ Badge appears in both tabs in real-time
- ✅ Badge disappears in both tabs when modal opens (counters.unreadCount changes)

---

### Test 6: Outbound Emails Don't Increment Counter
**Objective**: Verify sending a reply/outbound email doesn't increment the unread counter.

**Steps**:
1. Customer has 2 unread inbound emails (badge shows "2")
2. Open communications modal
3. **Expected**: Badge disappears, counter → 0
4. Send an outbound reply message from the modal
5. Close modal
6. **Expected**: Badge remains hidden (counter stays 0, doesn't become 1)

**Pass Criteria**:
- ✅ Outbound messages are stored with `read: true` (not false)
- ✅ `counters.unreadCount` is not incremented for outbound emails
- ✅ Badge stays hidden after sending reply

---

### Test 7: Badge Caps at "99+"
**Objective**: Verify badges display "99+" for counts above 99.

**Steps**:
1. Send 100+ inbound emails to a customer (or manually increment counter in Firestore)
2. **Expected**: Badge displays "99+" (not "100" or "150")

**Pass Criteria**:
- ✅ Badge displays "99+" when unreadCount > 99
- ✅ Badge still functional; marking read decrements correctly

---

### Test 8: Badge Hides When Count Returns to 0
**Objective**: Verify badge hides (hidden attribute) when unreadCount reaches 0.

**Steps**:
1. Customer has badge showing "3"
2. Open communications modal
3. Messages batch-updated to read: true; counter decremented to 0
4. **Expected**: Badge element has `hidden` attribute; not visible

**Pass Criteria**:
- ✅ Badge element remains in DOM but `hidden = true`
- ✅ Styling: `.badge-unread { display: flex }` + `hidden` selector hides it
- ✅ When more emails arrive, badge re-shows (unhide and update count)

---

## Debugging Checklist

If badges don't appear, check:

### 1. Firestore Listener Attached?
```javascript
// In browser DevTools > Console:
// Look for logs from subscribeToCustomerUnreadCount
console.log("[Scheduler] subscribing to customer unread count for", customerId);
```

### 2. Counter Field Exists?
- Go to Firebase Console > Firestore > customers > [customerId]
- Verify `counters.unreadCount` exists (should be 0 or a number)
- If missing, manually add: `counters: { unreadCount: 0 }`

### 3. Message Has read Flag?
- Go to Firebase Console > Firestore > customers > [customerId] > messages > [messageId]
- Verify `read: false` on inbound emails
- Verify `read: true` on outbound emails

### 4. Firestore Rules Correct?
- Go to Firebase Console > Firestore > Rules
- Verify rule allows `counters.unreadCount` updates:
  ```
  allow update: if request.resource.data.diff(resource.data).changedKeys().hasOnly(["counters"]);
  ```

### 5. onSnapshot Import Added?
- Check `rep/scheduler.js` line 10-26
- Verify `onSnapshot` is in the firestore imports list
- If missing, add it and redeploy

### 6. Browser Console Errors?
- Open DevTools > Console
- Look for errors like:
  - `ReferenceError: onSnapshot is not defined`
  - `Failed to subscribe to customer unread count`
  - `Firestore permission denied`

---

## Manual Testing Commands

### Trigger Inbound Email
```powershell
$uri = "https://app.swashcleaning.co.uk/api/zohoInboundEmail"
$body = @{
    from = "test@example.com"
    to = "support@swashcleaning.co.uk"
    subject = "Test subject"
    body = "Test message body"
} | ConvertTo-Json

Invoke-WebRequest -Uri $uri -Method Post -Body $body -ContentType "application/json"
```

### Check Firestore Counter
1. Go to https://console.firebase.google.com/project/swash-app-436a1/firestore/data/customers
2. Find customer doc
3. Expand `counters` field
4. Verify `unreadCount` value

### Manually Update Counter (for testing)
1. In Firebase Console, click on customer doc
2. Edit `counters.unreadCount` value
3. Changes should reflect in scheduler badge within 1-2 seconds

---

## Troubleshooting

### Badge Not Appearing
**Possible Causes**:
1. `onSnapshot` import missing → add to scheduler.js imports and redeploy
2. Firestore rules blocking update → verify rules allow counters.unreadCount updates
3. Customer ID not resolved → check `getCachedCustomerId()` returns value
4. Counter field doesn't exist → manually create `counters: { unreadCount: 0 }` in Firestore

**Fix**:
- Check browser console for errors
- Verify Firestore rules and deploy
- Restart scheduler tab
- Check network tab for failed Firestore requests

### Badge Doesn't Hide When Modal Opens
**Possible Causes**:
1. `markCustomerMessagesAsRead()` not called → check chat-controller.js line 528
2. Batch update failed → check Firestore rules allow message read flag updates
3. Message doesn't have read field → verify messages have `read: false` or `read: true`

**Fix**:
- Check Firestore Console to verify counter is 0 and message.read is true
- Check browser console for batch update errors
- Verify Firestore rules allow:
  ```
  allow update: if request.auth != null && resource.data.read == false && request.resource.data.read == true;
  ```

---

## Success Criteria Summary
✅ Badge appears in real-time when inbound email arrives (no refresh)
✅ Badge count increments for each additional unread email
✅ Badge disappears when communications modal opens
✅ Multiple customer cards update independently
✅ Cross-tab sync works (one tab's modal close affects all tabs)
✅ Outbound emails don't increment counter
✅ Badge caps display at "99+"
✅ No console errors or Firestore permission denials

---

## Rollback Plan
If issues arise:
1. Revert `rep/scheduler.js` to remove `onSnapshot` from imports
2. Run `firebase deploy --only hosting`
3. Scheduler will continue to work (badges just won't appear)
4. All message functionality preserved

---

## Next Steps After Testing
- ✅ Test all 8 cases and confirm pass criteria
- ✅ Document any edge cases or missing features
- ✅ Update team on badge deployment status
- ✅ Monitor Firestore logs for any permission errors (go to Logs in Firebase Console)
