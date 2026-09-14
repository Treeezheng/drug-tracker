import test from 'node:test';
import assert from 'node:assert/strict';
import { historyBars } from '../src/lib/history-bars';
import { exactSumValues, UNRECORDED_INGREDIENT } from '../src/lib/history-amounts';
import type { Dose } from '../src/lib/types';

const dose = (id: string, administeredAt: string, amountMg = '1'): Dose => ({
  id, administeredAt, amountMg, productId: 'fixture', productName: 'Synthetic fixture',
  formulation: 'tablet', strength: amountMg, quantity: '1', unit: 'tablet',
  timeZone: 'UTC', status: 'actual', note: '',
});

test('history buckets each record once and retains exact amounts across an ordinary multi-year range', () => {
  let reads = 0;
  const records = Array.from({ length: 1000 }, (_, index) => {
    const row = dose(String(index), new Date(Date.UTC(2020, 0, 1) + index * 86_400_000).toISOString(), '0.000000001');
    return { ...row, get administeredAt() { reads++; return row.administeredAt; } };
  });
  const result = historyBars(records, '2020-01-01', '2024-12-31', 'UTC', UNRECORDED_INGREDIENT);
  assert.equal(result.title, 'Monthly amount');
  assert.equal(result.bars.length, 60);
  assert.equal(reads, 1000, 'Calendar conversion must be once per record, not once per record per month.');
  assert.equal(result.bars.reduce((sum, bar) => sum + bar.count, 0), 1000);
  assert.equal(exactSumValues(result.bars.map(bar => bar.amount)), '0.000001');
});

test('daily bars use the report time zone across DST and distinguish no record from a zero selected-ingredient amount', () => {
  const rows = [dose('previous-day', '2026-03-08T07:59:00Z'), dose('first', '2026-03-08T08:00:00Z', '0.03'),
    dose('second', '2026-03-09T06:59:00Z', '0.07'), dose('outside', '2026-03-11T07:00:00Z'),
    { ...dose('plan', '2026-03-09T12:00:00Z'), status: 'planned' as const }];
  const result = historyBars(rows, '2026-03-08', '2026-03-10', 'America/Los_Angeles', UNRECORDED_INGREDIENT);
  assert.equal(result.title, 'Daily amount');
  assert.deepEqual(result.bars, [{ period: '2026-03-08', count: 2, amount: '0.1' },
    { period: '2026-03-09', count: 0, amount: '0' }, { period: '2026-03-10', count: 0, amount: '0' }]);
  const named = historyBars(rows, '2026-03-08', '2026-03-10', 'America/Los_Angeles', 'not in the record');
  assert.deepEqual(named.bars[0], { period: '2026-03-08', count: 2, amount: '0' });
  assert.equal(named.bars[1].count, 0);
});

test('century-spanning custom ranges include the latest records and disclose yearly aggregation', () => {
  const result = historyBars([dose('old', '1900-01-01T00:00:00Z'), dose('recent', '2026-09-14T23:59:00Z', '2')],
    '1900-01-01', '2026-09-14', 'UTC', UNRECORDED_INGREDIENT);
  assert.equal(result.title, 'Yearly amount');
  assert.equal(result.bars.length, 127);
  assert.deepEqual(result.bars[0], { period: '1900', count: 1, amount: '1' });
  assert.deepEqual(result.bars.at(-1), { period: '2026', count: 1, amount: '2' });
});

test('the entire accepted year range remains bounded without truncating either end', () => {
  const result = historyBars([dose('first', '0001-01-01T00:00:00Z', '0.000000001'), dose('last', '9998-12-31T23:59:59Z', '999999999999.123456789')],
    '0001-01-01', '9998-12-31', 'UTC', UNRECORDED_INGREDIENT);
  assert.equal(result.title, 'Amount by 9-year period');
  assert.ok(result.bars.length <= 1200);
  assert.equal(result.bars[0].period, '0001–0009');
  assert.equal(result.bars.at(-1)?.period, '9991–9998');
  assert.equal(result.bars.reduce((sum, bar) => sum + bar.count, 0), 2);
  assert.equal(exactSumValues(result.bars.map(bar => bar.amount)), '999999999999.12345679');
});

test('ingredient snapshots stay separate from unknown legacy amounts and exact fractional components', () => {
  const first = { ...dose('named', '2026-09-14T00:00:00Z', '0.3'), ingredients: [{ name: 'A', amountMg: '0.1' }, { name: 'B', amountMg: '0.2' }] };
  const second = dose('legacy', '2026-09-14T01:00:00Z', '0.7');
  const records = [first, second], before = structuredClone(records);
  for (const [ingredient, expected] of [['A', '0.1'], ['B', '0.2'], [UNRECORDED_INGREDIENT, '0.7']]) {
    assert.equal(historyBars(records, '2026-09-14', '2026-09-14', 'UTC', ingredient).bars[0].amount, expected);
  }
  assert.deepEqual(records, before);
  assert.throws(() => historyBars(records, '2026-09-15', '2026-09-14', 'UTC', 'A'), /on or before/);
  assert.throws(() => historyBars(records, '2026-02-30', '2026-09-14', 'UTC', 'A'), /valid calendar date/);
});
