import type { PkReferenceProfile } from './pk-reference-types';
import type { Source } from './types';

// Figure landmarks are rounded visual reconstructions, not patient observations.
// Mean concentration-curve peaks need not equal the mean of individual Cmax values.
export const COMMON_MPH_PK_REFERENCES: readonly PkReferenceProfile[] = [
  {
    id:'aptensio-xr-fasted-80mg-figure',productIds:['aptensio-xr'],label:'Aptensio XR 80 mg adult figure reference',
    referenceDoseMg:80,unit:'capsule',strengthUnit:'mg',
    channels:[{group:'Methylphenidate',cmax:20.5,peakHours:2,halfLifeHours:5.09,points:[[0,0],[0.25,0.4],[0.5,3.5],[1,15.5],[1.5,20],[2,20.5],[2.5,19.5],[3,17.5],[4,15],[5,13.5],[5.5,13.5],[6,15],[6.5,17.4],[7,18.2],[8,17.3],[9,15.7],[10,14.5],[11,13.3],[12,12.5],[15,9],[19,5.4],[24,2.7]]}],
    sourceIds:['M1'],population:'Healthy adults, single 80 mg intact capsule, fasted; label Figure 1 and Table 2.',
    note:'Rounded reconstruction of the capsule triangle-marker curve, not the sprinkled comparison. Both release peaks remain. Its approximate 20.5 ng/mL mean-curve peak differs from Table 2 mean individual Cmax 23.47 ng/mL; reported AUCinf is 258.1 ng·h/mL. Linear interpolation, the post-24-hour half-life tail and scaling to other labeled doses are estimates. The study dose is a reference, not a dose recommendation; food changes the profile.',
  },
  {
    id:'metadate-cd-fasted-adult-60mg',productIds:['metadate-cd'],label:'Metadate CD 60 mg adult reference',
    referenceDoseMg:60,unit:'capsule',strengthUnit:'mg',
    channels:[{group:'Methylphenidate',cmax:17.4,peakHours:5,halfLifeHours:6,points:[[0,0],[1,7],[2,13.1],[3,12.1],[5,17.4],[8,10],[12,6],[18,1.7],[24,0.8]]}],
    sourceIds:['M2'],population:'38 healthy adults, fasted, single 60 mg Metadate CD comparator in study NT0102.1001, FDA review Table 3.',
    note:'The table measures total d+l methylphenidate: Cmax 17.4 ng/mL, Tmax 5 h, half-life 6 h, AUCinf 170 ng·h/mL; AUC0–3h 25.7, AUC0–Tmax 53.1 and AUCTmax–24h 104.3 ng·h/mL. The displayed two-stage rise and decline are constructed landmarks checked against these exposure summaries, not digitized measured total concentrations. Figure 1 separately shows d-methylphenidate and is not relabeled as total. Scaling other doses is estimated; pediatric repeated-dose parameters are not used as single-dose adult data.',
  },
  {
    id:'jornay-pm-fasted-adult-100mg-figure',productIds:['jornay-pm'],label:'Jornay PM 100 mg adult figure reference',
    referenceDoseMg:100,unit:'capsule',strengthUnit:'mg',
    channels:[{group:'Methylphenidate',cmax:10.1,peakHours:13.5,halfLifeHours:5.9,points:[[0,0],[6,0],[8,1.3],[8.5,2.2],[9,3.3],[10,4.9],[10.5,5.5],[11,6],[11.5,6.7],[12,7.3],[12.5,8],[13.5,10.1],[14,9.9],[15,8.3],[16,7],[17,6.5],[18,5.8],[19,5.2],[20,4.5],[22,3.5],[24,2.8],[36,0.75],[48,0.1]]}],
    sourceIds:['M3'],population:'11 healthy adults, single 100 mg evening dose at 9 pm, label Figure 1.',
    note:'Rounded triangle-marker reconstruction of the delayed-release mean curve; the comparator is 20 mg immediate-release methylphenidate and is not used. The approximate mean-curve maximum is 10.1 ng/mL at 13.5 h; label median individual Tmax is 14 h. The near-zero beginning is graph rounding, not proof of no drug in an individual. Linear interpolation, the post-48-hour half-life tail and dose-proportional scaling are estimates. It is not a morning-release curve or an instruction to take a particular dose/time.',
  },
  {
    id:'quillichew-er-fasted-40mg-figure',productIds:['quillichew-er'],label:'QuilliChew ER 40 mg adult figure reference',
    referenceDoseMg:40,unit:'tablet',strengthUnit:'mg',fractionalStrengths:['20','30'],
    channels:[{group:'Methylphenidate',cmax:11.6,peakHours:5,halfLifeHours:5.2,points:[[0,0],[0.5,1.6],[0.75,4],[1,6],[1.5,7.1],[1.75,7.6],[2,8.1],[2.25,9.3],[2.5,9.9],[3,10.4],[4,10.8],[5,11.6],[6,10],[6.5,9.2],[7,8.5],[7.5,7.8],[8,7.2],[8.5,6.6],[9,6.1],[10,5],[11,4.3],[12,3.8],[14,2.9],[16,2],[24,0.8]]}],
    sourceIds:['M4'],population:'Healthy volunteers, single 40 mg fasted dose, label Figure 2.',
    note:'Rounded solid-circle reconstruction of the 40 mg ER mean curve, not the two-dose IR chewable comparator. Approximate graph peak 11.6 ng/mL at 5 h; terminal half-life 5.2 h. Strength is labeled methylphenidate HCl equivalent. Linear interpolation, the post-24-hour tail and other-dose scaling are estimates. Only labeled 20 and 30 mg scored tablet strengths support half-tablet quantities; the 40 mg tablet is not divided.',
  },
  {
    id:'relexxii-label-er-18mg-reference',productIds:['relexxii'],label:'18 mg ER reference in the Relexxii label',
    referenceDoseMg:18,unit:'tablet',strengthUnit:'mg',
    channels:[{group:'Methylphenidate',cmax:3.6,peakHours:6,halfLifeHours:3.5,points:[[0,0.03],[0.5,0.5],[1,1.95],[1.5,2.15],[2,2.1],[3,2.15],[4,2.35],[6,3.6],[8,3.4],[10,2.8],[12,2.1],[14,1.4],[17,0.8],[20,0.4],[24,0.2],[30,0.05]]}],
    sourceIds:['M5'],population:'36 healthy adults, single 18 mg ER reference reported in Relexxii label Table 7 and Figure 1.',
    note:'This label includes legacy 18 mg ER reference data, not a product-specific Relexxii concentration trace. The displayed rounded Figure 1 circle-marker curve remains a starred reference; the app does not claim formulation interchangeability. Table 7 mean individual Cmax 3.7 ng/mL, Tmax 6.8 h, AUCinf 41.8 ng·h/mL and half-life 3.5 h differ from the approximate mean-curve peak. Linear interpolation, the post-30-hour tail and scaling are estimates; tablets must remain whole.',
  },
];

