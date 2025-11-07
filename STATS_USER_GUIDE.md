# 📊 STATS DASHBOARD - USER GUIDE

## Quick Start

### Access the Dashboard
1. Go to your Swash Admin Dashboard
2. Click the **Menu** button (top right)
3. Select **📊 Stats**
4. Dashboard loads automatically with last 30 days of data

---

## Dashboard Sections

### 📈 Section 1: Rep Sales Performance

**What It Shows:**
- How many quotes each rep created
- How many converted to bookings (Conversion %)
- Average value per quote
- Total revenue generated

**How to Use It:**
- **Review overall performance:** Check KPI cards at top for summary
- **Compare reps:** Sort the table by any column
- **Spot trends:** Reps above 75% conversion are on track
- **Identify top earners:** Sort by "Total Value" to see revenue leaders

**Key Metrics Explained:**
- **Conversion Rate:** (Booked / Total Quotes) × 100 — higher is better
- **Avg Quote Value:** Total Revenue ÷ Total Quotes — shows deal size
- **Status Badge:**
  - ✓ On Track: 75%+ conversion rate
  - ⚠ Below Target: <75% conversion rate

---

### 🗺️ Section 2: Route Quality & Density
**Target: 320 customers per cleaner**

**What It Shows:**
- How many customers each cleaner has assigned
- Progress toward 320-customer target
- Weekly workload capacity
- Overall route efficiency

**How to Use It:**
- **Monitor capacity:** Green bars (90-110%) = balanced workload
- **Identify overload:** Red bars (>110%) = reassign some customers
- **Spot underutilization:** Yellow bars (<90%) = add more customers
- **Check weekly output:** "Avg/Week" column shows customer/week rate

**Visual Indicators:**
- 🟢 **Green** (90-110%): Perfect! On target
- 🟡 **Yellow** (<90%): Below capacity, add customers
- 🔴 **Red** (>110%): Over capacity, redistribute

**Example:**
```
Cleaner 3: ▓▓▓▓▓░░░ 285/320 (89%)
↳ 89% of target = Under capacity
↳ Should add ~35 more customers to reach 320
↳ Efficiency: 88%
```

---

### 💰 Section 3: Cleaner Efficiency & Pricing
**Target: £25 per clean**

**What It Shows:**
- Average price per clean for each cleaner's customers
- How far above/below the £25 target they are
- Projected total revenue per cleaner
- Pricing strategy effectiveness

**How to Use It:**
- **Monitor profitability:** Green bars = pricing on track
- **Identify premium service:** Green > 110% = premium customers (£26+)
- **Spot discounting:** Yellow < 90% = check for excessive discounts
- **Calculate revenue impact:** Projected Revenue × 3 cleans = annual cleaning value per cleaner's portfolio

**Visual Indicators:**
- 🟢 **Green** (90-110%): Perfect pricing! On target at £25
- 🟡 **Yellow** (<90%): Below target, pricing too low
- 🟢 **Premium** (>110%): Premium pricing (£26+/clean) — could be premium tier customers

**Example:**
```
Cleaner 2: ▓▓▓▓░░░░ £22.00 / £25.00 (88%)
↳ £3.00 below target
↳ If 285 customers × £22 × 3 cleans = £18,810
↳ Could increase to £25: 285 × £25 × 3 = £21,375
↳ Potential revenue increase: +£2,565
```

---

## How to Use Filters

### Date Range Filter
**Located:** Top right of dashboard

**Options:**
- **Last 30 Days** ← Default, shows most recent activity
- **This Month** - Calendar month only
- **This Quarter** - Last 3 months
- **This Year** - Year-to-date data
- **Custom Range** - Pick start and end dates manually

**Use Cases:**
- Want monthly performance review? Select "This Month"
- Checking quarterly targets? Select "This Quarter"
- Year-end report? Select "This Year"
- Comparing two specific weeks? Select "Custom Range"

**Example:**
1. Click the dropdown (currently showing "Last 30 Days")
2. Select "This Month"
3. Dashboard updates instantly — all sections refilter to current calendar month

---

## Refresh Button

**Located:** Top right, next to date range filter

**What It Does:**
- Reloads all data from Firestore in real-time
- Updates all three sections with latest quotes
- Takes 1-2 seconds

**When to Use:**
- After bulk operations (mass quote creation, booking, assigning cleaners)
- If you notice data seems stale
- Before generating a report

**How to Use:**
1. Click the **🔄 Refresh** button
2. Button grays out while loading
3. Data updates automatically

---

## Understanding the Tables

### Rep Sales Table Columns

| Column | Meaning | Example |
|--------|---------|---------|
| **Rep** | Rep code (from quote system) | CHRIS, JASMINE |
| **Quotes** | Total quotes submitted | 12 |
| **Booked** | Quotes that became bookings | 10 |
| **Conv %** | Conversion rate | 83% |
| **Avg Price** | Average price per clean across quotes | £28.50 |
| **Total Value** | Sum of all their quotes' prices | £342.00 |
| **Status** | Performance indicator | ✓ On Track |

