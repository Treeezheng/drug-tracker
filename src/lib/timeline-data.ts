import { concentration, contributionForGroup, doseTimestamp, groupedTotals, includeTimelineDose } from './model';
import type { Dose } from './types';

export type TimelineTotal = ReturnType<typeof groupedTotals>[string] | undefined;

/** A future dose's known zero cannot make an already-unknown total appear known. */
export function hasKnownTotal(total:TimelineTotal,at:number):boolean {
  return !!total&&(total.complete||total.items.some(item=>item.value!==null&&Date.parse(item.dose.administeredAt)<=at));
}

export function timelineReading(total:TimelineTotal,at:number,digits=2):string {
  return hasKnownTotal(total,at)?`${total!.value.toFixed(digits)}${total!.complete?'':'*'}`:'—';
}

/**
 * Mark only missing contributions that overlap this view. The implemented
 * profiles are unavailable from administration or beyond their observed end;
 * checking both limits also catches gaps shorter than a plotted sample interval.
 */
export function hasMissingTimelineData(doses:readonly Dose[],start:number,end:number,publishedOnly:boolean,group?:string):boolean {
  if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start)return false;
  const seen=new Set<string>();
  for(const dose of doses){
    const admin=doseTimestamp(dose);
    if(!includeTimelineDose(dose)||seen.has(dose.id))continue;
    seen.add(dose.id);
    if(admin>=end)continue;
    const valueAt=(at:number)=>group===undefined?concentration(dose,at,publishedOnly):contributionForGroup(dose,at,group,publishedOnly);
    if(valueAt(Number.isFinite(admin)?Math.max(start,admin):start)?.value===null||valueAt(end)?.value===null)return true;
  }
  return false;
}