const source=(id:string,title:string,url:string,section:string,note:string):Source=>({id,title,url,section,note,reviewed:'2026-09-14'});
export const COMMON_MPH_PK_SOURCES:Source[]=[
  source('M1','Aptensio XR — DailyMed adult reference curve','https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=5adedc01-ebf0-11e3-ac10-0800200c9a66','§12.3; Table 2; Figure 1','80 mg fasted intact-capsule reference. Two peaks; total racemic methylphenidate. The graph is rounded visually, with estimated interpolation and terminal tail.'),
  source('M2','Metadate CD comparator — FDA clinical pharmacology review','https://www.fda.gov/media/106977/download','Review p. 5, Table 3, study NT0102.1001','Single 60 mg Metadate CD comparator, 38 fasted adults. Use the reference column for total d+l MPH; the adjacent graph measures d-MPH. Constructed landmarks are checked against total and partial AUC summaries.'),
  source('M3','Jornay PM — DailyMed delayed-release reference','https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=d95dede0-b1ff-4489-8f91-3bbe122852bf','§12.3; Figure 1','100 mg evening adult reference, N=11. Rounded mean-curve reconstruction with delayed absorption; tail uses 5.9 h half-life. Keep separate from the 54 mg pediatric/adult comparison.'),
  source('M4','QuilliChew ER — DailyMed reference curve','https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=defc1205-8e90-4b1e-b862-05e4c35c7364','§§2.2, 11, 12.3; Figure 2','40 mg HCl-equivalent ER mean curve, fasted. Separate from the IR comparator. Only 20 and 30 mg strengths are functionally scored for halves.'),
  source('M5','Relexxii — DailyMed labeled ER reference data','https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=22d5fa47-b5b9-4fd9-980c-4eb88e95ae5d','§12.3; Figure 1; Table 7','The 18 mg ER reference included in the label is not a direct Relexxii trace. Displayed only as a starred reference with unvalidated dose scaling.'),
];
