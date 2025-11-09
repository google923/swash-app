import { auth, db } from "../firebase-init.js";
import { collection, doc, getDoc, getDocs, query, where } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";

const els = {
  monthMiles: null,
  monthCommission: null,
  monthSignups: null,
  recentLogs: null,
  breakdown: null,
};

function getEls() {
  els.monthMiles = document.getElementById("c_monthMiles");
  els.monthCommission = document.getElementById("c_monthCommission");
  els.monthSignups = document.getElementById("c_monthSignups");
  els.recentLogs = document.getElementById("c_recentLogs");
  els.breakdown = document.getElementById("c_breakdown");
}

function monthRange(date = new Date()) {
  const start = new Date(date.getFullYear(), date.getMonth(), 1);
  const end = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  const s = start.toISOString().slice(0,10);
  const e = end.toISOString().slice(0,10);
  return { s, e };
}

async function loadMonth(user) {
  getEls();
  const { s, e } = monthRange();
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

  // Commission rough calc (placeholder until policy): £5 per sale
  const commissionPerSale = 5;
  const commission = sales * commissionPerSale;

  if (els.monthMiles) els.monthMiles.textContent = miles.toFixed(2) + " mi";
  if (els.monthCommission) els.monthCommission.textContent = `£${commission.toFixed(2)}`;
  if (els.monthSignups) els.monthSignups.textContent = String(sales);

  if (els.breakdown) {
    els.breakdown.innerHTML = `
      <table style="width:100%;border-collapse:collapse">
        <tr><td>Doors knocked</td><td>${doors}</td></tr>
        <tr><td>Sign ups</td><td>${sales}</td></tr>
        <tr><td>Pay (hourly)</td><td>£${totalPay.toFixed(2)}</td></tr>
        <tr><td>Mileage expense</td><td>£${mileageExpense.toFixed(2)}</td></tr>
        <tr><td><strong>Total owed</strong></td><td><strong>£${totalOwed.toFixed(2)}</strong></td></tr>
        <tr><td>Commission (est.)</td><td>£${commission.toFixed(2)} <span style="color:#64748b">(£${commissionPerSale}/sale)</span></td></tr>
      </table>
    `;
  }

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

onAuthStateChanged(auth, (user) => {
  if (!user) return; // auth-check overlay handles auth
  loadMonth(user);
});
