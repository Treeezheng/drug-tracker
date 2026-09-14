import { useEffect, useMemo, useRef, useState } from 'react';
import type { Dose, Profile } from '../lib/types';
import { contributions, effectWindow, groupedTotals, modelGroup } from '../lib/model';
import { addDays, dayWindow, formatInstant, sleepIntervals } from '../lib/time';
export const colors=['#426a95','#8c729c','#b48654','#5e8b83','#9d7075','#71839b'];
interface Props {doses:Dose[];date:string;days:number;profile:Profile;publishedOnly:boolean;actual?:boolean;baseline?:'empty'|'recorded';onMove?:(id:string,iso:string)=>void;onProfile:()=>void;}
export default function TimelineChart({doses,date,days,profile,publishedOnly,onMove,onProfile,baseline='empty'}:Props){
  const {start,end}=dayWindow(date,days,profile.timeZone),ref=useRef<HTMLDivElement>(null);
  const [width,setWidth]=useState(800),[hover,setHover]=useState<number|null>(null),[pinned,setPinned]=useState<number|null>(null);
  useEffect(()=>{const el=ref.current;if(!el)return;const observer=new ResizeObserver(()=>setWidth(Math.max(280,el.clientWidth)));observer.observe(el);return()=>observer.disconnect();},[]);
  useEffect(()=>{setHover(null);if(pinned!==null&&(pinned<start||pinned>end))setPinned(null);},[start,end,pinned]);
  const at=pinned??hover??start+(end-start)/2;
  const visible=doses.filter(d=>d.productId&&d.administeredAt&&Number.isFinite(Date.parse(d.administeredAt))&&Number(d.amountMg)>0&&Number.isFinite(Number(d.amountMg))&&d.status!=='skipped');
  const names=[...new Set(visible.filter(d=>modelGroup(d).reference||d.assumptions?.accepted).map(d=>modelGroup(d).group))];
  const eventRows=visible.filter(d=>!names.includes(modelGroup(d).group));
  const groups=[...names,...(eventRows.length||!names.length?['Timeline']:[])];
  const totals=groupedTotals(visible,at,publishedOnly),readings=contributions(visible,at,publishedOnly),sleeps=sleepIntervals(start,end,profile);
  const sampleTimes=useMemo(()=>Array.from({length:289},(_,i)=>start+(end-start)*i/288),[start,end]);
  const headers=Array.from({length:days},(_,i)=>{const d=addDays(date,i);return {date:d,...dayWindow(d,1,profile.timeZone)};});
  const W=width,H=260,L=40,R=24,T=36,B=38,iw=W-L-R;
  const x=(t:number)=>L+(t-start)/(end-start)*iw;
  const tickHours=days===1?(width<500?6:4):12;
  type Total=ReturnType<typeof groupedTotals>[string]|undefined;
  function known(g:Total,t:number){return !!g&&(g.complete||g.items.some(c=>c.value!==null&&Date.parse(c.dose.administeredAt)<=t));}
  function pointerTime(e:React.MouseEvent<SVGSVGElement>|React.PointerEvent<SVGSVGElement>){const r=e.currentTarget.getBoundingClientRect();return start+Math.max(0,Math.min(1,((e.clientX-r.left)/r.width*W-L)/iw))*(end-start);}
  function move(e:React.PointerEvent<SVGGElement>,d:Dose){if(d.status==='actual'||!onMove||!e.currentTarget.hasPointerCapture(e.pointerId))return;e.stopPropagation();const r=e.currentTarget.ownerSVGElement!.getBoundingClientRect();const t=start+Math.max(0,Math.min(1,((e.clientX-r.left)/r.width*W-L)/iw))*(end-start);const step=(profile.timeIncrementMinutes||5)*60000;onMove(d.id,new Date(Math.round(t/step)*step).toISOString());}
  return <div className="simple-timeline"><div className="chart-main" ref={ref}>
    {groups.map((group,index)=>{
      const timing=group==='Timeline',members=timing?eventRows:visible.filter(d=>modelGroup(d).group===group),unit=members[0]&&!timing?modelGroup(members[0]).unit:'';
      const panelH=timing?118:H, panelIh=panelH-T-B;
      const series=sampleTimes.map(t=>groupedTotals(members,t,publishedOnly)[group]);
      const max=Math.max(1,...series.map(v=>v?.value||0));
      const ceiling=unit==='ng/mL'?Math.max(6,Math.ceil(max*1.1/2)*2):Math.max(2,Math.ceil(max*1.1));
      const y=(v:number)=>T+panelIh-v/ceiling*panelIh;
      const path=(values:(number|null)[])=>{let active=false;return values.map((v,i)=>{if(v===null){active=false;return '';}const text=`${active?'L':'M'}${x(sampleTimes[i]).toFixed(2)},${y(v).toFixed(2)}`;active=true;return text;}).join(' ');};
      const totalsPath=path(series.map((v,i)=>known(v,sampleTimes[i])?v!.value:null));
      const current=totals[group];
      return <div className="analyte-panel" key={group}><div className="chart-heading"><h3>{group}</h3><span className="muted">{timing?'':`${unit} · estimate`}</span></div><div className="day-headings" style={{paddingLeft:L,paddingRight:R}}>{headers.map(h=><span key={h.date} style={{width:`${(h.end-h.start)/(end-start)*100}%`}}>{new Intl.DateTimeFormat('en-US',{timeZone:profile.timeZone,weekday:'short',month:'short',day:'numeric'}).format(h.start)}</span>)}</div>
      <svg className="chart-svg" viewBox={`0 0 ${W} ${panelH}`} role="img" aria-label={timing?'Dose times':`${group}, ${unit}. Exact readings are available below.`} onPointerMove={e=>{if(pinned===null)setHover(pointerTime(e));}} onClick={e=>setPinned(pinned===null?pointerTime(e):null)}>
        <defs><clipPath id={`plot-${index}`}><rect x={L} y={T-10} width={iw} height={panelIh+22}/></clipPath></defs>
        {sleeps.map(s=><g key={s.start}><rect x={x(Math.max(start,s.start))} y={T-10} width={x(Math.min(end,s.end))-x(Math.max(start,s.start))} height={panelIh+10} fill="#e7ebef"/><text className="sleep-label" x={x(Math.min(end,s.end))-x(Math.max(start,s.start))<42?x(Math.min(end,s.end))-2:x(Math.max(start,s.start))+5} y={T-18} textAnchor={x(Math.min(end,s.end))-x(Math.max(start,s.start))<42?"end":"start"}>Sleep</text></g>)}
        {(timing?[0]:[0,1,2,3,4]).map(i=><g key={i}><line x1={L} x2={W-R} y1={y(ceiling*i/4)} y2={y(ceiling*i/4)} stroke="#e0e5ea" strokeDasharray={i?'3 4':undefined}/>{!timing&&<text x={L-8} y={y(ceiling*i/4)+4} textAnchor="end">{Number((ceiling*i/4).toFixed(1))}</text>}</g>)}
        {headers.slice(1).map(h=><line key={h.date} x1={x(h.start)} x2={x(h.start)} y1={T-10} y2={y(0)} stroke="#b9c2cd"/>)}
        {Array.from({length:Math.ceil((end-start)/3600000/tickHours)+1},(_,i)=>start+i*tickHours*3600000).filter(t=>t<=end).map(t=><text key={t} x={x(t)} y={panelH-12} textAnchor="middle">{new Intl.DateTimeFormat('en-US',{timeZone:profile.timeZone,hour:'numeric',hour12:profile.timeFormat==='12h'}).format(t)}</text>)}
        <g clipPath={`url(#plot-${index})`}>
          {!timing&&members.map(d=><path key={d.id} d={path(sampleTimes.map(t=>contributions([d],t,publishedOnly)[0]?.value??null))} stroke={colors[visible.findIndex(v=>v.id===d.id)%colors.length]} strokeWidth="1.5" fill="none" strokeDasharray="4 4"/>)}
          {!timing&&<path d={totalsPath} stroke="#426a95" strokeWidth="2.7" fill="none" strokeLinejoin="round" strokeDasharray={series.some(g=>g&&(!g.complete||g.tail))?'7 4':undefined}/>}
          {members.filter(d=>Date.parse(d.administeredAt)>=start&&Date.parse(d.administeredAt)<=end).map(d=>{const dx=x(Date.parse(d.administeredAt)),color=colors[visible.findIndex(v=>v.id===d.id)%colors.length];return <g key={d.id} style={{cursor:d.status==='actual'?'default':'ew-resize',touchAction:'none'}} onClick={e=>e.stopPropagation()} onPointerDown={e=>{if(d.status==='actual')return;e.stopPropagation();e.currentTarget.setPointerCapture(e.pointerId);}} onPointerMove={e=>move(e,d)} onPointerUp={e=>{move(e,d);if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);}}><line x1={dx} x2={dx} y1={T+14} y2={y(0)} stroke={color} opacity=".25"/><rect x={dx-22} y={y(0)-22} width="44" height="44" fill="transparent"/>{d.status==='actual'?<circle cx={dx} cy={y(0)} r="5" fill={color} stroke="white" strokeWidth="1.5"/>:<path d={`M${dx},${y(0)-5}l5,5 -5,5 -5,-5Z`} fill={color} stroke="white"/>}</g>;})}
        </g>
        {Date.now()>=start&&Date.now()<=end&&<g><line x1={x(Date.now())} x2={x(Date.now())} y1={T+10} y2={y(0)} stroke="#8c96a3" strokeDasharray="2 4"/><text x={Math.max(L+14,Math.min(W-R-14,x(Date.now())))} y={T+3} textAnchor="middle">Now</text></g>}
        {!timing&&visible.length>0&&<line x1={x(at)} x2={x(at)} y1={T+10} y2={y(0)} stroke="#9ca9b8" strokeDasharray="3 4"/>}
        {current&&known(current,at)&&<circle cx={x(at)} cy={y(current.value)} r="4" fill="#426a95" stroke="white" strokeWidth="2"/>}
      </svg>
      {members.length>0&&<div className="chart-legend">{!timing&&<span><i style={{background:'#426a95'}}/>{current?.complete?(unit==='ng/mL'?'Modeled total':'Illustrative sum'):known(current,at)?'Known contributions · incomplete':'Unknown total'}</span>}{members.map(d=><span key={d.id}><i style={{background:colors[visible.findIndex(v=>v.id===d.id)%colors.length]}}/>{d.productName} · {d.packageStrength||d.strength} {d.strengthUnit||'mg'}</span>)}</div>}
      </div>;
    })}
    {names.length>0&&<div className="reading-control"><span>{formatInstant(at,profile,true)}</span><input aria-label="Reading time" aria-valuetext={formatInstant(at,profile,true)} type="range" min={start} max={end} step={(profile.timeIncrementMinutes||5)*60000} value={at} onChange={e=>setPinned(Number(e.target.value))}/>{Object.entries(totals).filter(([group])=>names.includes(group)).map(([group,g])=><span key={group} className="reading-value">{names.length>1?`${group}: `:''}{known(g,at)?g.value.toFixed(2):'—'} {g.unit}{!g.complete?' · incomplete':''}</span>)}{pinned!==null&&<button className="text-button" onClick={()=>setPinned(null)}>Unpin</button>}</div>}
  </div>
  {visible.length>0&&<p className="chart-caption">● Taken　◆ Planned{eventRows.length?' · No curve for unmodeled medication':''}</p>}
  {visible.length>0&&<details className="chart-details"><summary>Readings & details</summary><p className="muted">{baseline==='recorded'?'Includes recorded history. Earlier unrecorded history is unknown.':'Empty earlier history is an assumption.'} Circles = taken; diamonds = not recorded.</p>{readings.map(c=><div className="contribution" key={c.dose.id}><span><strong>{c.dose.productName}</strong><small>{formatInstant(Date.parse(c.dose.administeredAt),profile,true)} · {c.dose.quantity} {c.dose.unit} × {c.dose.packageStrength||c.dose.strength} {c.dose.strengthUnit||'mg'}{Date.parse(c.dose.administeredAt)<start?' · Earlier dose':''}</small></span><span>{c.value===null?'Unknown':`${c.value.toFixed(3)} ${c.unit}`}<small>{c.tail?'Estimated tail':c.evidence==='D'?'Assumptions':`Evidence ${c.evidence}`}</small></span></div>)}
    {visible.some(d=>effectWindow(d))&&<details className="effect-track"><summary>Assumed effect windows</summary>{visible.map(d=>{const w=effectWindow(d);if(!w)return null;return <div key={d.id} className="effect-row"><span>{d.productName}</span><div className="effect-rail"><i className="effect-band uncertain" style={{left:`${Math.max(0,(w.start-start)/(end-start)*100)}%`,width:`${Math.max(0,(Math.min(end,w.maxEnd)-Math.max(start,w.start))/(end-start)*100)}%`}}/><i className="effect-band" style={{left:`${Math.max(0,(w.start-start)/(end-start)*100)}%`,width:`${Math.max(0,(Math.min(end,w.minEnd)-Math.max(start,w.start))/(end-start)*100)}%`}}/></div><small>{formatInstant(w.start,profile,true)} → end {formatInstant(w.minEnd,profile,true)}–{formatInstant(w.maxEnd,profile,true)}</small></div>;})}<p className="muted">Assumed effect intervals, not clearance times or confidence intervals.</p></details>}
    {sleeps.length>0&&<details><summary>Sleep readings</summary>{sleeps.map(s=><div key={s.start}>{[s.start,s.end].map((t,i)=><p key={t}>{i?'Wake':'Bed'} · {formatInstant(t,profile,true)}: {Object.entries(groupedTotals(visible,t,publishedOnly)).map(([name,g])=>`${name}: ${known(g,t)?g.value.toFixed(3):'Unknown'} ${g.unit}${!g.complete?' (incomplete)':''}${g.tail?' (estimated tail)':''}`).join('; ')}</p>)}</div>)}<p className="muted">Target sleep schedule. Does not predict sleep quality. <button className="text-button" onClick={onProfile}>Edit schedule</button></p></details>}
  </details>}
  </div>;
}
