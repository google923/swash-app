# 🧪 UNREAD BADGES - DIAGNOSTIC TESTING PROCEDURE

**Goal**: Find out why the badge isn't appearing on the customer card

---

## STEP 1: Open the Scheduler & DevTools

1. Go to: https://app.swashcleaning.co.uk/rep/scheduler.html
2. **Hard refresh** the page (Ctrl+Shift+R) to clear cache
3. **Open DevTools** (Press F12)
4. Go to **Console** tab
5. **Keep DevTools open** for all remaining steps

---

## STEP 2: Send an Inbound Email

You already have a test customer "CHRISTOPHER WESSELL" visible on the scheduler card.

Send an inbound email to this customer:

**Option A - PowerShell Command** (Easiest):
```powershell
$uri = "https://app.swashcleaning.co.uk/api/zohoInboundEmail"
$body = @{
    from = "wessellchris882@gmail.com"
    to = "support@swashcleaning.co.uk"
    subject = "Test unread message"
    body = "This is a test to see if the badge appears"
} | ConvertTo-Json

Invoke-WebRequest -Uri $uri -Method Post -Body $body -ContentType "application/json"
```

**Option B - Manual**: Send email to support@swashcleaning.co.uk from wessellchris882@gmail.com

After sending, **wait 2-3 seconds** and check the scheduler card.

---

## STEP 3: Check What You See

### 🔍 QUESTION 1: Does the badge appear on the customer card?

**If YES** ✅:
- Feature is working! Skip to "Success" section below
- Check badge shows count "1"
- Check it's red (#e11d48)
- Check it's in top-left corner

**If NO** ❌:
- Go to STEP 4 (Diagnostic Logging)

---

## STEP 4: Check DevTools Console Logs

Look for logs starting with `[Scheduler]`. 

**Copy ALL logs you see** that mention:
- `[Scheduler]`
- `Card rendering for quote`
- `subscribeToCustomerUnreadCount`
- Any errors (red text)

**Example of what you're looking for**:
```
[Scheduler] Card rendering for quote CHRISTOPHER WESSELL {quoteId: "...", inlineCustomerId: "...", ...}
[Scheduler] Setting up unread count subscription for customer abc123
[Scheduler] Unread count listener fired for customer abc123 {unreadCount: 1, hasCounters: true}
[Scheduler] Created new badge element for customer abc123
```

---

## STEP 5: Check Each Part of the Data Flow

### Check A: Is the customer ID being resolved?

In DevTools Console, run this command:
```javascript
// Find the customer card element
const card = document.querySelector('[data-id*="wessell"]');
console.log('Card customerId:', card?.dataset.customerId);
console.log('Card element exists:', !!card);
```

**Expected output**:
```
Card customerId: "some-long-id-string"
Card element exists: true
```

**If customerId is undefined or null**, that's the problem.

### Check B: Is Firestore returning data?

In DevTools Console, run this:
```javascript
// Check if listener is even firing
const card = document.querySelector('[data-id*="wessell"]');
if (card?.dataset?.customerId) {
  const { doc, getFirestore, onSnapshot } = window.firebase.firestore;
  const db = getFirestore();
  const customerRef = doc(db, 'customers', card.dataset.customerId);
  onSnapshot(customerRef, (snap) => {
    console.log('Customer doc data:', snap.data());
    console.log('Unread count:', snap.data()?.counters?.unreadCount);
  });
}
```

**Expected output**:
```
Customer doc data: {name: "...", counters: {unreadCount: 1}, ...}
Unread count: 1
```

**If unreadCount is 0 or missing**, that's the problem.

### Check C: Check Firestore Directly

1. Go to: https://console.firebase.google.com/project/swash-app-436a1/firestore/data/customers
2. **Search for the customer** by name "CHRISTOPHER WESSELL" (or email wessellchris882@gmail.com)
3. **Click on the customer doc**
4. **Look for field**: `counters` → `unreadCount`
5. **What value do you see?** (Should be 1 or higher)

**Expected**:
```
customers/
  [customer-id]/
    counters: {
      unreadCount: 1
    }
    messages/
      [message-id]: {
        read: false
        subject: "Test unread message"
        ...
      }
```

---

## STEP 6: Check CSS Styling

In DevTools, check if the badge CSS is loaded:

```javascript
// Check if CSS exists
const badgeStyle = getComputedStyle(document.querySelector('.badge-unread'));
console.log('Badge background:', badgeStyle.background);
console.log('Badge display:', badgeStyle.display);
```

