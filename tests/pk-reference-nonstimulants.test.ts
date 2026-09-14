import test from 'node:test';
import assert from 'node:assert/strict';
import { products, sources } from '../src/lib/catalog.ts';
import { evaluatePkReference } from '../src/lib/pk-references.ts';
import { NONSTIMULANT_PK_REFERENCES } from '../src/lib/pk-reference-nonstimulants.ts';
import { NONSTIMULANT_PK_SOURCES } from '../src/lib/pk-reference-nonstimulant-sources.ts';
import type { PkReferenceChannel } from '../src/lib/pk-reference-types.ts';

function reference(productId: string) {
  const profile = NONSTIMULANT_PK_REFERENCES.find(value => value.productIds.includes(productId));
  assert.ok(profile, productId);
  return profile;
}

function auc(channel: PkReferenceChannel): number {
  let area = 0, previous = evaluatePkReference(channel, 0)!;
  // Trapezoid integration is independent of the fitted absorption-rate implementation.
  for (let i = 1; i <= 120000; i++) {
    const current = evaluatePkReference(channel, i * 0.005);
    assert.ok(current !== null && Number.isFinite(current) && current >= 0);
    area += (previous + current) * 0.0025;
    previous = current;
  }
  return area;
}

test('nonstimulants use exact formulation identities, compatible dose units and resolvable primary sources', () => {
  const ids = new Set<string>();
  for (const profile of NONSTIMULANT_PK_REFERENCES) {
    assert.equal(profile.channels.length, 1);
    assert.equal(profile.fractionalTablets, undefined);
    assert.match(profile.population, /single/i);
    for (const id of profile.productIds) {
      assert.ok(!ids.has(id)); ids.add(id);
      const product = products.find(value => value.id === id);
      assert.ok(product);
      assert.equal(profile.unit, product.unit);
      assert.equal(profile.strengthUnit, product.strengthUnit);
    }
    for (const id of profile.sourceIds) {
      const source = [...sources, ...NONSTIMULANT_PK_SOURCES].find(value => value.id === id);
      assert.ok(source, id);
      assert.ok(['www.accessdata.fda.gov', 'dailymed.nlm.nih.gov'].includes(new URL(source.url).hostname));
    }
  }
  assert.deepEqual([...ids].sort(), ['atomoxetine', 'clonidine-er', 'intuniv', 'qelbree']);
  assert.ok(!ids.has('onyda-xr'), 'ER suspension must not borrow the tablet study');
});

test('single-dose peaks preserve pg/µg conversions and labeled base-versus-salt dose bases', () => {
  const facts: [string, string, number, number, number, number][] = [
    ['atomoxetine', 'Atomoxetine', 40, 333, 1, 4.2],
    ['intuniv', 'Guanfacine', 1, 0.98, 6, 17.5],
    ['clonidine-er', 'Clonidine', 0.1, 258 / 1000, 6.5, 12.65],
    ['qelbree', 'Viloxazine', 200, 1.33 * 1000, 5, 7.02],
  ];
  for (const [id, group, dose, cmax, peak, halfLife] of facts) {
    const profile = reference(id), channel = profile.channels[0];
    assert.equal(profile.referenceDoseMg, dose);
    assert.equal(channel.group, group);
    assert.equal(channel.halfLifeHours, halfLife);
    assert.ok(Math.abs(evaluatePkReference(channel, peak)! - cmax) < 1e-8);
    assert.ok(evaluatePkReference(channel, peak / 2)! < cmax);
    assert.ok(evaluatePkReference(channel, peak + 2)! < cmax);
  }
});

test('constructed exposure is checked against same-condition single-dose AUC, including coarse Qelbree error', () => {
  // Engineering sanity checks, not equivalence tests or clinical validation.
  for (const [id, reported, tolerance] of [
    ['atomoxetine', 2.11 * 1000, 0.15],
    ['intuniv', 32.4, 0.05],
    ['clonidine-er', 6729 / 1000, 0.01],
    ['qelbree', 27.3 * 1000, 0.20],
  ] as const) {
    const modeled = auc(reference(id).channels[0]);
    assert.ok(Math.abs(modeled / reported - 1) < tolerance, `${id}: ${modeled} vs ${reported}`);
  }
  // Independent 24-hour concentration landmark in FDA Intuniv Table 5.1.
  assert.ok(Math.abs(evaluatePkReference(reference('intuniv').channels[0], 24)! / 0.53 - 1) < 0.05);
});

test('atomoxetine identifies the studied CYP2D6 group without inventing a personal genotype or a PM scaling factor', () => {
  const profile = reference('atomoxetine');
  assert.match(profile.label, /CYP2D6 extensive-metabolizer/);
  assert.match(profile.note, /not an assumption about your genotype/);
  assert.match(profile.note, /poor metabolizers and strong CYP2D6 inhibitors/);
  assert.equal(profile.channels.length, 1);
  for (const entry of NONSTIMULANT_PK_REFERENCES) {
    assert.equal(evaluatePkReference(entry.channels[0], NaN), null);
    assert.equal(evaluatePkReference(entry.channels[0], -1), 0);
  }
});
