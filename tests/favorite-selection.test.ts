import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import FavoritePicker from '../src/components/FavoritePicker.tsx';
import { products } from '../src/lib/catalog.ts';
import { commitFavoriteChanges, favoriteChanges, favoriteSelection, favoriteStrengths, selectFavoriteStrength, strengthKey } from '../src/lib/favorite-selection.ts';
import type { Favorite } from '../src/lib/types.ts';

const favorite = (id: string, strength = '5', patch: Partial<Favorite> = {}): Favorite => ({
  id, productId: 'ritalin', strength, packageStrength: strength, quantity: '0.5', revision: 7, ...patch,
});

test('one product can keep an existing 5 mg snapshot and add a new 10 mg favorite', () => {
  const existing = [favorite('kept-5')], initial = favoriteSelection(existing);
  const selected = selectFavoriteStrength(initial, existing, 'ritalin', '10', true, () => 'new-10');
  assert.equal(initial.size, 1); assert.equal(selected.size, 2);
  assert.equal(selected.get(strengthKey('ritalin', '5')), existing[0]);
  assert.deepEqual(favoriteChanges(existing, selected), [{ type: 'save', favorite: { id: 'new-10', productId: 'ritalin', strength: '10', packageStrength: '10', quantity: '1' } }]);
  assert.deepEqual(existing, [favorite('kept-5')]);
});

test('unchecking and rechecking equivalent decimal strength preserves ID, revision, quantity and original spelling', () => {
  const saved = favorite('original', '10.00', { quantity: '1.5', inventory: '22' }), existing = [saved];
  const off = selectFavoriteStrength(favoriteSelection(existing), existing, 'ritalin', '10', false);
  const on = selectFavoriteStrength(off, existing, 'ritalin', '10.000', true, () => { throw new Error('An existing selection must not allocate an ID.'); });
  assert.equal(on.get(strengthKey('ritalin', '10')), saved);
  assert.deepEqual(favoriteChanges(existing, on), []);
});

test('removing only 5 mg preserves 10 mg and another product with the same numerical strength', () => {
  const existing = [favorite('five'), favorite('ten', '10'), favorite('generic-five', '5', { productId: 'methylphenidate-ir' })];
  const selected = selectFavoriteStrength(favoriteSelection(existing), existing, 'ritalin', '5', false);
  assert.equal(selected.size, 2);
  assert.deepEqual(favoriteChanges(existing, selected), [{ type: 'remove', favorite: existing[0] }]);
  assert.equal(existing.length, 3);
});

test('full combination strength is part of selection identity, including the second ingredient', () => {
  const saved = favorite('combo', '26.1', { productId: 'azstarys', packageStrength: '26.1/5.2' });
  const selected = selectFavoriteStrength(favoriteSelection([saved]), [saved], 'azstarys', '26.1/7.8', true, () => 'different-combo');
  assert.equal(selected.size, 2);
  assert.equal(selected.get(strengthKey('azstarys', '26.10/5.20')), saved);
  assert.equal(favoriteChanges([saved], selected)[0].favorite.packageStrength, '26.1/7.8');
});

test('catalog choices include saved out-of-catalog strengths while equivalent decimal aliases share one chip', () => {
  const product = products.find(p => p.id === 'ritalin')!;
  const saved = [favorite('ten', '10.000'), favorite('old-strength', '7.5')];
  assert.deepEqual(favoriteStrengths(product, saved), ['5', '10', '20', '7.5']);
  assert.equal(saved[0].packageStrength, '10.000');
});

test('unrecognized historical products and unresolved strengths are not removed by an unrelated selection', () => {
  const existing = [favorite('unknown', '7', { productId: 'archived-product' }), favorite('needs-review', '')];
  const selected = selectFavoriteStrength(favoriteSelection(existing), existing, 'ritalin', '10', true, () => 'ten');
  const changes = favoriteChanges(existing, selected);
  assert.equal(changes.length, 1); assert.equal(changes[0].type, 'save');
  assert.equal(selected.size, 3);
});

