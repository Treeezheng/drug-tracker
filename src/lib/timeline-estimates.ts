import { concentrationAnalyte, contributionForGroup, groupedTotals, pkReferenceContribution, referenceOverlay } from './model';
import type { Dose } from './types';

/** Display layer only. Evidence-qualified concentration/groupedTotals stay unchanged. */
export function estimateContribution(dose:Dose,at:number,group:string,publishedOnly=false) {
  const direct=contributionForGroup(dose,at,group,publishedOnly);
  if(!direct)return undefined;
  const reference=pkReferenceContribution(dose,at,group,publishedOnly)
    ??(concentrationAnalyte(dose)?.group===group&&direct.unit==='ng/mL'?referenceOverlay(dose,at,publishedOnly):null);
  return reference
    ?{...direct,value:reference.value,tail:reference.tail,evidence:'D',reason:reference.reason,directValue:direct.value,hasReference:true}
    :{...direct,directValue:direct.value,hasReference:false};
}

/** Sum only compatible analytes/units, with a separate flag for inferred references.
 * `complete` concerns the displayed estimate; `directComplete` retains its narrower
 * evidence meaning. A wholly unsupported contribution stays null, never zero. */
export function estimateTotals(doses:Dose[],at:number,publishedOnly=false) {
  const direct=groupedTotals(doses,at,publishedOnly);
  return Object.fromEntries(Object.entries(direct).map(([group,total])=>{
    const items=total.items.map(item=>({dose:item.dose,...estimateContribution(item.dose,at,group,publishedOnly)!}));
    return [group,{
      ...total,items,
      value:items.reduce((sum,item)=>sum+(item.value??0),0),
      complete:items.every(item=>item.value!==null),
      hasReference:items.some(item=>item.hasReference),
      tail:items.some(item=>item.tail),
      directComplete:total.complete,directValue:total.value,
    }];
  }));
}
