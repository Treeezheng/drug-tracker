import test from 'node:test';
import assert from 'node:assert/strict';
import { concentration, contributions, groupedTotals, modelGroup, effectWindow, blankAssumptions, MODEL_VERSION } from '../src/lib/model.ts';
import type { Dose } from '../src/lib/types.ts';
import { getProduct, sources } from '../src/lib/catalog.ts';

const HOUR = 3_600_000;
const START = Date.parse('2026-09-12T08:00:00Z');
function fixture(productId = 'concerta', patch: Partial<Dose> = {}): Dose {
  const amount = productId === 'concerta' ? '18' : '10';
  return {
    id: 'synthetic-dose-a', productId, productName: `Synthetic ${productId}`, formulation: 'Synthetic test fixture',
    strength: amount, quantity: '1', amountMg: amount, unit: 'tablet', timeZone: 'UTC', status: 'simulated',
    administeredAt: new Date(START).toISOString(), note: 'Synthetic test only', modelVersion: MODEL_VERSION, ...patch,
  };
}
function close(actual: number | null | undefined, expected: number, tolerance = 1e-10): void {
  assert.equal(typeof actual, 'number');
  assert.ok(Math.abs(actual! - expected) <= tolerance, `Expected ${actual} to be within ${tolerance} of ${expected}`);
}

test('valid future and skipped doses contribute zero; incomplete simulated rows remain pending', () => {
  for (const product of ['concerta', 'ritalin', 'vyvanse-capsule']) close(concentration(fixture(product), START - 1).value, 0);
  close(concentration(fixture('concerta', { status: 'skipped' }), START + HOUR).value, 0);
  assert.equal(concentration(fixture('concerta', { administeredAt: '' }), START + HOUR).value, null);
  assert.equal(concentration(fixture('concerta', { administeredAt: 'invalid' }), START + HOUR).value, null);
  assert.deepEqual(contributions([fixture('concerta', { status: 'skipped' }), fixture('ritalin', { id: 'pending', administeredAt: '' })], START + HOUR), []);
});

test('published Concerta points and IR reference peak retain independent numerical anchors', () => {
  const concerta = fixture();
  close(concentration(concerta, START).value, 0.024);
  close(concentration(concerta, START + 6.005 * HOUR).value, 3.544);
  close(concentration(concerta, START + 23.971 * HOUR).value, 0.227);
  close(concentration(concerta, START + 29.976 * HOUR).value, 0.073);
  close(concentration(concerta, START + 5.0015 * HOUR).value, (2.330 + 3.544) / 2);
  const ir = fixture('ritalin');
  close(concentration(ir, START).value, 0);
  close(concentration(ir, START + 2 * HOUR).value, 4.3);
  assert.equal(concentration(ir, START + 2 * HOUR).evidence, 'B');
});

test('moving a dose shifts the entire profile by the same elapsed interval', () => {
  for (const product of ['concerta', 'ritalin']) {
    const original = fixture(product);
    const shifted = { ...original, administeredAt: new Date(START + 27.5 * HOUR).toISOString() };
    for (const elapsed of [0.1, 2, 8, 24, 36, 72]) close(concentration(shifted, START + (elapsed + 27.5) * HOUR).value, concentration(original, START + elapsed * HOUR).value!);
  }
});

test('equal simultaneous reference doses double the component profile without amplitude normalization', () => {
  for (const product of ['concerta', 'ritalin']) {
    const a = fixture(product);
    const b = { ...a, id: 'synthetic-dose-b' };
    for (const elapsed of [2, 7, 24, 50]) {
      const at = START + elapsed * HOUR;
      close(groupedTotals([a, b], at).Methylphenidate.value, concentration(a, at).value! * 2);
    }
  }
});

test('mixed reference doses across midnight sum independently checked concentrations', () => {
  const at = Date.parse('2026-09-13T01:00:00Z');
  const earlier = fixture('concerta', { administeredAt: '2026-09-12T18:59:42Z' });
  const later = fixture('ritalin', { id: 'synthetic-dose-b', administeredAt: '2026-09-12T23:00:00Z' });
  const result = groupedTotals([earlier, later], at).Methylphenidate;
  close(result.value, 3.544 + 4.3);
  assert.equal(result.complete, true);
  assert.equal(result.unit, 'ng/mL');
  assert.equal(result.items.length, 2);
  const midnight = Date.parse('2026-09-13T00:00:00Z');
  assert.ok(Math.abs(groupedTotals([earlier, later], midnight - 1).Methylphenidate.value - groupedTotals([earlier, later], midnight + 1).Methylphenidate.value) < 0.00001);
});

