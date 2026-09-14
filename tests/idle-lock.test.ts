import test from 'node:test';
import assert from 'node:assert/strict';
import { startIdleLock } from '../src/lib/idle-lock';

function setup(){let time=0,locked=0;let callback=()=>{};const activity=new EventTarget(),visibility=new EventTarget();const stop=startIdleLock({activity,visibility,now:()=>time,onLock:()=>locked++,idleMs:100,schedule:((fn:()=>void)=>{callback=fn;return 1;}) as any,cancel:(()=>{}) as any});return {activity,visibility,stop,tick:(value:number)=>{time=value;},timeout:()=>callback(),locked:()=>locked};}
test('activity extends the deadline and an idle vault locks exactly once',()=>{const s=setup();s.tick(90);s.activity.dispatchEvent(new Event('keydown'));s.tick(100);s.timeout();assert.equal(s.locked(),0);s.tick(190);s.timeout();assert.equal(s.locked(),1);s.timeout();s.activity.dispatchEvent(new Event('pointerdown'));assert.equal(s.locked(),1);});
test('returning from a suspended tab locks before late interaction can reset the deadline',()=>{for(const name of ['focus','pointerdown']){const s=setup();s.tick(500);s.activity.dispatchEvent(new Event(name));assert.equal(s.locked(),1);}const s=setup();s.tick(500);s.visibility.dispatchEvent(new Event('visibilitychange'));assert.equal(s.locked(),1);});
test('unmount cleanup removes all listeners and cancels future locking',()=>{const s=setup();s.stop();s.tick(500);s.timeout();s.visibility.dispatchEvent(new Event('visibilitychange'));assert.equal(s.locked(),0);});
