import test from 'node:test';
import assert from 'node:assert/strict';
import { csvString, filterCheckins, parseBackup } from '../src/lib/reports.ts';
import { instantToLocal } from '../src/lib/time.ts';
import type { Checkin, Dose, Profile } from '../src/lib/types.ts';

const profile: Profile = { name: 'Synthetic', timeZone: 'America/Los_Angeles', timeFormat: '24h', sleepEnabled: false, bedtime: '', wakeTime: '', weekendEnabled: false, weekendBedtime: '', weekendWakeTime: '' };
const checkin = (id: string, recordedAt = '2026-09-13T18:00:00Z', patch: Partial<Checkin> = {}): Checkin => ({ id, date: instantToLocal(recordedAt, profile.timeZone).date, recordedAt, timeZone: profile.timeZone, symptoms: ['headache'], note: '', revision: 1, ...patch });
const dose = (id: string, patch: Partial<Dose> = {}): Dose => ({ id, productId: 'reference', productName: 'Synthetic reference', formulation: 'IR', strength: '10', quantity: '0.5', unit: 'tablet', amountMg: '5', administeredAt: '2026-09-13T15:00:00Z', timeZone: profile.timeZone, status: 'actual', note: '', ...patch });
const backup = (checkins: unknown[]) => JSON.stringify({ format: 'dose-timeline-backup', schemaVersion: 1, exportedAt: '2026-09-14T12:00:00Z', data: { profile, doses: [], scenarios: [], favorites: [], checkins } });

function readCsv(source: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = '', quoted = false;
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (c === '"') {
      if (quoted && source[i + 1] === '"') { cell += '"'; i++; } else quoted = !quoted;
    } else if (c === ',' && !quoted) { row.push(cell); cell = ''; }
    else if (c === '\n' && !quoted) { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  return rows;
}

test('CSV retains dose columns and exact decimals while symptoms are independent non-dose events', () => {
  const rows = readCsv(csvString([dose('dose-1', { quantity: '0.100000001', amountMg: '1.00000001' }), dose('planned', { status: 'planned' })], profile, '2026-09-13', '2026-09-13', [checkin('symptom-1')]));
  const [header, doseRow, symptomRow] = rows;
  assert.equal(rows.length, 3);
  assert.ok(rows.every(row => row.length === header.length));
  assert.equal(header[0], 'Record ID');
  assert.equal(header[25], 'Missing-data disclosure');
  assert.equal(header[26], 'event_type');
  assert.equal(doseRow[header.indexOf('Quantity')], '0.100000001');
  assert.equal(doseRow[header.indexOf('Labeled ingredient amount mg')], '1.00000001');
  assert.equal(doseRow[26], 'dose');
  assert.equal(symptomRow[26], 'symptom');
  assert.equal(symptomRow[header.indexOf('symptoms')], 'headache');
  assert.equal(symptomRow[header.indexOf('checkin_time_utc')], '2026-09-13T18:00:00Z');
  for (const column of ['Administration UTC', 'Product', 'Quantity', 'Quantity unit', 'Labeled ingredient amount mg', 'Ingredient amounts mg', 'Amount basis']) assert.equal(symptomRow[header.indexOf(column)], '');
  assert.match(symptomRow[25], /does not establish a medication cause/);
});

test('symptom-only CSV includes full local report days and excludes adjacent UTC-boundary observations', () => {
  const records = [
    checkin('before', '2026-09-13T06:59:59Z'), checkin('first', '2026-09-13T07:00:00Z'),
    checkin('last', '2026-09-14T06:59:59Z', { symptoms: ['none'] }), checkin('after', '2026-09-14T07:00:00Z'),
  ];
  const rows = readCsv(csvString([], profile, '2026-09-13', '2026-09-13', records));
  assert.deepEqual(rows.slice(1).map(row => row[0]), ['first', 'last']);
  assert.equal(rows[1][2], '2026-09-13');
  assert.equal(rows[2][3], '23:59');
  assert.equal(rows[2][rows[0].indexOf('symptoms')], 'none');
  assert.equal(readCsv(csvString([], profile, '2026-09-13', '2026-09-13', [])).length, 1, 'A missing observation must not synthesize a no-discomfort row.');
});

test('check-in corrections are selected before report date filtering and conflicts are explicit', () => {
  const original = checkin('corrected');
  const corrected = checkin('corrected', '2026-09-14T18:00:00Z', { revision: 2, symptoms: ['nausea'] });
  assert.deepEqual(filterCheckins([original, corrected], '2026-09-13', '2026-09-13', profile.timeZone), []);
  assert.deepEqual(filterCheckins([corrected, original], '2026-09-14', '2026-09-14', profile.timeZone), [corrected]);
  assert.throws(() => filterCheckins([original, { ...original, symptoms: ['none'] }], '2026-09-13', '2026-09-13', profile.timeZone), /Conflicting copies/);
  assert.throws(() => filterCheckins([], '2026-09-14', '2026-09-13', profile.timeZone), /start date/);
});

test('CSV preserves legacy observations without inventing symptom status or an exact time', () => {
  const legacy: Checkin = { id: 'legacy', date: '2026-09-13', focus: '3', sleepQuality: '4', note: '' };
  const [header, row] = readCsv(csvString([], profile, '2026-09-13', '2026-09-13', [legacy]));
  assert.equal(row[header.indexOf('event_type')], 'legacy_checkin');
  assert.equal(row[header.indexOf('symptoms')], '');
  assert.equal(row[header.indexOf('checkin_time_utc')], '');
  assert.equal(row[3], '');
  assert.equal(row[header.indexOf('legacy_focus')], '3');
  assert.equal(row[header.indexOf('legacy_sleep_quality')], '4');
  assert.match(row[25], /time was not recorded/);
});

test('symptom CSV neutralizes formulas and preserves quoted notes without corrupting row boundaries', () => {
  const note = '  =HYPERLINK("synthetic")\nSecond line, quoted';
  const [header, row] = readCsv(csvString([], profile, '2026-09-13', '2026-09-13', [checkin('formula', undefined, { note, focus: '+1', sleepQuality: '@test' })]));
  assert.equal(row[header.indexOf('Notes')], `'${note}`);
  assert.equal(row[header.indexOf('legacy_focus')], "'+1");
  assert.equal(row[header.indexOf('legacy_sleep_quality')], "'@test");
  assert.equal(row.length, header.length);
});

test('backup keeps new symptom tags and both legacy observation shapes without adding or dropping fields', () => {
  const records = [checkin('new'), { id: 'legacy-date', date: '2026-09-13', focus: '3', sleepQuality: '4', note: '' },
    { id: 'legacy-time', recordedAt: '2026-09-14T06:30:00Z', timeZone: profile.timeZone, note: 'Original timestamp-only observation' }];
  assert.deepEqual(parseBackup(backup(records)).checkins, records);
  const noNote = { ...checkin('optional-note') } as Partial<Checkin>;
  delete noNote.note;
  assert.deepEqual(parseBackup(backup([noNote])).checkins, [noNote]);
});

test('backup rejects unknown, empty, duplicate or contradictory tags and inconsistent original dates', () => {
  for (const patch of [
    { symptoms: [] }, { symptoms: ['headache', 'headache'] }, { symptoms: ['headache', 'none'] }, { symptoms: ['not-a-tag'] }, { symptoms: [1] },
    { recordedAt: undefined }, { timeZone: undefined }, { date: '2026-09-14' }, { recordedAt: '2026-02-30T08:00:00Z' },
  ]) assert.throws(() => parseBackup(backup([{ ...checkin('invalid'), ...patch }])));
});
