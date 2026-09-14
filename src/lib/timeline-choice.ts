import { products } from './catalog';
import { medicationBrand, medicationDisplay } from './medication-display';
import { concentrationAnalytes, includeTimelineDose } from './model';
import type { Dose } from './types';

export interface TimelineChoice {id:string;label:string;doses:Dose[];}

/** Group views by shared measured compounds, retaining each formulation's own model.
 * Multi-component medicines can join compatible views, but TimelinePlot still
 * selects and sums one exact analyte at a time. Unknown contributions stay present. */
export function timelineChoices(doses:readonly Dose[]):TimelineChoice[] {
  const parents = new Map<string, string>();
  function root(key: string): string {
    const parent = parents.get(key);
    if (parent === undefined || parent === key) return key;
    const result = root(parent);
    parents.set(key, result);
    return result;
  }

  const rows = doses.filter(includeTimelineDose).map(dose => {
    const analytes = concentrationAnalytes(dose);
    const product = products.find(item => item.id === dose.productId);
    const display = medicationDisplay({ id: dose.productId, name: product?.name ?? dose.productName });
    const keys = analytes.length
      ? analytes.map(({ group, unit }) => `analyte:${encodeURIComponent(group)}:${encodeURIComponent(unit)}`)
      : [`product:${display.groupId}`];
    // Link overlapping channel sets (e.g. Adderall d/l and Vyvanse d). Choosing
    // a stable root avoids changing selection when doses are reordered.
    const roots = keys.map(root).sort();
    for (const key of roots) parents.set(key, roots[0]);
    return { dose, key: keys[0], name: medicationBrand(dose.productId) ?? display.title };
  });

  const choices = new Map<string, TimelineChoice>();
  const labels = new Map<string, Set<string>>();
  for (const { dose, key, name } of rows) {
    const id = root(key);
    const choice = choices.get(id) ?? { id, label: '', doses: [] };
    const names = labels.get(id) ?? new Set<string>();
    names.add(name);
    labels.set(id, names);
    choice.doses.push(dose);
    choice.label = [...names].join(' / ');
    choices.set(id, choice);
  }
  return [...choices.values()];
}

export function selectedTimelineChoice(choices:readonly TimelineChoice[],id:string|null) {
  return choices.find(choice=>choice.id===id)??choices[0];
}
