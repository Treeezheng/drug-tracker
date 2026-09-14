export const VAULT_IDLE_MS = 7 * 24 * 60 * 60 * 1000;

/** Check elapsed wall time on return too: background tabs can throttle timers. */
export function startIdleLock({onLock,activity=window,visibility=document,now=Date.now,schedule=setTimeout,cancel=clearTimeout,idleMs=VAULT_IDLE_MS,expiresAt}:{
  onLock:()=>void;activity?:EventTarget;visibility?:EventTarget;now?:()=>number;
  schedule?:typeof setTimeout;cancel?:typeof clearTimeout;idleMs?:number;expiresAt?:number;
}) {
  let last=now(),closed=false,timer:ReturnType<typeof setTimeout>;
  const events=['pointerdown','keydown','touchstart','scroll'];
  function stop(){if(closed)return;closed=true;cancel(timer);for(const name of events)activity.removeEventListener(name,touch);activity.removeEventListener('focus',check);visibility.removeEventListener('visibilitychange',check);}
  function check(){if(closed)return;const current=now(),elapsed=current-last,remaining=expiresAt===undefined?Infinity:expiresAt-current;if(elapsed>=idleMs||elapsed<0||!Number.isFinite(expiresAt??0)||remaining<=0){stop();onLock();return;}cancel(timer);timer=schedule(check,Math.min(idleMs-elapsed,remaining));}
  function touch(){check();if(closed)return;last=now();check();}
  for(const name of events)activity.addEventListener(name,touch,{passive:true});
  activity.addEventListener('focus',check);visibility.addEventListener('visibilitychange',check);
  check();
  return stop;
}
