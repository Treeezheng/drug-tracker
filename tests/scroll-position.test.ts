import test from 'node:test';
import assert from 'node:assert/strict';
import { captureScrollPosition } from '../src/lib/scroll-position.ts';

function fixture(dialog=false){
  const calls:{top:number;behavior:string}[]=[];
  const page={tagName:'HTML',parentElement:null,scrollTop:400,scrollHeight:2400,clientHeight:800,
    scrollTo(value:{top:number;behavior:string}){calls.push(value);this.scrollTop=value.top;}};
  const modal={tagName:'DIALOG',parentElement:page,scrollTop:120,scrollHeight:1000,clientHeight:500,
    scrollTo(value:{top:number;behavior:string}){calls.push(value);this.scrollTop=value.top;}};
  const document={scrollingElement:page,defaultView:{getComputedStyle:()=>({overflowY:'visible'})}};
  const scroller=dialog?modal:page;
  let contentTop=650;
  const element={ownerDocument:document,parentElement:scroller,isConnected:true,getBoundingClientRect:()=>({top:contentTop-scroller.scrollTop})};
  return{element:element as unknown as HTMLElement,page,modal,calls,move:(delta:number)=>{contentTop+=delta;},top:()=>element.getBoundingClientRect().top};
}

test('changing chart height above a selected dose preserves its viewport position in either direction',()=>{
  const f=fixture(),before=f.top();
  const restore=captureScrollPosition(f.element);f.move(390);restore();
  assert.equal(f.top(),before);assert.deepEqual(f.calls,[{top:790,behavior:'instant'}]);
  const shrink=captureScrollPosition(f.element);f.move(-310);shrink();
  assert.equal(f.top(),before);assert.equal(f.page.scrollTop,480);
  restore();assert.equal(f.calls.length,2,'A consumed capture cannot scroll during a later update.');
});

test('browser anchoring already preserving the control does not receive a second adjustment',()=>{
  const f=fixture(),restore=captureScrollPosition(f.element),before=f.top();
  f.move(300);f.page.scrollTop+=300;restore();
  assert.equal(f.top(),before);assert.equal(f.calls.length,0);
});

test('an edit dialog uses its own scroll range and never moves the page behind it',()=>{
  const f=fixture(true),before=f.top(),restore=captureScrollPosition(f.element);
  f.move(90);restore();assert.equal(f.top(),before);assert.equal(f.modal.scrollTop,210);assert.equal(f.page.scrollTop,400);
  const bounded=captureScrollPosition(f.element);f.move(900);bounded();
  assert.equal(f.modal.scrollTop,500,'The available scroll range bounds the adjustment.');assert.equal(f.page.scrollTop,400);
});

test('removed rows and invalid layout measurements do not cause an unrelated page scroll',()=>{
  const f=fixture(),restore=captureScrollPosition(f.element);f.move(300);
  Object.assign(f.element,{isConnected:false});restore();assert.equal(f.calls.length,0);
  const other=fixture(),invalid=captureScrollPosition(other.element);other.move(Number.NaN);invalid();
  assert.equal(other.calls.length,0);
});
