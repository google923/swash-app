# Revolut Payment Integration - Visual Guide

This document provides a visual overview of the UI changes in the admin dashboard.

## Admin Dashboard Changes

### 1. Status Filter Dropdown

**Location**: Top of admin dashboard, in filters section

**New Options Added**:
- Pending payment (orange highlight)
- Paid (blue highlight)
- Needs booking
- Booked (green highlight)
- Cancelled (red highlight)

**Usage**: Select "Paid" to view all quotes with confirmed payments.

---

### 2. Quote Table View

**Visual Indicators**:

#### Pending Payment Quote
```
┌──────────────────────────────────────────────────────┐
│ [▢] REF-123 | 09/11/2025 | John Smith             │  ← Orange left border
│     123 Main St | Cleaner 1 | £50.00 | £150.00     │
│     Status: Pending Payment                         │
└──────────────────────────────────────────────────────┘
```

#### Paid Quote
```
┌──────────────────────────────────────────────────────┐
│ [▢] REF-456 | 10/11/2025 | Jane Doe               │  ← Blue left border
│     456 Oak Ave | Cleaner 2 | £60.00 | £180.00     │
│     Status: Paid - Awaiting Booking                 │
└──────────────────────────────────────────────────────┘
```

---

### 3. Quote Details Panel

**Location**: Click on any quote row to expand

**Payment Information Section** (appears for paid quotes only):

```
┌─────────────────────────────────────────────────────────┐
│ More info                                          [▼]  │
├─────────────────────────────────────────────────────────┤
│ Customer Details                                        │
│ [Name: John Smith]  [Rep Code: REP01]                  │
│ [Address: 123 Main St]  [Mobile: 07700900123]          │
│ [Email: john@email.com]  [Ref: ABC123]                 │
│                                                         │
│ ┌─────────────────────────────────────────────────┐   │
│ │ 💳 Payment Information                          │   │  ← Light blue background
│ ├─────────────────────────────────────────────────┤   │
│ │ STATUS:         ✓ Paid  (blue, bold)            │   │
│ │ PAID DATE:      10/11/2025                      │   │
│ │ AMOUNT:         £150.00 GBP                     │   │
│ │ TRANSACTION ID: abc-123-xyz-789  (monospace)    │   │
│ └─────────────────────────────────────────────────┘   │
│                                                         │
│ Service Details                                         │
│ [House Type: 3 bed]  [Size: 3 bed]                    │
│ [Tier: Standard]  [Per Clean: £50.00]                 │
│                                                         │
│ [📍 Set Location]  [Save changes]                     │
└─────────────────────────────────────────────────────────┘
```

---

### 4. Actions Menu

**Location**: Top right, when quotes are selected

**New Option**: "Mark as paid" (appears first in menu)

```
┌─────────────────────────┐
│ Actions ▼              │
├─────────────────────────┤
│ ▸ Mark as paid         │  ← NEW
│ ▸ Send booking emails  │
│ ▸ Add to schedule      │
│ ▸ Archive selected     │
│ ▸ Export CSV           │
│ ▸ Import customers     │
└─────────────────────────┘
```

---

### 5. Mark as Paid Modal

**Triggered by**: Actions > Mark as paid

```
┌────────────────────────────────────────────────┐
│  Mark Quotes as Paid                      [×]  │
├────────────────────────────────────────────────┤
│                                                │
│  Mark the selected quotes as paid.             │
│  Optionally enter transaction details.         │
│                                                │
│  Selected Customers:                           │
│  • John Smith (Ref: ABC123)                    │
│  • Jane Doe (Ref: XYZ789) ✓ Already paid      │
│                                                │
│  Transaction ID (optional)                     │
│  [____________________________]                │
│                                                │
│  Payment Amount (optional)                     │
│  [____________________________]                │
│                                                │
│  Currency                                      │
│  [GBP (£)        ▼]                           │
│                                                │
│  Status: _________________________________     │
│                                                │
│  [Cancel]              [Mark as Paid]         │
└────────────────────────────────────────────────┘
```

---

### 6. Card View

**Visual Indicators**:

#### Pending Payment Card
```
┌──────────────────────────────────────────┐
│ [▢] Select                               │  ← Orange left border (4px)
│ REF-ABC123        09/11/2025 14:30      │
├──────────────────────────────────────────┤
│ John Smith                               │
│ 123 Main St, London                      │
│                                          │
│ 📞 07700900123                           │
│ ✉️  john@email.com                       │
│                                          │
│ 👤 Cleaner: Cleaner 1                    │
│                                          │
│ PRICING                                  │
│ Per clean: £50.00  |  Upfront: £150.00  │
│                                          │
│ [PENDING PAYMENT] ← Orange pill          │
└──────────────────────────────────────────┘
```

