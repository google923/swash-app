// Shared scheduling helpers for rep and subscriber planners
export const MS_PER_DAY = 24 * 60 * 60 * 1000;
export const DEFAULT_FREQUENCY_DAYS = 28;

export function toDate(input) {
  if (!input) return null;
  if (typeof input.toDate === "function") {
    try {
      return input.toDate();
    } catch (error) {
      // Firestore Timestamp with invalid conversion
    }
  }
  const date = new Date(input);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function addDays(date, days) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function toPositiveInteger(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return null;
  return Math.round(number);
}

export function resolveFrequencyDays(quote) {
  if (!quote) return DEFAULT_FREQUENCY_DAYS;

  const numericCandidates = [
    quote.cleaningFrequencyIntervalDays,
    quote.cleaningFrequencyDays,
    quote.recurringFrequencyDays,
    quote.frequencyDays,
    quote.serviceFrequencyDays,
    quote.scheduleFrequencyDays,
  ];

  for (const candidate of numericCandidates) {
    const resolved = toPositiveInteger(candidate);
    if (resolved) return resolved;
  }

  const weeklyCandidates = [
    quote.cleaningFrequencyWeeks,
    quote.recurringFrequencyWeeks,
    quote.frequencyWeeks,
    quote.serviceFrequencyWeeks,
  ];

  for (const candidate of weeklyCandidates) {
    const weeks = Number(candidate);
    if (Number.isFinite(weeks) && weeks > 0) {
      return Math.round(weeks * 7);
    }
  }

  const stringCandidates = [
    quote.cleaningFrequencyLabel,
    quote.cleaningFrequency,
    quote.frequencyLabel,
    quote.frequency,
    quote.serviceFrequency,
  ];

  for (const candidate of stringCandidates) {
    if (!candidate) continue;
    const raw = String(candidate).toLowerCase();
    const match = raw.match(/(\d+(?:\.\d+)?)\s*(day|week|month)/);
    if (match) {
      const value = Number(match[1]);
      if (Number.isFinite(value) && value > 0) {
        const unit = match[2];
        if (unit.startsWith("week")) return Math.round(value * 7);
        if (unit.startsWith("month")) return Math.round(value * 28);
        if (unit.startsWith("day")) return Math.round(value);
      }
    }
    if (raw.includes("fortnight") || raw.includes("bi-week") || raw.includes("biweek")) {
      return 14;
    }
    if (raw.includes("weekly")) return 7;
    if (raw.includes("monthly")) return 28;
  }

  const bookedDate = toDate(quote.bookedDate);
  if (bookedDate && Array.isArray(quote.nextCleanDates) && quote.nextCleanDates.length) {
    const nextDate = toDate(quote.nextCleanDates[0]);
    if (nextDate) {
      const diffDays = Math.round((nextDate.getTime() - bookedDate.getTime()) / MS_PER_DAY);
      if (diffDays > 0) return diffDays;
    }
  }

  return DEFAULT_FREQUENCY_DAYS;
}

export function resolveFrequencyLabel(quote) {
  if (!quote) return "";
  const labelCandidates = [
    quote.cleaningFrequencyLabel,
    quote.cleaningFrequency,
    quote.frequencyLabel,
    quote.frequency,
    quote.serviceFrequency,
  ];

  for (const candidate of labelCandidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  const days = resolveFrequencyDays(quote);
  if (!Number.isFinite(days) || days <= 0) return "";

  if (days % 7 === 0) {
    const weeks = days / 7;
    if (weeks === 1) return "Every week";
    if (weeks === 2) return "Every 2 weeks";
    if (weeks === 4) return "Every 4 weeks";
    return `Every ${weeks} weeks`;
  }

  if (days === 30 || days === 31) return "Every month";
  if (days === 28) return "Every 4 weeks";
  if (days === 14) return "Every 2 weeks";
  if (days === 7) return "Every week";

  return `Every ${days} days`;
}

export function getFrequencyDisplay(quote) {
  const label = resolveFrequencyLabel(quote);
  if (label) return label;

  const days = resolveFrequencyDays(quote);
  if (!Number.isFinite(days) || days <= 0) return "";
  if (days % 7 === 0) {
    const weeks = days / 7;
    return weeks === 1 ? "Every week" : `Every ${weeks} weeks`;
  }
  return `Every ${days} days`;
}

function dedupePositiveIntegers(values) {
  const seen = new Set();
  const result = [];
  values.forEach((value) => {
    const number = toPositiveInteger(value);
    if (number && !seen.has(number)) {
      seen.add(number);
      result.push(number);
    }
  });
  return result.sort((a, b) => a - b);
}

export function resolveRecurringOffsets(quote, fallbackFrequencyDays) {
  const frequencyDays = Math.max(resolveFrequencyDays(quote), 1);
  const effectiveFrequency = fallbackFrequencyDays || frequencyDays;
  const bookedDate = toDate(quote.bookedDate);
  if (!bookedDate) {
    return dedupePositiveIntegers([effectiveFrequency, effectiveFrequency * 2]);
  }

  const offsets = Array.isArray(quote.nextCleanDates)
    ? quote.nextCleanDates
        .map((dateStr) => {
          const target = toDate(dateStr);
          if (!target) return null;
          const diff = Math.round((target.getTime() - bookedDate.getTime()) / MS_PER_DAY);
          return diff > 0 ? diff : null;
        })
        .filter((value) => value !== null)
    : [];

  if (!offsets.length) {
    offsets.push(effectiveFrequency, effectiveFrequency * 2);
  }

  return dedupePositiveIntegers(offsets).slice(0, 2);
}

export function buildNextCleanDates(baseDate, offsets) {
  if (!baseDate) return [];
  const base = new Date(baseDate);
  base.setHours(0, 0, 0, 0);
  return (offsets || []).map((days) => addDays(base, days).toISOString());
}

export function computeNextCleanDates(quote, newBaseDate) {
  if (!newBaseDate) return [];
  const offsets = resolveRecurringOffsets(quote);
  return buildNextCleanDates(newBaseDate, offsets);
}

export function generateOccurrencesInRange(quote, rangeStart, rangeEnd) {
  if (!quote || !rangeStart || !rangeEnd) return [];

  const start = rangeStart.getTime();
  const end = rangeEnd.getTime();
  const occurrences = [];
  const seen = new Set();

  const register = (dateObj) => {
    if (!dateObj) return;
    const time = dateObj.getTime();
    if (time < start || time > end) return;
    const key = dateObj.toISOString().slice(0, 10);
    if (seen.has(key)) return;
    seen.add(key);
    occurrences.push(new Date(dateObj));
  };

  const bookedDate = toDate(quote.bookedDate);
  const frequencyDays = Math.max(resolveFrequencyDays(quote), 1);

  if (bookedDate) {
    let currentDate = new Date(bookedDate);
    currentDate.setHours(0, 0, 0, 0);

    if (currentDate.getTime() < start) {
      const diffDays = Math.floor((start - currentDate.getTime()) / MS_PER_DAY);
      if (diffDays > 0 && frequencyDays > 0) {
        const skips = Math.floor(diffDays / frequencyDays);
        if (skips > 0) {
          currentDate = addDays(currentDate, skips * frequencyDays);
        }
        while (currentDate.getTime() + 1 < start) {
          currentDate = addDays(currentDate, frequencyDays);
        }
      }
    }

    let guard = 0;
    while (currentDate.getTime() <= end && guard < 1000) {
      register(currentDate);
      currentDate = addDays(currentDate, frequencyDays);
      guard += 1;
    }
  }

  if (Array.isArray(quote.nextCleanDates)) {
    quote.nextCleanDates.forEach((dateStr) => register(toDate(dateStr)));
  }

  occurrences.sort((a, b) => a.getTime() - b.getTime());
  return occurrences;
}
