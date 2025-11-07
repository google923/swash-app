# 10-Task Testing Checklist

Test all 10 improvements systematically. Open the live site at **https://system.swashcleaning.co.uk** and follow each section.

---

## ✅ Task 1: Mark as Done Sends Receipt

### Visual Check
- [ ] Navigate to Schedule page (`/rep/scheduler.html`)
- [ ] Look at any job card in the schedule
- [ ] Verify green **"✓ Done"** button appears in job card (right side of job meta area)
- [ ] Button text is white on green background

### Functional Check
- [ ] Click the **"✓ Done"** button on any job
- [ ] Verify a **notification appears** (usually top-right saying "Receipt sent!")
- [ ] Wait 2-3 seconds for notification to disappear
- [ ] Check browser console (F12) for any errors - should see success message

### Data Check (Advanced)
- [ ] Open Firebase console → Firestore → `quotes` collection
- [ ] Find the quote you just clicked
- [ ] Verify `completedDate` field was set to today's date
- [ ] Verify `messageLog` array includes an entry for the receipt

### Email Check (If you have access)
- [ ] Check the customer's email (from quote.email field)
- [ ] Verify receipt email arrived with subject "Job Completion Receipt"
- [ ] Email should contain customer name, ref code, and completion message

**Result:** ✅ Pass / ❌ Fail

---

## ✅ Task 2: Area Colors Tinted

### Visual Check
- [ ] Navigate to Schedule page
- [ ] Look at job cards that have an assigned area (not all may have areas)
- [ ] Verify job cards have a **light tinted background color** (should be subtle, not bright)
- [ ] Verify cards still show the **colored border** (2px colored line)
- [ ] Colors should be: light versions of area colors (15% opacity)

### Comparison Check
- [ ] Compare multiple job cards - some should be different colors if in different areas
- [ ] Verify text is still readable (black text on light background)
- [ ] Hover over a card - verify hover effect still works (slight color change)

### Color Examples
- Red area → very light pink tinted background
- Blue area → very light blue tinted background
- Green area → very light green tinted background

**Result:** ✅ Pass / ❌ Fail

---

## ✅ Task 3: Schedule Page Centered

### Visual Check (Desktop)
- [ ] Navigate to Schedule page on desktop
- [ ] Verify page **loads without horizontal scroll**
- [ ] Verify the 5-day schedule grid is **centered on the page**
- [ ] Scroll down - no horizontal scrolling at any point
- [ ] Resize window wider/narrower - still centered

### Visual Check (Mobile - 375px width)
- [ ] Open DevTools (F12) → Device toolbar (Ctrl+Shift+M)
- [ ] Set width to ~375px (iPhone SE size)
- [ ] Verify schedule converts to **1 column layout** (not 5 columns)
- [ ] Verify **no horizontal scroll** on mobile
- [ ] Verify job cards stack vertically
- [ ] Scroll through entire page - no horizontal scroll anywhere

### No Scaling Issues
- [ ] Page loads at normal size (no zoomed in/out weirdly)
- [ ] Elements align properly
- [ ] Buttons and text are clickable without scrolling

**Result:** ✅ Pass / ❌ Fail

---

## ✅ Task 4: Order Jobs Modal with Route Optimization

### Modal Opening
- [ ] Navigate to Schedule page
- [ ] Click on any **day** in the schedule (click the day cell/area)
- [ ] Look for the **day-actions dropdown** (should appear near that day)
- [ ] Click the dropdown and verify **"Order jobs 🚗"** option is visible
- [ ] Click "Order jobs 🚗"
- [ ] Verify **"Order Jobs for Day"** modal opens (centered on screen)

### Modal Structure
- [ ] Modal should show:
  - Title: "Order Jobs for Day"
  - List of jobs for that day with numbers (1, 2, 3, etc.)
  - "Optimize Route" button (with 🚗 icon)
  - "Clear Order" button (with ↻ icon)
  - "Save Order" button (with 💾 icon)
  - Cancel/Close buttons

