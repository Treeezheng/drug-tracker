import type { Product } from './types';

type DisplayPair = { genericId: string; brandId: string; title: string; brand: string };
// Corresponding ingredient + formulation only. Other release systems remain independent.
const pairs: readonly DisplayPair[] = [
  { genericId: 'methylphenidate-ir', brandId: 'ritalin', title: 'Methylphenidate IR', brand: 'Ritalin' },
  { genericId: 'dexmethylphenidate-ir', brandId: 'focalin', title: 'Dexmethylphenidate IR', brand: 'Focalin' },
  { genericId: 'dexmethylphenidate-er', brandId: 'focalin-xr', title: 'Dexmethylphenidate ER capsule', brand: 'Focalin XR' },
  { genericId: 'amphetamine-salts-ir', brandId: 'adderall-ir', title: 'Mixed amphetamine salts IR', brand: 'Adderall' },
  { genericId: 'amphetamine-salts-er', brandId: 'adderall-xr', title: 'Mixed amphetamine salts ER capsule', brand: 'Adderall XR' },
  { genericId: 'dextroamphetamine-ir', brandId: 'zenzedi', title: 'Dextroamphetamine IR', brand: 'Zenzedi' },
  { genericId: 'lisdexamfetamine-capsule', brandId: 'vyvanse-capsule', title: 'Lisdexamfetamine capsule', brand: 'Vyvanse' },
  { genericId: 'lisdexamfetamine-chewable', brandId: 'vyvanse-chewable', title: 'Lisdexamfetamine chewable', brand: 'Vyvanse' },
];

/** Record labels preserve the actual saved product identity, including generic entries. */
export function medicationDisplay(product: Pick<Product, 'id' | 'name'>): { groupId: string; title: string; variant?: string; label: string } {
  const pair = pairs.find(pair => pair.genericId === product.id || pair.brandId === product.id);
  if (pair) {
    const variant = product.id === pair.brandId ? pair.brand : 'Generic';
    return { groupId: `${pair.genericId}-display`, title: pair.title, variant, label: `${pair.title} · ${variant}` };
  }
  return { groupId: product.id, title: product.name, label: product.name };
}

export type MedicationGroup = { id: string; title: string; family: string; brand?: string; products: Product[]; defaultProduct: Product };

/** Presentation only: no product, manufacturer, model or inventory snapshots are merged. */
export function groupMedicationProducts(products: readonly Product[]): MedicationGroup[] {
  const groups = new Map<string, MedicationGroup>();
  for (const product of products) {
    const display = medicationDisplay(product);
    const pair = pairs.find(pair => pair.genericId === product.id || pair.brandId === product.id);
    const group = groups.get(display.groupId) ?? { id: display.groupId, title: display.title, family: product.family, brand: pair?.brand, products: [], defaultProduct: product };
    group.products.push(product);
    if (pair?.genericId === product.id) group.defaultProduct = product;
    groups.set(display.groupId, group);
  }
  return [...groups.values()];
}

/** Search the whole group so a brand match never hides its generic strengths. */
export function matchesMedicationGroup(group: MedicationGroup, query: string): boolean {
  return `${group.title} ${group.brand || ''} ${group.products.map(p => `${p.name} ${p.generic} ${p.formulation}`).join(' ')}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
}
