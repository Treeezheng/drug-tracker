import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import MobileTimePicker, { minuteChoices, nearestWheelIndex, timePickerLabel } from '../src/components/MobileTimePicker.tsx';

test('off-step original minutes remain exact choices without changing the interval',()=>{
  assert.deepEqual(minuteChoices(10,3),[0,3,10,20,30,40,50]);
  assert.deepEqual(minuteChoices(5,3),[0,3,5,10,15,20,25,30,35,40,45,50,55]);
  assert.deepEqual(minuteChoices(10,59),[0,10,20,30,40,50,59]);
  assert.equal(minuteChoices(5,5).length,12);
});
test('clock labels retain minutes and distinguish midnight and noon',()=>{
  assert.equal(timePickerLabel('08:03','12h'),'8:03 AM');
  assert.equal(timePickerLabel('00:03','12h'),'12:03 AM');
  assert.equal(timePickerLabel('12:03','12h'),'12:03 PM');
  assert.equal(timePickerLabel('23:59','24h'),'23:59');
  assert.equal(timePickerLabel('','24h'),'Set time');
  assert.equal(timePickerLabel('24:00','24h'),'Set time');
});
test('Done reads the actual row nearest the viewport center even before scroll state updates',()=>{
  const rows=Array.from({length:5},(_,index)=>({dataset:{wheelIndex:String(index)},getBoundingClientRect:()=>({top:100+index*48-77,height:48})}));
  const wheel={clientHeight:240,clientTop:0,getBoundingClientRect:()=>({top:0}),querySelectorAll:()=>rows} as unknown as HTMLElement;
  assert.equal(nearestWheelIndex(wheel,0),2);
  assert.equal(nearestWheelIndex(null,3),3);
});
test('compact trigger and native dialog expose named keyboard-selectable wheels',()=>{
  const html=renderToStaticMarkup(createElement(MobileTimePicker,{value:'08:03',minuteStep:5,timeFormat:'12h',label:'Dose 2 time',onChange:()=>{},onNow:()=>{}}));
  assert.match(html,/aria-label="Dose 2 time: 8:03 AM"/);
  assert.match(html,/aria-haspopup="dialog"/);
  assert.equal((html.match(/role="listbox"/g)||[]).length,2);
  assert.match(html,/aria-label="Dose 2 time hour"/);
  assert.match(html,/aria-label="Dose 2 time minute"/);
  assert.match(html,/>12 AM<\/div>/);
  assert.match(html,/>12 PM<\/div>/);
  assert.match(html,/>Cancel<\/button>/);
  assert.match(html,/>Done<\/button>/);
});
