import type { Dose } from './types';
import { estimateContribution } from './timeline-estimates';
import { doseTimestamp, includeTimelineDose, pkReferenceForDose, preparePkReferenceContribution, referenceForDose } from './model';

export const isHistoryDose=(dose:Dose,start:number)=>dose.status==='actual'&&doseTimestamp(dose)<start;

/** View-owned samples: reuse the same evaluated contributions for the total and
 * individual paths. No plaintext records or samples survive in a global cache. */
export function sampleTimelinePanel(members:Dose[],group:string,times:number[],publishedOnly:boolean) {
  const curves=members.map(dose=>({dose,reference:!!referenceForDose(dose)||!!pkReferenceForDose(dose),values:[] as (number|null)[]}));
  const seen=new Set<string>();
  const evaluations=curves.map(curve=>{
    if(seen.has(curve.dose.id)||!includeTimelineDose(curve.dose))return null;
    seen.add(curve.dose.id);
    const prepared=preparePkReferenceContribution(curve.dose,group,publishedOnly);
    return {admin:doseTimestamp(curve.dose),at:(at:number)=>prepared
      ? {...prepared(at),unit:'ng/mL',hasReference:true}
      : estimateContribution(curve.dose,at,group,publishedOnly)};
  });
  let max=0;
  const series=times.map(at=>{
    let value=0,unit='',complete=true,tail=false,hasReference=false,known=false,count=0;
    curves.forEach((curve,i)=>{
      const result=evaluations[i]?.at(at),current=result?.value??null;
      curve.values.push(current);
      if(!result)return;
      count++;unit=result.unit;complete&&=current!==null;tail||=result.tail??false;hasReference||=result.hasReference;
      if(current!==null){
        value+=current;
        known||=evaluations[i]!.admin<=at;
        if(curve.reference)max=Math.max(max,current);
      }
    });
    max=Math.max(max,value);
    complete&&=count>0;
    return {value,unit,known:known||complete,complete,tail,hasReference};
  });
  return {series,curves,max};
}

export function timelinePanelGeometry(samples:ReturnType<typeof sampleTimelinePanel>,times:number[],width:number,height:number,start:number,end:number) {
  const {series,curves,max}=samples,unit=series[0]?.unit??'';
  const smallScale=max>0&&max<1?10**Math.floor(Math.log10(max*1.1)):0;
  const smallCeiling=smallScale?[1,2,5,10].find(step=>step*smallScale>=max*1.1)!*smallScale:0;
  const ceiling=unit==='ng/mL'?(smallCeiling||Math.max(6,Math.ceil(max*1.1/2)*2)):Math.max(2,Math.ceil(max*1.1));
  const x=(t:number)=>40+(t-start)/(end-start)*(width-64);
  const y=(value:number)=>36+(height-74)*(1-value/ceiling);
  const path=(values:(number|null)[])=>{
    let active=false;
    return values.map((value,i)=>{
      if(value===null){active=false;return '';}
      const point=`${active?'L':'M'}${x(times[i]).toFixed(2)},${y(value).toFixed(2)}`;
      active=true;return point;
    }).join(' ');
  };
  const totalPaths={solid:'',estimated:''};
  let previousKind='';
  for(let i=1;i<series.length;i++){
    const before=series[i-1],after=series[i];
    if(!before.known||!after.known){previousKind='';continue;}
    const kind=before.complete&&after.complete&&!before.tail&&!after.tail&&!before.hasReference&&!after.hasReference?'solid':'estimated';
    if(previousKind!==kind)totalPaths[kind]+=` M${x(times[i-1]).toFixed(2)},${y(before.value).toFixed(2)}`;
    totalPaths[kind]+=` L${x(times[i]).toFixed(2)},${y(after.value).toFixed(2)}`;previousKind=kind;
  }
  const earlier=curves.filter(curve=>isHistoryDose(curve.dose,start));
  const historyValues=times.map((_,i)=>{
    const known=earlier.map(curve=>curve.values[i]).filter((value):value is number=>value!==null);
    return known.length?known.reduce((sum,value)=>sum+value,0):null;
  });
  return {ceiling,totalPaths,historyPath:earlier.length?path(historyValues).trim():'',hasCurrent:curves.some(curve=>!isHistoryDose(curve.dose,start)),curves:curves.map(curve=>({...curve,path:path(curve.values)}))};
}
