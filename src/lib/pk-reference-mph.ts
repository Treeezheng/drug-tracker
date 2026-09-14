import type { PkReferenceProfile } from './pk-reference-types';

/** Audited label parameters; constructed curves, never measured personal levels.
 * Evidence and remaining graph-digitization work:
 * docs/mph-pk-reference-research-2026-09-14.md (reviewed 2026-09-14).
 * Existing source IDs resolve to the same primary documents reviewed here.
 */
export const MPH_PK_REFERENCES: readonly PkReferenceProfile[] = [
  {
    id: 'ritalin-la-adult-20mg',
    productIds: ['ritalin-la'],
    label: 'Ritalin LA 20 mg adult reference',
    referenceDoseMg: 20,
    unit: 'capsule',
    strengthUnit: 'mg',
    channels: [{
      group: 'Methylphenidate', peakHours: 5.5, cmax: 6.2, halfLifeHours: 3.3, lagHours: 0.7,
      points: [[0, 0], [0.7, 0], [2, 5.3], [3.6, 3], [5.5, 6.2]],
    }],
    sourceIds: ['S3'],
    population: 'Adult men, N=8; single 20 mg Ritalin LA dose, FDA label Table 4.',
    note: 'The two peaks and intervening minimum are population parameter means, not a digitized concentration trace. Zero baseline and a zero until the mean 0.7-hour lag, linear interpolation, and a terminal tail starting at the second peak are modeling assumptions. The label describes 50% immediate and 50% delayed release; its Figure 1 instead studies 40 mg. Other-dose proportional scaling is an unvalidated illustration. Food can alter the second peak.',
  },
  {
    id: 'methylin-solution-20mg',
    productIds: ['methylin-solution'],
    label: 'Methylin oral solution 20 mg reference',
    referenceDoseMg: 20,
    unit: 'mL',
    strengthUnit: 'mg/mL',
    channels: [{ group: 'Methylphenidate', peakHours: 1.5, cmax: 9.1, halfLifeHours: 2.7 }],
    sourceIds: ['C1'],
    population: 'Healthy volunteers, fasted, single 20 mg Methylin solution dose; sample age/count not stated in this label paragraph.',
    note: 'The label reports Cmax 9.1 ng/mL, Tmax 1–2 hours, half-life 2.7 hours and AUC 46.7 ng·h/mL. The modeled 1.5-hour peak is the midpoint of the reported range, not a reported mean. The absorption curve and proportional scaling are unvalidated illustrations. Reference dose is 20 mg HCl, not 20 mL; use the recorded 1 or 2 mg/mL bottle concentration. The label comparison tablet has different parameters.',
  },
  {
    id: 'methylphenidate-chewable-20mg',
    productIds: ['methylphenidate-chewable'],
    label: 'Methylphenidate IR chewable 20 mg reference',
    referenceDoseMg: 20,
    unit: 'tablet',
    strengthUnit: 'mg',
    channels: [{ group: 'Methylphenidate', peakHours: 1.5, cmax: 10, halfLifeHours: 3 }],
    sourceIds: ['C2'],
    population: 'Healthy adult volunteers; 20 mg immediate-release chewable dose, fasted reference.',
    note: 'Cmax is approximately 10 ng/mL; the label gives a 1–2-hour peak range and specifically 1.5 hours fasted in the food study. Half-life is 3 hours. These label summaries do not provide a measured full curve; the constructed absorption curve and other-dose scaling remain unvalidated. Do not substitute extended-release QuilliChew parameters. This profile does not declare every tablet strength divisible.',
  },
  {
    id: 'quillivant-xr-adult-fasted-60mg',
    productIds: ['quillivant-xr'],
    label: 'Quillivant XR 60 mg adult reference',
    referenceDoseMg: 60,
    unit: 'mL',
    strengthUnit: 'mg/mL',
    channels: [{
      group: 'd-Methylphenidate', peakHours: 5, cmax: 13.6, halfLifeHours: 5.6,
      points: [[0, 0], [5, 13.6]],
    }],
    sourceIds: ['C6'],
    population: '28 healthy adults, fasted, single 60 mg HCl-equivalent dose (12 mL of reconstituted 5 mg/mL suspension).',
    note: 'The measured analyte is d-methylphenidate: Cmax 13.6±5.8 ng/mL, median Tmax 5 hours, terminal half-life 5.6±0.8 hours. The curve uses an assumed zero baseline, a linear rise to the summary peak and an estimated terminal tail; it is not a digitization of Figure 2 or the 20%/80% release process. Other-dose scaling is unvalidated. Do not mix these fasted parameters with the separate fed table or sum this analyte as total racemic methylphenidate.',
  },
  {
    id: 'cotempla-xr-odt-adult-fasted-51-8mg',
    productIds: ['cotempla-xr-odt'],
    label: 'Cotempla XR-ODT 51.8 mg adult reference',
    referenceDoseMg: 51.8,
    unit: 'tablet',
    strengthUnit: 'mg',
    channels: [{
      group: 'd-Methylphenidate', peakHours: 4.98, cmax: 20.8, halfLifeHours: 4,
      points: [[0, 0], [4.98, 20.8]],
    }],
    sourceIds: ['C8'],
    population: '38 healthy adults, fasted, single 51.8 mg methylphenidate-base dose (two 25.9 mg ODTs), Table 2.',
    note: 'Table 2 measures d-methylphenidate: Cmax 20.8±5.22 ng/mL, median Tmax 4.98 hours, half-life 4.00±0.73 hours and AUC 169.1±57.13 ng·h/mL. The curve is an assumed zero baseline, linear rise and estimated terminal tail, not the observed Figure 2 trace or a release-rate reconstruction. Other-dose proportional scaling is unvalidated. Preserve the methylphenidate-base dose basis; do not read 51.8 mg as HCl or add this analyte to total racemic MPH.',
  },
];
