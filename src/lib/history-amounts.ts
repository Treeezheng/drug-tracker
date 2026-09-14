import type { Dose } from './types';

export const UNRECORDED_INGREDIENT = 'Ingredient not recorded';
const SCALE = 1_000_000_000n;

/** Add recorded decimal amounts without binary rounding or silently dropping invalid input. */
export function exactSumValues(values: readonly string[]): string {
  let total = 0n;
  for (const value of values) {
    if (typeof value !== 'string' || value.length > 30 || !/^(?:\d+(?:\.\d{1,9})?|\.\d{1,9})$/.test(value)) {
      throw new Error('Recorded amounts must use decimal notation with up to nine decimal places.');
    }
    const [whole = '0', fraction = ''] = value.split('.');
    total += BigInt(whole || '0') * SCALE + BigInt(fraction.padEnd(9, '0'));
  }
  const fraction = (total % SCALE).toString().padStart(9, '0').replace(/0+$/, '');
  return `${total / SCALE}${fraction ? `.${fraction}` : ''}`;
}

/** Missing ingredient snapshots stay distinct from all named ingredients. */
export function doseIngredientNames(dose: Dose): string[] {
  return dose.ingredients?.length
    ? [...new Set(dose.ingredients.map(ingredient => ingredient.name))]
    : [UNRECORDED_INGREDIENT];
}

/**
 * Return only an amount explicitly assigned to this ingredient in the snapshot.
 * A legacy amount has unknown ingredient identity. It belongs to one separate
 * bucket and is never added to each known ingredient or inferred from the catalog.
 * Its original amountBasis still determines whether it is a labeled salt amount,
 * first ingredient, or nominal patch delivery; this helper does not convert it.
 */
export function ingredientAmount(dose: Dose, name: string): string {
  if (!dose.ingredients?.length) {
    return name === UNRECORDED_INGREDIENT ? exactSumValues([dose.amountMg]) : '0';
  }
  return exactSumValues(dose.ingredients.filter(ingredient => ingredient.name === name).map(ingredient => ingredient.amountMg));
}
