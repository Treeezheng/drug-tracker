import test from 'node:test';
import assert from 'node:assert/strict';
import { newDose } from '../src/components/DoseEditor';
import { blankAssumptions, MODEL_VERSION, pkReferenceForDose, preparePkReferenceContribution } from '../src/lib/model';
import { PK_REFERENCES, evaluatePkReference } from '../src/lib/pk-references';
import { estimateTotals } from '../src/lib/timeline-estimates';
import { sampleTimelinePanel } from '../src/lib/timeline-series';
import { hasKnownTotal } from '../src/lib/timeline-data';
import type { Dose } from '../src/lib/types';

const start = Date.parse('2026-09-14T08:00:00Z'), hour = 3_600_000;
const dose = (id = 'adderall-ir', strength?: string): Dose => ({
  ...newDose(id, strength), status: 'actual', administeredAt: new Date(start).toISOString(),
});

test('prepared references preserve every registered product/analyte peak, knot and tail boundary', () => {
  for (const profile of PK_REFERENCES) for (const id of profile.productIds) {
    const record = dose(id), before = structuredClone(record), reference = pkReferenceForDose(record);
    assert.ok(reference, id);
    for (const channel of profile.channels) for (const publishedOnly of [false, true]) {
      const evaluate = preparePkReferenceContribution(record, channel.group, publishedOnly);
      assert.ok(evaluate, `${id} ${channel.group}`);
      const last = channel.points?.at(-1)?.[0];
      const elapsed = [-1, 0, channel.lagHours ?? 0, channel.peakHours,
        ...(channel.points?.flatMap(([time]) => [time, time + 1 / hour]) ?? []), 240];
      for (const hours of elapsed) {
        const at = start + hours * hour, result = evaluate(at)!;
        // Use the effective JS timestamp to avoid comparing different sub-ms values.
        const effective = (at - start) / hour, tail = last !== undefined && effective > last;
        const expected = tail && publishedOnly ? null : evaluatePkReference(channel, effective);
        assert.equal(result.value, expected === null ? null : expected * reference.doseScale, `${id} ${channel.group} ${hours}`);
        assert.equal(result.tail, tail);
      }
      for (const at of [NaN, Infinity, -Infinity]) assert.equal(evaluate(at), null);
    }
    assert.equal(preparePkReferenceContribution(record, 'unrelated analyte'), null);
    assert.deepEqual(record, before);
  }
});

test('preparation rejects invalid snapshots and revalidates each edited view without mutating prior samples', () => {
  const record = dose('adderall-ir', '10'), group = 'd-Amphetamine';
  const prepared = preparePkReferenceContribution(record, group)!;
  const peak = prepared(start + 3 * hour)!.value;
  assert.ok(peak !== null && peak > 0);
  const patches: Partial<Dose>[] = [
    ...['', '0', '-1', 'NaN', 'Infinity', '1e1', ' 10'].map(amountMg => ({ amountMg })),
    { quantity: '2' }, { quantity: '0' }, { strength: '' }, { strength: '11', amountMg: '11', packageStrength: '11' },
    { administeredAt: '' }, { administeredAt: '2026-02-30T08:00:00Z' },
    { administeredAt: '2026-09-14T08:00:00-07:00' }, { packageStrength: '5' },
    { unit: 'mL' }, { strengthUnit: 'mg/mL' }, { amountBasis: 'first listed ingredient' },
    { formulation: 'unknown' }, { modelVersion: MODEL_VERSION + '-unknown' },
    { status: 'skipped' }, { unusual: true }, { assumptions: { ...blankAssumptions(), accepted: true } },
  ];
  for (const patch of patches) {
    const changed = { ...record, ...patch };
    assert.equal(preparePkReferenceContribution(changed, group), null, JSON.stringify(patch));
  }
  const samples = sampleTimelinePanel([record], group, [start + 3 * hour], false);
  const twice = { ...record, quantity: '2', amountMg: '20' };
  assert.equal(sampleTimelinePanel([twice], group, [start + 3 * hour], false).series[0].value, peak * 2);
  assert.equal(samples.series[0].value, peak, 'Already-rendered view samples remain local values.');
  assert.equal(prepared(start + 3 * hour)!.value, peak);
});

test('fractional IR, liquid and combination rules survive preparation instead of bypassing model eligibility', () => {
  for (const id of ['focalin', 'evekeo', 'adderall-ir']) {
    const full = dose(id, '10'), half = { ...full, quantity: '0.5', amountMg: '5' };
    const group = pkReferenceForDose(full)!.channels[0].group;
    const one = preparePkReferenceContribution(full, group)!, split = preparePkReferenceContribution(half, group);
    assert.ok(split, id);
    assert.equal(split(start + 2 * hour)!.value, one(start + 2 * hour)!.value! / 2);
    assert.equal(preparePkReferenceContribution({ ...full, quantity: '0.25', amountMg: '2.5' }, group), null);
  }
  for (const id of ['focalin-xr', 'mydayis', 'dyanavel-xr-tablet', 'evekeo-odt']) {
    const full = dose(id), half = { ...full, quantity: '0.5', amountMg: String(Number(full.strength) / 2) };
    assert.equal(preparePkReferenceContribution(half, pkReferenceForDose(full)!.channels[0].group), null, id);
  }
  const liquid = { ...dose('dyanavel-xr-liquid'), quantity: '7.5', amountMg: '18.75' };
  assert.equal(pkReferenceForDose(liquid)?.doseScale, 1);
  assert.ok(preparePkReferenceContribution(liquid, 'l-Amphetamine'));
  assert.equal(preparePkReferenceContribution({ ...liquid, amountMg: '20' }, 'l-Amphetamine'), null);
  const combination = dose('azstarys');
  assert.ok(preparePkReferenceContribution(combination, 'd-Methylphenidate'));
  assert.equal(preparePkReferenceContribution({ ...combination, ingredients: [] }, 'd-Methylphenidate'), null);
  assert.equal(preparePkReferenceContribution({ ...combination, amountBasis: 'labeled ingredient' }, 'd-Methylphenidate'), null);
});

test('fast sampling retains unknown gaps beside future zeroes and deduplicates only included records', () => {
  const actual = dose(), invalid = { ...dose(), amountMg: '' }, future = { ...dose(), administeredAt: new Date(start + 48 * hour).toISOString() };
  const samplesAt = [start - hour, start, start + 3 * hour, start + 48 * hour, start + 80 * hour];
  for (const members of [[invalid, future], [actual, invalid, future],
    [{ ...actual, status: 'skipped' as const }, actual], [{ ...actual, status: 'simulated' as const, amountMg: '' }, actual],
    [actual, { ...actual, quantity: '2', amountMg: '20' }], [invalid, { ...actual, id: invalid.id }]]) {
    for (const publishedOnly of [false, true]) for (const group of ['d-Amphetamine', 'l-Amphetamine']) {
      const samples = sampleTimelinePanel(members, group, samplesAt, publishedOnly);
      samplesAt.forEach((at, i) => {
        const expected = estimateTotals(members, at, publishedOnly)[group], got = samples.series[i];
        assert.equal(got.value, expected?.value ?? 0);
        assert.equal(got.known, hasKnownTotal(expected, at));
        assert.equal(got.complete, expected?.complete ?? false);
        assert.equal(got.hasReference, expected?.hasReference ?? false);
      });
    }
  }
  const missing = sampleTimelinePanel([invalid, future], 'd-Amphetamine', [start + 3 * hour], false).series[0];
  assert.equal(missing.value, 0);
  assert.equal(missing.known, false, 'A future known zero cannot conceal an earlier unknown dose.');
});
