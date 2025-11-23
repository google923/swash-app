// GoCardless Webhook Handler (offline-aware)
// Updates offlineSubmitted quotes when payment confirmed.
// Suppresses duplicate email flows; creates notification document.
import admin from 'firebase-admin';
import getRawBody from 'raw-body';
import { sendEmailJsTemplate } from '../lib/emailjs.js';
import { logOutboundEmailToFirestore } from '../lib/firestore-utils.js';

if (!admin.apps.length) {
  try {
    admin.initializeApp();
  } catch (e) {
    console.warn('[gcWebhook] Firebase admin init failed', e);
  }
}

const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;
const BASELINE_START_DATE = '2025-11-03';
const BOOKING_EMAIL_TITLE = "We've received your payment — let’s get you booked in!";
const BOOKING_BUTTON_STYLE = 'display:inline-block;padding:12px 18px;margin:8px 0;background:#0078d7;color:#fff;border-radius:6px;text-decoration:none;';
const BOOKING_CAPACITY_LIMIT = 400;
const BOOKING_LOOKAHEAD_DAYS = 120;
const BOOKING_MAX_OPTIONS = 5;
const BOOKING_CONFIRM_URL = process.env.BOOKING_CONFIRM_URL || 'https://app.swashcleaning.co.uk/confirm-booking';
const EMAIL_TEMPLATE_BLANK = 'template_6mpufs4';
const DAY_MS = 24 * 60 * 60 * 1000;

let bookedQuotesCache = null;

function normalizeDate(value) {
  const date = value instanceof Date ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  date.setHours(0, 0, 0, 0);
  return date;
}

function addDays(date, amount) {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
}

function getCycleWeekNumber(dateInput) {
  try {
    const baseline = new Date(`${BASELINE_START_DATE}T00:00:00`);
    const weekStart = new Date(dateInput);
    const day = weekStart.getDay();
    const offset = day === 0 ? -6 : 1 - day;
    weekStart.setDate(weekStart.getDate() + offset);
    const diffWeeks = Math.floor((weekStart - baseline) / (7 * DAY_MS));
    const mod = ((diffWeeks % 4) + 4) % 4;
    return mod + 1;
  } catch (error) {
    console.warn('[gcWebhook] getCycleWeekNumber fallback', error);
    return 1;
  }
}

function getWeekKeyForDate(dateInput) {
  return `week${getCycleWeekNumber(dateInput)}`;
}

function getDayKeyForDate(dateInput) {
  try {
    const label = new Date(dateInput).toLocaleDateString('en-GB', { weekday: 'short' });
    return label.replace('.', '');
  } catch (error) {
    console.warn('[gcWebhook] getDayKeyForDate fallback', error);
    return 'Mon';
  }
}

function occursOnDate(quote, targetDate) {
  try {
    if (!quote || !quote.bookedDate) return false;
    const start = normalizeDate(quote.bookedDate);
    const target = normalizeDate(targetDate);
    if (!start || !target) return false;
    const diff = Math.round((target - start) / DAY_MS);
    return diff >= 0 && diff % 28 === 0;
  } catch (error) {
    console.warn('[gcWebhook] occursOnDate fallback', error);
    return false;
  }
}

function resolvePricePerCleanLocal(quote = {}) {
  const candidates = [quote.pricePerClean, quote.price_per_clean, quote.price];
  for (const value of candidates) {
    const num = Number(value);
    if (Number.isFinite(num) && num > 0) {
      return num;
    }
  }
  return 0;
}

async function loadBookedQuotes() {
  if (bookedQuotesCache) return bookedQuotesCache;
  try {
    const snap = await db.collection('quotes').where('bookedDate', '!=', null).get();
    bookedQuotesCache = snap.docs
      .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
      .filter((item) => item && !item.deleted && item.bookedDate);
  } catch (error) {
    console.error('[gcWebhook] loadBookedQuotes failed', error);
    bookedQuotesCache = [];
  }
  return bookedQuotesCache;
}

