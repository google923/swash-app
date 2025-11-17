import admin from 'firebase-admin';
import { sendEmailJsTemplate } from '../lib/emailjs.js';
import { logOutboundEmailToFirestore } from '../lib/firestore-utils.js';

if (!admin.apps.length) {
  try {
    admin.initializeApp();
  } catch (error) {
    console.warn('[confirmBooking] Firebase admin init failed', error);
  }
}

const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

const TEMPLATE_BOOKED = 'template_943nfcg';
const HTML_SUCCESS_TITLE = 'Booking confirmed';
const HTML_ERROR_TITLE = 'Unable to confirm booking';

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function computeNextDates(firstDate) {
  const first = new Date(firstDate);
  const second = addDays(first, 28);
  const third = addDays(first, 56);
  return { first, second, third };
}

function formatDdMmYyyy(value) {
  try {
    const d = new Date(value);
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
  } catch (error) {
    console.warn('[confirmBooking] formatDdMmYyyy fallback', error);
    return '';
  }
}

function formatDateNice(value) {
  return new Date(value).toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

function getFirstName(value = 'there') {
  const trimmed = String(value || '').trim();
  if (!trimmed) return 'there';
  return trimmed.split(/\s+/)[0];
}

function getPlanLabel(tier = 'silver') {
  if (!tier) return 'Silver';
  const normalised = String(tier).toLowerCase();
  if (normalised === 'gold-for-silver') return 'Gold';
  return normalised.charAt(0).toUpperCase() + normalised.slice(1);
}

function formatExtrasList(items = []) {
  if (!items.length) return '';
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

function buildPropertySummary(form = {}) {
  const baseParts = [];
  if (form.houseSize) baseParts.push(String(form.houseSize).trim());
  if (form.houseType) baseParts.push(String(form.houseType).trim());
  let summary = baseParts.length ? `${baseParts.join(' ')} home` : 'home';
  const extras = [];
  if (form.conservatory) extras.push('conservatory');
  if (form.extension) extras.push('extension');
  if (form.skylights) {
    const label = Number(form.skylights) === 1 ? 'skylight' : 'skylights';
    extras.push(`${form.skylights} ${label}`);
  }
  if (form.roofLanterns) {
    const label = Number(form.roofLanterns) === 1 ? 'roof lantern' : 'roof lanterns';
    extras.push(`${form.roofLanterns} ${label}`);
  }
  if (extras.length) {
    summary += ` with ${formatExtrasList(extras)}`;
  }
  return summary;
}

function formatCurrency(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return '';
  return `£${num.toFixed(2)}`;
}

function resolveJobPrice(quote = {}) {
  const candidates = [quote.pricePerClean, quote.price_per_clean, quote.price];
  for (const value of candidates) {
    const num = Number(value);
    if (Number.isFinite(num) && num > 0) return num;
  }
  const totalAmount = Number(quote.totalAmount);
  if (Number.isFinite(totalAmount) && totalAmount > 0) {
    return Number((totalAmount / 3).toFixed(2));
  }
  const text = quote.pricePerCleanText;
  if (typeof text === 'string' && text.trim()) {
    const num = Number(text.replace(/[^0-9.]/g, ''));
    if (Number.isFinite(num) && num > 0) return num;
  }
  return 0;
}

function composeBookedEmailParams(form, dates, repName = '') {
  const firstNice = formatDateNice(dates.first);
  const secondNice = formatDateNice(dates.second);
  const thirdNice = formatDateNice(dates.third);
  const firstName = getFirstName(form.name);
  const safeFullName = form.name?.trim() || firstName;
  const planLabel = getPlanLabel(form.tier || 'silver');
  const propertySummary = buildPropertySummary(form);
  const offerSuffix = form.offerApplied ? ' (special offer applied)' : '';
  const priceCopy = form.pricePerCleanText || 'your confirmed rate';
  const messageParts = [
    `Hi ${firstName},`,
    `Thank you for choosing Swash Cleaning Ltd. The regular cleaning for your ${propertySummary} is all paid for and scheduled.`,
    `You’re on our ${planLabel}${offerSuffix}, and the price per clean every 4 weeks is ${priceCopy}.`,
    `🗓 Your first clean is scheduled for ${firstNice}.`,
    `Your next cleans are expected around:\n• ${secondNice}\n• ${thirdNice}\n(Dates may vary slightly due to weather.)`,
    `You’ll receive a reminder email the day before each clean. We look forward to keeping your windows sparkling!`,
    `Please don’t forget — your feedback means the world to us. If you’re happy, a quick Google review really helps us grow. If there’s ever an issue, just reply to this email so we can make it right straight away.`,
    repName ? `If you need anything, just reply to this email or message ${repName}.` : 'If you need anything, just reply to this email.'
  ].filter(Boolean);
  const message = messageParts.join('\n\n');
  return {
    title: 'Your next 3 window cleans are confirmed!',
    subject: 'Your Swash booking is confirmed',
    customer_name: safeFullName,
    name: safeFullName,
    first_name: firstName,
    email: form.email,
    address: form.address,
    service_address: form.address,
    plan_label: planLabel,
    plan_label_with_offer: `${planLabel}${offerSuffix}`.trim(),
    price_per_clean: form.pricePerCleanText,
    first_date: firstNice,
    first_clean_date: firstNice,
    second_date: secondNice,
    second_clean_date: secondNice,
    third_date: thirdNice,
    third_clean_date: thirdNice,
    second_date_short: formatDdMmYyyy(dates.second),
    third_date_short: formatDdMmYyyy(dates.third),
    rep_name: repName,
    offer_applied: form.offerApplied ? 'yes' : 'no',
    house_summary: propertySummary,
    message,
    message_body: message,
    booking_summary: `First clean: ${firstNice} • Next cleans: ${secondNice} & ${thirdNice}`,
  };
}

function renderHtml({ title, body, success = true }) {
  const textColor = success ? '#065f46' : '#b91c1c';
  const accent = success ? '#ecfdf5' : '#fef2f2';
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <style>
      body { font-family: 'Segoe UI', Roboto, sans-serif; background: #f8fafc; margin: 0; padding: 0; }
      .wrap { max-width: 520px; margin: 60px auto; background: #fff; border-radius: 16px; padding: 32px; box-shadow: 0 20px 50px rgba(15,23,42,0.08); }
      h1 { margin-top: 0; color: ${textColor}; }
      p { color: #0f172a; line-height: 1.6; }
      .card { background: ${accent}; border-radius: 12px; padding: 16px; margin-top: 20px; }
    </style>
  </head>
  <body>
    <main class="wrap">
      <h1>${title}</h1>
      <p>${body}</p>
    </main>
  </body>
</html>`;
}

function sendHtml(res, status, payload) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.status(status).send(renderHtml(payload));
}

async function notifyBookingConfirmed({ repId, customerId, quotePath, firstDateISO }) {
  const payload = {
    type: 'booking_confirmed',
    repId: repId || null,
    customerId: customerId || null,
    quotePath: quotePath || null,
    firstDate: firstDateISO,
    timestamp: new Date().toISOString(),
    offlineSubmitted: true,
  };
  try {
    await db.collection('notifications').add(payload);
    if (repId) {
      await db.collection('notifications').doc(repId).collection('items').add(payload);
    }
  } catch (error) {
    console.warn('[confirmBooking] notification failed', error);
  }
}

function buildSyntheticForm(customer = {}, quote = {}) {
  const price = resolveJobPrice(quote);
  return {
    name: customer.name || quote.customerName || 'Customer',
    address: customer.address || quote.address || '',
    email: customer.email || quote.customerEmail || '',
    mobile: customer.mobile || quote.mobile || '',
    tier: quote.tierLabel || quote.tier || 'silver',
    houseType: quote.propertyType || quote.houseType || '',
    houseSize: quote.houseSize || '',
    conservatory: quote.conservatory || false,
    extension: quote.extension || false,
    skylights: quote.skylights || 0,
    roofLanterns: quote.roofLanterns || 0,
    offerApplied: !!quote.offerApplied,
    pricePerCleanText: formatCurrency(price),
    repName: quote.repName || customer.repName || '',
  };
}

function sanitizeIso(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { cid, date } = req.query || {};
  if (!cid || !date) {
    return sendHtml(res, 400, {
      title: HTML_ERROR_TITLE,
      body: 'Missing booking details. Please use the booking buttons in your email.',
      success: false,
    });
  }

  const normalizedIso = sanitizeIso(date);
  if (!normalizedIso) {
    return sendHtml(res, 400, {
      title: HTML_ERROR_TITLE,
      body: 'The booking link is invalid or has expired. Please request a new booking email.',
      success: false,
    });
  }

  try {
    const customerRef = db.collection('customers').doc(cid);
    const customerSnap = await customerRef.get();
    if (!customerSnap.exists) {
      return sendHtml(res, 404, {
        title: HTML_ERROR_TITLE,
        body: 'We could not find your booking record. Please contact Swash Cleaning for assistance.',
        success: false,
      });
    }

    const quotesSnap = await customerRef.collection('quotes').get();
    let targetQuoteSnap = null;
    let targetQuoteData = null;
    quotesSnap.forEach((docSnap) => {
      if (targetQuoteSnap) return;
      const data = docSnap.data();
      if (!data || !data.offlineSubmitted || data.bookingEmailSent !== true) return;
      const status = String(data.status || '').toLowerCase();
      if (status !== 'paid') return;
      const options = Array.isArray(data.bookingOptions) ? data.bookingOptions : [];
      const matched = options.find((opt) => sanitizeIso(opt?.iso) === normalizedIso);
      if (matched) {
        targetQuoteSnap = docSnap;
        targetQuoteData = { ...data, matchedOption: matched };
      }
    });

    if (!targetQuoteSnap || !targetQuoteData) {
      return sendHtml(res, 410, {
        title: HTML_ERROR_TITLE,
        body: 'This booking link has already been used or is no longer available. Please request a new email if you still need to schedule.',
        success: false,
      });
    }

    const firstDate = new Date(normalizedIso);
    const { second, third } = computeNextDates(firstDate);
    const firstIso = firstDate.toISOString();
    const secondIso = second.toISOString();
    const thirdIso = third.toISOString();
    const statusLabel = `Booked - ${formatDdMmYyyy(firstDate)}`;

    await customerRef.collection('booking').add({
      status: 'booked',
      firstDateISO: firstIso,
      secondDateISO: secondIso,
      thirdDateISO: thirdIso,
      via: 'email',
      source: 'confirmBooking',
      selectedOptionLabel: targetQuoteData.matchedOption?.label || null,
      weekKey: targetQuoteData.matchedOption?.weekKey || null,
      dayKey: targetQuoteData.matchedOption?.dayKey || null,
      createdAt: FieldValue.serverTimestamp(),
    });

    const quoteUpdate = {
      status: statusLabel,
      bookedDate: firstIso,
      nextCleanDates: [secondIso, thirdIso],
      bookingConfirmedVia: 'customer-email',
      bookingConfirmedAt: FieldValue.serverTimestamp(),
      selectedBookingOption: targetQuoteData.matchedOption || null,
      assignedCleaner: targetQuoteData.matchedOption?.cleanerId || targetQuoteData.assignedCleaner || null,
      bookingOptions: FieldValue.delete(),
    };
    await targetQuoteSnap.ref.update(quoteUpdate);

    const customer = customerSnap.data() || {};
    const syntheticForm = buildSyntheticForm(customer, targetQuoteData);
    if (!syntheticForm.email) {
      throw new Error('Customer email missing; cannot send confirmation');
    }
    const emailParams = composeBookedEmailParams(syntheticForm, { first: firstDate, second, third }, syntheticForm.repName || '');
    await sendEmailJsTemplate(TEMPLATE_BOOKED, emailParams);
    await logOutboundEmailToFirestore({
      to: syntheticForm.email,
      subject: emailParams.subject,
      body: emailParams.message,
      source: 'confirmBooking',
    });

    await notifyBookingConfirmed({
      repId: targetQuoteData.repId || null,
      customerId: customerSnap.id,
      quotePath: targetQuoteSnap.ref.path,
      firstDateISO: firstIso,
    });

    return sendHtml(res, 200, {
      title: HTML_SUCCESS_TITLE,
      body: `Thank you! Your first clean is booked for <strong>${formatDateNice(firstDate)}</strong>. We’ll send you a confirmation email shortly.`,
      success: true,
    });
  } catch (error) {
    console.error('[confirmBooking] error', error);
    return sendHtml(res, 500, {
      title: HTML_ERROR_TITLE,
      body: 'Something went wrong while confirming your booking. Please reply to the email and our team will help you schedule manually.',
      success: false,
    });
  }
}