test('same-product administrations on successive days retain the earlier contribution', () => {
  const first = fixture();
  const second = fixture('concerta', { id: 'synthetic-dose-b', administeredAt: new Date(START + 24 * HOUR).toISOString() });
  const at = START + (24 + 6.005) * HOUR;
  const earlierTail = 0.073 * 2 ** (-(30.005 - 29.976) / 3.5);
  const result = groupedTotals([first, second], at).Methylphenidate;
  close(result.value, earlierTail + 3.544);
  assert.equal(result.tail, true);
  assert.equal(result.items[0].tail, true);
});

test('72-hour carryover keeps the independently calculated earlier tail', () => {
  const dose = fixture();
  const at = START + 72 * HOUR;
  const expected = 0.073 * 2 ** (-(72 - 29.976) / 3.5);
  close(concentration(dose, at).value, expected, 1e-14);
  assert.ok(expected > 0);
  close(groupedTotals([dose], at).Methylphenidate.value, expected, 1e-14);
});

test('shared UTC instants give the same sum regardless of event display time-zone metadata', () => {
  const rows = [fixture(), fixture('ritalin', { id: 'synthetic-dose-b', administeredAt: new Date(START + 24 * HOUR).toISOString() })];
  const at = START + 26 * HOUR;
  const expected = groupedTotals(rows, at).Methylphenidate.value;
  for (const timeZone of ['America/Los_Angeles', 'Asia/Tokyo', 'Europe/London']) {
    close(groupedTotals(rows.map((row) => ({ ...row, timeZone })), at).Methylphenidate.value, expected);
  }
});

test('clearing a row timestamp removes its old contribution without disturbing other IDs', () => {
  const doses = [fixture(), fixture('ritalin', { id: 'synthetic-dose-b' }), fixture('concerta', { id: 'synthetic-dose-c' }), fixture('ritalin', { id: 'synthetic-dose-d' })];
  const edited = doses.map((dose) => dose.id === 'synthetic-dose-b' ? { ...dose, administeredAt: '', time: '' } : dose);
  const result = contributions(edited, START + 2 * HOUR);
  assert.deepEqual(result.map((item) => item.dose.id), ['synthetic-dose-a', 'synthetic-dose-c', 'synthetic-dose-d']);
  close(groupedTotals(edited, START + 2 * HOUR).Methylphenidate.value, 2 * concentration(doses[0], START + 2 * HOUR).value! + 4.3);
  assert.equal(doses[1].administeredAt, new Date(START).toISOString());
});

test('published-only mode returns unknown beyond the trace and qualifies the total', () => {
  const concerta = fixture();
  const ir = fixture('ritalin', { id: 'synthetic-dose-b', administeredAt: new Date(START + 30 * HOUR).toISOString() });
  const at = START + 32 * HOUR;
  const missing = concentration(concerta, at, true);
  assert.equal(missing.value, null);
  assert.equal(missing.tail, false);
  assert.match(missing.reason, /unknown/);
  const sum = groupedTotals([concerta, ir], at, true).Methylphenidate;
  assert.equal(sum.complete, false);
  close(sum.value, 4.3); // Known contributions, never an unqualified full total.
  assert.equal(sum.items.length, 2);
});

test('estimated tail joins continuously, halves in 3.5 hours, and propagates its status', () => {
  const dose = fixture();
  const join = START + 29.976 * HOUR;
  close(concentration(dose, join).value, 0.073);
  assert.equal(concentration(dose, join).tail, false);
  assert.ok(Math.abs(concentration(dose, join + 1).value! - 0.073) < 1e-8);
  close(concentration(dose, join + 3.5 * HOUR).value, 0.0365);
  assert.equal(concentration(dose, join + 1).evidence, 'B');
  const total = groupedTotals([dose], join + 1).Methylphenidate;
  assert.equal(total.tail, true);
  assert.equal(total.complete, true);
});

