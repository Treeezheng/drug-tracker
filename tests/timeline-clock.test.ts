import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { startTimelineClock, timelineReadingTime } from '../src/lib/timeline-clock';
import TimelineChart from '../src/components/TimelineChart';
import { newDose } from '../src/components/DoseEditor';
import { dayWindow } from '../src/lib/time';
import type { Profile } from '../src/lib/types';

const start=Date.parse('2026-09-14T07:00:00Z'),end=start+86_400_000,now=start+37_845_000;
const reading=(extra:Partial<Parameters<typeof timelineReadingTime>[0]>={})=>timelineReadingTime({start,end,now,pinned:null,hover:null,...extra});

test('automatic readings start at the current instant; leaving hover restores Now while pinned readings stay selected',()=>{
  assert.deepEqual(reading(),{at:now,isNow:true});
  assert.deepEqual(reading({hover:start+1_000}),{at:start+1_000,isNow:false});
  assert.deepEqual(reading({hover:null}),{at:now,isNow:true});
  assert.deepEqual(reading({pinned:start+2_000,hover:start+1_000}),{at:start+2_000,isNow:false});
  assert.deepEqual(reading({pinned:start+2_000,hover:null,now:now+60_000}),{at:start+2_000,isNow:false});
  assert.equal(reading({pinned:now}).isNow,false,'A deliberate selection is not Now even in the same minute.');
});

test('historical, future and midnight views do not pretend their scoped data is a current reading',()=>{
  for(const time of [start-1,end,end+86_400_000]){
    assert.deepEqual(reading({now:time}),{at:start+43_200_000,isNow:false});
  }
  assert.deepEqual(reading({now:start}),{at:start,isNow:true});
  assert.deepEqual(reading({pinned:start-1,hover:end+1}),{at:now,isNow:true});
});

test('minute clock catches up on app return, pauses in the background and cleans up listeners and timers',()=>{
  const activity=new EventTarget(),visibility=Object.assign(new EventTarget(),{visibilityState:'visible'});
  let current=now,callback:(()=>void)|null=null,delay=0,resumes=0,cancellations=0;
  const ticks:number[]=[];
  const stop=startTimelineClock({activity,visibility,now:()=>current,onTick:time=>ticks.push(time),onResume:()=>resumes++,
    schedule:((fn:()=>void,ms:number)=>{callback=fn;delay=ms;return 1;}) as unknown as typeof setTimeout,
    cancel:(()=>{callback=null;cancellations++;}) as typeof clearTimeout,
  });
  assert.deepEqual(ticks,[now]);assert.equal(delay,15_000);assert.equal(resumes,0);
  current+=15_000;callback!();assert.equal(ticks.at(-1),current);assert.equal(delay,60_000);assert.equal(resumes,0);
  visibility.visibilityState='hidden';visibility.dispatchEvent(new Event('visibilitychange'));assert.equal(callback,null);
  current+=8*3_600_000;activity.dispatchEvent(new Event('focus'));assert.equal(resumes,0);
  visibility.visibilityState='visible';visibility.dispatchEvent(new Event('visibilitychange'));
  assert.equal(resumes,1);assert.equal(ticks.at(-1),current);
  current+=86_400_000;activity.dispatchEvent(new Event('pageshow'));assert.equal(resumes,2);assert.equal(ticks.at(-1),current);
  activity.dispatchEvent(new Event('focus'));assert.equal(resumes,3);
  const lateTick=callback!,count=ticks.length;stop();assert.equal(callback,null);assert.ok(cancellations>0);
  activity.dispatchEvent(new Event('focus'));activity.dispatchEvent(new Event('pageshow'));visibility.dispatchEvent(new Event('visibilitychange'));lateTick();
  assert.equal(ticks.length,count);assert.equal(resumes,3);
});

test('fresh chart renders the current readout with Now in the profile time zone, including DST day lengths',t=>{
  const profile:Profile={name:'',timeZone:'America/Los_Angeles',timeFormat:'12h',sleepEnabled:false,bedtime:'',wakeTime:'',weekendEnabled:false,weekendBedtime:'',weekendWakeTime:''};
  for(const instant of ['2026-09-14T17:30:45Z','2026-03-08T09:30:00Z','2026-11-01T09:30:00Z']){
    t.mock.method(Date,'now',()=>Date.parse(instant));
    const date=instant.slice(0,10),window=dayWindow(date,1,profile.timeZone);
    const dose={...newDose('ritalin','10'),administeredAt:new Date(window.start).toISOString()};
    const html=renderToStaticMarkup(createElement(TimelineChart,{doses:[dose],date,days:1,profile,publishedOnly:false,onProfile:()=>{}}));
    assert.ok(html.includes(`dateTime="${new Date(instant).toISOString()}"`));
    assert.match(html,/aria-label="Now, /);assert.match(html,/class="reading-now" aria-hidden="false" style="visibility:visible">Now<\/span>/);
    assert.doesNotMatch(html,/>Unpin<\/button>/);
    t.mock.restoreAll();
  }
});