### Drag-and-Drop
- [ ] Try to **drag a job** from position 1 to position 3
- [ ] Verify the job **moves to the new position**
- [ ] Verify the **numbers update** (re-order 1, 2, 3)
- [ ] Drag another job to verify drag works multiple times
- [ ] Verify cursor shows **grab/grabbing** when hovering over jobs

### Optimize Route Button
- [ ] Click **"Optimize Route"** button
- [ ] Wait 2-3 seconds (calling Google Maps API)
- [ ] Verify job order **changes to optimized sequence**
- [ ] Check console (F12) - should see route optimization message
- [ ] Verify notification appears: "Route optimized!"

### Clear Order Button
- [ ] Click **"Clear Order"** button
- [ ] Verify jobs **revert to original order**
- [ ] Verify numbers reset to original sequence
- [ ] Notification: "Order cleared"

### Save Order Button
- [ ] Arrange jobs in custom order (e.g., drag some around)
- [ ] Click **"Save Order"** button
- [ ] Verify modal closes
- [ ] Notification: "Job order saved!"
- [ ] Re-open the modal for same day - verify your custom order is **still there**

### Close Modal
- [ ] Click **X button** or **Cancel** button
- [ ] Verify modal closes
- [ ] Verify you're back on schedule view

**Result:** ✅ Pass / ❌ Fail

---

## ✅ Task 5: Total Selected Price Display

### Selection Info Bar Visibility
- [ ] Navigate to Schedule page
- [ ] Look at the top of the schedule area (below the week selector)
- [ ] Verify the **blue selection info bar is HIDDEN** initially
- [ ] Should say nothing is selected

### Select Jobs and Show Bar
- [ ] Click **checkbox** on any job card
- [ ] Verify the **blue selection info bar APPEARS** with smooth animation
- [ ] Bar should show:
  - Number of jobs selected (e.g., "1 job selected")
  - Total price (e.g., "£50")
  - Duration estimate (e.g., "(50 mins)")
  - **Clear** button (to deselect all)

### Multiple Selections
- [ ] Select 3-4 more jobs
- [ ] Verify the info bar **updates in real-time**
- [ ] Count should increase (e.g., "4 jobs selected")
- [ ] Total price should **add up correctly** (sum of all selected job prices)
- [ ] Duration should increase proportionally

### Clear Button
- [ ] Click the **"Clear"** button in the info bar
- [ ] Verify **all checkboxes uncheck**
- [ ] Verify info bar **disappears smoothly**
- [ ] Verify no jobs are selected

### Deselect Manually
- [ ] Select 2 jobs again
- [ ] Click checkbox on one to deselect it
- [ ] Verify info bar **updates** (shows 1 job instead of 2)
- [ ] Click checkbox on last job to fully deselect
- [ ] Verify info bar **disappears**

### Blue Styling
- [ ] Verify info bar has **blue gradient background** (should look professional)
- [ ] Text should be white/light colored
- [ ] Clear button should have secondary styling

**Result:** ✅ Pass / ❌ Fail

---

## ✅ Task 6: Auto-Calculate Duration from Price

### Duration in Job Details
- [ ] Navigate to Schedule page
- [ ] Click on any job card to **expand details** (click card, not checkbox)
- [ ] Look in the expanded details section
- [ ] Verify it shows **"Est. Duration: XX mins"** 
- [ ] Duration should equal the price in pounds (£1 = 1 minute)
  - £25 job = 25 mins
  - £50 job = 50 mins

### Duration in Order Modal
- [ ] Open the "Order jobs" modal (see Task 4 instructions)
- [ ] Look at each job in the modal
- [ ] Verify each job shows a **duration badge** (e.g., "25m")
- [ ] Badge should be styled with gray/light background
- [ ] Verify duration matches the price-to-minute conversion

