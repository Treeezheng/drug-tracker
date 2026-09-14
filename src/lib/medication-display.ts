import type { Product } from './types';

/** Presentation only; keep product IDs, formulations, snapshots and evidence separate. */
export function medicationDisplay(product: Pick<Product, 'id' | 'name'>): { groupId: string; title: string; variant?: 'Ritalin' | 'Generic'; label: string } {
  if (product.id === 'ritalin' || product.id === 'methylphenidate-ir') {
    const variant = product.id === 'ritalin' ? 'Ritalin' : 'Generic';
    return { groupId: 'methylphenidate-ir-display', title: 'Methylphenidate IR', variant, label: `Methylphenidate IR · ${variant}` };
  }
  return { groupId: product.id, title: product.name, label: product.name };
}

export function groupMedicationProducts(products: readonly Product[]): { id: string; title: string; family: string; products: Product[] }[] {
  const groups = new Map<string, { id: string; title: string; family: string; products: Product[] }>();
  for (const product of products) {
    const display = medicationDisplay(product);
    const group = groups.get(display.groupId) ?? { id: display.groupId, title: display.title, family: product.family, products: [] };
    group.products.push(product);
    groups.set(display.groupId, group);
  }
  return [...groups.values()];
}