**Expected**:
```
Badge background: rgb(225, 29, 72)  /* Red #e11d48 */
Badge display: flex
```

---

## STEP 7: Manual Test - Create Badge Directly

If the badge still doesn't appear, let's manually create one to verify CSS works:

```javascript
const card = document.querySelector('[data-id*="wessell"]');
if (card) {
  const badge = document.createElement('span');
  badge.className = 'badge-unread';
  badge.textContent = '1';
  card.style.position = 'relative';
  card.appendChild(badge);
  console.log('Manual badge created - can you see it on the card?');
}
```

**If you see a red "1" badge appear** ✅:
- CSS is working
- Problem is with the Firestore listener

**If you DON'T see a badge** ❌:
- Problem is with CSS or DOM positioning

---

## STEP 8: Check Browser Console for Errors

**Look for error messages** (red text in console):

- `Uncaught ReferenceError: onSnapshot is not defined`
  → Missing import
  
- `Firestore permission denied`
  → Rules blocking the read
  
- `Customer document not found`
  → Document doesn't exist in Firestore
  
- `Failed to subscribe to customer unread count`
  → Listener subscription failed

**Copy the full error message** if you see any.

---

## STEP 9: Check Firestore Rules

Go to: https://console.firebase.google.com/project/swash-app-436a1/firestore/rules

Look for rules that mention `customers`. 

Check that the rule allows `read` access:
```
allow read: if request.auth != null;
```

If you see `allow read: if false;` or nothing, rules are blocking reads.

---

## Summary: What to Report

When you've done these steps, tell me:

### ✅ If Badge DID Appear:
- Describe what you see (color, position, count)
- Feature is working!

### ❌ If Badge DID NOT Appear:

**From STEP 4 (Console Logs)**, send me:
- All `[Scheduler]` logs you see
- Any error messages

**From STEP 5 (Data Flow)**:
- **Check A result**: Is customerId undefined or a valid ID?
- **Check B result**: Does Firestore return unreadCount?
- **Check C result**: Does customer doc have `counters.unreadCount` field in Firestore?

**From STEP 6 (CSS)**:
- What background color does the badge show?
- Is display set to 'flex'?

**From STEP 7 (Manual Badge)**:
- Can you see the manual red "1" badge I create?

**From STEP 8 (Errors)**:
- Any error messages in red?

**From STEP 9 (Rules)**:
- What does the customers rule look like?

---

## Example Diagnostic Report

Here's what a good report looks like:

```
STEP 4 - Console Logs:
[Scheduler] Card rendering for quote CHRISTOPHER WESSELL {quoteId: "abc123", inlineCustomerId: undefined}
→ PROBLEM: inlineCustomerId is undefined!

STEP 5 - Check A:
Card customerId: undefined
→ PROBLEM CONFIRMED: customerId not being resolved

STEP 5 - Check C:
Customer doc in Firestore exists: YES
counters.unreadCount field: 1
messages collection: has 1 unread message
→ PROBLEM IS NOT IN FIRESTORE

STEP 7 - Manual Badge:
Manually created red badge appears on card
→ CSS IS WORKING

CONCLUSION:
Problem: customerId is not being resolved from the quote
Likely cause: getCachedCustomerId() returning null
```

---

## 🎯 What Each Result Tells Us

| Finding | Meaning | Next Step |
|---------|---------|-----------|
| customerId is undefined | Quote has no customer linked | Link customer in chat modal first |
| customerId exists but badge doesn't show | Listener or subscription problem | Check Firestore data & rules |
| Firestore shows unreadCount: 0 | Backend didn't increment counter | Check zohoInboundEmail.js |
| Firestore shows unreadCount: 1 | Data is there, UI problem | Check listener subscription |
| Manual badge doesn't appear | CSS not loading | Check style.css |
| `onSnapshot not defined` error | Import missing | Check scheduler.js imports |
| `Permission denied` error | Firestore rules blocking | Check firestore.rules |

---

## 🚀 Quick Test Version (2 minutes)

If you want a super quick version:

1. Open https://app.swashcleaning.co.uk/rep/scheduler.html
2. Open DevTools (F12) → Console
3. Send test email
4. **Wait 2 seconds**
5. Look for any `[Scheduler]` logs in console
6. Check if badge appears on customer card
7. Tell me: YES badge appears OR NO badge doesn't appear + any error messages

---

**Once you run these steps and share the results, I can pinpoint exactly what's wrong and fix it!**
