import type { PkReferenceProfile } from './pk-reference-types';

/** Product-specific adult references; every curve remains a starred construction.
 * Source parameters, fitted quantities and independent AUC checks are recorded in
 * docs/common-stimulant-pk-research-2026-09-14.md.
 */
export const COMMON_STIMULANT_PK_REFERENCES: readonly PkReferenceProfile[] = [
  {
    id: 'focalin-ir-adult-fasted-20mg',
    productIds: ['focalin', 'dexmethylphenidate-ir'],
    label: 'Focalin IR 20 mg adult reference',
    referenceDoseMg: 20,
    unit: 'tablet',
    strengthUnit: 'mg',
    channels: [{
      group: 'd-Methylphenidate', peakHours: 1.5, cmax: 23.7,
      halfLifeHours: 2.7, lagHours: 0.44935035,
    }],
    sourceIds: ['F1', 'F2'],
    population: '15 healthy adults, fasted; two 10 mg dexmethylphenidate HCl IR tablets as one dose, study PK-00-001.',
    fractionalTablets: true,
    note: 'Cmax 23.7 ng/mL, Tmax 1.5 h and half-life 2.7 h come from the same fasting study, not the label\'s pooled 2.2 h summary. The 0.44935 h lag is fitted, not measured, so the constructed curve has AUC 120.9 ng·h/mL. At a proportionally scaled 10 mg, its AUC0–4 is 33.21 versus 32.5 in the separate adult Focalin IR study 2101. The curve, other-dose scaling, half-tablet quantities and application to unspecified generic manufacturers remain unvalidated illustrations. Dose is labeled HCl, not racemic methylphenidate or free base.',
  },
  {
    id: 'focalin-xr-adult-fasted-20mg',
    productIds: ['focalin-xr', 'dexmethylphenidate-er'],
    label: 'Focalin XR 20 mg adult reference',
    referenceDoseMg: 20,
    unit: 'capsule',
    strengthUnit: 'mg',
    channels: [{
      group: 'd-Methylphenidate', peakHours: 6.5, cmax: 14.9, halfLifeHours: 3.26,
      points: [
        [0, 0], [0.5, 1], [1, 10.7], [1.5, 13.5], [2, 12.6], [3, 9.5],
        [4, 7.6], [6.5, 14.9], [8, 9.6], [10, 5], [12, 3], [16, 1], [20, 0.65], [24, 0.2],
      ],
    }],
    sourceIds: ['F2'],
    population: '24 healthy adults, fasted, one 20 mg dexmethylphenidate HCl XR capsule; study 2101.',
    note: 'This hybrid construction uses FDA Table 19 mean first peak 13.5 at 1.5 h, interpeak minimum 7.6 at 4 h, and second peak 14.9 at 6.5 h, with rough Figure 3 rise/decline anchors, linear interpolation and an estimated tail after 24 h. It is not a measured mean trace: the mean of individual peaks differs from the peak of a mean curve. AUC0–4/4–10/total are 35.35/61.10/118.39 versus Table 20 values 36.3/59.1/119.1 ng·h/mL. Other-dose and unspecified generic-manufacturer scaling remain illustrations; intact capsule quantities only.',
  },
  {
    id: 'dyanavel-xr-tablet-adult-fasted-20mg',
    productIds: ['dyanavel-xr-tablet'],
    label: 'Dyanavel XR tablet 20 mg adult reference',
    referenceDoseMg: 20,
    unit: 'tablet',
    strengthUnit: 'mg',
    channels: [
      {
        group: 'd-Amphetamine', peakHours: 5, cmax: 53.4, halfLifeHours: 13.5,
        points: [[0, 0], [2, 38.36], [5, 53.4]],
      },
      {
        group: 'l-Amphetamine', peakHours: 5, cmax: 17.2, halfLifeHours: 17.3,
        points: [[0, 0], [2, 11.68], [5, 17.2]],
      },
    ],
    sourceIds: ['F3', 'F4'],
    population: '32 healthy adult pharmacokinetic participants, fasted, one 20 mg amphetamine-base XR tablet swallowed whole.',
    note: 'FDA Table 4 reports separate d/l Cmax 53.4/17.2 ng/mL, median Tmax 5/5 h, AUC0–5 176/55 and AUCinf 1215/481 ng·h/mL. Terminal half-lives 13.5/17.3 h are the tablet label summaries. The two-hour points are constructed to match early AUC, not measured concentrations; subsequent exponential tails give total AUC about 1216/484. This is not a digitized release curve. Chewed tablets were separately bioequivalent, with somewhat different means. Other-dose scaling remains illustrative; no divided ER tablet or suspension substitution in this profile. Dose is amphetamine base, not salt mass; d/l are never summed.',
  },
  {
    id: 'mydayis-adult-fasted-37-5mg',
    productIds: ['mydayis'],
    label: 'Mydayis 37.5 mg adult reference',
    referenceDoseMg: 37.5,
    unit: 'capsule',
    strengthUnit: 'mg',
    channels: [
      {
        group: 'd-Amphetamine', peakHours: 8.2, cmax: 50.3, halfLifeHours: 10.1,
        points: [
          [0, 0], [1, 11.5], [2, 24.2], [3, 31.2], [4, 35.5], [5, 42], [6, 44.8],
          [7, 47.7], [8.2, 50.3], [9, 46.8], [10, 44.5], [12, 40.8], [14, 36],
          [16, 31.3], [24, 18.4], [36, 9.2], [48, 3.8], [60, 1.7],
        ],
      },
      {
        group: 'l-Amphetamine', peakHours: 8.4, cmax: 14.7, halfLifeHours: 12.5,
        points: [
          [0, 0], [1, 3], [2, 6.7], [3, 8.8], [4, 9.9], [5, 11.8], [6, 12.5],
          [7, 13.8], [8.4, 14.7], [9, 13.7], [10, 13.5], [12, 12.6], [14, 11.5],
          [16, 10.3], [24, 6.7], [36, 3.8], [48, 1.8], [60, 1],
        ],
      },
    ],
    sourceIds: ['F5', 'F6'],
    population: '20 healthy adults aged 19–52, single fasted 37.5 mg Mydayis mixed-amphetamine-salt capsule.',
    note: 'Separate d/l arithmetic-mean peaks 50.3/14.7 ng/mL at mean 8.2/8.4 h and half-lives 10.1/12.5 h come from the FDA adult table. This hybrid construction inserts those summary peaks among approximate label Figure 1 Mydayis circle-marker readings; it is not an exact mean trace or the comparator two-dose regimen. Linear interpolation plus a tail after 60 h yields AUC 1085.9/373.1 versus reported 1085/373 ng·h/mL. Early Figure 1 anchors preserve the gradual rise. Other-dose scaling remains illustrative; intact capsules only, labeled total salt mg, and d/l are never added.',
  },
  {
    id: 'evekeo-ir-adult-fasted-20mg',
    productIds: ['evekeo'],
    label: 'Evekeo IR 20 mg adult reference',
    referenceDoseMg: 20,
    unit: 'tablet',
    strengthUnit: 'mg',
    fractionalTablets: true,
    channels: [
      {
        group: 'd-Amphetamine', peakHours: 2.51, cmax: 29.4, halfLifeHours: 10.1,
        points: [
          [0, 0], [0.25, 0], [0.5, 4], [1, 18], [1.5, 25], [2, 28], [2.51, 29.4],
          [3, 28.4], [4, 27.5], [5, 26], [6, 24.5], [8, 21], [10, 18], [12, 15.8],
          [16, 12.2], [24, 6.8], [36, 3.2], [48, 1.35], [60, 0.5],
        ],
      },
      {
        group: 'l-Amphetamine', peakHours: 2.72, cmax: 24.8, halfLifeHours: 11.6,
        points: [
          [0, 0], [0.25, 0], [0.5, 3], [1, 15], [1.5, 21], [2, 23], [2.72, 24.8],
          [4, 23], [6, 21], [8, 18.5], [10, 16.7], [12, 15], [16, 12.3],
          [24, 7.2], [36, 4], [48, 1.8], [60, 0.93],
        ],
      },
    ],
    sourceIds: ['F7'],
    population: '39 healthy adults, fasted; two 10 mg amphetamine sulfate IR tablets swallowed with water, study AR17.001 treatment C.',
    note: 'The source measures d/l separately: Cmax 29.4/24.8 ng/mL, mean Tmax 2.51/2.72 h, half-life 10.1/11.6 h and AUCinf 493/488 ng·h/mL. The construction combines these summary peaks with coarse formulation-specific Figure 1/2 rise and decline readings, an assumed initial baseline, interpolation and a post-60-hour tail. Calculated AUC is 494.7/489.6. The early rise is graph-derived, not an Adderall curve. Other-dose/half-tablet scaling is illustrative. Dose is total labeled racemic sulfate salt; its 1:1 composition is not an instruction to add the d/l curves.',
  },
  {
    id: 'evekeo-odt-adult-fasted-20mg',
    productIds: ['evekeo-odt'],
    label: 'Evekeo ODT 20 mg adult reference',
    referenceDoseMg: 20,
    unit: 'tablet',
    strengthUnit: 'mg',
    channels: [
      {
        group: 'd-Amphetamine', peakHours: 3.28, cmax: 29.4, halfLifeHours: 10,
        points: [
          [0, 0], [0.5, 0.5], [1, 9], [1.5, 18], [2, 24], [2.5, 27.5], [3.28, 29.4],
          [4, 28], [5, 26.8], [6, 25.3], [8, 22], [10, 19], [12, 16.5],
          [16, 12.5], [24, 7.4], [36, 3.4], [48, 1.4], [60, 0.5],
        ],
      },
      {
        group: 'l-Amphetamine', peakHours: 3.45, cmax: 24.8, halfLifeHours: 11.8,
        points: [
          [0, 0], [0.5, 0.5], [1, 7], [1.5, 15], [2, 20], [2.5, 22.5], [3.45, 24.8],
          [4, 24], [6, 21.7], [8, 20], [10, 17.5], [12, 15.8],
          [16, 12.5], [24, 8], [36, 4.2], [48, 1.9], [60, 1.05],
        ],
      },
    ],
    sourceIds: ['F7'],
    population: '40 healthy adults, fasted; one 20 mg amphetamine sulfate ODT dissolved orally without water, study AR17.001 treatment B.',
    note: 'This ODT reference keeps its own slower early rise: d/l mean Tmax 3.28/3.45 h, Cmax 29.4/24.8 ng/mL, half-life 10/11.8 h and AUCinf 506/505 ng·h/mL. Summary peaks are combined with coarse Figure 1/2 treatment-B readings, interpolation and post-60-hour tails; calculated AUC is 502.5/504.9. It is a constructed reference, not a measured mean trace. Water and food conditions differ. Other-dose scaling is illustrative; whole ODT quantities only and labeled total sulfate salt, with d/l shown separately.',
  },
  {
    id: 'dyanavel-xr-suspension-adult-fasted-18-75mg',
    productIds: ['dyanavel-xr-liquid'],
    label: 'Dyanavel XR suspension 7.5 mL adult reference',
    referenceDoseMg: 18.75,
    unit: 'mL',
    strengthUnit: 'mg/mL',
    channels: [
      {
        group: 'd-Amphetamine', peakHours: 4, cmax: 54.128, halfLifeHours: 12.36,
        points: [
          [0, 0], [1, 21.77], [2, 44.56], [3, 51.23], [4, 54.128], [5, 51.51],
          [6, 49.72], [7, 47.96], [8, 45.49], [9, 43.56], [10, 41.77],
          [12, 36.77], [14, 33.22], [16, 30.18], [24, 18.56], [36, 10.42], [48, 4.9], [60, 3],
        ],
      },
      {
        group: 'l-Amphetamine', peakHours: 4, cmax: 17.286, halfLifeHours: 15.12,
        points: [
          [0, 0], [1, 6.7], [2, 14], [3, 16.2], [4, 17.286], [5, 16.7], [6, 16.4],
          [7, 16.1], [8, 15.2], [9, 14.6], [10, 14.3], [12, 12.9],
          [14, 12], [16, 11.1], [24, 7.4], [36, 4.6], [48, 2.4], [60, 1.7],
        ],
      },
    ],
    sourceIds: ['F8'],
    population: '29 healthy adults, fasted, 7.5 mL of 2.5 mg/mL amphetamine-base suspension, study 2014-3401 treatment A.',
    note: 'The administered 7.5 mL is 18.75 mg by labeled concentration, rounded to 18.8 mg in the FDA review. It is not the 20 mg/8 mL bottle-concentration description. Separate d/l Cmax 54.128/17.286, median Tmax 4/4 h, half-life 12.36/15.12 h and AUCinf 1197.321/461.544 come from the fasting arm. Summary peaks and coarse formulation-specific early/tail anchors form an interpolated construction, not a measured trace. AUC0–4/0–5/total are 144.62/197.44/1204.40 for d and 45.54/62.54/465.22 for l, within about 2% of source values. Other-dose scaling remains illustrative; d/l stay separate.',
  },
];
