import { useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Clock3 } from 'lucide-react';

export interface MobileTimePickerProps {
  value:string;
  minuteStep:5|10;
  timeFormat:'12h'|'24h';
  label:string;
  invalid?:boolean;
  describedBy?:string;
  onChange:(time:string)=>void;
  onNow:()=>void;
}
const pad=(value:number)=>String(value).padStart(2,'0');
function parseTime(value:string){
  if(!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value))return null;
  const [hour,minute]=value.split(':').map(Number);
  return {hour,minute};
}
export function minuteChoices(step:5|10,original:number|null):number[]{
  const values=Array.from({length:60/step},(_,index)=>index*step);
  if(original!==null&&Number.isInteger(original)&&original>=0&&original<60&&!values.includes(original))values.push(original);
  return values.sort((a,b)=>a-b);
}
export function timePickerLabel(value:string,format:'12h'|'24h'):string{
  const time=parseTime(value);
  if(!time)return 'Set time';
  return format==='24h'?`${pad(time.hour)}:${pad(time.minute)}`:`${time.hour%12||12}:${pad(time.minute)} ${time.hour<12?'AM':'PM'}`;
}
/** Read the nearest rendered row, including an in-progress inertial scroll. */
export function nearestWheelIndex(element:HTMLElement|null,fallback=0):number{
  if(!element||!element.clientHeight)return fallback;
  const center=element.getBoundingClientRect().top+element.clientTop+element.clientHeight/2;
  let nearest=fallback,distance=Infinity;
  for(const row of element.querySelectorAll<HTMLElement>('[data-wheel-index]')){
    const rect=row.getBoundingClientRect(),delta=Math.abs(rect.top+rect.height/2-center);
    if(delta<distance){distance=delta;nearest=Number(row.dataset.wheelIndex);}
  }
  return nearest;
}
function positionWheel(element:HTMLElement|null,index:number){
  const row=element?.querySelector<HTMLElement>(`[data-wheel-index="${index}"]`);
  if(!element||!row)return;
  const center=element.getBoundingClientRect().top+element.clientTop+element.clientHeight/2;
  const rect=row.getBoundingClientRect();
  // Instant movement also stops an old smooth/snap destination before Done commits.
  element.scrollTo({top:element.scrollTop+rect.top+rect.height/2-center,behavior:'instant'});
}