### Cleaner Density Table Columns

| Column | Meaning | Example |
|--------|---------|---------|
| **Cleaner** | Cleaner identifier | Cleaner 1 |
| **Assigned** | Total customers for this cleaner | 245 |
| **% Target** | Percent of 320-customer target | 77% |
| **Avg/Week** | Customers serviced per week (÷4 weeks) | 61 |
| **Efficiency** | Overall route efficiency score | 92% |
| **Status** | Capacity status | ⚠ Under |

### Cleaner Pricing Table Columns

| Column | Meaning | Example |
|--------|---------|---------|
| **Cleaner** | Cleaner identifier | Cleaner 1 |
| **Avg Price** | Average £ per clean across all their customers | £24.50 |
| **vs Target** | Difference from £25 target | -£0.50 |
| **Total Revenue** | Projected from 3 cleans per customer | £18,017.50 |
| **Profitability** | Efficiency score for pricing | 98% |
| **Status** | Pricing status | ✓ On Target |

---

## Common Questions & Answers

### Q: Why is Cleaner 3's efficiency 88% but they're at 285/320 customers (89%)?
**A:** Efficiency also factors booking rate and price consistency. 285 customers at 89% is high utilization.

### Q: How is "Projected Revenue" calculated?
**A:** `Customers × Average Price × 3 cleans` 
- Example: 245 customers × £24.50 × 3 = £18,017.50

### Q: What does "Avg/Week" mean in density section?
**A:** Your service cycle is 28 days (4 weeks), so this shows: Total Assigned ÷ 4
- Example: 245 customers ÷ 4 weeks = ~61 customers per week

### Q: Can I filter by cleaner?
**A:** Not yet — recommend this feature! Currently showing all cleaners. You can manually focus on specific rows.

### Q: Why is a rep showing 0 conversion rate?
**A:** They have quotes but none have been booked yet (`bookedDate` field is empty).

### Q: What counts as "booked"?
**A:** Either:
1. Quote has a `bookedDate` field set, OR
2. Quote `status` field contains "booked" (case-insensitive)

### Q: Can I export this data?
**A:** Not yet — export feature coming soon! For now:
- Screenshot individual sections
- Right-click table → "Copy" → Paste to Excel
- Browser DevTools console: `copy(state.allQuotes)` to export raw data

---

## Tips & Best Practices

### 📊 Weekly Reviews
- Set a recurring meeting every Monday
- Filter to "Last 7 Days" to see week performance
- Focus on rep conversion trends and cleaner capacity

### 🎯 Target Monitoring
- **Rep Goal:** Aim for 80%+ conversion rates
- **Cleaner Goal:** Aim for 90-110% of 320 customer target per cleaner
- **Pricing Goal:** Aim for 90-110% of £25 average per clean

### 🔴 Red Flags to Watch
- Rep with <70% conversion = coaching opportunity
- Cleaner >120% capacity = risk of burnout, reassign customers
- Cleaner <70% capacity = underutilized, add more customers
- Cleaner <£20 avg price = pricing too low, consider tier adjustment

### 💡 Action Items from Stats

**If seeing high conversion (85%+):**
→ Rep is great! Increase their quota or spotlight their technique

**If seeing low conversion (<70%):**
→ Schedule coaching call, review their process, check quote quality

**If cleaner is over-assigned (>120%):**
→ Reassign ~50-60 customers to another cleaner immediately

**If cleaner is under-assigned (<70%):**
→ Review their performance; if good, add more customers from waitlist

**If prices are dropping:**
→ Check if customers are asking for discounts; train on premium positioning

---

## Troubleshooting

### Dashboard won't load
- **Cause:** Auth not complete
- **Fix:** Make sure you're logged in, reload page

### Data looks stale
- **Cause:** Not updated recently
- **Fix:** Click "🔄 Refresh" button

### Filter not working
- **Cause:** Page caching issue
- **Fix:** Hard refresh (Ctrl+Shift+R on Windows, Cmd+Shift+R on Mac)

### Can't see Stats in menu
- **Cause:** You're not an admin
- **Fix:** Contact your admin to set your role to "admin" in users table

### Numbers don't add up
- **Cause:** Multiple quotes per customer or deleted quotes
- **Fix:** Filtered quotes exclude soft-deleted records; check quote status

---

## Next Steps

1. **Review your current state:** Load the dashboard and examine baseline metrics
2. **Set targets:** Based on your business, adjust goals (320 customers, £25 price)
3. **Monitor weekly:** Make this part of your routine
4. **Take action:** Use insights to coach reps and optimize routes
5. **Request features:** Need custom reports? Let me know!

---

## Contact & Support

For questions about:
- **Dashboard access:** Check if you have admin role
- **Data accuracy:** Verify quote entries in admin dashboard
- **Feature requests:** Create a list of needed enhancements
- **Technical issues:** Check browser console (F12) for errors

---

**Dashboard Ready to Use! 🚀**

Go to: https://swash-app-436a1.web.app/admin/stats.html

Good luck with your performance analytics! 📊
