import { freshGuestWorkspace, parseGuestWorkspace, readGuestWorkspace, type GuestStorage, type GuestWorkspace } from './guest-workspace';
import { readGuestConsent } from './guest-consent';

function canonical(value:unknown):string {
  if(Array.isArray(value))return `[${value.map(canonical).join(',')}]`;
  if(value&&typeof value==='object')return `{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonical((value as Record<string,unknown>)[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
export const sameGuestWorkspace=(left:GuestWorkspace|null,right:GuestWorkspace|null)=>canonical(left)===canonical(right);
/** Parent-held memory may return after sign-out; it never authorizes a storage write. */
export function restoreGuestSession(storage:GuestStorage,initialWorkspace?:GuestWorkspace,initialConsent=false){
  const incoming=initialWorkspace?parseGuestWorkspace(JSON.stringify(initialWorkspace)):null;
  const consented=readGuestConsent(storage),saved=consented?readGuestWorkspace(storage):null;
  if(!incoming)return {workspace:saved??freshGuestWorkspace(),deviceSnapshot:saved,remembered:consented,consented,blocked:false,error:''};
  const same=!!saved&&sameGuestWorkspace(incoming,saved);
  return {workspace:incoming,deviceSnapshot:saved,remembered:consented&&same,consented:initialConsent||consented,blocked:false,
    error:consented&&!same?'Your earlier simulation is restored in memory. The separate device copy is unchanged; automatic device saving is off.':''};
}
