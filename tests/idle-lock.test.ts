import test from 'node:test';
import assert from 'node:assert/strict';
import { startIdleLock } from '../src/lib/idle-lock';

function setup(){let time=0,locked=0;let callback=()=>{};const activity=new EventTarget(),visibility=new EventTarget();const stop=startIdleLock({activity,visibility,now:()=>time,onLock:()=>locked++,idleMs:100,schedule:((fn:()=>void)=>{callback=fn;return 1;}) as any,cancel:(()=>{}) as any});return {activity,visibility,stop,tick:(value:number)=>{time=value;},timeout:()=>callback(),locked:()=>locked};}
test('activity extends the deadline and an idle vault locks exactly once',()=>{const s=setup();s.tick(90);s.activity.dispatchEvent(new Event('keydown'));s.tick(100);s.timeout();assert.equal(s.locked(),0);s.tick(190);s.timeout();assert.equal(s.locked(),1);s.timeout();s.activity.dispatchEvent(new Event('pointerdown'));assert.equal(s.locked(),1);});
test('returning from a suspended tab locks before late interaction can reset the deadline',()=>{for(const name of ['focus','pointerdown']){const s=setup();s.tick(500);s.activity.dispatchEvent(new Event(name));assert.equal(s.locked(),1);}const s=setup();s.tick(500);s.visibility.dispatchEvent(new Event('visibilitychange'));assert.equal(s.locked(),1);});
test('unmount cleanup removes all listeners and cancels future locking',()=>{const s=setup();s.stop();s.tick(500);s.timeout();s.visibility.dispatchEvent(new Event('visibilitychange'));assert.equal(s.locked(),0);});
test('an absolute unlock expiry is not renewed by activity and is checked after suspension',()=>{
  for(const event of ['focus','pointerdown','visibilitychange']){
    let time=0,locked=0,callback=()=>{};const activity=new EventTarget(),visibility=new EventTarget();
    startIdleLock({activity,visibility,now:()=>time,onLock:()=>locked++,idleMs:100,expiresAt:150,schedule:((fn:()=>void)=>{callback=fn;return 1;}) as any,cancel:(()=>{}) as any});
    time=90;activity.dispatchEvent(new Event('pointerdown'));time=140;activity.dispatchEvent(new Event('keydown'));assert.equal(locked,0);
    time=150;(event==='visibilitychange'?visibility:activity).dispatchEvent(new Event(event));assert.equal(locked,1);callback();assert.equal(locked,1);
  }
});
test('expired and malformed absolute deadlines lock immediately',()=>{
  for(const expiresAt of [99,100,NaN,Infinity]){let locked=0;startIdleLock({activity:new EventTarget(),visibility:new EventTarget(),now:()=>100,onLock:()=>locked++,expiresAt,schedule:(()=>1) as any,cancel:(()=>{}) as any});assert.equal(locked,1);}
});
