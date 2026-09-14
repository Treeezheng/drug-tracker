import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { getProduct, products } from '../src/lib/catalog.ts';
import { concentration, pkReferenceForDose, referenceForDose } from '../src/lib/model.ts';
import { isRecordingOnlyMedication, RECORDING_ONLY_EXPLANATION, RECORDING_ONLY_LABEL } from '../src/lib/medication-model-support.ts';
import DoseEditor, { doseInputError, newDose, selectDoseMedication } from '../src/components/DoseEditor.tsx';
import FavoritePicker from '../src/components/FavoritePicker.tsx';
import MedicationName from '../src/components/MedicationName.tsx';

const profile = { name: '', timeZone: 'UTC', timeFormat: '24h' as const, sleepEnabled: false, bedtime: '', wakeTime: '', weekendEnabled: false, weekendBedtime: '', weekendWakeTime: '' };
const administeredAt = '2026-09-14T08:00:00Z';

test('product-level recording markers agree with actual implemented curve availability across the catalog', () => {
  for (const product of products) {
    const hasImplementedCurve = product.strengths.some(strength => {
      const dose = { ...newDose(product.id, strength), administeredAt };
      return concentration(dose, Date.parse(administeredAt) + 3_600_000).value !== null
        || referenceForDose(dose) !== null || pkReferenceForDose(dose) !== null;
    });
    assert.equal(isRecordingOnlyMedication(product.id), !hasImplementedCurve, product.id);
  }
  for (const id of ['methylphenidate-ir', 'focalin-xr', 'amphetamine-salts-er', 'azstarys', 'atomoxetine', 'qelbree']) {
    assert.equal(getProduct(id).evidence, 'D');
    assert.equal(isRecordingOnlyMedication(id), false, `${id} has a reference despite evidence D.`);
  }
  assert.equal(isRecordingOnlyMedication(''), false, 'The empty chooser has no medication marker.');
  assert.equal(isRecordingOnlyMedication('historical-product'), true);
});

test('the chooser marks unsupported products once per name and shares one explanation without blocking strengths', () => {
  const html = renderToStaticMarkup(createElement(FavoritePicker, {
    favorites: [], onSave() {}, onRemove() {}, onClose() {},
  }));
  assert.equal(html.split(RECORDING_ONLY_EXPLANATION).length - 1, 1);
  for (const id of ['daytrana', 'adzenys-xr-odt', 'procentra', 'xelstrym', 'desoxyn', 'onyda-xr', 'simtriyo', 'metformin-ir']) {
    const product = getProduct(id);
    assert.ok(html.includes(`<h4>${product.name}<span class="medication-recording-only">${RECORDING_ONLY_LABEL}</span></h4>`), id);
    assert.ok(html.includes(`aria-label="${product.name} ${product.strengths[0]} ${product.strengthUnit}"`), `${id} keeps its strength choices.`);
  }
  assert.doesNotMatch(html, /disabled=""/);
  assert.doesNotMatch(html, /<h4>Concerta<span class="medication-recording-only"/);
});

test('recording-only medication labels and editor options preserve record entry and historical names', () => {
  const product = getProduct('metformin-ir');
  const dose = selectDoseMedication({ ...newDose(), administeredAt }, product.id, undefined, 'UTC');
  const before = structuredClone(dose);
  assert.equal(doseInputError(dose), '');
  assert.equal(dose.assumptions, undefined);
  const html = renderToStaticMarkup(createElement(DoseEditor, { dose, index: 0, profile, onChange() {} }));
  assert.ok(html.includes(`value="metformin-ir" selected="">${product.name} · ${RECORDING_ONLY_LABEL}</option>`));
  assert.deepEqual(dose, before);
  const name = renderToStaticMarkup(createElement(MedicationName, { id: product.id, name: product.name }));
  assert.ok(name.includes(`<span class="medication-recording-only">${RECORDING_ONLY_LABEL}</span>`));
  const saved = renderToStaticMarkup(createElement(MedicationName, { id: 'historical-product', name: 'Saved package name' }));
  assert.ok(saved.includes('Saved package name'));
  assert.ok(saved.includes(RECORDING_ONLY_LABEL));
  const supported = renderToStaticMarkup(createElement(MedicationName, { id: 'methylphenidate-ir', name: 'Saved generic tablet' }));
  assert.ok(!supported.includes(RECORDING_ONLY_LABEL));
});
