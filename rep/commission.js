import { auth, db } from "../firebase-init.js";
import { collection, doc, getDoc, getDocs, onSnapshot, query, where } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";

const els = {
  monthMiles: null,
  monthCommission: null,
  monthSignups: null,
  recentLogs: null,
  breakdown: null,
  signups: null,
};

function getEls() {
  els.monthMiles = document.getElementById("c_monthMiles");
  els.monthCommission = document.getElementById("c_monthCommission");
  els.monthSignups = document.getElementById("c_monthSignups");
  els.recentLogs = document.getElementById("c_recentLogs");
  els.breakdown = document.getElementById("c_breakdown");
  els.signups = document.getElementById("c_signups");
}

function monthRange(date = new Date()) {
  const start = new Date(date.getFullYear(), date.getMonth(), 1);
  const end = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  const s = start.toISOString().slice(0,10);
  const e = end.toISOString().slice(0,10);
  return { s, e, start, end };
}

async function loadMonth(user) {
  getEls();
  const { s, e, start, end } = monthRange();
  // Pull daily shift summaries from repShifts keyed by repId_date
  let miles = 0, totalPay = 0, mileageExpense = 0, totalOwed = 0, doors = 0, sales = 0;
  try {
    // Brute force fetch of this month by iterating dates and trying each key
    const today = new Date(s);
    const end = new Date(e);
    const days = [];
    for (let d = new Date(today); d <= end; d.setDate(d.getDate()+1)) {
      days.push(d.toISOString().slice(0,10));
    }
    const summaries = [];
    for (const day of days) {
      const id = `${user.uid}_${day}`;
      const snap = await getDoc(doc(db, "repShifts", id));
      if (snap.exists()) summaries.push(snap.data());
    }
    summaries.forEach(su => {
      miles += Number(su.miles||0);
      doors += Number(su.totals?.doors||0);
      sales += Number(su.totals?.sales||0);
      totalPay += Number(su.pay||0);
      mileageExpense += Number(su.mileageExpense||0);
      totalOwed += Number(su.totalOwed||0);
    });
  } catch (e) { console.warn("commission summary load failed", e); }

  // Update miles card (activity only; not reimbursed in contractor model)
  if (els.monthMiles) els.monthMiles.textContent = miles.toFixed(2) + " mi";

  // Compute actual monthly commission from quotes and render signups table
  await computeCommissionFromQuotes(user, { start, end, s, e, doors });
  // Attach real-time updates for quotes matching this rep
  attachQuotesListener(user, { start, end, s, e, doors });

  // Recent logs (last 7 days) from repLogs/{repId}/dates/*/doorLogs
  try {
    const list = [];
    for (let i=0;i<7;i++){
      const d = new Date(Date.now() - i*86400000);
      const key = d.toISOString().slice(0,10);
      const col = collection(db, 'repLogs', user.uid, 'dates', key, 'doorLogs');
      const snap = await getDocs(col);
      snap.forEach(docu => list.push({ date: key, ...docu.data() }));
    }
    list.sort((a,b)=> new Date(b.timestamp)-new Date(a.timestamp));
    if (els.recentLogs) {
      els.recentLogs.innerHTML = list.slice(0,10).map(l => `
        <div style="padding:6px 0;border-bottom:1px dashed #e5e7eb;display:flex;gap:8px;justify-content:space-between">
          <div>${new Date(l.timestamp).toLocaleString('en-GB')}</div>
          <div>${l.status}${l.roadName?` • ${l.houseNumber||''} ${l.roadName}`:''}</div>
        </div>
      `).join('') || '<div class="text-muted">No recent logs found.</div>';
    }
  } catch(e) { console.warn("recent logs load failed", e); }
}

// Real-time listener for quotes by repCode (handles case variance)
let quotesRealtimeUnsubs = [];
async function attachQuotesListener(user, periodCtx) {
  // Cleanup existing
  quotesRealtimeUnsubs.forEach(fn => { try { fn(); } catch(_) {} });
  quotesRealtimeUnsubs = [];
  try {
    const repNameForMatch = await getRepNameForMatch(user);
    const namesToTry = Array.from(new Set([repNameForMatch, (repNameForMatch||'').toUpperCase()]));
    namesToTry.forEach(name => {
      const qRef = query(collection(db, 'quotes'), where('repCode', '==', name));
      const unsub = onSnapshot(qRef, () => {
        // On any change, recompute from fresh fetch to include cross-name dedupe
        computeCommissionFromQuotes(user, periodCtx);
      });
      quotesRealtimeUnsubs.push(unsub);
    });
  } catch(err) { console.warn('attachQuotesListener failed', err); }
}

