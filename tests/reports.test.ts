import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReportPdf, csvString, filterDoses, parseBackup, summarize } from '../src/lib/reports';
import type { AppData, Dose, Profile } from '../src/lib/types';

const profile: Profile = {
  name: 'Synthetic example', timeZone: 'America/Los_Angeles', timeFormat: '24h',
  sleepEnabled: false, bedtime: '', wakeTime: '', weekendEnabled: false, weekendBedtime: '', weekendWakeTime: '',
};
const dose = (id: string, patch: Partial<Dose> = {}): Dose => ({
  id, productId: 'reference-tablet', productName: 'Reference product', formulation: 'Immediate-release tablet',
  strength: '10', strengthUnit: 'mg', quantity: '1', unit: 'tablet', amountMg: '10', administeredAt: '2026-09-14T15:00:00Z',
  timeZone: profile.timeZone, status: 'actual', note: '', revision: 1, modelVersion: 'test-v1', ...patch,
});
const data = (): AppData => ({ profile: { ...profile }, doses: [dose('dose-1')], scenarios: [], favorites: [], checkins: [] });
const backup = (value: AppData) => JSON.stringify({ format: 'dose-timeline-backup', schemaVersion: 1, exportedAt: '2026-09-14T20:00:00Z', data: value });

test('report filtering is actual-only and includes the full chosen local calendar dates', () => {
  const rows = [
    dose('before', { administeredAt: '2026-09-01T06:59:59Z' }),
    dose('first', { administeredAt: '2026-09-01T07:00:00Z' }),
    dose('last', { administeredAt: '2026-10-01T06:59:59Z' }),
    dose('after', { administeredAt: '2026-10-01T07:00:00Z' }),
    dose('scenario', { status: 'simulated' }), dose('planned', { status: 'planned' }), dose('skipped', { status: 'skipped' }),
  ];
  assert.deepEqual(filterDoses(rows, '2026-09-01', '2026-09-30', profile.timeZone).map(row => row.id), ['first', 'last']);
  assert.equal(filterDoses(rows, '2026-09-01', '2026-09-30', 'UTC').length, 2);
  assert.deepEqual(filterDoses(rows, '2026-09-01', '2026-09-30', profile.timeZone, 'another-product'), []);
  assert.throws(() => filterDoses(rows, '2026-09-30', '2026-09-01', profile.timeZone), /start date/);
});

test('report totals retain decimal quantities exactly and exclude simulations', () => {
  const result = summarize([
    dose('one', { quantity: '0.1', amountMg: '1' }), dose('two', { quantity: '0.2', amountMg: '2' }),
    dose('three', { quantity: '0.000000001', amountMg: '0.00000001' }), dose('simulation', { status: 'simulated', quantity: '10', amountMg: '100' }),
  ]);
  assert.equal(result.length, 1);
  assert.equal(result[0].quantity, '0.300000001');
  assert.equal(result[0].amountMg, '3.00000001');
  assert.equal(result[0].count, 3);
});

test('products, formulation snapshots, strengths and ingredient totals remain separate', () => {
  const result = summarize([
    dose('a'), dose('b', { strength: '20', amountMg: '20' }),
    dose('c', { formulation: 'Extended-release capsule' }),
    dose('combo1', { productId: 'combo', productName: 'Combination', ingredients: [{ name: 'Ingredient A', amountMg: '0.1' }, { name: 'Ingredient B', amountMg: '0.2' }] }),
    dose('combo2', { productId: 'combo', productName: 'Combination', ingredients: [{ name: 'Ingredient B', amountMg: '0.4' }, { name: 'Ingredient A', amountMg: '0.2' }] }),
  ]);
  assert.equal(result.length, 4);
  const combination = result.find(item => item.product.startsWith('Combination'))!;
  assert.deepEqual(combination.ingredients, [{ name: 'Ingredient A', amountMg: '0.3' }, { name: 'Ingredient B', amountMg: '0.6' }]);
});

test('duplicates do not double count and corrections use the newest revision before date filtering', () => {
  const original = dose('same', { administeredAt: '2026-09-01T06:30:00Z', revision: 1 });
  const correction = dose('same', { administeredAt: '2026-09-01T08:00:00Z', revision: 2, amountMg: '20' });
  assert.equal(summarize([original, original])[0].count, 1);
  assert.equal(filterDoses([original, correction], '2026-09-01', '2026-09-01', profile.timeZone)[0].amountMg, '20');
  assert.deepEqual(summarize([original, { ...original, status: 'skipped', revision: 2 }]), []);
  assert.throws(() => summarize([original, { ...original, amountMg: '20' }]), /Conflicting/);
});

test('recorded day counts use an explicit report zone when requested', () => {
  const rows = [dose('one', { administeredAt: '2026-09-14T06:30:00Z' }), dose('two', { administeredAt: '2026-09-14T08:30:00Z' })];
  assert.equal(summarize(rows)[0].days, 2);
  assert.equal(summarize(rows, 'UTC')[0].days, 1);
});

