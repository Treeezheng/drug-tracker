export const SESSION_SECONDS = 24 * 60 * 60;
export const SESSION_MILLISECONDS = SESSION_SECONDS * 1000;

/** Legacy cookie lifetimes are capped by their original creation instant, never renewed on restart. */
export function cappedSessionExpiry(row, now = Date.now()) {
  const created = Date.parse(row.created_at);
  if (!Number.isFinite(created)) return 0;
  return Math.min(Number(row.expires_at), created + SESSION_MILLISECONDS, now + SESSION_MILLISECONDS);
}
