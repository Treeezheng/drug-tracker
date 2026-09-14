import { medicationDisplay } from './medication-display';
import { strengthKey } from './favorite-selection';
import type { Dose } from './types';

/** Compact legend only: individual doses and colored curves are never combined. */
export function timelineLegend(doses: readonly Dose[]): { key: string; dose: Dose; members: Dose[] }[] {
  const groups = new Map<string, { key: string; dose: Dose; members: Dose[] }>();
  for (const dose of doses) {
    const display = medicationDisplay({ id: dose.productId, name: dose.productName });
    let strength: string;
    try { strength = strengthKey(display.groupId, dose.packageStrength || dose.strength); }
    catch { strength = JSON.stringify([display.groupId, dose.packageStrength || dose.strength]); }
    const key = JSON.stringify([strength, dose.strengthUnit || 'mg', dose.unit]);
    const group = groups.get(key) ?? { key, dose, members: [] };
    group.members.push(dose); groups.set(key, group);
  }
  return [...groups.values()];
}
