import test from 'node:test';
import assert from 'node:assert/strict';
import { csvString, filterCheckins, parseBackup } from '../src/lib/reports.ts';
import { instantToLocal } from '../src/lib/time.ts';
import { newDose, updateDose } from '../src/components/DoseEditor.tsx';
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

test('CSV keeps concise medication fields and exact decimals with separate self-reported symptom rows', () => {
  const rows = readCsv(csvString([dose('dose-1', { quantity: '0.100000001', amountMg: '1.00000001' }), dose('planned', { status: 'planned' })], profile, '2026-09-13', '2026-09-13', [checkin('symptom-1')]));
  const [header, doseRow, symptomRow] = rows;
  assert.equal(rows.length, 3); assert.equal(header.length, 15);
  assert.ok(rows.every(row => row.length === header.length));
  for (const internal of ['Record ID', 'Model version', 'Revision', 'Missing-data disclosure', 'Report from', 'event_type']) assert.ok(!header.includes(internal));
  assert.equal(doseRow[header.indexOf('Quantity')], '0.100000001');
  assert.equal(doseRow[header.indexOf('Total mg')], '1.00000001');
  assert.equal(doseRow[header.indexOf('Status')], 'Taken');
  assert.equal(symptomRow[header.indexOf('Status')], 'Self-reported');
  assert.equal(symptomRow[header.indexOf('Feeling / discomfort')], 'Headache');
  assert.equal(symptomRow[header.indexOf('UTC time')], '2026-09-13T18:00:00Z');
  for (const column of ['Medication', 'Formulation', 'Quantity', 'Quantity unit', 'Total mg', 'Amount details']) assert.equal(symptomRow[header.indexOf(column)], '');
  assert.ok(!rows.flat().includes('dose-1')); assert.ok(!rows.flat().includes('planned'));
});

test('symptom-only CSV includes full report-zone days and does not synthesize missing observations', () => {
  const records = [
    checkin('before', '2026-09-13T06:59:59Z'), checkin('first', '2026-09-13T07:00:00Z'),
    checkin('last', '2026-09-14T06:59:59Z', { symptoms: ['none'] }), checkin('after', '2026-09-14T07:00:00Z'),
  ];
  const [header, ...rows] = readCsv(csvString([], profile, '2026-09-13', '2026-09-13', records));
  assert.deepEqual(rows.map(row => row[header.indexOf('UTC time')]), ['2026-09-13T07:00:00Z', '2026-09-14T06:59:59Z']);
  assert.equal(rows[0][header.indexOf('Date')], '2026-09-13');
  assert.equal(rows[1][header.indexOf('Time')], '23:59');
  assert.equal(rows[1][header.indexOf('Feeling / discomfort')], 'No discomfort');
  assert.equal(readCsv(csvString([], profile, '2026-09-13', '2026-09-13', [])).length, 1);
});

test('check-in corrections are selected before report date filtering and conflicts are explicit', () => {
  const original = checkin('corrected');
  const corrected = checkin('corrected', '2026-09-14T18:00:00Z', { revision: 2, symptoms: ['nausea'] });
  assert.deepEqual(filterCheckins([original, corrected], '2026-09-13', '2026-09-13', profile.timeZone), []);
  assert.deepEqual(filterCheckins([corrected, original], '2026-09-14', '2026-09-14', profile.timeZone), [corrected]);
  assert.throws(() => filterCheckins([original, { ...original, symptoms: ['none'] }], '2026-09-13', '2026-09-13', profile.timeZone), /Conflicting copies/);
  assert.throws(() => filterCheckins([], '2026-09-14', '2026-09-13', profile.timeZone), /start date/);
});

test('CSV keeps legacy observations in notes without inventing symptoms, a clock time or a time zone', () => {
  const legacy: Checkin = { id: 'legacy', date: '2026-09-13', focus: '3', sleepQuality: '4', note: '' };
  const [header, row] = readCsv(csvString([], profile, '2026-09-13', '2026-09-13', [legacy]));
  assert.equal(row[header.indexOf('Status')], 'Self-reported');
  for (const field of ['Feeling / discomfort', 'Time', 'Time zone', 'UTC time']) assert.equal(row[header.indexOf(field)], '');
  assert.match(row[header.indexOf('Notes')], /Focus \(legacy\): 3/);
  assert.match(row[header.indexOf('Notes')], /Sleep quality \(legacy\): 4/);
  assert.match(row[header.indexOf('Notes')], /time and time zone were not recorded/);
});

