export const SESSION_SECONDS = 7 * 24 * 60 * 60;
export const SESSION_MILLISECONDS = SESSION_SECONDS * 1000;

/** Legacy cookie lifetimes are capped by their original creation instant, never renewed on restart. */
export function cappedSessionExpiry(row, now = Date.now()) {
  const created = typeof row?.created_at === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(row.created_at) ? Date.parse(row.created_at) : NaN;
  const rawExpiry = row?.expires_at;
  const expires = typeof rawExpiry === 'number' || (typeof rawExpiry === 'string' && /^\d+$/.test(rawExpiry)) ? Number(rawExpiry) : NaN;
  if (!Number.isSafeInteger(now) || !Number.isFinite(new Date(now).getTime()) || !Number.isFinite(created) || created > now
    || new Date(created).toISOString().slice(0, 19) !== row.created_at.slice(0, 19)
    || !Number.isSafeInteger(expires) || !Number.isFinite(new Date(expires).getTime()) || expires <= created) return 0;
  return Math.min(expires, created + SESSION_MILLISECONDS);
}
