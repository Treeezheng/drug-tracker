import test from 'node:test';
import assert from 'node:assert/strict';
import { products, sources } from '../src/lib/catalog.ts';
import { PK_REFERENCES, evaluatePkReference, pkProfileForProduct } from '../src/lib/pk-references.ts';
import type { PkReferenceChannel } from '../src/lib/pk-reference-types.ts';

const channel = (productId: string, group: string): PkReferenceChannel => {
  const result = pkProfileForProduct(productId)?.channels.find(value => value.group === group);
  assert.ok(result, `${productId}: missing ${group} reference`);
  return result;
};
const close = (actual: number | null, expected: number, tolerance = 1e-8) => {
  assert.ok(actual !== null && Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
};

/** Independent numerical exposure check, not the evaluator's absorption formula. */
function auc(value: PkReferenceChannel, end = 600): number {
  const step = 0.005;
  let area = 0, previous = evaluatePkReference(value, 0);
  assert.notEqual(previous, null);
  for (let index = 1; index <= Math.round(end / step); index++) {
    const current = evaluatePkReference(value, index * step);
    assert.ok(current !== null && Number.isFinite(current) && current >= 0);
    area += (previous! + current) * step / 2;
    previous = current;
  }
  return area;
}

test('reference identities resolve to exact catalog units and primary sources without duplicate product mappings', () => {
  const ids = new Set<string>(), productIds = new Set<string>();
  for (const profile of PK_REFERENCES) {
    assert.ok(!ids.has(profile.id)); ids.add(profile.id);
    assert.ok(Number.isFinite(profile.referenceDoseMg) && profile.referenceDoseMg > 0);
    assert.ok(profile.productIds.length && profile.channels.length && profile.sourceIds.length);
    assert.ok(profile.population.length && profile.note.length);
    assert.equal(new Set(profile.channels.map(value => value.group)).size, profile.channels.length);
    for (const productId of profile.productIds) {
      assert.ok(!productIds.has(productId), `${productId}: ambiguous reference mapping`); productIds.add(productId);
      const product = products.find(value => value.id === productId);
      assert.ok(product, productId);
      assert.equal(profile.unit, product.unit);
      assert.equal(profile.strengthUnit, product.strengthUnit);
      assert.equal(pkProfileForProduct(productId), profile);
      if (profile.fractionalTablets) {
        assert.equal(profile.unit, 'tablet');
        assert.match(product.formulation, /immediate-release/i);
      }
    }
    for (const id of profile.sourceIds) {
      const source = sources.find(value => value.id === id);
      assert.ok(source, `Missing source ${id}`);
      assert.ok(['www.accessdata.fda.gov', 'dailymed.nlm.nih.gov', 'www.fda.gov'].includes(new URL(source.url).hostname));
    }
    for (const value of profile.channels) {
      assert.ok([value.cmax, value.peakHours, value.halfLifeHours].every(number => Number.isFinite(number) && number > 0));
      assert.ok((value.lagHours ?? 0) >= 0 && (value.lagHours ?? 0) < value.peakHours);
      if (value.points) {
        assert.ok(value.points.length > 1);
        assert.equal(value.points[0][0], 0);
        for (let i = 0; i < value.points.length; i++) {
          const [hours, concentration] = value.points[i];
          assert.ok(Number.isFinite(hours) && Number.isFinite(concentration) && concentration >= 0);
          if (i) assert.ok(hours > value.points[i - 1][0]);
        }
      }
    }
  }
});

test('named study peaks preserve formulation, analyte and labeled reference-dose bases', () => {
  // Cmax ng/mL, peak h, and study dose mg are independently transcribed label/review facts.
  const facts: [string, string, number, number, number][] = [
    ['ritalin-la', 'Methylphenidate', 20, 5.5, 6.2],
    ['methylin-solution', 'Methylphenidate', 20, 1.5, 9.1],
    ['methylphenidate-chewable', 'Methylphenidate', 20, 1.5, 10],
    ['quillivant-xr', 'd-Methylphenidate', 60, 5, 13.6],
    ['cotempla-xr-odt', 'd-Methylphenidate', 51.8, 4.98, 20.8],
    ['amphetamine-salts-ir', 'd-Amphetamine', 10, 2.72, 15.7],
    ['amphetamine-salts-ir', 'l-Amphetamine', 10, 2.89, 5.02],
    ['adderall-xr', 'd-Amphetamine', 30, 5.2, 44.3],
    ['adderall-xr', 'l-Amphetamine', 30, 5.6, 13.3],
    ['dextroamphetamine-ir', 'd-Amphetamine', 15, 3, 36.6],
    ['dexedrine-spansule', 'd-Amphetamine', 15, 8, 23.5],
    ['vyvanse-capsule', 'd-Amphetamine', 70, 3.70, 71.75],
    ['vyvanse-chewable', 'd-Amphetamine', 60, 4.4, 56.9],
    ['arynta', 'd-Amphetamine', 70, 3.42, 72.61],
  ];
  for (const [id, group, dose, peak, cmax] of facts) {
    assert.equal(pkProfileForProduct(id)?.referenceDoseMg, dose);
    close(evaluatePkReference(channel(id, group), peak), cmax);
  }
  assert.deepEqual(pkProfileForProduct('amphetamine-salts-ir')?.channels.map(value => value.group), ['d-Amphetamine', 'l-Amphetamine']);
  assert.deepEqual(pkProfileForProduct('cotempla-xr-odt')?.channels.map(value => value.group), ['d-Methylphenidate']);
  assert.notEqual(pkProfileForProduct('methylin-solution'), pkProfileForProduct('quillivant-xr'));
  for (const id of ['not-a-catalog-product', 'metformin-ir']) {
    assert.equal(pkProfileForProduct(id), undefined, `${id}: unsupported form must not borrow another product's curve`);
  }
});

test('Ritalin LA retains its adult first peak and valley instead of substituting pediatric peaks or a single pulse', () => {
  const value = channel('ritalin-la', 'Methylphenidate');
  close(evaluatePkReference(value, 2), 5.3);
  close(evaluatePkReference(value, 3.6), 3);
  close(evaluatePkReference(value, 5.5), 6.2);
  assert.ok(evaluatePkReference(value, 3.6)! < evaluatePkReference(value, 2)!);
  close(evaluatePkReference(value, 5.5 + 3.3), 3.1);
});

test('constructed total exposure stays within 20 percent of independently reported same-condition AUC', () => {
  // This engineering sanity limit is not a clinical bioequivalence criterion.
  // S3 Table 4; C1 §12.3; C8 Table 2; A1 Table 7; A4 Table 16; A7 p10 Table 4.
  const facts: [string, string, number][] = [
    ['ritalin-la', 'Methylphenidate', 45.8],
    ['methylin-solution', 'Methylphenidate', 46.7],
    ['cotempla-xr-odt', 'd-Methylphenidate', 169.1],
    ['amphetamine-salts-ir', 'd-Amphetamine', 276],
    ['amphetamine-salts-ir', 'l-Amphetamine', 107],
    ['vyvanse-capsule', 'd-Amphetamine', 1492.39],
    ['arynta', 'd-Amphetamine', 1479.12],
    ['vyvanse-chewable', 'd-Amphetamine', 1168],
  ];
  for (const [id, group, reported] of facts) {
    const modeled = auc(channel(id, group));
    assert.ok(Math.abs(modeled / reported - 1) < 0.2, `${id} ${group}: AUC ${modeled}; reported ${reported}`);
  }
  // The label says the 15 mg IR and SR extents are similar, but supplies no absolute AUC.
  const ir = auc(channel('dextroamphetamine-ir', 'd-Amphetamine'));
  const sr = auc(channel('dexedrine-spansule', 'd-Amphetamine'));
  assert.ok(Math.abs(sr / ir - 1) < 0.2);
});

test('LDX early exposure respects the FDA partial AUC instead of immediately absorbing like an IR active drug', () => {
  // A4 p73 Table16 (70 mg capsule/solution); A7 p10 Table4 (60 mg chewable).
  const facts: [string, number, number][] = [
    ['vyvanse-capsule', 1.5, 15.63], ['vyvanse-capsule', 4, 163.40],
    ['arynta', 1.5, 24.09], ['arynta', 4, 182.46],
    ['vyvanse-chewable', 4, 135], ['vyvanse-chewable', 5, 188],
  ];
  for (const [id, end, reported] of facts) {
    const modeled = auc(channel(id, 'd-Amphetamine'), end);
    assert.ok(Math.abs(modeled / reported - 1) < 0.2, `${id}: AUC0–${end} ${modeled}; reported ${reported}`);
    assert.match(pkProfileForProduct(id)!.note, /not a measured absorption delay/);
  }
  assert.equal(channel('vyvanse-chewable', 'd-Amphetamine').halfLifeHours, 12.7);
});

test('registered reference evaluations stay finite and nonnegative, and invalid evaluation instants remain unavailable', () => {
  for (const profile of PK_REFERENCES) for (const value of profile.channels) {
    assert.equal(evaluatePkReference(value, -1), 0);
    for (const time of [NaN, Infinity, -Infinity]) assert.equal(evaluatePkReference(value, time), null);
    for (let time = 0; time <= 160; time += 0.25) {
      const concentration = evaluatePkReference(value, time);
      assert.ok(concentration !== null && Number.isFinite(concentration) && concentration >= 0);
      assert.ok(concentration <= value.cmax + 1e-8);
    }
  }
});