test('different analytes and relative illustrations remain separate from methylphenidate concentration', () => {
  const mph = fixture('ritalin');
  const amphetamine = fixture('adderall-ir', { id: 'synthetic-amphetamine', assumptions: { ...blankAssumptions(), accepted: true } });
  const groups = groupedTotals([mph, amphetamine], START + 2 * HOUR);
  assert.equal(Object.keys(groups).length, 4);
  assert.equal(groups['d-Amphetamine'].complete,false);assert.equal(groups['l-Amphetamine'].complete,false);
  assert.equal(modelGroup(amphetamine).reference, false);
  close(groups.Methylphenidate.value, 4.3);
  assert.equal(groups[modelGroup(amphetamine).group].unit, 'relative units');
  close(groups[modelGroup(amphetamine).group].value, 1);
});

test('Level D needs explicit acceptance; four independent rows sum on a fixed relative scale', () => {
  const assumed = fixture('vyvanse-capsule', { assumptions: { ...blankAssumptions(), peakHours: 2, halfLifeHours: 3, lagHours: 0, amplitude: 2, referenceDose: 10, accepted: false } });
  assert.equal(concentration(assumed, START + 2 * HOUR).value, null);
  const doses = Array.from({ length: 4 }, (_, i) => ({ ...assumed, id: `synthetic-assumed-${i}`, assumptions: { ...assumed.assumptions!, accepted: true } }));
  const group = modelGroup(doses[0]).group;
  close(groupedTotals(doses, START + 2 * HOUR)[group].value, 8);
  close(groupedTotals(doses.filter((dose) => dose.id !== 'synthetic-assumed-1'), START + 2 * HOUR)[group].value, 6);
  const moved = doses.map((dose, i) => i === 2 ? { ...dose, administeredAt: new Date(START + HOUR).toISOString() } : dose);
  close(groupedTotals(moved, START + 2 * HOUR)[group].value, 7);
  assert.equal(groupedTotals(moved, START + 2 * HOUR)[group].unit, 'relative units');
  assert.equal(doses[2].administeredAt, new Date(START).toISOString());
});

test('assumed delayed delivery can first appear on the following day', () => {
  const dose = fixture('jornay-pm', {
    administeredAt: '2026-09-12T21:00:00Z',
    assumptions: { ...blankAssumptions(), accepted: true, lagHours: 8, peakHours: 2, amplitude: 1 },
  });
  close(concentration(dose, Date.parse('2026-09-13T04:59:59Z')).value, 0);
  close(concentration(dose, Date.parse('2026-09-13T06:00:00Z')).value, 0.5);
  assert.equal(concentration(dose, Date.parse('2026-09-13T06:00:00Z')).evidence, 'D');
});

test('same stable baseline ID is not counted twice and unsupported model versions remain unknown', () => {
  const dose = fixture('ritalin');
  assert.equal(contributions([dose, { ...dose }], START + 2 * HOUR).length, 1);
  close(groupedTotals([dose, { ...dose }], START + 2 * HOUR).Methylphenidate.value, 4.3);
  const pinned = { ...dose, modelVersion: 'future-not-installed' };
  assert.equal(concentration(pinned, START + 2 * HOUR).value, null);
  assert.equal(groupedTotals([pinned], START + 2 * HOUR).Methylphenidate.complete, false);
});

test('effect duration origin produces the explicit 08:30 to 11:30–13:30 interval', () => {
  const dose = fixture('ritalin', { assumptions: { ...blankAssumptions(), accepted: true, onsetHours: 0.5, durationMinHours: 3, durationMaxHours: 5, durationOrigin: 'from_onset' } });
  const result = effectWindow(dose)!;
  assert.equal(new Date(result.start).toISOString(), '2026-09-12T08:30:00.000Z');
  assert.equal(new Date(result.minEnd).toISOString(), '2026-09-12T11:30:00.000Z');
  assert.equal(new Date(result.maxEnd).toISOString(), '2026-09-12T13:30:00.000Z');
  assert.match(result.label, /Assumed/);
  const fourHours = effectWindow({ ...dose, assumptions: { ...dose.assumptions!, durationMinHours: 4, durationMaxHours: 4 } })!;
  assert.equal(new Date(fourHours.minEnd).toISOString(), '2026-09-12T12:30:00.000Z');
  const fromAdministration = effectWindow({ ...dose, assumptions: { ...dose.assumptions!, durationOrigin: 'from_administration', durationMinHours: 4, durationMaxHours: 4 } })!;
  assert.equal(new Date(fromAdministration.maxEnd).toISOString(), '2026-09-12T12:00:00.000Z');
  assert.ok(concentration(dose, fourHours.maxEnd + HOUR).value! > 0);
  assert.equal(effectWindow({ ...dose, assumptions: { ...dose.assumptions!, accepted: false } }), null);
  assert.equal(effectWindow({ ...dose, administeredAt: '' }), null);
});