async function getRepNameForMatch(user) {
  try {
    const snap = await getDoc(doc(db, 'users', user.uid));
    if (snap.exists()) {
      const d = snap.data();
      return d.name || d.repName || user.displayName || user.email || '';
    }
  } catch(_) {}
  return user.displayName || user.email || '';
}

function parseDateLike(v) {
  if (!v) return null;
  if (typeof v === 'string') {
    const d = new Date(v);
    return isNaN(d) ? null : d;
  }
  if (v?.toDate) {
    try { return v.toDate(); } catch(_) { return null; }
  }
  return null;
}

function inMonth(d, start, end) {
  if (!d) return false;
  // end is inclusive date (last day), make range inclusive by < end+1day
  const endPlus = new Date(end.getFullYear(), end.getMonth(), end.getDate()+1);
  return d >= start && d < endPlus;
}

async function computeCommissionFromQuotes(user, periodCtx) {
  const { start, end, doors } = periodCtx;
  const repNameForMatch = await getRepNameForMatch(user);
  let quotes = [];
  try {
    const namesToTry = Array.from(new Set([repNameForMatch, (repNameForMatch||'').toUpperCase()]));
    for (const name of namesToTry) {
      const snap = await getDocs(query(collection(db, 'quotes'), where('repCode', '==', name)));
      snap.forEach(ds => {
        const q = ds.data() || {};
        if (q.deleted) return;
        const id = ds.id;
        if (quotes.some(x => x.id === id)) return; // dedupe
        q.id = id;
        quotes.push(q);
      });
    }
  } catch(err) { console.warn('Failed to fetch quotes for rep', err); }

  // Compute monthly totals and rows
  const RATE = [15, 8, 8];
  let monthlyCommission = 0;
  let createdThisMonth = 0;
  let customersCleanedThisMonth = 0; // customers with >=1 commissionable occurrence in month
  let activeCustomers = 0; // customers with >=1 commissionable occurrence overall
  const rows = [];

  for (const q of quotes) {
    const created = parseDateLike(q.createdAt) || parseDateLike(q.date);
    if (created && inMonth(created, start, end)) createdThisMonth++;

    const paidMap = (q.paidOccurrences && typeof q.paidOccurrences === 'object') ? q.paidOccurrences : {};
    const compMap = (q.completedOccurrences && typeof q.completedOccurrences === 'object') ? q.completedOccurrences : {};
    const occKeys = Object.keys(compMap).filter(k => paidMap[k]);
    const occDates = occKeys
      .map(k => ({ key: k, date: parseDateLike(k) }))
      .filter(o => !!o.date)
      .sort((a,b) => a.date - b.date);

    const commissionableCount = occDates.length;
    if (commissionableCount > 0) activeCustomers++;

    let perQuoteMonthCommission = 0;
    let hasMonthOccurrence = false;
    occDates.forEach((o, idx) => {
      const rate = RATE[idx] || 0;
      if (rate <= 0) return;
      if (inMonth(o.date, start, end)) {
        perQuoteMonthCommission += rate;
        hasMonthOccurrence = true;
      }
    });
    if (hasMonthOccurrence) customersCleanedThisMonth++;
    monthlyCommission += perQuoteMonthCommission;

    const progress = `${Math.min(commissionableCount,3)}/3 payouts done`;
    const status = commissionableCount === 0 ? 'Awaiting first clean' : (commissionableCount >= 3 ? 'Commission complete' : `Next: ${commissionableCount+1} of 3`);
    const booked = parseDateLike(q.bookedDate);
    const signedStr = created ? created.toLocaleDateString('en-GB') : '—';
    const bookedStr = booked ? booked.toLocaleDateString('en-GB') : '—';

    rows.push({
      customer: q.customerName || q.address || q.email || 'Customer',
      ref: q.refCode || '—',
      signed: signedStr,
      booked: bookedStr,
      progress,
      status,
      monthCommission: perQuoteMonthCommission,
    });
  }

  // Render cards
  if (els.monthMiles) els.monthMiles.textContent = milesToTextSafe();
  if (els.monthCommission) els.monthCommission.textContent = `£${monthlyCommission.toFixed(2)}`;
  if (els.monthSignups) els.monthSignups.textContent = String(createdThisMonth);

  // Render breakdown
  if (els.breakdown) {
    const avgPerCleaned = customersCleanedThisMonth ? (monthlyCommission / customersCleanedThisMonth) : 0;
    const avgPerActive = activeCustomers ? (monthlyCommission / activeCustomers) : 0;
    els.breakdown.innerHTML = `
      <div style="line-height:1.6;color:#111827">
        <div style="margin-bottom:10px; font-weight:600; color:#0078d7;">Commission Policy Summary</div>
        <ul style="margin:0 0 14px 18px; color:#374151;">
          <li>Commission-only: no hourly pay, no mileage reimbursement.</li>
          <li>Rates: £15 after 1st clean, £8 after 2nd, £8 after 3rd.</li>
          <li>Eligibility: clean completed and paid, matches your rep ID, passes verification.</li>
          <li>Payout: monthly in arrears for cleans completed in the month.</li>
        </ul>
        <table style="width:100%;border-collapse:collapse">
          <tr><td style="padding:6px 0;border-bottom:1px solid #e5e7eb;">Doors knocked (activity)</td><td style="padding:6px 0;border-bottom:1px solid #e5e7eb;">${periodCtxDoorsSafe(doors)}</td></tr>
          <tr><td style="padding:6px 0;border-bottom:1px solid #e5e7eb;">Sign-ups created this month</td><td style="padding:6px 0;border-bottom:1px solid #e5e7eb;">${createdThisMonth}</td></tr>
          <tr><td style="padding:6px 0;border-bottom:1px solid #e5e7eb;">Customers cleaned (commission in month)</td><td style="padding:6px 0;border-bottom:1px solid #e5e7eb;">${customersCleanedThisMonth}</td></tr>
          <tr><td style="padding:6px 0;border-bottom:1px solid #e5e7eb;"><strong>Total commission (this month)</strong></td><td style="padding:6px 0;border-bottom:1px solid #e5e7eb;"><strong>£${monthlyCommission.toFixed(2)}</strong></td></tr>
          <tr><td style="padding:6px 0;">Avg per cleaned customer</td><td style="padding:6px 0;">£${avgPerCleaned.toFixed(2)}</td></tr>
          <tr><td style="padding:6px 0;">Avg per active customer</td><td style="padding:6px 0;">£${avgPerActive.toFixed(2)}</td></tr>
        </table>
      </div>
    `;
  }

  // Render signups table
  if (els.signups) {
    if (!rows.length) {
      els.signups.textContent = 'No sign-ups found for your rep code.';
    } else {
      const head = `
        <table style="width:100%;border-collapse:collapse">
          <thead>
            <tr style="background:#eef5ff;color:#1e293b;text-align:left;">
              <th style="padding:8px;border-bottom:1px solid #e5e7eb;">Customer</th>
              <th style="padding:8px;border-bottom:1px solid #e5e7eb;">Ref</th>
              <th style="padding:8px;border-bottom:1px solid #e5e7eb;">Signed</th>
              <th style="padding:8px;border-bottom:1px solid #e5e7eb;">Booked</th>
              <th style="padding:8px;border-bottom:1px solid #e5e7eb;">Progress</th>
              <th style="padding:8px;border-bottom:1px solid #e5e7eb;">Status</th>
              <th style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:right;">This month (£)</th>
            </tr>
          </thead>
          <tbody>`;
      const body = rows.sort((a,b)=> a.customer.localeCompare(b.customer)).map(r => `
            <tr>
              <td style="padding:8px;border-bottom:1px solid #e5e7eb;">${escapeHtmlSafe(r.customer)}</td>
              <td style="padding:8px;border-bottom:1px solid #e5e7eb;">${escapeHtmlSafe(r.ref)}</td>
              <td style="padding:8px;border-bottom:1px solid #e5e7eb;">${escapeHtmlSafe(r.signed)}</td>
              <td style="padding:8px;border-bottom:1px solid #e5e7eb;">${escapeHtmlSafe(r.booked)}</td>
              <td style="padding:8px;border-bottom:1px solid #e5e7eb;">${escapeHtmlSafe(r.progress)}</td>
              <td style="padding:8px;border-bottom:1px solid #e5e7eb;">${escapeHtmlSafe(r.status)}</td>
              <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:right;">£${r.monthCommission.toFixed(2)}</td>
            </tr>`).join('');
      const foot = `</tbody></table>`;
      els.signups.innerHTML = head + body + foot;
    }
  }
}

function escapeHtmlSafe(v){
  return String(v||'').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
}

function milesToTextSafe(){
  // Prefer existing displayed miles if already set earlier
  return els.monthMiles?.textContent && els.monthMiles.textContent !== '--' ? els.monthMiles.textContent : '--';
}

function periodCtxDoorsSafe(doors){
  return typeof doors === 'number' ? String(doors) : '--';
}

onAuthStateChanged(auth, (user) => {
  if (!user) return; // auth-check overlay handles auth
  loadMonth(user);
});
