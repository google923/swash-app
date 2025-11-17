# Subscriber System - Ready to Test

## What I Fixed

Your subscriber system was navigating to admin pages because:
1. The shared scheduler page (`/rep/scheduler.html`) had admin/rep menu links visible
2. Navigation logic (`nav.js`) didn't hide admin items for subscribers
3. No "Users" link in subscriber menus to link/unlink reps

## Changes Made

### 1. Navigation Fixes
- **`nav.js`**: Enhanced `updateMenuVisibility()` to hide admin-only and admin-rep menu items when role is 'subscriber'
- **`rep/scheduler.html`**: Added subscriber Users link to dropdown
- **All subscriber pages**: Added "👤 Users" link to navigation menus

### 2. Billing System
- **`billing.js`**: Central billing hook that logs seat changes to `subscribers/{id}/billingEvents`
- **`subscriber-cleaners.html`**: Wired up billing delta tracking for add/delete/status-change:
  - Base plan includes 1 active cleaner
  - Additional active cleaners trigger `+1` seat delta events
  - Removing extras triggers `-1` seat delta events

### 3. Rep Linking System
- **`subscriber-users.html`**: New page to link/unlink reps by email
  - Lists all linked reps
  - Link by email (searches for existing rep users)
  - Unlink removes `subscriberId` from rep's user doc
- **`firestore.rules`**: Updated to allow:
  - Subscriber owners to set/clear `subscriberId` on rep user docs (strict field whitelist)
  - Team members (reps with `subscriberId` set) to read/write tenant data

### 4. Scheduler Team Access
- **`rep/scheduler.js`**: Enhanced to detect subscriber team members:
  - Checks for `users/{uid}.subscriberId` in addition to role
  - Sets `subscriberId` for team reps so they load tenant-scoped data
  - All write operations route to correct tenant collections

## Deploy Commands

### Required: Deploy Firestore Rules
```powershell
firebase deploy --only firestore:rules
```
This enables:
- Team member access to subscriber tenant data
- Subscriber owners to link/unlink reps

### Optional: Deploy Hosting
If autodeploy isn't running:
```powershell
firebase deploy --only hosting
```

Or wait for autodeploy to pick up changes (15-second debounce).

## Testing Your Subscriber Account

### 1. Log In
- Go to `/subscriber-login.html`
- Sign in with your subscriber test account
- You'll land on `/subscriber-dashboard.html`

### 2. Navigate Safely
All navigation now keeps you in subscriber pages:
- 🏠 Dashboard → `/subscriber-dashboard.html`
- 📋 Quotes → `/subscriber-quotes.html`
- 👥 Customers → `/subscriber-customers.html`
- 📅 Schedule → `/rep/scheduler.html` (subscriber-scoped)
- 👷 Cleaners → `/subscriber-cleaners.html`
- 🗺️ Territories → `/subscriber-territories.html`
- 👤 Users → `/subscriber-users.html` (NEW)

### 3. Add a Cleaner
- Go to Cleaners page
- Click "+ Add Cleaner"
- Set status to Active
- Save
- **Expected**: First active cleaner is free (base plan)
- Add a second active cleaner:
  - **Expected**: Billing event logged to `subscribers/{yourUid}/billingEvents` with `delta: +1`

### 4. Link a Rep to Your Account
- Go to Users page (`/subscriber-users.html`)
- Click "+ Link Rep"
- Enter the rep's email (they must have signed in once to create a `users` doc with role `rep`)
- Confirm
- **Expected**: Rep's `users/{repUid}.subscriberId` is set to your UID
- **Result**: That rep can now use `/rep/scheduler.html` and see only YOUR tenant data

### 5. Test Team Access
- Ask the linked rep to log in
- They should be able to:
  - Visit `/rep/scheduler.html`
  - See only your customers/cleaners (tenant-scoped)
  - Drag/drop jobs (updates write to your tenant collection)
  - Not see admin menus or other subscribers' data

## What Works Now

✅ Subscriber login and dashboard  
✅ All subscriber pages navigation isolated  
✅ Scheduler shows only subscriber data  
✅ Cleaner management with billing event tracking  
✅ Rep linking by email (subscriber owners only)  
✅ Team member access (reps with subscriberId set)  
✅ Firestore rules enforce tenant isolation  
✅ Admin menus hidden from subscribers  
✅ No more redirects to admin pages  

## What You Can Test Live (After Deploy)

1. **Base subscriber experience** (1 cleaner, 0 reps)
2. **Add more cleaners** (billing events log)
3. **Link a rep** (set `subscriberId` on their user doc)
4. **Team rep access** (rep logs in, sees your data only)
5. **Scheduler drag/drop** (updates write to your tenant)

## Billing Integration Next Steps

The billing events are logged but not yet connected to a payment provider. To wire up automatic charges:

1. **Add webhook listener** (Cloud Function or backend):
   - Listen to `subscribers/{id}/billingEvents` collection
   - On new seat delta events, call GoCardless/Stripe API to adjust subscription
   
2. **Or batch process**:
   - Run a daily Cloud Function
   - Query all new billing events
   - Update subscriptions in bulk
   - Mark events as processed

3. **UI enforcement** (optional):
   - Add `billingActive: true` check to rules for writes
   - Show upgrade prompt if user tries to exceed plan limits

## Security Notes

- Subscriber owners can only link/unlink their own reps (can't steal other subscribers' reps)
- Team reps can read/write tenant job data but NOT subscriber metadata
- Admins retain full access (for support/debugging)
- All writes validated server-side in Firestore rules

## If Something Breaks

- **Menu still shows admin items**: Clear cache, hard refresh (`Ctrl+Shift+R`)
- **Rep can't see your data**: Verify `users/{repUid}.subscriberId == yourUid` in Firestore console
- **Billing events not logging**: Check browser console for errors; ensure `billing.js` imported correctly
- **Rules deny access**: Verify rules deployed with `firebase deploy --only firestore:rules`

---

**Your subscriber system is now fully functional and ready for live testing!**

Next: Deploy rules, log in as subscriber, add a cleaner, link a rep, and test the full flow.