### Duration in Selection Info Bar
- [ ] Select multiple jobs (see Task 5 instructions)
- [ ] Look at the blue info bar at top
- [ ] Verify it shows **total duration** in minutes
  - 2 jobs (£25 each) = 50 mins shown
  - 3 jobs (£30, £40, £50) = 120 mins shown
- [ ] Duration should calculate correctly every time

### Verification Examples
- [ ] A £1 job = "1 min" duration
- [ ] A £60 job = "60 min" (or "1 hr") duration
- [ ] Total of £100 across jobs = "100 mins" (or "1h 40m")

**Result:** ✅ Pass / ❌ Fail

---

## ✅ Task 7: Remove Template Subject

### Message Modal Check
- [ ] Navigate to Schedule page
- [ ] Click on any day to open **day-actions dropdown**
- [ ] Click **"Send message 💬"** option
- [ ] Verify the **"Send Message"** modal opens
- [ ] Look for the message template selector
- [ ] Verify **template subject dropdown is NOT visible** (should be removed/hidden)
- [ ] Only visible should be: message body textarea, buttons

### Message Sending Still Works
- [ ] Type a custom message in the text area (e.g., "Testing message")
- [ ] Click **"Send"** button
- [ ] Verify message sends without template selection
- [ ] Notification appears: "Message sent!"
- [ ] Modal closes

**Result:** ✅ Pass / ❌ Fail

---

## ✅ Task 8: Fix Schedule Selection After Message

### Send Message and Regain Focus
- [ ] Navigate to Schedule page
- [ ] Click checkbox on a job to select it
- [ ] Verify job is selected (checkbox checked)
- [ ] Click on any day to open **day-actions dropdown**
- [ ] Click **"Send message 💬"**
- [ ] Type a test message and click **"Send"**
- [ ] Modal closes
- [ ] Verify the **job checkbox is STILL CHECKED** (selection preserved)
- [ ] Verify you can **interact with schedule immediately** (no frozen UI)

### Keyboard Interaction
- [ ] Try pressing arrow keys - schedule should respond
- [ ] Try clicking other job cards - should work normally
- [ ] Try selecting/deselecting - should work
- [ ] UI should feel responsive (not locked up)

**Result:** ✅ Pass / ❌ Fail

---

## ✅ Task 9: Fix Schedule Mobile Layout

### Desktop Layout (1200px+)
- [ ] Open DevTools (F12) → Device toolbar
- [ ] Set width to 1200px+ (desktop)
- [ ] Verify schedule shows **5 columns** (Monday-Friday)
- [ ] Each day has equal width
- [ ] All jobs display properly

### Tablet Layout (768px - 1024px)
- [ ] Set DevTools width to 900px
- [ ] Verify schedule still shows **5 columns** or converts to fewer
- [ ] No horizontal scrolling
- [ ] All text readable

### Mobile Layout (≤768px)
- [ ] Set DevTools width to 375px (mobile)
- [ ] Verify schedule converts to **1 column layout** (single column, not 5 wide)
- [ ] Verify job cards **stack vertically**
- [ ] Verify **NO horizontal scroll** anywhere on page
- [ ] Scroll down entire page - no horizontal scroll at any point
- [ ] Job text is readable and not cut off

### Mobile Interaction
- [ ] On mobile view, verify you can:
  - [ ] Tap job cards
  - [ ] Open day dropdowns
  - [ ] Select jobs (checkboxes work)
  - [ ] Open modals
  - [ ] All buttons are touchable

### Responsive Transitions
- [ ] Slowly resize browser window from desktop to mobile
- [ ] Watch layout smoothly transition
- [ ] No jumping or broken styling
- [ ] Verify it's responsive at 768px threshold

**Result:** ✅ Pass / ❌ Fail

---

## ✅ Task 10: Admin Message Log Page

