import test from 'node:test';
import assert from 'node:assert/strict';
import { createTimelinePointer, timelinePointerTime } from '../src/lib/timeline-pointer';

function fixture(initial:number|null=null){
  let pinned=initial,hover:number|null=null;const captured=new Set<number>(),calls:number[]=[];
  const target={setPointerCapture:(id:number)=>{captured.add(id);},releasePointerCapture:(id:number)=>{captured.delete(id);},hasPointerCapture:(id:number)=>captured.has(id),getBoundingClientRect:()=>({left:10,width:360})};
  const plot={width:800,left:40,right:24,start:0,end:86400000};
  const controller=createTimelinePointer({time:event=>timelinePointerTime(event.clientX,event.currentTarget.getBoundingClientRect(),plot),getPinned:()=>pinned,pin:value=>{pinned=value;if(value!==null)calls.push(value);},hover:value=>{hover=value;}});
  const event=(clientX:number,id=1)=>({currentTarget:target,pointerId:id,clientX,button:0,isPrimary:true});
  return {controller,event,target,captured,calls,get pinned(){return pinned;},get hover(){return hover;}};
}

test('touch or mouse dragging updates an already pinned time continuously and retains the release position',()=>{
  const f=fixture(1234);f.controller.down(f.event(100));assert.equal(f.captured.has(1),true);
  const first=f.pinned;f.controller.move(f.event(200));assert.ok(f.pinned!>first!);
  f.controller.move(f.event(300));assert.ok(f.calls[2]>f.calls[1]);
  f.controller.up(f.event(340));const final=f.pinned;
  assert.equal(f.captured.size,0);f.controller.cancel({pointerId:1});assert.equal(f.pinned,final,'Normal lost capture after release does not undo the selection.');
  f.controller.move(f.event(100));assert.equal(f.pinned,final,'Mouse hover does not erase the pinned result.');
});

test('a vertical browser pan cancellation restores the prior selection and permits the next horizontal drag',()=>{
  for(const before of [null,7200000]){
    const f=fixture(before);f.controller.down(f.event(220));f.controller.move(f.event(225));f.controller.cancel({pointerId:1});
    assert.equal(f.pinned,before);assert.equal(f.captured.size,0);
    f.controller.down(f.event(260));f.controller.up(f.event(280));assert.notEqual(f.pinned,before);
  }
});

test('only the initiating primary pointer can move or end a drag, and pointer capture clamps outside the chart',()=>{
  const f=fixture();f.controller.down({...f.event(100),button:2});assert.equal(f.captured.size,0);
  f.controller.down({...f.event(100),isPrimary:false});assert.equal(f.captured.size,0);
  f.controller.down(f.event(100));const before=f.pinned;
  f.controller.move(f.event(300,2));f.controller.up(f.event(300,2));f.controller.cancel({pointerId:2});assert.equal(f.pinned,before);assert.equal(f.captured.has(1),true);
  f.controller.move(f.event(-500));assert.equal(f.pinned,0);f.controller.up(f.event(900));assert.equal(f.pinned,86400000);
});

test('responsive SVG mapping respects CSS scale, axis margins, bounds and invalid rectangles',()=>{
  const plot={width:800,left:40,right:24,start:100,end:1100},rect={left:20,width:400};
  assert.equal(timelinePointerTime(40,rect,plot),100);assert.equal(timelinePointerTime(408,rect,plot),1100);
  assert.equal(timelinePointerTime(224,rect,plot),600);
  assert.equal(timelinePointerTime(10,{left:0,width:0},plot),null);
  assert.equal(timelinePointerTime(NaN,rect,plot),null);
});

test('hover, reset and failed capture do not leave a stuck active pointer',()=>{
  const f=fixture();f.controller.move(f.event(100));assert.notEqual(f.hover,null);f.controller.leave();assert.equal(f.hover,null);
  f.controller.down(f.event(100));f.controller.reset();assert.equal(f.captured.size,0);
  f.target.setPointerCapture=()=>{throw new Error('The pointer is no longer active.');};
  const previous=f.pinned;f.controller.down(f.event(300));assert.equal(f.pinned,previous);
});
