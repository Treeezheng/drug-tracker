import type { PkReferenceProfile } from './pk-reference-types';

/** Single-dose adult population references. All interpolated shapes are estimates.
 * Dose bases, sources and exposure checks: docs/nonstimulant-pk-research-2026-09-14.md.
 * No steady-state trace, IR/ER substitution, genotype inference or effect-window model.
 */
export const NONSTIMULANT_PK_REFERENCES: readonly PkReferenceProfile[] = [
  {
    id: 'atomoxetine-adult-em-fasted-40mg',
    productIds: ['atomoxetine'],
    label: 'Atomoxetine 40 mg adult CYP2D6 extensive-metabolizer reference',
    referenceDoseMg: 40, unit: 'capsule', strengthUnit: 'mg',
    channels: [{ group: 'Atomoxetine', cmax: 333, peakHours: 1, halfLifeHours: 4.2 }],
    sourceIds: ['N1', 'S10'],
    population: 'Healthy adults aged 18–55, CYP2D6 extensive metabolizers; LYAL single 40 mg market-image capsule, fasted, N=24 PK observations (25 participants).',
    note: 'Cmax 333 ng/mL, median Tmax 1 hour and mean half-life 4.2 hours are from the same single-dose study. Dose is labeled atomoxetine base. The fitted absorption shape is not a measured trace; its AUC is about 12.8% above the study mean 2110 ng·h/mL. This is an extensive-metabolizer reference, not an assumption about your genotype: poor metabolizers and strong CYP2D6 inhibitors can markedly increase exposure. Dose scaling is illustrative; the label reports proportionality over 10–120 mg. Concentration does not define an immediate therapeutic effect window.',
  },
  {
    id: 'guanfacine-er-adult-fasted-1mg',
    productIds: ['intuniv'],
    label: 'Guanfacine ER 1 mg adult reference',
    referenceDoseMg: 1, unit: 'tablet', strengthUnit: 'mg',
    channels: [{ group: 'Guanfacine', cmax: 0.98, peakHours: 6, halfLifeHours: 17.5 }],
    sourceIds: ['N2', 'C20'],
    population: '52 healthy adults; single 1 mg Intuniv extended-release tablet, fasted; FDA clinical review Table 5.1.',
    note: 'The FDA review explicitly identifies these as single-dose data, despite the current label table saying once daily. Dose is 1 mg guanfacine base. The fitted absorption curve is an estimate; modeled AUC is about 3.1% below the reported 32.4 ng·h/mL. Adult single-dose proportionality is reported over 1–4 mg; other-dose scaling remains illustrative. Food, CYP3A4 interactions and organ impairment are not personalized. Immediate-release guanfacine has different exposure and is not represented by this ER reference.',
  },
  {
    id: 'clonidine-er-adult-fasted-0-1mg',
    productIds: ['clonidine-er'],
    label: 'Clonidine ADHD ER tablet 0.1 mg adult reference',
    referenceDoseMg: 0.1, unit: 'tablet', strengthUnit: 'mg',
    channels: [{ group: 'Clonidine', cmax: 0.258, peakHours: 6.5, halfLifeHours: 12.65 }],
    sourceIds: ['C21'],
    population: 'Healthy adults in a three-period crossover; single 0.1 mg clonidine HCl ADHD ER tablet, fasted, N=14 for this arm.',
    note: 'Table 7 reports Cmax 258 pg/mL and AUC 6729 pg·h/mL, converted to 0.258 ng/mL and 6.729 ng·h/mL. The reference dose remains 0.1 mg hydrochloride, not 0.087 mg base. The fitted absorption curve is estimated; its AUC is about 0.1% below the reported mean. Other-dose scaling is not a validated adult dose-proportionality claim. Renal function and interactions are not personalized. Do not borrow this profile for immediate-release clonidine, patches or Onyda XR suspension.',
  },
  {
    id: 'viloxazine-er-adult-fasted-200mg',
    productIds: ['qelbree'],
    label: 'Viloxazine ER 200 mg adult reference',
    referenceDoseMg: 200, unit: 'capsule', strengthUnit: 'mg',
    channels: [{ group: 'Viloxazine', cmax: 1330, peakHours: 5, halfLifeHours: 7.02 }],
    sourceIds: ['N3', 'S11'],
    population: 'Study 812P103 healthy adults, fasted; single 200 mg SPN-812 ER on day 1, N=28 (AUC∞ and half-life N=27).',
    note: 'FDA Table 139 reports 1.33 µg/mL, converted to 1330 ng/mL; median Tmax is 5 hours and half-life 7.02 hours. Dose is 200 mg viloxazine base, not 231 mg HCl. These are single-dose results, not the subsequent steady-state tables. The fitted shape is a coarse estimate: modeled AUC is about 19.2% below the reported 27300 ng·h/mL; no sampled trace or early partial AUC was fitted. The label reports dose proportionality over 100–600 mg, but individual scaling, food, interactions and renal function are not personalized.',
  },
];
