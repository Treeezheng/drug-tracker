import { MPH_PK_REFERENCES } from './pk-reference-mph';
import { AMPHETAMINE_PK_REFERENCES } from './pk-reference-amphetamine';
import { COMMON_MPH_PK_REFERENCES } from './pk-reference-common-mph';
import { NONSTIMULANT_PK_REFERENCES } from './pk-reference-nonstimulants';
import { AZSTARYS_PK_REFERENCE } from './pk-reference-azstarys';
import { COMMON_STIMULANT_PK_REFERENCES } from './pk-reference-common-stimulants';
import type { PkReferenceChannel } from './pk-reference-types';

export const PK_REFERENCES = [...MPH_PK_REFERENCES,...AMPHETAMINE_PK_REFERENCES,...COMMON_MPH_PK_REFERENCES,...NONSTIMULANT_PK_REFERENCES,...COMMON_STIMULANT_PK_REFERENCES,AZSTARYS_PK_REFERENCE];
const byProduct = new Map(PK_REFERENCES.flatMap(profile=>profile.productIds.map(id=>[id,profile] as const)));
export const pkProfileForProduct = (id:string)=>byProduct.get(id);

/** Fit absorption to a reported peak time while retaining the reported terminal rate. */
function absorptionRate(peakHours:number,halfLifeHours:number):number {
  const ke=Math.LN2/halfLifeHours;
  let lo=ke*(1+1e-7),hi=Math.max(1,ke*2);
  const peak=(ka:number)=>Math.log(ka/ke)/(ka-ke);
  while(peak(hi)>peakHours)hi*=2;
  for(let i=0;i<70;i++){const mid=(lo+hi)/2;if(peak(mid)>peakHours)lo=mid;else hi=mid;}
  return (lo+hi)/2;
}

const rates = new WeakMap<PkReferenceChannel,number>();
/** Evaluate a source-backed, explicitly estimated reference shape. */
export function evaluatePkReference(channel:PkReferenceChannel,hours:number):number|null {
  if(!Number.isFinite(hours))return null;
  if(hours<0)return 0;
  const points=channel.points;
  if(points?.length){
    const [lastTime,lastValue]=points[points.length-1];
    if(hours>lastTime)return lastValue*Math.exp(-Math.LN2*(hours-lastTime)/channel.halfLifeHours);
    for(let i=1;i<points.length;i++){
      const [t0,c0]=points[i-1],[t1,c1]=points[i];
      if(hours<=t1)return c0+(c1-c0)*(hours-t0)/(t1-t0);
    }
    return null;
  }
  const elapsed=hours-(channel.lagHours??0),peak=channel.peakHours-(channel.lagHours??0);
  if(elapsed<=0)return 0;
  const ke=Math.LN2/channel.halfLifeHours;
  if(!(peak>0&&peak<1/ke))return null;
  let ka=rates.get(channel);
  if(ka===undefined){ka=absorptionRate(peak,channel.halfLifeHours);rates.set(channel,ka);}
  const shape=(time:number)=>Math.exp(-ke*time)*(-Math.expm1(-(ka-ke)*time));
  const value=channel.cmax*shape(elapsed)/shape(peak);
  return Number.isFinite(value)&&value>=0?value:null;
}
