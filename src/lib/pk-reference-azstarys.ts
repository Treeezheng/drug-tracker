import type { PkReferenceProfile } from './pk-reference-types';

export const AZSTARYS_PK_REFERENCE: PkReferenceProfile = {
  id:'azstarys-adult-single-figure-2026-09-14',productIds:['azstarys'],
  label:'Azstarys 52.3/10.4 mg adult figure reference',
  // First labeled ingredient only; packageReference controls all concentration scaling.
  referenceDoseMg:52.3,packageReference:{strength:'52.3/10.4',scales:{'26.1/5.2':.5,'39.2/7.8':.75,'52.3/10.4':1}},
  unit:'capsule',strengthUnit:'mg',sourceIds:['S8'],
  population:'Healthy adults, a single 52.3 mg serdexmethylphenidate / 10.4 mg dexmethylphenidate capsule, fasted',
  channels:[{group:'d-Methylphenidate',cmax:12.3,peakHours:2,halfLifeHours:11.7,points:[
    [0,0],[.5,.6],[1,7.8],[1.5,12.2],[2,12.3],[3,11.1],[4,9],[5,8],[6,7.6],[7,7.5],
    [8,7.1],[10,5.8],[12,5.2],[13,5.1],[16,4],[24,3],[36,1.4],[48,.5],[60,.1],[72,.03],
  ]}],
  note:'Rounded reconstruction of the solid-circle mean curve in label Figure 1. Its approximate peak of 12.3 ng/mL is distinct from mean individual Cmax 14.0 ng/mL. Linear interpolation and terminal continuation are estimates. The three labeled combination packages scale by 0.5, 0.75 or 1 per intact capsule. A single d-methylphenidate channel represents the complete combination; the prodrug is not counted again or added by mass. No steady-state multiplier, pediatric adjustment or interchangeability with another formulation is implied.',
};
