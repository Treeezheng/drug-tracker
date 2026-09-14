export interface TimelinePointerTarget {
  setPointerCapture(id:number):void; releasePointerCapture(id:number):void; hasPointerCapture(id:number):boolean;
  getBoundingClientRect():{left:number;width:number};
}
interface PointerInput {currentTarget:TimelinePointerTarget;pointerId:number;clientX:number;button?:number;isPrimary?:boolean;}

/** Map CSS pixels to the plot's actual viewBox, including its axis margins. */
export function timelinePointerTime(clientX:number,rect:{left:number;width:number},plot:{width:number;left:number;right:number;start:number;end:number}):number|null {
  if (![clientX,rect.left,rect.width,plot.width,plot.left,plot.right,plot.start,plot.end].every(Number.isFinite)
    ||rect.width<=0||plot.width<=plot.left+plot.right||plot.end<=plot.start)return null;
  const fraction=(clientX-rect.left)/rect.width*plot.width;
  return plot.start+Math.max(0,Math.min(1,(fraction-plot.left)/(plot.width-plot.left-plot.right)))*(plot.end-plot.start);
}

/** One captured pointer controls the reading; browser-cancelled vertical pans roll back. */
export function createTimelinePointer(options:{time:(event:PointerInput)=>number|null;getPinned:()=>number|null;pin:(time:number|null)=>void;hover:(time:number|null)=>void}) {
  let active:{id:number;target:TimelinePointerTarget;before:number|null}|null=null;
  function release(cancel:boolean){
    const previous=active;active=null;if(!previous)return;
    if(cancel)options.pin(previous.before);
    if(previous.target.hasPointerCapture(previous.id))previous.target.releasePointerCapture(previous.id);
  }
  return {
    down(event:PointerInput){
      if(active||event.button!==0||event.isPrimary===false)return;
      const time=options.time(event);if(time===null)return;
      active={id:event.pointerId,target:event.currentTarget,before:options.getPinned()};
      try{event.currentTarget.setPointerCapture(event.pointerId);}catch{active=null;return;}
      options.pin(time);
    },
    move(event:PointerInput){
      if(active&&(event.pointerId!==active.id||event.currentTarget!==active.target))return;
      const time=options.time(event);if(time===null)return;
      if(active)options.pin(time);else if(options.getPinned()===null)options.hover(time);
    },
    up(event:PointerInput){
      if(!active||event.pointerId!==active.id||event.currentTarget!==active.target)return;
      const time=options.time(event);if(time!==null)options.pin(time);release(false);
    },
    cancel(event:Pick<PointerInput,'pointerId'>){if(active?.id===event.pointerId)release(true);},
    leave(){if(!active)options.hover(null);},
    reset(){release(false);options.hover(null);},
  };
}