export default function MobileTimePicker({value,minuteStep,timeFormat,label,invalid,describedBy,onChange,onNow}:MobileTimePickerProps){
  const id=useId(),dialog=useRef<HTMLDialogElement>(null),trigger=useRef<HTMLButtonElement>(null);
  const hours=useRef<HTMLDivElement>(null),minutes=useRef<HTMLDivElement>(null);
  const [open,setOpen]=useState(false),[draft,setDraft]=useState({hour:0,minute:0}),[originalMinute,setOriginalMinute]=useState<number|null>(null);
  const minuteValues=useMemo(()=>minuteChoices(minuteStep,originalMinute),[minuteStep,originalMinute]);
  const hourLabel=(hour:number)=>timeFormat==='24h'?pad(hour):`${hour%12||12} ${hour<12?'AM':'PM'}`;
  function dismiss(){dialog.current?.close();setOpen(false);trigger.current?.focus({preventScroll:true});}
  function show(){
    const time=parseTime(value);
    setDraft(time||{hour:0,minute:0});setOriginalMinute(time?.minute??null);setOpen(true);
  }
  useLayoutEffect(()=>{
    if(!open)return;
    const sheet=dialog.current;
    if(!sheet)return;
    if(!sheet.open)sheet.showModal();
    positionWheel(hours.current,draft.hour);
    positionWheel(minutes.current,minuteValues.indexOf(draft.minute));
    hours.current?.focus({preventScroll:true});
    return()=>{if(sheet.open)sheet.close();};
    // Initialize only on opening; scrolling must never reopen or reposition the sheet.
  },[open]);
  function choose(kind:'hour'|'minute',index:number){
    const values=kind==='hour'?Array.from({length:24},(_,i)=>i):minuteValues;
    const bounded=Math.max(0,Math.min(values.length-1,index));
    positionWheel(kind==='hour'?hours.current:minutes.current,bounded);
    setDraft(current=>({...current,[kind]:values[bounded]}));
  }
  function readWheel(kind:'hour'|'minute'){
    const element=kind==='hour'?hours.current:minutes.current;
    const fallback=kind==='hour'?draft.hour:minuteValues.indexOf(draft.minute);
    const index=nearestWheelIndex(element,fallback);
    const next=kind==='hour'?index:minuteValues[index];
    setDraft(current=>current[kind]===next?current:{...current,[kind]:next});
  }
  function keyboard(event:KeyboardEvent<HTMLDivElement>,kind:'hour'|'minute'){
    const element=event.currentTarget,maximum=kind==='hour'?23:minuteValues.length-1;
    const index=nearestWheelIndex(element,kind==='hour'?draft.hour:minuteValues.indexOf(draft.minute));
    const target=event.key==='ArrowDown'?index+1:event.key==='ArrowUp'?index-1:event.key==='PageDown'?index+5:event.key==='PageUp'?index-5:event.key==='Home'?0:event.key==='End'?maximum:null;
    if(target!==null){event.preventDefault();choose(kind,target);}
    else if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();(kind==='hour'?minutes.current:hours.current)?.focus({preventScroll:true});}
    else if(event.key===' '||event.key==='Enter'){event.preventDefault();choose(kind,index);}
  }
  function commit(){
    // Do not trust delayed React scroll state or scrollend support at this boundary.
    const hour=nearestWheelIndex(hours.current,draft.hour);
    const minuteIndex=nearestWheelIndex(minutes.current,minuteValues.indexOf(draft.minute));
    positionWheel(hours.current,hour);positionWheel(minutes.current,minuteIndex);
    onChange(`${pad(hour)}:${pad(minuteValues[minuteIndex])}`);
    dismiss();
  }
  return <>
    <button ref={trigger} type="button" className="mtp-trigger" aria-label={`${label}: ${timePickerLabel(value,timeFormat)}`} aria-invalid={invalid||undefined} aria-describedby={describedBy} aria-haspopup="dialog" aria-expanded={open} aria-controls={`${id}-sheet`} onClick={show}><Clock3 size={16} aria-hidden="true"/><span>{timePickerLabel(value,timeFormat)}</span></button>
    <dialog ref={dialog} id={`${id}-sheet`} className="mtp-sheet" aria-labelledby={`${id}-title`} onCancel={event=>{event.preventDefault();dismiss();}}>
      <div className="mtp-toolbar"><button type="button" onClick={dismiss}>Cancel</button><h2 id={`${id}-title`}>{label}</h2><button type="button" className="mtp-done" onClick={commit}>Done</button></div>
      <p id={`${id}-help`} className="mtp-sr-only">Swipe a column, or use the arrow keys. Home and End reach the first and last option. Changes are saved with Done.</p>
      <div className="mtp-wheels">
        <div className="mtp-column"><span aria-hidden="true">Hour</span><div className="mtp-wheel-frame"><div ref={hours} className="mtp-wheel" role="listbox" tabIndex={0} aria-label={`${label} hour`} aria-describedby={`${id}-help`} aria-activedescendant={`${id}-hour-${draft.hour}`} onScroll={()=>readWheel('hour')} onKeyDown={event=>keyboard(event,'hour')}>
          {Array.from({length:24},(_,hour)=><div key={hour} id={`${id}-hour-${hour}`} className="mtp-option" data-wheel-index={hour} role="option" aria-selected={draft.hour===hour} onClick={()=>choose('hour',hour)}>{hourLabel(hour)}</div>)}
        </div></div></div>
        <div className="mtp-column"><span aria-hidden="true">Minute</span><div className="mtp-wheel-frame"><div ref={minutes} className="mtp-wheel" role="listbox" tabIndex={0} aria-label={`${label} minute`} aria-describedby={`${id}-help`} aria-activedescendant={`${id}-minute-${draft.minute}`} onScroll={()=>readWheel('minute')} onKeyDown={event=>keyboard(event,'minute')}>
          {minuteValues.map((minute,index)=><div key={minute} id={`${id}-minute-${minute}`} className="mtp-option" data-wheel-index={index} role="option" aria-selected={draft.minute===minute} onClick={()=>choose('minute',index)}>{pad(minute)}</div>)}
        </div></div></div>
      </div>
      <button type="button" className="mtp-now" onClick={()=>{onNow();dismiss();}}>Now</button>
    </dialog>
  </>;
}
