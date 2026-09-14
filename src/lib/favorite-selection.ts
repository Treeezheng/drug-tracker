import { favoriteKey } from './favorites';
import type { Favorite, Product } from './types';

export type FavoriteSelection = ReadonlyMap<string, Favorite>;
export type FavoriteChange = { type: 'save' | 'remove'; favorite: Favorite };

/** Unrecognized historical entries stay selected until explicitly removed. */
function selectionKey(favorite: Favorite): string {
  try { return favoriteKey(favorite); }
  catch { return JSON.stringify(['unresolved-favorite', favorite.id]); }
}

export function favoriteSelection(favorites: readonly Favorite[]): FavoriteSelection {
  return new Map(favorites.map(favorite => [selectionKey(favorite), favorite]));
}

export function strengthKey(productId: string, packageStrength: string): string {
  return favoriteKey({ productId, packageStrength, strength: packageStrength.split('/')[0] });
}

export function selectFavoriteStrength(
  selection: FavoriteSelection, existing: readonly Favorite[], productId: string,
  packageStrength: string, selected: boolean, createId: () => string = () => crypto.randomUUID(),
): FavoriteSelection {
  const key = strengthKey(productId, packageStrength), next = new Map(selection);
  if (!selected) next.delete(key);
  else if (!next.has(key)) {
    // Restore the original snapshot if a user unchecks and rechecks it.
    const saved = existing.find(favorite => selectionKey(favorite) === key);
    next.set(key, saved || { id: createId(), productId, packageStrength, strength: packageStrength.split('/')[0], quantity: '1' });
  }
  return next;
}

/** Catalog display may use 10 while the preserved saved snapshot contains 10.00. */
export function favoriteStrengths(product: Product, favorites: readonly Favorite[]): string[] {
  const choices = new Map<string, string>();
  for (const strength of [...product.strengths, ...favorites.filter(f => f.productId === product.id).map(f => f.packageStrength || f.strength)]) {
    try {
      const key = strengthKey(product.id, strength);
      if (!choices.has(key)) choices.set(key, strength);
    } catch { /* Keep unresolved snapshots in selection without inventing a package strength. */ }
  }
  return [...choices.values()];
}

/** Existing selected rows are never rewritten: ID, revision, quantity and spelling survive. */
export function favoriteChanges(existing: readonly Favorite[], selection: FavoriteSelection): FavoriteChange[] {
  const current = favoriteSelection(existing);
  const additions: FavoriteChange[] = [...selection].filter(([key]) => !current.has(key)).map(([, favorite]) => ({ type: 'save', favorite }));
  const removals: FavoriteChange[] = existing.filter(favorite => !selection.has(selectionKey(favorite))).map(favorite => ({ type: 'remove', favorite }));
  // A failing new selection must not first erase a working old strength.
  return [...additions, ...removals];
}

/** Consume only confirmed operations. A failed save retains the same UUID for retry. */
export async function commitFavoriteChanges(
  pending: FavoriteChange[], onSave: (favorite: Favorite) => Promise<void> | void,
  onRemove: (favorite: Favorite) => Promise<void> | void,
): Promise<void> {
  while (pending.length) {
    const change = pending[0];
    await (change.type === 'save' ? onSave(change.favorite) : onRemove(change.favorite));
    pending.shift();
  }
}
