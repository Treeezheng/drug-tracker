import test from 'node:test';
import assert from 'node:assert/strict';
import { cappedSessionExpiry, SESSION_SECONDS, SESSION_MILLISECONDS } from '../server/cloud-session.mjs';

const day = 86_400_000;
const created = Date.parse('2026-09-14T12:00:00.000Z');
const row = expires => ({ created_at: new Date(created).toISOString(), expires_at: expires });

test('cloud sessions have a fixed seven-day lifetime that visits and restarts cannot renew', () => {
  assert.equal(SESSION_SECONDS, 604_800);
  assert.equal(SESSION_MILLISECONDS, 7 * day);
  const expiry = created + 7 * day;
  for (const now of [created, created + day, expiry - 1, expiry, expiry + day]) {
    assert.equal(cappedSessionExpiry(row(expiry), now), expiry);
    assert.equal(cappedSessionExpiry(row(String(expiry)), now), expiry, 'PostgreSQL BIGINT strings preserve the same boundary.');
    assert.equal(cappedSessionExpiry({ created_at: '2026-09-14T12:00:00Z', expires_at: expiry }, now), expiry);
  }
});

test('legacy shorter sessions keep their existing expiry while overlong sessions cap at original creation plus seven days', () => {
  const previousDayExpiry = created + day;
  assert.equal(cappedSessionExpiry(row(previousDayExpiry), created), previousDayExpiry);
  assert.equal(cappedSessionExpiry(row(previousDayExpiry), created + 2 * day), previousDayExpiry);
  const overlong = row(created + 30 * day);
  const capped = cappedSessionExpiry(overlong, created + 2 * day);
  assert.equal(capped, created + 7 * day);
  assert.equal(cappedSessionExpiry({ ...overlong, expires_at: capped }, created + 6 * day), capped);
  assert.ok(cappedSessionExpiry(overlong, created + 8 * day) < created + 8 * day);
});

test('malformed, impossible or future session creation timestamps fail closed', () => {
  for (const created_at of [undefined, null, 0, '', 'not-a-date', '2026-09-14', '2026-02-30T12:00:00.000Z', '2026-09-14T25:00:00.000Z', '2026-09-14 12:00:00Z', '2026-09-15T12:00:00.000Z']) {
    assert.equal(cappedSessionExpiry({ created_at, expires_at: created + 7 * day }, created), 0);
  }
  assert.equal(cappedSessionExpiry(null, created), 0);
});

test('invalid or out-of-range expiry metadata cannot create a usable session', () => {
  for (const expiry of [undefined, null, '', ' ', 'Infinity', 'NaN', '1.5', '1e15', true, {}, NaN, Infinity, -Infinity, -1, created, created - 1, created + 0.5, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(cappedSessionExpiry(row(expiry), created), 0);
  }
  for (const now of [NaN, Infinity, Number.MAX_SAFE_INTEGER, '2026-09-14', created + 0.5]) assert.equal(cappedSessionExpiry(row(created + day), now), 0);
});