test('symptom CSV neutralizes formulas and preserves quoted multiline notes and older scores', () => {
  const note = '  =HYPERLINK("synthetic")\nSecond line, quoted';
  const [header, row] = readCsv(csvString([], profile, '2026-09-13', '2026-09-13', [checkin('formula', undefined, { note, focus: '+1', sleepQuality: '@test' })]));
  assert.equal(row[header.indexOf('Notes')], `'${note}\nFocus (legacy): +1\nSleep quality (legacy): @test`);
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

test('feelings and high heart rate retain their labels and selections through CSV and backup restore', () => {
  const records = [checkin('feelings', undefined, { symptoms: ['concentrated', 'refreshed'] }), checkin('heart-rate', undefined, { symptoms: ['high-heart-rate'] })];
  const [header, ...rows] = readCsv(csvString([], profile, '2026-09-13', '2026-09-13', records));
  assert.ok(header.includes('Feeling / discomfort'));
  assert.deepEqual(rows.map(row => row[header.indexOf('Feeling / discomfort')]), ['Concentrated; Refreshed', 'High heart rate']);
  assert.ok(rows.every(row => row[header.indexOf('Status')] === 'Self-reported'));
  assert.deepEqual(parseBackup(backup(records)).checkins, records);
});

test('concise CSV preserves exact tablet and liquid amounts, separate combination components, and nominal patch units',()=>{
  const recorded=(id:string,strength:string,quantity:string):Dose=>({...updateDose(newDose(id,strength),{quantity},profile.timeZone),administeredAt:'2026-09-13T15:00:00Z',status:'actual'});
  const input=[recorded('ritalin','10','1.5'),recorded('metformin-solution','100','0.100000001'),recorded('azstarys','26.1/5.2','1'),recorded('xelstrym','4.5','1'),recorded('adderall-ir','10','1.5')];
  const before=structuredClone(input),[header,...rows]=readCsv(csvString(input,profile,'2026-09-13','2026-09-13'));
  const rowFor=(product:string)=>rows.find(row=>row[header.indexOf('Medication')]===input.find(item=>item.productId===product)!.productName)!;
  assert.equal(rowFor('ritalin')[header.indexOf('Quantity')],'1.5');assert.equal(rowFor('ritalin')[header.indexOf('Total mg')],'15');
  const liquid=rowFor('metformin-solution');assert.equal(liquid[header.indexOf('Strength unit')],'mg/mL');assert.equal(liquid[header.indexOf('Quantity unit')],'mL');assert.equal(liquid[header.indexOf('Total mg')],'10.0000001');
  const combo=rowFor('azstarys');assert.equal(combo[header.indexOf('Strength')],'26.1/5.2');assert.equal(combo[header.indexOf('Total mg')],'');assert.match(combo[header.indexOf('Amount details')],/serdexmethylphenidate: 26.1 mg; dexmethylphenidate: 5.2 mg/);
  const patch=rowFor('xelstrym');assert.equal(patch[header.indexOf('Total mg')],'');assert.equal(patch[header.indexOf('Strength unit')],'mg/9 h');assert.match(patch[header.indexOf('Amount details')],/4.5 mg nominal labeled delivery over 9 hours/);
  const salts=rowFor('adderall-ir');assert.equal(salts[header.indexOf('Total mg')],'15');assert.match(salts[header.indexOf('Amount details')],/dextroamphetamine saccharate: 3.75 mg/);
  assert.deepEqual(input,before);
});

test('CSV rejects invalid saved mass/time instead of exporting a misleading zero or inconsistent amount',()=>{
  for(const patch of [{amountMg:'0'},{quantity:'NaN'},{amountMg:'6'},{administeredAt:'2026-02-30T15:00:00Z'},{packageStrength:'20'}]){
    assert.throws(()=>csvString([dose('invalid',patch)],profile,'2026-01-01','2026-12-31'));
  }
  const allTags=checkin('tags',undefined,{symptoms:['anxiety','palpitations','other','dry-mouth']});
  const [header,row]=readCsv(csvString([],profile,'2026-09-13','2026-09-13',[allTags]));
  assert.equal(row[header.indexOf('Feeling / discomfort')],'Anxiety; Palpitations; Other; Dry mouth');
  assert.deepEqual(parseBackup(backup([allTags])).checkins,[allTags]);
});
