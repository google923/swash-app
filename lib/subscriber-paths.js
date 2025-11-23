import { collection, doc } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

/**
 * Build a Firestore path that is aware of subscriber tenancy.
 * If `subscriberId` is provided the resulting path is nested under
 * `subscribers/{subscriberId}` otherwise it references the root collection.
 *
 * Example:
 *   tenantPath(undefined, 'quotes', 'abc') => 'quotes/abc'
 *   tenantPath('sub123', 'quotes', 'abc') => 'subscribers/sub123/quotes/abc'
 */
export function tenantPath(subscriberId, ...segments) {
  const cleaned = segments.filter((part) => typeof part === "string" && part.trim().length);
  if (!cleaned.length) {
    throw new Error("tenantPath requires at least one non-empty path segment");
  }
  if (subscriberId) {
    return ["subscribers", subscriberId, ...cleaned].join("/");
  }
  return cleaned.join("/");
}

/**
 * Convenience helper for `collection()` that honours subscriber tenancy.
 */
export function tenantCollection(db, subscriberId, ...segments) {
  return collection(db, tenantPath(subscriberId, ...segments));
}

/**
 * Convenience helper for `doc()` that honours subscriber tenancy.
 */
export function tenantDoc(db, subscriberId, ...segments) {
  return doc(db, tenantPath(subscriberId, ...segments));
}

/**
 * Returns a string key suitable for memoisation caches that need to be
 * tenant-aware (e.g. cleaner lists, quote selections).
 */
export function tenantCacheKey(subscriberId, key) {
  return subscriberId ? `${key}::${subscriberId}` : key;
}
