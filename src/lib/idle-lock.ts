export const VAULT_IDLE_MS = 10 * 60 * 1000;

/** Check elapsed wall time on return too: background tabs can throttle timers. */
export function startIdleLock({onLock,activity=window,visibility=document,now=Date.now,schedule=setTimeout,cancel=clearTimeout,idleMs=VAULT_IDLE_MS}:{
  onLock:()=>void;activity?:EventTarget;visibility?:EventTarget;now?:()=>number;
  schedule?:typeof setTimeout;cancel?:typeof clearTimeout;idleMs?:number;
}) {
  let last=now(),closed=false,timer:ReturnType<typeof setTimeout>;
  const events=['pointerdown','keydown','touchstart','scroll'];
  function stop(){if(closed)return;closed=true;cancel(timer);for(const name of events)activity.removeEventListener(name,touch);activity.removeEventListener('focus',check);visibility.removeEventListener('visibilitychange',check);}
  function check(){if(closed)return;const elapsed=now()-last;if(elapsed>=idleMs||elapsed<0){stop();onLock();return;}cancel(timer);timer=schedule(check,idleMs-elapsed);}
  function touch(){check();if(closed)return;last=now();cancel(timer);timer=schedule(check,idleMs);}
  for(const name of events)activity.addEventListener(name,touch,{passive:true});
  activity.addEventListener('focus',check);visibility.addEventListener('visibilitychange',check);
  timer=schedule(check,idleMs);
  return stop;
}