test('a successful save adds new strengths before removing deselected rows and leaves retained snapshots untouched', async () => {
  const existing = [favorite('five'), favorite('ten', '10')];
  let selected = selectFavoriteStrength(favoriteSelection(existing), existing, 'ritalin', '20', true, () => 'twenty');
  selected = selectFavoriteStrength(selected, existing, 'ritalin', '5', false);
  const pending = favoriteChanges(existing, selected), calls: string[] = [], stored = new Map(existing.map(f => [f.id, f]));
  await commitFavoriteChanges(pending, async f => { calls.push(`save:${f.id}`); stored.set(f.id, f); }, async f => { calls.push(`remove:${f.id}`); stored.delete(f.id); });
  assert.deepEqual(calls, ['save:twenty', 'remove:five']);
  assert.equal(stored.get('ten'), existing[1]);
  assert.deepEqual([...stored.keys()], ['ten', 'twenty']);
  assert.equal(pending.length, 0);
});

test('partial save failure retries only remaining operations using the original new UUID', async () => {
  const existing = [favorite('old-five')];
  let selected = selectFavoriteStrength(favoriteSelection(existing), existing, 'ritalin', '10', true, () => 'new-ten');
  selected = selectFavoriteStrength(selected, existing, 'ritalin', '20', true, () => 'new-twenty');
  selected = selectFavoriteStrength(selected, existing, 'ritalin', '5', false);
  const pending = favoriteChanges(existing, selected), attempts: string[] = [];
  const onRemove = async (f: Favorite) => { attempts.push(`remove:${f.id}`); };
  await assert.rejects(commitFavoriteChanges(pending, async f => { attempts.push(`save:${f.id}`); if (f.id === 'new-twenty') throw new Error('Temporary failure'); }, onRemove), /Temporary failure/);
  assert.deepEqual(attempts, ['save:new-ten', 'save:new-twenty']);
  assert.deepEqual(pending.map(change => change.favorite.id), ['new-twenty', 'old-five']);
  await commitFavoriteChanges(pending, async f => { attempts.push(`retry:${f.id}`); }, onRemove);
  assert.deepEqual(attempts, ['save:new-ten', 'save:new-twenty', 'retry:new-twenty', 'remove:old-five']);
  assert.equal(pending.length, 0);
});

test('a failed first addition cannot remove existing strengths', async () => {
  const existing = [favorite('old')];
  let selected = selectFavoriteStrength(favoriteSelection(existing), existing, 'ritalin', '10', true, () => 'new');
  selected = selectFavoriteStrength(selected, existing, 'ritalin', '5', false);
  const pending = favoriteChanges(existing, selected);
  await assert.rejects(commitFavoriteChanges(pending, () => { throw new Error('Save failed'); }, () => { throw new Error('Removal must wait'); }), /Save failed/);
  assert.deepEqual(pending.map(change => change.type), ['save', 'remove']);
});

test('picker markup presents multiple checked strength chips and one IR heading with distinct brand labels', () => {
  const html = renderToStaticMarkup(createElement(FavoritePicker, {
    favorites: [favorite('five'), favorite('ten', '10'), favorite('generic', '10', { productId: 'methylphenidate-ir' })],
    onSave: () => {}, onRemove: () => {}, onClose: () => {},
  }));
  assert.equal((html.match(/<h4>Methylphenidate IR<\/h4>/g) || []).length, 1);
  for (const label of ['Methylphenidate IR · Ritalin 5 mg', 'Methylphenidate IR · Ritalin 10 mg', 'Methylphenidate IR · Generic 10 mg']) {
    const input = html.match(new RegExp(`<input[^>]*aria-label="${label}"[^>]*>`));
    assert.ok(input, `Missing ${label}`); assert.match(input[0], /checked=""/);
  }
  assert.match(html, /3 strengths selected/);
  assert.match(html, /aria-label="Search brand or ingredient"/);
  assert.doesNotMatch(html, /Preferred strength|<select/);
});
