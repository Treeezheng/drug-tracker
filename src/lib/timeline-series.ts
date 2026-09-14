import type { Dose } from './types';
import { estimateTotals } from './timeline-estimates';
import { hasKnownTotal } from './timeline-data';
import { referenceForDose } from './model';

/** View-owned samples: reuse the same evaluated contributions for the total and
 * individual paths. No plaintext records or samples survive in a global cache. */
export function sampleTimelinePanel(members:Dose[],group:string,times:number[],publishedOnly:boolean) {
  const curves=members.map(dose=>({dose,reference:!!referenceForDose(dose),values:[] as (number|null)[]}));
  let max=1;
  const series=times.map(at=>{
    const total=estimateTotals(members,at,publishedOnly)[group];
    const items=new Map(total?.items.map(item=>[item.dose,item]));
    for(const curve of curves){
      const value=items.get(curve.dose)?.value??null;
      curve.values.push(value);
      if(curve.reference&&value!==null)max=Math.max(max,value);
    }
    max=Math.max(max,total?.value??0);
    // Keep only plotting metadata, rather than retaining every record's model
    // result 289 times. Unknown/partial totals retain the existing semantics.
    return {value:total?.value??0,unit:total?.unit??'',known:hasKnownTotal(total,at),
      complete:total?.complete??false,tail:total?.tail??false,hasReference:total?.hasReference??false};
  });
  return {series,curves,max};
}

export function timelinePanelGeometry(samples:ReturnType<typeof sampleTimelinePanel>,times:number[],width:number,height:number,start:number,end:number) {
  const {series,curves,max}=samples,unit=series[0]?.unit??'';
  const ceiling=unit==='ng/mL'?Math.max(6,Math.ceil(max*1.1/2)*2):Math.max(2,Math.ceil(max*1.1));
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
  return {ceiling,totalPaths,curves:curves.map(curve=>({...curve,path:path(curve.values)}))};
}
