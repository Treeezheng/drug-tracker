import { favoriteSelection, favoriteStrengths, selectFavoriteStrength, strengthKey, type FavoriteSelection } from './favorite-selection';
import { medicationDisplay, type MedicationGroup } from './medication-display';
import type { Favorite } from './types';

function matchingFavorites(favorites: Iterable<Favorite>, group: MedicationGroup, strength: string): Favorite[] {
  const wanted = strengthKey(group.id, strength);
  return [...favorites].filter(favorite => {
    if (!group.products.some(p => p.id === favorite.productId)) return false;
    try { return strengthKey(group.id, favorite.packageStrength || favorite.strength) === wanted; }
    catch { return false; }
  });
}

export function groupStrengthSelected(selection: FavoriteSelection, group: MedicationGroup, strength: string): boolean {
  return matchingFavorites(selection.values(), group, strength).length > 0;
}

/** A single visual choice may retain several historical brand/generic snapshots. */
export function selectGroupStrength(selection: FavoriteSelection, existing: readonly Favorite[], group: MedicationGroup, strength: string, checked: boolean, createId?: () => string): FavoriteSelection {
  let next = selection;
  if (!checked) {
    for (const favorite of matchingFavorites(next.values(), group, strength)) next = selectFavoriteStrength(next, existing, favorite.productId, strength, false);
  } else if (!groupStrengthSelected(next, group, strength)) {
    const originals = matchingFavorites(existing, group, strength);
    if (originals.length) {
      for (const favorite of originals) next = selectFavoriteStrength(next, existing, favorite.productId, strength, true, createId);
    } else next = selectFavoriteStrength(next, existing, group.defaultProduct.id, strength, true, createId);
  }
  return next;
}

export function groupStrengths(group: MedicationGroup, favorites: readonly Favorite[], selection: FavoriteSelection): string[] {
  const strengths = new Map<string, string>();
  for (const product of group.products) {
    for (const strength of favoriteStrengths(product, [...favorites, ...selection.values()])) {
      const key = strengthKey(group.id, strength);
      if (!strengths.has(key)) strengths.set(key, strength);
    }
  }
  return [...strengths.values()];
}

export function selectedGroupCount(selection: FavoriteSelection): number {
  const keys = new Set<string>();
  for (const favorite of selection.values()) {
    try {
      keys.add(strengthKey(medicationDisplay({ id: favorite.productId, name: favorite.productId }).groupId, favorite.packageStrength || favorite.strength));
    } catch { keys.add([...favoriteSelection([favorite]).keys()][0]); }
  }
  return keys.size;
}
