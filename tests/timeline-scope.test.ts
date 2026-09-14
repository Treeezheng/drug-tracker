import test from 'node:test';
import assert from 'node:assert/strict';
import { scopeTimeline } from '../src/lib/timeline-scope.ts';
import { blankAssumptions, concentration, groupedTotals, MODEL_VERSION } from '../src/lib/model.ts';
import type { Dose } from '../src/lib/types.ts';

const start = Date.parse('2026-09-13T00:00:00Z'), end = start + 86_400_000;
const event = (id: string, productId: string, amount: string, time: string): Dose => ({
  id, productId, productName: productId, formulation: 'Saved formulation', strength: amount, amountMg: amount,
  quantity: '1', unit: 'tablet', administeredAt: time, timeZone: 'UTC', status: 'actual', note: '', modelVersion: MODEL_VERSION,
});

test('old record-only medication and its sources leave the page; current event remains unknown', () => {
  const old = event('old', 'metformin-ir', '500', '2026-07-01T08:00:00Z');
  const current = event('current', 'adderall-ir', '5', '2026-09-13T08:00:00Z');
  const result = scopeTimeline({ actual: [old, current], drafts: [], start, end });
  assert.deepEqual(result.doses, [current]);
  assert.deepEqual(result.sourceIds, ['C11']);
  assert.equal(result.omittedHistoryCount, 1);
  assert.equal(concentration(result.doses[0], start + 12 * 3_600_000).value, null);
});

test('pending editor products supply references without inventing dates or amounts', () => {
  const draft = { ...event('pending', 'metformin-solution', '', ''), status: 'simulated' as const };
  const result = scopeTimeline({ actual: [], drafts: [draft], start, end });
  assert.equal(result.doses[0], draft);
  assert.equal(result.doses[0].administeredAt, '');
  assert.equal(result.doses[0].amountMg, '');
  assert.deepEqual(result.sourceIds, ['C25']);
});

test('prior Concerta retains meaningful carryover; remote reference groups can be hidden', () => {
  const prior = event('prior', 'concerta', '18', '2026-09-12T08:00:00Z');
  const remote = event('remote', 'ritalin', '10', '2026-07-01T08:00:00Z');
  assert.deepEqual(scopeTimeline({ actual: [prior], drafts: [], start, end }).doses, [prior]);
  const hidden = scopeTimeline({ actual: [remote], drafts: [], start, end });
  assert.deepEqual(hidden.doses, []);
  assert.deepEqual(hidden.sourceIds, []);
  assert.equal(hidden.omittedHistoryCount, 1);
});

test('a kept group retains tiny components and unknown published-only history unchanged', () => {
  const remoteIR = event('ir', 'ritalin', '10', '2026-07-01T08:00:00Z');
  const remoteConcerta = event('old-c', 'concerta', '18', '2026-07-01T08:00:00Z');
  const current = event('current', 'concerta', '18', '2026-09-13T08:00:00Z');
  const records = [remoteIR, remoteConcerta, current];
  const result = scopeTimeline({ actual: records, drafts: [], start, end, publishedOnly: true });
  assert.deepEqual(result.doses, records);
  assert.equal(result.doses[0], remoteIR);
  const total = groupedTotals(result.doses, start + 12 * 3_600_000, true).Methylphenidate;
  assert.equal(total.complete, false);
  assert.equal(total.items.find(c => c.dose.id === 'old-c')?.value, null);
  assert.equal(result.omittedHistoryCount, 0);
});

test('the threshold applies to a group, not to individual small contributions', () => {
  const a = { ...event('a', 'metformin-ir', '500', '2026-09-12T22:00:00Z'), assumptions: { ...blankAssumptions(), accepted: true, amplitude: 0.0006, referenceDose: 500 } };
  const b = { ...a, id: 'b' };
  assert.equal(scopeTimeline({ actual: [a], drafts: [], start, end }).doses.length, 0);
  const result = scopeTimeline({ actual: [a, b], drafts: [], start, end });
  assert.deepEqual(result.doses, [a, b]);
  assert.equal(groupedTotals(result.doses, start)['Metformin IR (generic) · assumptions'].value, 0.0012);
});

test('current unsupported snapshots remain visible without fabricated catalog references', () => {
  const unknown = event('unknown', 'archived-product', '7', '2026-09-13T08:00:00Z');
  const result = scopeTimeline({ actual: [unknown], drafts: [], start, end });
  assert.deepEqual(result.doses, [unknown]);
  assert.deepEqual(result.sourceIds, []);
  assert.equal(concentration(result.doses[0], start + 12 * 3_600_000).value, null);
});

test('the newest actual revision wins and future actual events do not leak into past views', () => {
  const first = event('same', 'ritalin', '10', '2026-09-13T08:00:00Z');
  const corrected = { ...first, revision: 2, administeredAt: '2026-09-13T09:00:00Z' };
  const duplicateDraft = { ...first, status: 'simulated' as const };
  const future = event('later', 'metformin-ir', '500', '2026-09-14T00:00:00Z');
  const result = scopeTimeline({ actual: [first, corrected, future], drafts: [duplicateDraft], start, end });
  assert.deepEqual(result.doses, [corrected]);
  assert.deepEqual(result.sourceIds, ['S2', 'S3']);
});