### Navigation to Message Log
- [ ] Click **Menu** button (top right)
- [ ] Verify dropdown appears with navigation options
- [ ] Look for **"📧 Message Log"** link
- [ ] Click on it
- [ ] Verify page loads: `/admin/message-log.html`
- [ ] Page title should show "Message Log"

### Page Structure
- [ ] Verify page shows:
  - Header with Swash logo
  - "Message Log" title
  - Filter controls (From date, To date, Type, Search)
  - Results table showing messages
  - Logout button

### Filter by Date Range
- [ ] Verify "From" and "To" date inputs are present
- [ ] Default should show last **30 days**
- [ ] Change "From" date to 60 days ago
- [ ] Verify table **updates** with more messages
- [ ] Change "To" date to today
- [ ] Verify messages filtered to date range
- [ ] Clear dates - should show all messages

### Filter by Message Type
- [ ] Find **"Type"** dropdown in filters
- [ ] Verify options include:
  - All (shows all types)
  - Booking (shows booking confirmations)
  - Message (shows day messages)
  - Receipt (shows completion receipts)
- [ ] Select each type and verify table **updates** to show only that type
- [ ] Badge colors should change by type (different icons/colors)

### Search Functionality
- [ ] Find **search input** in filter controls
- [ ] Type a **customer name** (e.g., "John" or "Jane")
- [ ] Verify table **filters** to show only that customer's messages
- [ ] Try searching for an **email address**
- [ ] Verify results show only that email
- [ ] Try searching for a **reference code** (e.g., "REF001")
- [ ] Verify correct quote messages appear

### Message Log Table
- [ ] Verify table shows columns:
  - Type (badge with icon: 📧 for booking, 💬 for message, ✓ for receipt)
  - Customer (name)
  - Content (message body or description)
  - Date/Time (formatted nicely)
- [ ] Verify timestamps are readable (e.g., "Today at 2:30 PM" or "Yesterday at 10:15 AM")
- [ ] Verify long message content is truncated with "..."
- [ ] Hover over truncated text - tooltip/full text visible (optional)

### Mobile Responsive
- [ ] Open DevTools (F12) → Device toolbar (375px)
- [ ] Verify page layouts properly on mobile
- [ ] Filters still accessible
- [ ] Table converts to readable format (not cut off)
- [ ] All buttons clickable
- [ ] No horizontal scroll

### Authentication
- [ ] Logout from the page (click Logout button)
- [ ] Try to access `/admin/message-log.html` directly
- [ ] Verify you're **redirected to login** or login overlay appears
- [ ] Login with your admin credentials
- [ ] Verify page loads with message log

**Result:** ✅ Pass / ❌ Fail

---

## Summary

Track your results:

- [ ] Task 1: Mark as Done ✅
- [ ] Task 2: Area Colors ✅
- [ ] Task 3: Schedule Centering ✅
- [ ] Task 4: Order Jobs Modal ✅
- [ ] Task 5: Selection Price Display ✅
- [ ] Task 6: Duration Calculation ✅
- [ ] Task 7: Template Subject Hidden ✅
- [ ] Task 8: Schedule Selection Focus ✅
- [ ] Task 9: Mobile Layout ✅
- [ ] Task 10: Message Log Page ✅

**Overall Status:** 
- [ ] All 10 tasks working ✅
- [ ] Some issues found (list below):

### Issues Found (if any):
```
Issue 1: [Describe what didn't work]
  - Screenshot: [If applicable]
  - Steps to reproduce: [How it happened]
  
Issue 2: [Next issue...]
```

---

## Quick Links

- **Live Site:** https://system.swashcleaning.co.uk
- **Schedule Page:** https://system.swashcleaning.co.uk/rep/scheduler.html
- **Message Log:** https://system.swashcleaning.co.uk/admin/message-log.html
- **GitHub Repo:** https://github.com/google923/swash-app
- **Vercel Dashboard:** https://vercel.com/dashboard

---

Good luck with testing! Report any issues you find. 🚀