function computeDayTotalGBP(dateISO, bookedQuotes) {
  if (!Array.isArray(bookedQuotes) || !bookedQuotes.length) return 0;
  return bookedQuotes.reduce((sum, quote) => {
    if (occursOnDate(quote, dateISO)) {
      return sum + resolvePricePerCleanLocal(quote);
    }
    return sum;
  }, 0);
}

function formatSlotLabel(dateObj, weekKey) {
  const dayName = dateObj.toLocaleDateString('en-GB', { weekday: 'long' });
  const datePart = dateObj.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const weekNumber = weekKey.replace('week', '');
  return `${dayName} Week ${weekNumber} - ${datePart}`;
}

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildButtonUrl(customerId, iso) {
  const params = new URLSearchParams({ cid: customerId, date: iso });
  return `${BOOKING_CONFIRM_URL}?${params.toString()}`;
}

function buildBookingButtonsHtml(customerId, slots) {
  return slots
    .map((slot) => {
      const url = buildButtonUrl(customerId, slot.iso);
      const label = escapeHtml(slot.label);
      return `<a href="${url}" style="${BOOKING_BUTTON_STYLE}">${label}</a>`;
    })
    .join('\n\n');
}

async function fetchAllowedBookingDays(territoryId) {
  if (!territoryId) return null;
  try {
    const snap = await db.collection('territories').doc(territoryId).get();
    if (!snap.exists) return null;
    const data = snap.data() || {};
    return data.allowedBookingDays || null;
  } catch (error) {
    console.warn('[gcWebhook] fetchAllowedBookingDays failed', error);
    return null;
  }
}

function getCleanersForDay(allowedBookingDays = {}, weekKey, dayKey) {
  if (!allowedBookingDays || typeof allowedBookingDays !== 'object') return [];
  const weekEntry =
    allowedBookingDays[weekKey] ||
    allowedBookingDays[weekKey.toLowerCase()] ||
    allowedBookingDays[weekKey.toUpperCase()];
  if (!weekEntry) return [];
  const variants = [
    dayKey,
    dayKey.toLowerCase(),
    dayKey.toUpperCase(),
    dayKey.charAt(0).toUpperCase() + dayKey.slice(1).toLowerCase(),
  ];
  for (const key of variants) {
    if (Array.isArray(weekEntry[key])) {
      return weekEntry[key];
    }
  }
  return [];
}

function resolveJobPrice(quoteData = {}) {
  const pricePerClean = Number(quoteData.pricePerClean || quoteData.price_per_clean);
  if (Number.isFinite(pricePerClean) && pricePerClean > 0) return pricePerClean;
  const priceField = Number(quoteData.price);
  if (Number.isFinite(priceField) && priceField > 0) return priceField;
  const totalAmount = Number(quoteData.totalAmount);
  if (Number.isFinite(totalAmount) && totalAmount > 0) {
    return Number((totalAmount / 3).toFixed(2));
  }
  const text = quoteData.pricePerCleanText;
  if (typeof text === 'string' && text.trim()) {
    const num = Number(text.replace(/[^0-9.]/g, ''));
    if (Number.isFinite(num) && num > 0) return num;
  }
  return 0;
}

async function buildBookingSlots({ territoryId, allowedBookingDays, jobPrice }) {
  if (!territoryId || !allowedBookingDays) return [];
  const today = normalizeDate(new Date());
  if (!today) return [];
  const limitDate = addDays(today, BOOKING_LOOKAHEAD_DAYS);
  const bookedQuotes = await loadBookedQuotes();
  const jobValue = Number(jobPrice) || 0;
  const slots = [];
  for (let cursor = addDays(today, 1); cursor <= limitDate && slots.length < BOOKING_MAX_OPTIONS; cursor = addDays(cursor, 1)) {
    const iso = cursor.toISOString();
    const weekKey = getWeekKeyForDate(cursor);
    const dayKey = getDayKeyForDate(cursor);
    const cleaners = getCleanersForDay(allowedBookingDays, weekKey, dayKey);
    if (!cleaners.length) continue;
    const baseTotal = computeDayTotalGBP(iso, bookedQuotes);
    if (baseTotal + jobValue > BOOKING_CAPACITY_LIMIT) continue;
    slots.push({
      label: formatSlotLabel(new Date(cursor), weekKey),
      iso,
      weekKey,
      dayKey,
      territoryId,
      cleanerId: cleaners[0] || null,
    });
  }
  return slots;
}

