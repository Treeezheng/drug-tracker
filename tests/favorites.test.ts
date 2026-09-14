import test from 'node:test';
import assert from 'node:assert/strict';
import { dedupeFavorites, favoriteKey, normalizeFavoritesData, upsertFavorite } from '../src/lib/favorites.ts';
import { parseBackup } from '../src/lib/reports.ts';
import type { AppData, Favorite } from '../src/lib/types.ts';

const favorite = (id: string, patch: Partial<Favorite> = {}): Favorite => ({ id, productId: 'ritalin', strength: '10', quantity: '1', ...patch });

test('favorite identity normalizes complete decimal strengths, not quantities or just product IDs', () => {
  assert.equal(favoriteKey(favorite('a')), favoriteKey(favorite('b', { strength: '10.0', packageStrength: '10.000', quantity: '0.5' })));
  assert.notEqual(favoriteKey(favorite('a')), favoriteKey(favorite('b', { strength: '5' })));
  assert.notEqual(favoriteKey(favorite('a')), favoriteKey(favorite('b', { productId: 'another-product' })));
  assert.equal(favoriteKey(favorite('a', { strength: '26.1', packageStrength: '26.10/5.20' })), favoriteKey(favorite('b', { strength: '26.1', packageStrength: '26.1/5.2' })));
  assert.notEqual(favoriteKey(favorite('a', { strength: '26.1', packageStrength: '26.1/5.2' })), favoriteKey(favorite('b', { strength: '26.1', packageStrength: '26.1/5.200000001' })));
});

test('legacy duplicates choose the latest preference deterministically and preserve original snapshot strings', () => {
  const older = { ...favorite('old'), revision: 4, updatedAt: '2026-09-12T00:00:00Z' };
  const newer = { ...favorite('new', { packageStrength: '10.00', quantity: '0.5' }), revision: 1, updatedAt: '2026-09-13T00:00:00Z' };
  for (const rows of [[older, newer], [newer, older]]) assert.deepEqual(dedupeFavorites(rows), [newer]);
  assert.deepEqual(dedupeFavorites([older, newer], new Set(['old'])), [older]);
  assert.equal(newer.packageStrength, '10.00');
});

test('same-ID revisions resolve before strength grouping and unresolved legacy records remain visible', () => {
  const old = favorite('same', { revision: 1 });
  const changed = favorite('same', { strength: '20', revision: 2 });
  assert.deepEqual(dedupeFavorites([old, changed]), [changed]);
  const malformed = favorite('needs-review', { strength: '' });
  assert.deepEqual(dedupeFavorites([malformed, favorite('valid')]), [malformed, favorite('valid')]);
});

test('upsert avoids repeated additions while preserving another strength and default-quantity edits', () => {
  const current = favorite('canonical'), another = favorite('other-strength', { strength: '20' });
  const rows = upsertFavorite([current, another], favorite('incoming-copy', { packageStrength: '10.0', quantity: '0.5' }));
  assert.equal(rows.length, 2);
  assert.equal(rows.find(row => row.strength === '10')?.quantity, '0.5');
  assert.ok(rows.some(row => row.id === another.id));
  assert.equal(current.quantity, '1');
});

test('normalization changes only favorites, never legitimate repeated plan or actual dose rows', () => {
  const data = { profile: null, favorites: [favorite('a'), favorite('b')], doses: [{ id: 'taken-1' }, { id: 'taken-2' }], scenarios: [{ id: 'plan', doses: [{ id: 'dose-1' }, { id: 'dose-2' }] }], checkins: [] } as unknown as AppData;
  const normalized = normalizeFavoritesData(data);
  assert.equal(normalized.favorites.length, 1);
  assert.equal(data.favorites.length, 2);
  assert.equal(normalized.doses, data.doses);
  assert.equal(normalized.scenarios, data.scenarios);
});

test('backup preview collapses legacy duplicate selections and retains distinct strengths without mutating the archive', () => {
  const archive = { format: 'dose-timeline-backup', schemaVersion: 1, exportedAt: '2026-09-13T00:00:00Z', data: { profile: null, doses: [], scenarios: [], checkins: [], favorites: [favorite('a'), favorite('b', { packageStrength: '10.00' }), favorite('c', { strength: '20' })] } };
  assert.equal(parseBackup(JSON.stringify(archive)).favorites.length, 2);
  assert.equal(archive.data.favorites.length, 3);
});
