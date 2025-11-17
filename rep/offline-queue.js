// Offline Payment Queue Dashboard Logic
// Real-time view of customers/*/quotes/* with offlineSubmitted == true
// Color codes:
//  - yellow: offlineSubmitted && !offlineEmailSent
//  - green: offlineSubmitted && offlineEmailSent && status === 'pending_payment'
//  - red: retryCount > 3 or explicit error flag

import { getFirestore, collectionGroup, query, where, onSnapshot, doc, updateDoc, addDoc, collection } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

const db = getFirestore();
const tbody = document.querySelector('#queueTable tbody');
const toastRoot = document.getElementById('toast');

function showToast(msg, type='info') {
  const div = document.createElement('div');
  div.className='item';
  div.style.borderColor = type==='error' ? '#dc2626' : (type==='success' ? '#16a34a' : '#64748b');
  div.textContent = msg;
  toastRoot.appendChild(div);
  setTimeout(()=>div.remove(), 4500);
}

function fmtDate(iso) {
  if (!iso) return ''; try { const d = new Date(iso); return d.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'})+' '+d.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}); } catch { return iso; }
}

function renderRows(items) {
  tbody.innerHTML='';
  items.sort((a,b)=> (b.timestamp||'').localeCompare(a.timestamp||''));
  for (const it of items) {
    const tr = document.createElement('tr');
    let cls='';
    if (it.offlineSubmitted && !it.offlineEmailSent) cls='yellow';
    else if (it.offlineSubmitted && it.offlineEmailSent && it.status==='pending_payment') cls='green';
    if ((it.retryCount||0) > 3 || it.error) cls='red';
    tr.className=cls;
    tr.innerHTML = `
      <td>${(it.customerName||'').replace(/</g,'&lt;')}</td>
      <td>${(it.email||it.customerEmail||'').replace(/</g,'&lt;')}</td>
      <td>£${Number(it.totalAmount||0).toFixed(2)}</td>
      <td>${(it.tierLabel||'')}</td>
      <td>${(it.repId||'')}</td>
      <td>${fmtDate(it.timestamp)}</td>
      <td>${it.status || (it.offlineEmailSent ? 'link-sent' : 'queued')}</td>
      <td>${it.retryCount||0}</td>
      <td><button data-id="${it._docPath}" class="resendBtn" ${!it.paymentLink?'disabled':''}>Resend</button></td>
    `;
    tbody.appendChild(tr);
  }
}

async function resend(idPath) {
  try {
    if (!idPath) return;
    const [customers, customerId, quotes, quoteId] = idPath.split('/');
    if (customers!=='customers' || quotes!=='quotes') throw new Error('Bad path');
    const ref = doc(db, customers, customerId, quotes, quoteId);
    const snap = await (await import('https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js')).getDoc(ref);
    const data = snap.exists() ? snap.data() : null;
    if (!data) throw new Error('Missing quote');
    if (!data.paymentLink) throw new Error('No paymentLink to resend');
    if (!window.emailjs || !emailjs.send) throw new Error('EmailJS not loaded');
    const totalStr = Number(data.totalAmount||0).toFixed(2);
  const body = `Please use this secure payment link to complete your upfront payment of £${totalStr} for your ${data.propertyType||''} on the ${data.tierLabel||''} plan:\n\n${data.paymentLink}\n\nOnce payment is completed, we will email you with all available booking dates for your first clean.\nIf you have any questions, just reply to this email. Thank you!`;
    await emailjs.send(
      'service_cdy739m',
      'template_6mpufs4',
      {
        title: 'Payment Link – Swash Cleaning Ltd',
        name: data.customerName || data.email || 'Customer',
        message: body
      }
    );
    await updateDoc(ref,{ lastResentAt: new Date().toISOString() });
    // Notification for rep (if repId present)
    if (data.repId) {
      try { await addDoc(collection(db,'notifications'), { type:'offline_resend', repId: data.repId, customerId, quoteId, timestamp:new Date().toISOString() }); } catch(_) {}
    }
    showToast('Resent payment link.', 'success');
  } catch(e) {
    console.warn('resend failed', e);
    showToast('Resend failed: '+(e.message||'error'), 'error');
  }
}

function attachResendDelegation() {
  tbody.addEventListener('click', e => {
    const btn = e.target.closest('button.resendBtn');
    if (!btn) return;
    const idPath = btn.getAttribute('data-id');
    resend(idPath);
  });
}

function startListener() {
  const qRef = query(collectionGroup(db,'quotes'), where('offlineSubmitted','==', true));
  onSnapshot(qRef, snap => {
    const items = [];
    snap.forEach(docSnap => {
      const data = docSnap.data();
      items.push({ ...data, _docPath: docSnap.ref.path });
    });
    renderRows(items);
  }, err => {
    console.error('queue listener error', err);
    showToast('Listener error', 'error');
  });
}

document.getElementById('refreshBtn')?.addEventListener('click', () => startListener());
attachResendDelegation();
startListener();

// Expose helper
window.resendOfflinePaymentLink = resend;