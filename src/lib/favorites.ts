import type { AppData, Favorite } from './types';

type Snapshot = Favorite & { createdAt?: string; updatedAt?: string };
const SCALE = 1_000_000_000n;

function strengthComponent(value: string): string {
  if (!/^(?:0|[1-9]\d{0,11})(?:\.\d{1,9})?$/.test(value)) throw new Error('Invalid favorite package strength.');
  const [whole, fraction = ''] = value.split('.');
  const amount = BigInt(whole) * SCALE + BigInt(fraction.padEnd(9, '0'));
  if (amount <= 0n) throw new Error('Favorite package strength must be positive.');
  return amount.toString();
}

/** Identity excludes the default quantity: it is a preference, not another medication. */
export function favoriteKey(favorite: Pick<Favorite, 'productId' | 'strength' | 'packageStrength'>): string {
  const strength = favorite.packageStrength || favorite.strength;
  if (typeof strength !== 'string' || !strength) throw new Error('Choose a favorite package strength.');
  const components = strength.split('/');
  if (components.length > 10) throw new Error('Too many favorite package strength components.');
  return JSON.stringify([favorite.productId, components.map(strengthComponent)]);
}

function time(value?: string): number { return value && Number.isFinite(Date.parse(value)) ? Date.parse(value) : 0; }
function newer<T extends Snapshot>(a: T, b: T): T {
  const comparison = a.id === b.id
    ? (a.revision ?? 0) - (b.revision ?? 0) || time(a.updatedAt) - time(b.updatedAt)
    : time(a.updatedAt) - time(b.updatedAt) || (a.revision ?? 0) - (b.revision ?? 0) || time(a.createdAt) - time(b.createdAt);
  return comparison > 0 || (comparison === 0 && a.id < b.id) ? a : b;
}

/** Preserve distinct strengths and all original snapshot values; never normalize dose history. */
export function dedupeFavorites<T extends Favorite>(favorites: readonly T[], preferredIds: ReadonlySet<string> = new Set()): T[] {
  const byId = new Map<string, T>();
  for (const favorite of favorites) {
    const previous = byId.get(favorite.id);
    byId.set(favorite.id, previous ? newer(favorite, previous) : favorite);
  }
  const groups = new Map<string, T>();
  for (const favorite of byId.values()) {
    let key: string;
    try { key = favoriteKey(favorite); } catch { key = JSON.stringify(['unresolved-favorite', favorite.id]); }
    const previous = groups.get(key);
    if (!previous || (preferredIds.has(favorite.id) && !preferredIds.has(previous.id))) groups.set(key, favorite);
    else if (preferredIds.has(favorite.id) === preferredIds.has(previous.id)) groups.set(key, newer(favorite, previous));
  }
  return [...groups.values()];
}

export function upsertFavorite<T extends Favorite>(favorites: readonly T[], favorite: T): T[] {
  const key = favoriteKey(favorite);
  return dedupeFavorites([...favorites.filter(existing => {
    if (existing.id === favorite.id) return false;
    try { return favoriteKey(existing) !== key; } catch { return true; }
  }), favorite]);
}

export function normalizeFavoritesData<T extends AppData>(data: T): T {
  return { ...data, favorites: dedupeFavorites(data.favorites) };
}
