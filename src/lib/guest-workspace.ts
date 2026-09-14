import type { Dose, Favorite, Profile } from './types';
import { addDays, dayWindow, todayInZone } from './time';
import { parseBackup } from './reports';

export const GUEST_STORAGE_KEY='drug-tracker:guest-simulation:v1';
export interface GuestWorkspace { format:'drug-tracker-guest'; version:1; profile:Profile; drafts:Dose[]; favorites:Favorite[]; date:string; days:1|2|3; publishedOnly:boolean; }
export interface GuestStorage { getItem(key:string):string|null; setItem(key:string,value:string):void; removeItem(key:string):void; }
const maximumBytes=500_000;
const doseFields=['id','productId','productName','formulation','strength','packageStrength','strengthUnit','manufacturer','amountBasis','quantity','unit','amountMg','administeredAt','timeZone','status','note','date','time','disambiguation','assumptions','modelVersion','unusual','removalAt','ingredients'];
function record(value:unknown,fields:readonly string[]):Record<string,unknown>{
  if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value))||Object.keys(value).some(key=>!fields.includes(key)))throw new Error('Unsupported guest simulation data.');
  return value as Record<string,unknown>;
}
function text(value:unknown,max:number,empty=true):asserts value is string {if(typeof value!=='string'||value.length>max||(!empty&&!value))throw new Error('Invalid guest simulation text.');}
function id(value:unknown){if(typeof value!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(value))throw new Error('Invalid guest item ID.');}
function clock(value:unknown){if(value!==''&&(typeof value!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)))throw new Error('Invalid simulation time.');}
export function validGuestDate(value:string):boolean {try{return /^\d{4}-\d{2}-\d{2}$/.test(value)&&value>='0001-01-01'&&value<='9998-12-31'&&addDays(value,0)===value;}catch{return false;}}
export function guestDayWindow(date:string,days:number,zone:string):{start:number;end:number} {
  if(!validGuestDate(date)||![1,2,3].includes(days))throw new Error('Invalid guest chart view.');
  for(let day=0;day<days;day++)dayWindow(addDays(date,day),1,zone);
  return dayWindow(date,days,zone);
}
export function freshGuestWorkspace(zone=Intl.DateTimeFormat().resolvedOptions().timeZone):GuestWorkspace {
  return {format:'drug-tracker-guest',version:1,profile:{name:'',timeZone:zone,timeFormat:'12h',timeIncrementMinutes:5,sleepEnabled:false,bedtime:'23:00',wakeTime:'07:00',weekendEnabled:false,weekendBedtime:'23:00',weekendWakeTime:'07:00'},drafts:[],favorites:[],date:todayInZone(zone),days:1,publishedOnly:false};
}
function validateDraft(value:unknown):Dose {
  const d=record(value,doseFields);id(d.id);
  if(d.status!=='simulated')throw new Error('Only simulated doses belong in guest storage.');
  if(d.productId!=='')id(d.productId);
  for(const field of ['productName','formulation','unit','strength','quantity','amountMg','note','timeZone'])text(d[field],field==='note'?8000:field==='timeZone'?80:240);
  for(const field of ['packageStrength','strengthUnit','manufacturer','modelVersion'])if(d[field]!==undefined)text(d[field],field==='manufacturer'?240:100);
  new Intl.DateTimeFormat('en',{timeZone:d.timeZone as string});
  for(const field of ['administeredAt','removalAt'])if(d[field]!==undefined){text(d[field],60);if(d[field]!==''&&!Number.isFinite(Date.parse(d[field] as string)))throw new Error('Invalid simulation instant.');}
  if(d.administeredAt===undefined)throw new Error('Missing simulation instant.');
  if(d.date!==undefined&&d.date!==''&&(typeof d.date!=='string'||!validGuestDate(d.date)))throw new Error('Invalid simulation date.');
  if(d.time!==undefined)clock(d.time);
  if(d.unusual!==undefined&&typeof d.unusual!=='boolean')throw new Error('Invalid simulation flag.');
  if(d.disambiguation!==undefined&&!['earlier','later'].includes(String(d.disambiguation)))throw new Error('Invalid clock occurrence.');
  if(d.amountBasis!==undefined&&!['labeled ingredient','first listed ingredient','labeled delivery over 9 hours'].includes(String(d.amountBasis)))throw new Error('Invalid package basis.');
  if(d.ingredients!==undefined){
    if(!Array.isArray(d.ingredients)||d.ingredients.length>10)throw new Error('Invalid simulation ingredients.');
    for(const value of d.ingredients){const item=record(value,['name','amountMg','strengthMg','unit']);text(item.name,240);text(item.amountMg,100);if(item.strengthMg!==undefined)text(item.strengthMg,100);if(item.unit!==undefined)text(item.unit,40);}
  }
  if(d.assumptions!==undefined){
    const a=record(d.assumptions,['peakHours','halfLifeHours','lagHours','referenceDose','amplitude','onsetHours','durationMinHours','durationMaxHours','durationOrigin','accepted']);
    for(const field of ['peakHours','halfLifeHours','lagHours','referenceDose','amplitude','onsetHours','durationMinHours','durationMaxHours'])if(typeof a[field]!=='number'||!Number.isFinite(a[field])||Math.abs(a[field] as number)>100_000)throw new Error('Invalid simulation assumption.');
    if(typeof a.accepted!=='boolean'||!['from_onset','from_administration'].includes(String(a.durationOrigin)))throw new Error('Invalid simulation assumption.');
  }
  return structuredClone(d) as unknown as Dose;
}
/** No account IDs, history, symptoms, supply, credentials or sync operations are accepted. */
export function parseGuestWorkspace(source:string):GuestWorkspace {
  if(typeof source!=='string'||source.length>maximumBytes||new TextEncoder().encode(source).length>maximumBytes)throw new Error('Guest simulation is too large.');
  const root=record(JSON.parse(source),['format','version','profile','drafts','favorites','date','days','publishedOnly']);
  if(root.format!=='drug-tracker-guest'||root.version!==1)throw new Error('Unsupported guest simulation version.');
  const profile=record(root.profile,['name','timeZone','timeFormat','timeIncrementMinutes','sleepEnabled','bedtime','wakeTime','weekendEnabled','weekendBedtime','weekendWakeTime']);
  if(profile.name!=='')throw new Error('Guest simulation does not store a personal profile name.');
  if(!Array.isArray(root.favorites)||root.favorites.length>200||!Array.isArray(root.drafts)||root.drafts.length>100)throw new Error('Too many guest simulation items.');
  for(const item of root.favorites)record(item,['id','productId','strength','packageStrength','quantity']);
  const checked=parseBackup(JSON.stringify({format:'dose-timeline-backup',schemaVersion:1,exportedAt:'2026-01-01T00:00:00Z',data:{profile,doses:[],scenarios:[],favorites:root.favorites,checkins:[],inventory:[]}}));
  const drafts=root.drafts.map(validateDraft);
  if(new Set(drafts.map(d=>d.id)).size!==drafts.length)throw new Error('Duplicate guest dose IDs.');
  if(typeof root.date!=='string'||!validGuestDate(root.date)||![1,2,3].includes(Number(root.days))||typeof root.days!=='number'||typeof root.publishedOnly!=='boolean')throw new Error('Invalid guest chart view.');
  guestDayWindow(root.date,root.days,checked.profile!.timeZone);
  return {format:'drug-tracker-guest',version:1,profile:checked.profile!,drafts,favorites:checked.favorites,date:root.date,days:root.days as 1|2|3,publishedOnly:root.publishedOnly};
}
export function saveGuestWorkspace(storage:GuestStorage,workspace:GuestWorkspace):void {
  const serialized=JSON.stringify(workspace);
  const checked=parseGuestWorkspace(serialized);
  storage.setItem(GUEST_STORAGE_KEY,JSON.stringify(checked));
}
export function readGuestWorkspace(storage:GuestStorage):GuestWorkspace|null {
  const value=storage.getItem(GUEST_STORAGE_KEY);return value===null?null:parseGuestWorkspace(value);
}
export function clearGuestWorkspace(storage:GuestStorage):void {storage.removeItem(GUEST_STORAGE_KEY);}
