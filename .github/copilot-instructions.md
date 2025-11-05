# Swash Window Cleaning Management System - AI Agent Instructions

## Project Overview
Swash is a Firebase-hosted web application for managing window cleaning quotes, bookings, and schedules. The system consists of three main apps: Quote Calculator (customer-facing), Admin Dashboard (quote management), and 4-Week Route Planner (scheduling).

## Architecture

### Core Components
- **`public/index.html` + `script.js`**: Customer quote calculator with offline support
- **`public/admin.html` + `admin.js`**: Admin dashboard for managing quotes, sending booking emails, bulk scheduling
- **`public/scheduler.html` + `scheduler.js`**: 4-week route planner with drag-and-drop rescheduling and 28-day recurring cadence
- **`public/service-worker.js`**: Provides offline-first caching (network-first for navigation, cache-first for assets)
- **`public/offline-queue.js`**: Queues quote submissions when offline, auto-syncs on reconnection

### Firebase Setup
- **Firestore collection**: `quotes` (single collection for all customer data)
- **Authentication**: Email/password via Firebase Auth (`admin.js` and `scheduler.js` require login)
- **Hosting**: Firebase Hosting serves `public/` directory
- **Config**: All files share the same `firebaseConfig` object (project: `swash-app-436a1`)

### Data Model: `quotes` Collection
Key fields in Firestore documents:
- `customerName`, `address`, `mobile`, `email` - customer details
- `tier` - service tier (Basic/Standard/Premium/Deluxe)
- `price` - upfront price, `pricePerClean` - per-clean price
- `refCode` - unique reference (e.g., "REF001")
- `status` - "Quoted", "Booked - DD/MM/YYYY", "Cancelled", etc.
- `bookedDate` - ISO string when first clean is scheduled
- `nextCleanDates` - array of 2 ISO strings for 2nd and 3rd cleans (28-day intervals)
- `assignedCleaner` - "Cleaner 1" through "Cleaner 10" (used for filtering/routing)
- `date` - quote creation timestamp
- `deleted` - soft delete flag (filtered out in queries)

### Cleaner Assignment System
- **10 cleaners**: "Cleaner 1" to "Cleaner 10" (hardcoded in `CLEANER_OPTIONS`)
- **Three assignment points**:
  1. **Bulk assign** in Admin Dashboard: Select quotes → dropdown → "Assign" button → updates `assignedCleaner` field
  2. **Schedule modal**: When bulk-scheduling customers, dropdown sets `assignedCleaner` during booking
  3. **Email modal**: When sending booking confirmations, dropdown sets `assignedCleaner` during status update
- **Filtering**: 
  - Admin Dashboard: "Assign to cleaner" dropdown filters table by `assignedCleaner`
  - Scheduler: "Filter by cleaner" dropdown filters 4-week calendar by `assignedCleaner`
- **Helper functions** in both `admin.js` and `scheduler.js`:
  - `populateCleanerSelect()` - dynamically fills `<select>` elements
  - `resolveCleanerUpdate()` - handles "All cleaners", "Unassigned", or specific cleaner selection
  - `getCleanerDisplay()` - shows "Unassigned" if `assignedCleaner` is null/empty

## Cross-Tab Synchronization
**BroadcastChannel** (`"swash-quotes-sync"`) syncs data changes across open tabs:
- When `admin.js` updates quotes, it broadcasts `{ type: "quotes-updated", source: "admin" }`
- `scheduler.js` listens and calls `refreshData()` to reload booked quotes
- Prevents stale data when admin and scheduler are open simultaneously

## Email Integration (EmailJS)
- **Service**: `service_cdy739m`, Public Key: `7HZRYXz3JmMciex1L`
- **Templates**:
  - `template_d8tlf1p` - booking confirmations (sent from `admin.js`)
  - `template_6mpufs4` - day-before reminders (sent from `scheduler.js`)
- **Template params used in code**:
  - Booking confirmations (`admin.js` → `sendBookingEmails()`): `{ customer_name, ref_code, date, second_date, third_date, email }`
  - Day-before reminders (`scheduler.js` → `handleSendDayMessage()`): `{ customer_name, message_body, email }`
