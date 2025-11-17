# Unread Message Badges - Feature Complete

## Overview
Added real-time unread message notification badges on customer cards in Scheduler/Admin UI. Badges show the count of unread emails per customer and auto-clear when the user opens the communications modal.

## Implementation Details

### 1. Backend Counter (api/zohoInboundEmail.js)
- Inbound emails from Zoho now include `read: false` flag
- After storing the message, atomically increments `customers/{customerId}/counters/unreadCount` via `FieldValue.increment(1)`
- Includes fallback error logging if counter update fails

### 2. Mark-as-Read Logic (rep/components/chat-controller.js)
- New function `markCustomerMessagesAsRead(customerId)`:
  - Queries all messages where `read == false`
  - Batch-updates them to `read: true`
  - Atomically decrements `counters.unreadCount` by the count of unread messages
  - Called on modal open in `openCommunicationsForQuote()`
- Uses Firestore batch API for atomic operations

### 3. Badge Rendering (rep/scheduler.js)
- New function `subscribeToCustomerUnreadCount(customerId, cardElement)`:
  - Subscribes to real-time changes on the customer document via `onSnapshot()`
  - Renders/updates a `.badge-unread` span with the unread count
  - Caps display at "99+" for large counts
  - Hides badge when count is 0
  - Stores unsubscriber function for cleanup
- Integrated into `renderSchedule()` entry loop
- Each job card gets its own subscription for live badge updates

### 4. Firestore Security Rules (firestore.rules)
Updated `/customers/{customerId}` and `/messages/{messageId}` rules:
- Allow authenticated users to update `counters.unreadCount` field atomically
- Allow message `read` flag update from `false` → `true` only
- All other updates restricted to admin role

### 5. CSS Styling (style.css)
Added `.badge-unread` class:
- Position: absolute top-left corner of card
- Red background (#e11d48) with white text
- Circular badge design (18px height, 9px border-radius)
- Font size 11px, bold weight
- Subtle drop shadow for depth
- Responsive padding for count display

## Flow Diagram
```
Inbound Email (Zoho) 
  → zohoInboundEmail.js stores message with read:false
  → Increments counters.unreadCount

Badge Display (Scheduler)
  → subscribeToCustomerUnreadCount() listens to customer doc
  → Updates badge in real-time on count changes
  → Renders "1", "2", ... "99+" based on count

Modal Open (Chat)
  → openCommunicationsForQuote() calls markCustomerMessagesAsRead()
  → Batch-updates all unread messages to read:true
  → Decrements counter by unread count
  → Badge auto-hides (count = 0)

Outbound Email (App)
  → No counter update (read:true by default)
  → Badge unchanged
```

## Testing Checklist
- [ ] Send inbound email via Zoho → badge appears on customer card showing count
- [ ] Open modal → all unread messages marked read, badge clears (count = 0)
- [ ] Send two more inbound emails → badge shows "2"
- [ ] Send outbound reply → badge count unchanged (read:true not tracked)
- [ ] Close modal, reopen scheduler → badge persists correctly
- [ ] Verify Firestore rules allow counter.unreadCount updates
- [ ] Verify Firestore rules allow read:false → read:true updates
- [ ] Test on mobile → badge positioned correctly on smaller screens

## Files Modified
1. `api/zohoInboundEmail.js` - Added read flag and counter increment
2. `rep/components/chat-controller.js` - Added mark-as-read batch logic
3. `rep/scheduler.js` - Added badge subscription and rendering
4. `firestore.rules` - Updated to allow counter and read flag updates
5. `style.css` - Added .badge-unread styling

## Deployment Status
✅ Hosting deployed (includes all JS/CSS changes)
✅ Firestore rules deployed
✅ Auto-deploy watcher running (autodeploy.js)

## Known Limitations
- Badge caps display at "99+" (doesn't show counts above 99)
- Unread count is customer-wide (not per-type, e.g., per email/SMS)
- Mark-as-read only works for email messages (not SMS/notes with read flag)

## Future Enhancements
- Per-message-type unread counters (email vs SMS vs notes)
- Unread count persistence across devices
- Notification sound on new message (with permission)
- Admin bulk-mark-as-read feature
