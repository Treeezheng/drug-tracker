import type { Profile } from './types';
import { parseBackup } from './reports';

type SaveProfile=(profile:Profile)=>Promise<Profile>;
export interface PreferenceState {draft:Profile;saving:boolean;dirty:boolean;saved:boolean;error:string;}
const equal=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
function validated(profile:Profile):Profile {
  return parseBackup(JSON.stringify({format:'dose-timeline-backup',schemaVersion:1,exportedAt:'2026-01-01T00:00:00Z',data:{profile,doses:[],scenarios:[],favorites:[],checkins:[],inventory:[]}})).profile!;
}
/** Save discrete controls serially, while keeping unfinished text separate. */
export function createProfilePreferences(initial:Profile){
  let committed={...initial},state:PreferenceState={draft:{...initial},saving:false,dirty:false,saved:false,error:''};
  let queue:Promise<unknown>=Promise.resolve(),pending=0;
  const listeners=new Set<()=>void>();
  const emit=(patch:Partial<PreferenceState>)=>{
    state={...state,...patch};state.dirty=Object.keys({...committed,...state.draft}).some(key=>key!=='revision'&&!equal(committed[key as keyof Profile],state.draft[key as keyof Profile]));
    for(const listener of listeners)listener();
  };
  function sync(next:Profile){
    const draft={...next};
    for(const key of Object.keys(state.draft) as (keyof Profile)[]){
      if(key!=='revision'&&!equal(state.draft[key],committed[key]))Object.assign(draft,{[key]:state.draft[key]});
    }
    committed={...next};emit({draft});
  }
  function edit(patch:Partial<Profile>){emit({draft:{...state.draft,...patch},error:'',saved:false});}
  function enqueue(patch:Partial<Profile>,save:SaveProfile){
    pending++;emit({saving:true,error:'',saved:false});
    const run=queue.then(async()=>{
      const candidate=validated({...committed,...patch,revision:committed.revision});
      const result=await save(candidate);
      const draft={...state.draft};
      for(const key of Object.keys(candidate) as (keyof Profile)[]){
        if(key==='revision'||equal(draft[key],candidate[key]))Object.assign(draft,{[key]:result[key]});
      }
      committed={...result};emit({draft,saved:true,error:''});
      return result;
    });
    queue=run.catch(cause=>{emit({error:cause instanceof Error?cause.message:'Settings could not be saved. Your changes remain here.',saved:false});}).finally(()=>{pending--;emit({saving:pending>0});});
    return run;
  }
  return {
    snapshot:()=>state,subscribe:(listener:()=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener);};},sync,edit,
    apply(patch:Partial<Profile>,save:SaveProfile){edit(patch);return enqueue(patch,save);},
    save(save:SaveProfile){return enqueue({...state.draft},save);},
  };
}
