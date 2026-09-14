import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import MobileTimePicker, { minuteChoices, nearestWheelIndex, pickerPosition, timePickerLabel } from '../src/components/MobileTimePicker.tsx';

test('off-step original minutes remain exact choices without changing the interval',()=>{
  assert.deepEqual(minuteChoices(1,3),Array.from({length:60},(_,i)=>i));
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
  const html=renderToStaticMarkup(createElement(MobileTimePicker,{value:'08:03',minuteStep:5,timeFormat:'12h',label:'Dose 2 time',triggerId:'dose-time-test',onChange:()=>{}}));
  assert.match(html,/aria-label="Dose 2 time: 8:03 AM"/);
  assert.match(html,/aria-haspopup="dialog"/);
  assert.equal((html.match(/role="listbox"/g)||[]).length,2);
  assert.match(html,/aria-label="Dose 2 time hour"/);
  assert.match(html,/aria-label="Dose 2 time minute"/);
  assert.match(html,/>12 AM<\/div>/);
  assert.match(html,/>12 PM<\/div>/);
  assert.match(html,/>Cancel<\/button>/);
  assert.match(html,/>Done<\/button>/);
  assert.match(html,/id="dose-time-test"/);
  assert.doesNotMatch(html,/>Now<\/button>/);
  assert.match(html,/aria-selected="true">03<\/div>/);
});

test('the default picker uses five-minute choices while one- and ten-minute preferences stay intact',()=>{
  const base={value:'08:03',timeFormat:'24h' as const,label:'Time',onChange:()=>{throw Error('Rendering must not commit');}};
  const five=renderToStaticMarkup(createElement(MobileTimePicker,base));
  const one=renderToStaticMarkup(createElement(MobileTimePicker,{...base,minuteStep:1}));
  const ten=renderToStaticMarkup(createElement(MobileTimePicker,{...base,minuteStep:10}));
  assert.equal((one.match(/role="option"/g)||[]).length,24+60);
  assert.equal((five.match(/role="option"/g)||[]).length,24+13);
  assert.equal((ten.match(/role="option"/g)||[]).length,24+7);
  for(const html of [one,five,ten]){assert.match(html,/aria-selected="true">03<\/div>/);assert.match(html,/Time: 08:03/);}
});

test('minute choices reject unsupported intervals instead of generating a different grid',()=>{
  for(const step of [-1,0,2,15,1.5,'1',null,undefined,NaN])assert.throws(()=>minuteChoices(step as never,3),/time increment/);
});

test('the shared visible Dose time title preserves the distinct dose labels used by assistive technology',()=>{
  const html=renderToStaticMarkup(createElement(MobileTimePicker,{value:'08:03',timeFormat:'24h',label:'Dose 4 time',title:'Dose time',onChange:()=>{throw Error('Rendering cannot commit');}}));
  assert.match(html,/<h2[^>]*>Dose time<\/h2>/);
  assert.match(html,/aria-label="Dose 4 time: 08:03"/);
  assert.match(html,/aria-label="Dose 4 time minute"/);
  assert.match(html,/popover="auto"/);
  assert.doesNotMatch(html,/<h2[^>]*>Dose 4 time<\/h2>/);
});

test('desktop placement stays by the trigger, flips upward near the bottom and stays within horizontal edges',()=>{
  const panel={width:320,height:260},viewport={width:1024,height:768};
  assert.deepEqual(pickerPosition({left:200,top:100,bottom:144},panel,viewport),{left:200,top:150});
  assert.deepEqual(pickerPosition({left:930,top:690,bottom:734},panel,viewport),{left:696,top:424});
  assert.deepEqual(pickerPosition({left:-50,top:100,bottom:144},panel,viewport),{left:8,top:150});
});

test('placement clamps offscreen anchors and accounts for a shifted visual viewport',()=>{
  const panel={width:320,height:260},viewport={width:720,height:500,left:20,top:30};
  assert.deepEqual(pickerPosition({left:0,top:-80,bottom:-36},panel,viewport),{left:28,top:38});
  const below=pickerPosition({left:900,top:900,bottom:944},panel,viewport);
  assert.equal(below.left,412);assert.equal(below.top,262);
  const constrained=pickerPosition({left:400,top:180,bottom:224},{width:320,height:180},{width:720,height:200});
  assert.ok(constrained.left>=8&&constrained.left+320<=712);
  assert.ok(constrained.top>=8&&constrained.top+180<=192);
});
