/** Historical views use their own range, never current totals from a scoped set of doses. */
export function timelineReadingTime({start,end,now,pinned,hover}:{start:number;end:number;now:number;pinned:number|null;hover:number|null}) {
  const selected=[pinned,hover].find(value=>value!==null&&value>=start&&value<=end);
  const isNow=selected===undefined&&now>=start&&now<end;
  return {at:selected??(isNow?now:start+(end-start)/2),isNow};
}

/** Refresh at minute boundaries and immediately when a suspended page returns. */
export function startTimelineClock({onTick,onResume,activity=window,visibility=document,now=Date.now,schedule=setTimeout,cancel=clearTimeout}:{
  onTick:(time:number)=>void;onResume:()=>void;activity?:EventTarget;
  visibility?:EventTarget&{visibilityState:string};now?:()=>number;
  schedule?:typeof setTimeout;cancel?:typeof clearTimeout;
}) {
  let timer:ReturnType<typeof setTimeout>|undefined,stopped=false;
  function pause(){if(timer!==undefined)cancel(timer);timer=undefined;}
  function tick(){
    pause();if(stopped||visibility.visibilityState==='hidden')return;
    const time=now();onTick(time);
    timer=schedule(tick,60_000-((time%60_000+60_000)%60_000));
  }
  function resume(){if(stopped||visibility.visibilityState==='hidden')return;onResume();tick();}
  function visibilityChanged(){if(visibility.visibilityState==='hidden')pause();else resume();}
  activity.addEventListener('focus',resume);activity.addEventListener('pageshow',resume);
  visibility.addEventListener('visibilitychange',visibilityChanged);tick();
  return ()=>{stopped=true;pause();activity.removeEventListener('focus',resume);activity.removeEventListener('pageshow',resume);visibility.removeEventListener('visibilitychange',visibilityChanged);};
}