test('custom package strengths cannot gain a reference curve by matching its total dose', () => {
  const cases = [
    fixture('ritalin', { strength: '2.5', packageStrength: '2.5', quantity: '4', amountMg: '10', unusual: false }),
    fixture('ritalin', { strength: '2', packageStrength: '2', quantity: '5', amountMg: '10', unusual: false }),
    fixture('concerta', { strength: '9', packageStrength: '9', quantity: '2', amountMg: '18', unusual: false }),
    fixture('concerta', { strength: '36', packageStrength: '36', quantity: '0.5', amountMg: '18', unusual: false }),
    fixture('ritalin', { strength: '20', packageStrength: '20', quantity: '0.5', amountMg: '10', unusual: false }),
  ];
  for (const dose of cases) {
    const before = structuredClone(dose);
    assert.equal(modelGroup(dose).reference, false);
    const result = concentration(dose, START + 2 * HOUR);
    assert.equal(result.value, null); assert.equal(result.unit, 'ng/mL'); assert.equal(result.evidence, 'D');
    assert.deepEqual(dose, before);
  }
});

test('reference eligibility rejects inconsistent package, unit, quantity and mass snapshots', () => {
  for (const patch of [
    { packageStrength: '20' }, { packageStrength: '10/5' }, { packageStrength: '' },
    { strength: '5', packageStrength: '10', quantity: '2' }, { quantity: '2' },
    { strengthUnit: 'mg/mL' }, { unit: 'mL' }, { amountBasis: 'first listed ingredient' },
    { strength: '1e1' }, { amountMg: '0xA' }, { quantity: '-1' }, { quantity: '1.0000000001' },
  ] as Partial<Dose>[]) {
    assert.equal(modelGroup(fixture('ritalin', patch)).reference, false, JSON.stringify(patch));
  }
});

test('valid legacy snapshots and equivalent decimal spellings keep existing reference anchors', () => {
  const legacy = fixture('ritalin');
  assert.equal(legacy.packageStrength, undefined); assert.equal(legacy.strengthUnit, undefined);
  close(concentration(legacy, START + 2 * HOUR).value, 4.3);
  const spelled = fixture('ritalin', { strength: '10.000', packageStrength: '10.0', quantity: '1.000000000', amountMg: '10.00', strengthUnit: 'mg' });
  close(concentration(spelled, START + 2 * HOUR).value, 4.3);
  const twoWhole = fixture('ritalin', { strength: '5', packageStrength: '5', quantity: '2' });
  close(concentration(twoWhole, START + 2 * HOUR).value, 4.3);
  assert.equal(modelGroup(fixture('methylphenidate-ir', { strength: '10', packageStrength: '10' })).reference, false);
});

test('custom amounts remain loggable as explicit dimensionless illustrations without reference inheritance', () => {
  const dose = fixture('ritalin', { strength: '2.5', packageStrength: '2.5', quantity: '4', amountMg: '10', assumptions: { ...blankAssumptions(), accepted: true } });
  const result = concentration(dose, START + 2 * HOUR);
  close(result.value, 1); assert.equal(result.unit, 'relative units'); assert.equal(result.evidence, 'D');
});

test('generic dextroamphetamine includes seven primary-label strengths without gaining brand identity or a PK model', () => {
  const generic = getProduct('dextroamphetamine-ir');
  assert.deepEqual(generic.strengths, ['2.5', '5', '7.5', '10', '15', '20', '30']);
  assert.equal(generic.manufacturer, 'Confirm labeler on package'); assert.equal(generic.evidence, 'D'); assert.equal(generic.model, 'assumption');
  assert.ok(generic.sourceIds.some(id => sources.find(source => source.id === id)?.url.endsWith('ca1a8890-0675-4c9c-9716-6c28f975d827')));
  for (const strength of generic.strengths) assert.equal(modelGroup(fixture(generic.id, { strength, amountMg: strength })).reference, false);
});
