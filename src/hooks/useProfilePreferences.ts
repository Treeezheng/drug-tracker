import { useEffect, useMemo, useSyncExternalStore } from 'react';
import type { Profile } from '../lib/types';
import { createProfilePreferences } from '../lib/profile-preferences';

export function useProfilePreferences(profile:Profile,scope:string,onSave:(profile:Profile)=>Promise<Profile>){
  // Each owner gets its own queue; queued callbacks retain their original owner.
  const controller=useMemo(()=>createProfilePreferences(profile),[scope]);
  useEffect(()=>controller.sync(profile),[controller,profile]);
  const state=useSyncExternalStore(controller.subscribe,controller.snapshot,controller.snapshot);
  return {...state,edit:controller.edit,
    apply:(patch:Partial<Profile>)=>{void controller.apply(patch,onSave).catch(()=>{});},
    save:()=>{void controller.save(onSave).catch(()=>{});},
  };
}