- **Booking email flow**:
  1. Admin selects quotes in table or "Selected for email" section
  2. Picks first clean date in modal
  3. Optionally selects cleaner dropdown (sets `assignedCleaner`)
  4. Click "Send" → loops through quotes, sends EmailJS template, updates Firestore with `status`, `bookedDate`, `nextCleanDates`, `assignedCleaner`
- **Email preview**: `createEmailPreviewHtml()` generates inline HTML for desktop/mobile preview tabs

## Access & Roles
- Only the owner admin account should access `admin.html` and `scheduler.html` (Firebase Auth login overlay present on both pages).
- Reps use the quote calculator (`index.html` + `script.js`) and do not have access to admin or scheduler pages.
- Future: a dedicated Rep Dashboard can be added; keep it separate from admin and scheduler routes.

## Scheduling Logic (28-Day Cadence)
- **First clean**: User-selected date (e.g., 10/11/2025)
- **Second clean**: First clean + 28 days
- **Third clean**: First clean + 56 days
- `nextCleanDates` array stores ISO strings for 2nd and 3rd cleans
- **Scheduler rendering**: `getOccurrences()` generates recurring dates from `bookedDate` in 28-day intervals
- **Drag-and-drop rescheduling**: Updates `bookedDate` and recalculates `nextCleanDates` in Firestore

## Developer Workflows

### Local Development
```powershell
# Install dependencies
npm install

# Run auto-deploy watcher (autodeploys to Firebase on file changes with 15s debounce)
node public/autodeploy.js
# OR run the VS Code task: "Start Auto Deploy" (configured in tasks.json, runs on folder open)

# Manual deploy
firebase deploy

# Serve locally (Firebase emulator)
firebase serve
```

### Auto-Deploy System
- **`autodeploy.js`**: Watches all files (except `.git`, `node_modules`, Firebase logs)
- Debounces changes with 15-second cooldown
- Runs `firebase deploy --only hosting` automatically
- Desktop notifications via `node-notifier`
- **VS Code task**: "Start Auto Deploy" is a background task that runs `node autodeploy.js` (configured in `.vscode/tasks.json` with `runOn: folderOpen`)

### Testing Offline Mode
1. Open DevTools → Network → "Offline"
2. Submit a quote → should queue in `localStorage` (`swashOfflineQueue`)
3. Re-enable network → `offline-queue.js` auto-syncs queued items to Firestore

## Code Patterns & Conventions

### State Management
Each app uses a `state` object with app-specific properties:
- **`admin.js`**: `{ quotes, filtered, selectedIds, selectedForEmail, selectedForSchedule, currentPage, searchQuery, assignCleaner, scheduleCleaner, emailCleaner, ... }`
- **`scheduler.js`**: `{ quotes, startDate, weeksVisible, selectedJobIds, searchTerm, draggingIds, cleanerFilter, ... }`
- **No global state library** - plain JavaScript objects

### Firestore Updates
Always use `updateDoc()` to update quotes, never full document replacement:
```javascript
await updateDoc(doc(db, "quotes", quoteId), {
  status: "Booked - 10/11/2025",
  bookedDate: "2025-11-10T00:00:00.000Z",
  nextCleanDates: ["2025-12-08T00:00:00.000Z", "2026-01-05T00:00:00.000Z"],
  assignedCleaner: "Cleaner 5" // Optional
});
```

### Date Handling
- **Input dates**: `new Date(value)` for ISO strings or timestamp objects
- **Display dates**: `formatDate()` → "DD/MM/YYYY" or `formatScheduleDate()` → "Monday, 10 November 2025"
- **Firestore storage**: Always store as ISO strings (`date.toISOString()`)
- **Scheduler normalization**: `normalizeStartDate()` ensures weeks start on Monday

### HTML Generation
Use template literals with `escapeHtml()` for user-provided content:
```javascript
const safe = (value) => escapeHtml(value || "");
card.innerHTML = `<div class="job-name">${safe(quote.customerName)}</div>`;
```