function buildBookingMessage({ customerName, customerId, slots }) {
  const safeName = escapeHtml(customerName || 'there');
  const buttonsHtml = buildBookingButtonsHtml(customerId, slots);
  return `Thank you ${safeName}, your payment has been received and recorded.\n\nPlease choose one of the following available booking dates:\n\n${buttonsHtml}\n\nIf none of these dates work, simply reply to this email and we’ll arrange a suitable time.`;
}

function extractSubscriberIdFromPath(path) {
  if (!path) return null;
  const segments = String(path).split('/');
  const index = segments.indexOf('subscribers');
  if (index === -1 || index + 1 >= segments.length) return null;
  return segments[index + 1];
}

async function processSmsPurchases(billingRequestId) {
  if (!billingRequestId) {
    return { handled: false, updated: 0 };
  }
  try {
    const purchasesSnap = await db.collectionGroup('smsPurchases').where('billingRequestId', '==', billingRequestId).get();
    if (purchasesSnap.empty) {
      return { handled: false, updated: 0 };
    }

    let updated = 0;
    for (const docSnap of purchasesSnap.docs) {
      const ref = docSnap.ref;
      const subscriberId = extractSubscriberIdFromPath(ref.path);
      if (!subscriberId) continue;

      let applied = false;
      await db.runTransaction(async (tx) => {
        const latest = await tx.get(ref);
        if (!latest.exists) return;
        const data = latest.data() || {};
        const status = (data.status || '').toLowerCase();
        if (status === 'completed') return;
        const credits = Number(data.credits) || 0;
        if (!credits) return;

        const settingsRef = db.collection('subscribers').doc(subscriberId).collection('private').doc('smsSettings');
        tx.set(settingsRef, {
          creditsBalance: FieldValue.increment(credits),
          lastTopUpAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });

        tx.set(ref, {
          status: 'completed',
          completedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
        applied = true;
      });
      if (applied) {
        updated += 1;
      }
    }

    return { handled: true, updated };
  } catch (error) {
    console.error('[gcWebhook] Failed to process SMS purchase', error);
    return { handled: false, updated: 0, error };
  }
}

async function sendBookingSelectionEmail({ quoteSnap, quoteData }) {
  const customerRef = quoteSnap.ref.parent.parent;
  if (!customerRef) return { sent: false };
  const customerSnap = await customerRef.get();
  if (!customerSnap.exists) return { sent: false };
  const customer = customerSnap.data() || {};
  const customerId = customerSnap.id;
  const customerEmail = customer.email || quoteData.customerEmail || quoteData.email || '';
  const customerName = customer.name || quoteData.customerName || 'there';
  const territoryId = quoteData.territoryId || customer.territoryId;
  if (!territoryId) return { sent: false };
  const allowedBookingDays = await fetchAllowedBookingDays(territoryId);
  if (!allowedBookingDays) return { sent: false };
  const jobPrice = resolveJobPrice(quoteData);
  const slots = await buildBookingSlots({ territoryId, allowedBookingDays, jobPrice });
  if (!slots.length) return { sent: false };
  const message = buildBookingMessage({ customerName, customerId, slots });
  await sendEmailJsTemplate(EMAIL_TEMPLATE_BLANK, {
    title: BOOKING_EMAIL_TITLE,
    name: customerName,
    message,
  });
  if (customerEmail) {
    try {
      await logOutboundEmailToFirestore({
        to: customerEmail,
        subject: BOOKING_EMAIL_TITLE,
        body: message,
        source: 'gcWebhook-booking',
      });
    } catch (logError) {
      console.warn('[gcWebhook] outbound email log failed', logError);
    }
  }
  return { sent: true, slots, customerId };
}

export const config = {
  api: {
    bodyParser: false, // we use raw for potential signature verification later
  }
};

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let text; let json;
  try {
    const buf = await getRawBody(req, { encoding: 'utf-8' });
    text = buf.toString();
    json = JSON.parse(text);
  } catch (e) {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  const events = Array.isArray(json?.events) && json.events.length ? json.events : [json];
  let handledAny = false;
  const summary = [];

  for (const evt of events) {
    const billingRequestId = evt.billing_request_id || evt.billing_request?.id || evt.resource?.billing_request?.id || evt.resource?.id || evt.links?.billing_request || null;
    const eventStatus = evt.status || evt.event?.status || evt.resource?.status || null;
    const eventType = evt.event?.type || evt.type || '';
    const eventAction = evt.action || '';

    if (!billingRequestId) {
      summary.push({ ignored: true, reason: 'No billing_request_id' });
      continue;
    }

    const isConfirmed = /confirmed|paid|fulfilled|payment_created|payment_confirmed|payment_paid/i.test(eventStatus || '')
      || /fulfilled|payment_confirmed|payment_paid/i.test(eventType)
      || /fulfilled/i.test(eventAction);

    if (!isConfirmed) {
      summary.push({ billingRequestId, ignored: true, reason: 'Not a confirmation event', eventStatus, eventType, eventAction });
      continue;
    }

    handledAny = true;

    try {
      const smsResult = await processSmsPurchases(billingRequestId);
      const quotesQuery = await db.collectionGroup('quotes').where('gocardlessRef', '==', billingRequestId).get();
      if (quotesQuery.empty) {
        summary.push({ billingRequestId, success: true, updated: 0, smsPurchasesUpdated: smsResult.updated || 0 });
        continue;
      }
      let updated = 0;
      for (const docSnap of quotesQuery.docs) {
        const data = docSnap.data();
        if (data.offlineSubmitted) {
          const paymentIso = new Date().toISOString();
          const updatePayload = { status: 'paid', offlinePaidAt: paymentIso };
          if (!data.bookingEmailSent) {
            try {
              const bookingResult = await sendBookingSelectionEmail({ quoteSnap: docSnap, quoteData: data });
              if (bookingResult?.sent) {
                updatePayload.bookingEmailSent = true;
                updatePayload.bookingEmailSentAt = new Date().toISOString();
                updatePayload.bookingOptions = bookingResult.slots;
                updatePayload.bookingOptionsGeneratedAt = new Date().toISOString();
              }
            } catch (bookingError) {
              console.error('[gcWebhook] booking email dispatch failed', bookingError);
            }
          }
          await docSnap.ref.update(updatePayload);
          updated++;
          const repId = data.repId || null;
          await db.collection('notifications').add({
            type: 'payment_received',
            repId,
            customerId: docSnap.ref.parent.parent?.id || null,
            quotePath: docSnap.ref.path,
            billingRequestId,
            timestamp: new Date().toISOString(),
            offlineSubmitted: true
          });
          if (repId) {
            try {
              await db.collection('notifications').doc(repId).collection('items').add({
                type: 'payment_received',
                customerId: docSnap.ref.parent.parent?.id || null,
                quotePath: docSnap.ref.path,
                billingRequestId,
                timestamp: new Date().toISOString(),
                offlineSubmitted: true
              });
            } catch(_) {}
          }
        } else {
          await docSnap.ref.update({ status: 'paid' });
          updated++;
        }
      }
      summary.push({ billingRequestId, success: true, updated, smsPurchasesUpdated: smsResult.updated || 0 });
    } catch (error) {
      console.error('[gcWebhook] error', error);
      summary.push({ billingRequestId, success: false, error: error?.message || String(error) });
    }
  }

  if (!handledAny) {
    return res.status(200).json({ ignored: true, summary });
  }

  return res.status(200).json({ success: true, summary });
}