#### Paid Card
```
┌──────────────────────────────────────────┐
│ [▢] Select                               │  ← Blue left border (4px)
│ REF-XYZ789        10/11/2025 09:15      │
├──────────────────────────────────────────┤
│ Jane Doe                                 │
│ 456 Oak Ave, London                      │
│                                          │
│ 📞 07700900456                           │
│ ✉️  jane@email.com                       │
│                                          │
│ 👤 Cleaner: Cleaner 2                    │
│                                          │
│ PRICING                                  │
│ Per clean: £60.00  |  Upfront: £180.00  │
│                                          │
│ [✓ PAID] ← Blue pill, checkmark          │
└──────────────────────────────────────────┘
```

---

## Color Scheme

| Status | Border Color | Pill Color | Background |
|--------|-------------|------------|------------|
| **Pending Payment** | Orange (#f59e0b) | Orange bg, brown text | rgba(245, 158, 11, 0.08) |
| **Paid** | Blue (#0078d7) | Blue bg, blue text | rgba(0, 120, 215, 0.08) |
| **Booked** | Green (#1c9c5d) | Green bg, dark green text | rgba(28, 156, 93, 0.12) |
| **Cancelled** | Red (#b00020) | Red bg, red text | rgba(176, 0, 32, 0.08) |

---

## User Workflow Examples

### Scenario 1: Automatic Payment Detection

1. Customer receives quote with reference code "ABC123"
2. Customer makes bank transfer to Revolut with reference "ABC123"
3. **Revolut webhook fires** (behind the scenes)
4. Quote status automatically updates to "Paid - Awaiting Booking"
5. Admin dashboard shows:
   - Blue border on quote
   - "Paid" pill/badge
   - Payment details in expanded view
6. Admin can now filter by "Paid" status to see all paid quotes
7. Admin proceeds to book the customer

### Scenario 2: Manual Payment Reconciliation

1. Customer makes payment but uses wrong reference "AB123" (missing C)
2. Payment received in Revolut but quote not automatically updated
3. Admin notices payment in Revolut but quote still "Pending Payment"
4. Admin steps:
   a. Select the quote in dashboard
   b. Click **Actions** > **Mark as paid**
   c. Enter transaction ID from Revolut: "REV-123456"
   d. Enter amount: £150.00
   e. Select currency: GBP
   f. Click **Mark as Paid**
5. Quote updates to "Paid - Awaiting Booking"
6. Payment details recorded with "MANUAL" flag

### Scenario 3: Monitoring Paid Quotes

1. Admin wants to see all paid but unbooked quotes
2. Steps:
   a. Go to admin dashboard
   b. Set Status filter to "Paid"
   c. Click "Apply"
3. Dashboard shows only paid quotes
4. Blue borders make them easy to identify
5. Admin can bulk select and schedule them

---

## Mobile Responsive Design

All UI elements are responsive:

- Filter dropdowns stack vertically on mobile
- Payment info section uses single-column grid on narrow screens
- Modal dialogs scale to fit mobile screens
- Touch-friendly tap targets (min 44px)
- Cards adapt to full width on mobile

---

## Accessibility Features

- ✅ ARIA labels on all interactive elements
- ✅ Keyboard navigation support (Tab, Enter, Escape)
- ✅ Focus indicators on all focusable elements
- ✅ Screen reader announcements for status updates
- ✅ Color + text indicators (not color-only)
- ✅ High contrast ratios (WCAG AA compliant)

---

## Performance

- Payment info section only renders for paid quotes
- Minimal DOM manipulation (document fragments)
- CSS animations hardware-accelerated
- Lazy loading for large quote lists
- Debounced search and filter inputs

---

## Browser Compatibility

Tested and working in:
- ✅ Chrome 90+ (desktop & mobile)
- ✅ Firefox 88+ (desktop & mobile)
- ✅ Safari 14+ (desktop & mobile)
- ✅ Edge 90+
- ✅ Samsung Internet 14+

---

## Future Enhancements (Not in This PR)

Potential improvements for future consideration:

1. **Email Notifications**
   - Send customer email when payment detected
   - Include payment confirmation and next steps

2. **SMS Notifications**
   - Text customer when payment confirmed
   - Option to text before scheduled clean

3. **Payment History View**
   - Dedicated page showing all payments
   - Filter by date range, amount, status
   - Export payment reports

4. **Refund Handling**
   - UI for processing refunds
   - Track refund status
   - Link refunds to original payments

5. **Multi-Currency Support**
   - Display amounts in customer's currency
   - Convert to GBP equivalent
   - Exchange rate tracking

6. **Payment Analytics**
   - Dashboard with payment metrics
   - Average payment time
   - Payment success rate
   - Revenue tracking

7. **Customer Payment Portal**
   - Customer-facing payment page
   - Real-time status updates
   - Payment history for customers

---

## Summary

This integration provides a complete, production-ready payment tracking system that:

- ✅ Automatically detects payments via Revolut webhook
- ✅ Updates quote status in real-time
- ✅ Displays payment information clearly
- ✅ Provides manual reconciliation for edge cases
- ✅ Filters and organizes quotes by payment status
- ✅ Maintains comprehensive audit trail
- ✅ Works seamlessly with existing admin dashboard

All changes are minimal, focused, and follow existing code patterns in the repository.
