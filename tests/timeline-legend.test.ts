import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { newDose } from '../src/components/DoseEditor.tsx';
import TimelineChart from '../src/components/TimelineChart.tsx';
import { timelineLegend } from '../src/lib/timeline-legend.ts';
import type { Profile } from '../src/lib/types.ts';
const first={...newDose('ritalin','10'),administeredAt:'2026-09-13T15:00:00Z'};
const second={...newDose('ritalin','10'),administeredAt:'2026-09-13T19:00:00Z'};

test('repeated medicine and strength share one label while every colored dose stays intact',()=>{
  const original=JSON.stringify([first,second]);
  const groups=timelineLegend([first,{...second,packageStrength:'10.00'}]);
  assert.equal(groups.length,1); assert.equal(groups[0].members.length,2);
  assert.equal(groups[0].dose,first);
  assert.equal(JSON.stringify([first,second]),original);
  assert.equal(timelineLegend([first,newDose('ritalin','5'),newDose('ritalin-la','10')]).length,3);
  assert.equal(timelineLegend([newDose('azstarys','26.1/5.2'),newDose('azstarys','26.1/7.8')]).length,2);
});

test('the chart has stacked color swatches, prominent readings and keyboard access without a range slider',()=>{
  const profile:Profile={name:'',timeZone:'America/Los_Angeles',timeFormat:'24h',sleepEnabled:false,bedtime:'',wakeTime:'',weekendEnabled:false,weekendBedtime:'',weekendWakeTime:''};
  const html=renderToStaticMarkup(createElement(TimelineChart,{doses:[first,second],date:'2026-09-13',days:1,profile,publishedOnly:true,onProfile:()=>{}}));
  assert.doesNotMatch(html,/type="range"|aria-label="Reading time"/);
  assert.match(html,/class="reading-value"[\s\S]*?<strong>[0-9.]+<\/strong>/);
  const legend=html.match(/<div class="chart-legend">[\s\S]*?<\/div>/)![0];
  assert.equal((legend.match(/class="legend-medication"/g)||[]).length,1);
  assert.match(legend,/class="legend-swatches"[^>]*><i[^>]*><\/i><i[^>]*><\/i>/);
  assert.match(html,/tabindex="0"/);assert.match(html,/Use arrow keys to move through time/);
});