### Module System
- **ES6 modules** with CDN imports for Firebase SDK v10.8.1
- **Shared utilities** in `menu.js` (dropdown navigation) and `offline-queue.js`
- **No bundler** - browser-native ES modules

### Business Logic Locations
- Pricing and tier logic live in `public/script.js` (used by `index.html`).
- Cleaner assignment constants live in both `admin.js` and `scheduler.js` (`CLEANER_OPTIONS` with 10 cleaners). To add more in future, update the constant in both files and ensure selects are repopulated via `populateCleanerSelect()`.

## Common Pitfalls

1. **Corrupted state objects**: Previous AI agents accidentally merged scheduler state into admin state. Each app has distinct state properties:
   - Admin: `quotes`, `filtered`, `selectedIds`, `currentPage`, `pageSize`, etc.
   - Scheduler: `quotes`, `startDate`, `weeksVisible`, `selectedJobIds`, etc.

2. **Duplicate dropdowns**: When adding cleaner filters, ensure each dropdown has a unique ID:
   - Admin: `assignCleanerSelect`, `scheduleCleaner` (schedule modal), `emailCleaner` (email modal)
   - Scheduler: `cleanerFilter`
   - Never create duplicate hardcoded dropdowns (e.g., `confirm-cleaner-select`, `route-cleaner-filter`)

3. **Function references**: 
   - Admin uses `loadQuotes()` (not `fetchQuotes()`)
   - Scheduler uses `fetchBookedQuotes()` (filtered query for `bookedDate != null`)

4. **EmailJS initialization**: Call `emailjs.init(EMAIL_PUBLIC_KEY)` before sending emails (done in `startAdminApp()` and `initEmailJsScheduler()`)

5. **Soft deletes**: Always filter `quote.deleted` when rendering (e.g., `.filter((quote) => !quote.deleted)`)

## File Structure
```
public/
├── index.html, script.js          # Quote calculator (customer-facing)
├── admin.html, admin.js            # Admin dashboard (quote management, email, scheduling)
├── scheduler.html, scheduler.js    # 4-week route planner (drag-and-drop rescheduling)
├── menu.js                         # Shared dropdown navigation
├── offline-queue.js                # Offline submission queue + auto-sync
├── service-worker.js               # PWA caching (network-first for HTML, cache-first for assets)
├── style.css                       # Global styles (Swash blue: #0078d7)
├── manifest.json                   # PWA manifest
└── assets/                         # Logos, icons

swash-admin/, swash-admin-dashboard/ # Legacy/unused folders (ignore)
# Deprecated: not used by the live app and safe to remove from hosting. Keep for historical reference only.
autodeploy.js                       # Auto-deploy watcher
firebase.json                       # Firebase Hosting config
package.json                        # Node dependencies (chokidar, node-notifier)
```

## Key URLs
- **Production**: https://system.swashcleaning.co.uk (Firebase Hosting custom domain)
- **Firebase Console**: https://console.firebase.google.com/project/swash-app-436a1
- **Default Hosting URL**: https://swash-app-436a1.web.app

## When Making Changes

1. **Always preserve existing IDs, function names, and Firestore field names** (e.g., `assignedCleaner`, `bookedDate`, `nextCleanDates`)
2. **Test cleaner assignment flow**: Assign → Schedule → Email (all three should update `assignedCleaner`)
3. **Verify cross-tab sync**: Open admin + scheduler simultaneously, update a quote in admin, confirm scheduler auto-refreshes
4. **Check offline queue**: Test quote submission offline, verify `localStorage` queue, reconnect and confirm Firestore sync
5. **Run `firebase deploy`** after changes (or let `autodeploy.js` handle it if watcher is running)

## Debugging Tips
- **Console errors**: Check for `ReferenceError` (undefined functions), `SyntaxError` (corrupted code)
- **Firestore rules**: Ensure authenticated users can read/write `quotes` collection
- **EmailJS failures**: Verify `EMAIL_SERVICE`, `EMAIL_TEMPLATE`, `EMAIL_PUBLIC_KEY` constants match EmailJS dashboard
- **Service worker**: Hard refresh (`Ctrl+Shift+R`) to bypass cache during development