test('reports preserve full combination strengths, manufacturer snapshots and nominal patch delivery units', () => {
  const combo = dose('combo', { strength: '26.1', packageStrength: '26.1/5.2', amountBasis: 'first listed ingredient', amountMg: '26.1',
    ingredients: [{ name: 'Serdexmethylphenidate', amountMg: '26.1', strengthMg: '26.1', unit: 'mg' }, { name: 'Dexmethylphenidate', amountMg: '5.2', strengthMg: '5.2', unit: 'mg' }] });
  const patch = dose('patch', { productId: 'patch', productName: 'Reference patch', unit: 'patch', strengthUnit: 'mg/9 h', amountBasis: 'labeled delivery over 9 hours' });
  const rows = [combo, patch, dose('maker-a', { manufacturer: 'Manufacturer A' }), dose('maker-b', { manufacturer: 'Manufacturer B' })];
  const summary = summarize(rows);
  assert.equal(summary.length, 4);
  assert.ok(summary.some(item => item.strength === '26.1/5.2'));
  assert.ok(summary.some(item => item.strengthUnit === 'mg/9 h' && item.amountBasis === 'labeled delivery over 9 hours'));
  const csv = csvString(rows, profile, '2026-09-01', '2026-09-30');
  assert.ok(csv.includes('"26.1/5.2","mg"'));
  assert.ok(csv.includes('"labeled delivery over 9 hours","10"'));
  const value = data(); value.doses = rows;
  assert.deepEqual(parseBackup(backup(value)), value);
  value.doses[0].packageStrength = '20/5.2';
  assert.throws(() => parseBackup(backup(value)), /does not match/);
});

test('CSV quotes commas and newlines and neutralizes formula injection in text fields', () => {
  const csv = csvString([dose('one', { productName: '=HYPERLINK("bad")', note: '  @SUM(1,2)\nsecond line' })], profile, '2026-09-01', '2026-09-30');
  assert.ok(csv.includes('"\'=HYPERLINK(""bad"")"'));
  assert.ok(csv.includes('"\'  @SUM(1,2)\nsecond line"'));
  assert.ok(csv.includes('"2026-09-14","08:00","America/Los_Angeles"'));
  assert.ok(csv.includes('No record does not prove no dose.'));
  assert.ok(csv.endsWith('\r\n'));
});

test('a versioned backup round-trips complete current data and pending scenario rows without mutation', () => {
  const original = data();
  original.scenarios.push({ id: 'scenario-1', name: 'Untimed', doses: [dose('pending', { status: 'simulated', administeredAt: '', date: '', time: '' })], modelVersion: 'test-v1', baseline: 'empty' });
  original.favorites.push({ id: 'favorite-1', productId: 'reference-tablet', strength: '10', quantity: '1', inventory: '0' });
  original.checkins.push({ id: 'checkin-1', date: '2026-09-14', focus: '3', sleepQuality: '4', note: 'Example note' });
  const before = JSON.stringify(original);
  assert.deepEqual(parseBackup(backup(original)), original);
  assert.equal(JSON.stringify(original), before);
});

test('backup rejects invalid dates, amounts, IDs, duplicates and active tombstones', () => {
  const modifications: [Partial<Dose>, RegExp][] = [
    [{ administeredAt: '2026-02-30T08:00:00Z' }, /Invalid Administration time/],
    [{ quantity: '-1' }, /decimal string/], [{ amountMg: 'NaN' }, /decimal string/],
    [{ strength: '0' }, /positive/], [{ id: '../record' }, /record ID/],
    [{ timeZone: 'Invalid/Zone' }, /Unknown time zone/], [{ status: 'simulated' }, /status/],
  ];
  for (const [patch, message] of modifications) {
    const value = data(); value.doses[0] = { ...value.doses[0], ...patch };
    assert.throws(() => parseBackup(backup(value)), message);
  }
  const duplicate = data(); duplicate.doses.push({ ...duplicate.doses[0] });
  assert.throws(() => parseBackup(backup(duplicate)), /Duplicate record ID/);
  const deleted = data(); Object.assign(deleted.doses[0], { deleted: true });
  assert.throws(() => parseBackup(backup(deleted)), /Deleted records/);
});

test('backup rejects unsupported schema, unsafe keys, deep objects and oversized fields', () => {
  assert.throws(() => parseBackup('{"format":"dose-timeline-backup","schemaVersion":2}'), /Unsupported/);
  assert.throws(() => parseBackup('{"__proto__":{"polluted":true}}'), /unsafe field/);
  assert.throws(() => parseBackup('not JSON'), /not valid JSON/);
  const nested = `${'{"next":'.repeat(18)}null${'}'.repeat(18)}`;
  assert.throws(() => parseBackup(nested), /nested/);
  const value = data(); value.doses[0].note = 'x'.repeat(8001);
  assert.throws(() => parseBackup(backup(value)), /Invalid note/);
});

test('clinician PDF paginates a month of actual records and produces a real PDF', async () => {
  const rows = Array.from({ length: 60 }, (_, index) => dose(`synthetic-${index}`, {
    administeredAt: `2026-09-${String(Math.floor(index / 2) + 1).padStart(2, '0')}T${index % 2 ? '20' : '15'}:00:00Z`,
    note: index === 0 ? 'A longer observation. '.repeat(300) : '',
  }));
  const pdf = await buildReportPdf(rows, profile, '2026-09-01', '2026-09-30', 1);
  assert.ok(pdf.getNumberOfPages() > 3);
  const bytes = new Uint8Array(pdf.output('arraybuffer'));
  assert.equal(new TextDecoder().decode(bytes.slice(0, 5)), '%PDF-');
  assert.ok(bytes.byteLength > 5000);
});
