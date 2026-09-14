import MedicationName from './MedicationName';
import { timelineLegend } from '../lib/timeline-legend';
import { hasKnownTotal, hasMissingTimelineData } from '../lib/timeline-data';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import type { Dose, Profile } from '../lib/types';
import { concentrationAnalyte, contributions, contributesToGroup, doseTimestamp, effectWindow, includeTimelineDose, modelGroup, pkReferenceForDose, plotGroups, referenceForDose } from '../lib/model';
import { addDays, dayWindow, formatInstant, sleepIntervals } from '../lib/time';
import { createTimelinePointer, timelinePointerTime } from '../lib/timeline-pointer';
import { estimateContribution, estimateTotals } from '../lib/timeline-estimates';
import { isHistoryDose, sampleTimelinePanel, timelinePanelGeometry } from '../lib/timeline-series';
import { products, sources } from '../lib/catalog';
import DoseFormula from './DoseFormula';
import { selectedTimelineChoice, timelineChoices } from '../lib/timeline-choice';
import { startTimelineClock, timelineReadingTime } from '../lib/timeline-clock';
export const colors=['#426a95','#8c729c','#b48654','#5e8b83','#9d7075','#71839b'];
interface Props {doses:Dose[];date:string;days:number;profile:Profile;publishedOnly:boolean;actual?:boolean;baseline?:'empty'|'recorded';hasPendingDose?:boolean;omittedHistoryCount?:number;omittedUnknownHistoryCount?:number;onAddDose?:()=>void;onSources?:()=>void;onMove?:(id:string,iso:string)=>void;onProfile:()=>void;}
export function TimelineEmptyState({pending=false,hasHistory=false,onAddDose}:{pending?:boolean;hasHistory?:boolean;onAddDose?:()=>void}){
  return <div className="timeline-empty"><h2>{pending?'Complete your dose to see the timeline':hasHistory?'No doses to plot in this view':'Add a dose to see your timeline'}</h2><p>{pending?'Choose a medication, amount and time in the dose row below.':hasHistory?'Your saved records are still available in History.':'Choose a medication and time to start a simulation.'}</p>{!pending&&onAddDose&&<button type="button" className="button secondary small" onClick={onAddDose}>Add dose</button>}</div>;
}
export default function TimelineChart(props:Props){
  const choices=useMemo(()=>timelineChoices(props.doses),[props.doses]);
  const [choiceId,setChoiceId]=useState<string|null>(null);
  const selected=selectedTimelineChoice(choices,choiceId);
  return <><div className="chart-view-controls" hidden={choices.length<2}>
    <label className="field"><span>Medication to display</span><select aria-label="Medication to display" value={selected?.id??''} onChange={event=>setChoiceId(event.target.value)}>{choices.map(choice=><option key={choice.id} value={choice.id}>{choice.label}</option>)}</select></label>
    <p>Estimates for the same compound are added together. Other compounds have separate views. <a href={`${import.meta.env?.BASE_URL??'/drug/'}chart-guide.html`} target="_blank" rel="noreferrer">About grouping</a></p>
  </div><TimelinePlot {...props} doses={selected?.doses??props.doses}/></>;
}
export function TimelinePlot({doses,date,days,profile,publishedOnly,onMove,onProfile,baseline='empty',hasPendingDose=false,omittedHistoryCount=0,omittedUnknownHistoryCount=0,onAddDose,onSources}:Props){
  const readingsId=useId(),dataNoteId=useId(),[showReadings,setShowReadings]=useState(false),[showBasis,setShowBasis]=useState(false),noteRef=useRef<HTMLElement>(null);
  const {start,end}=useMemo(()=>dayWindow(date,days,profile.timeZone),[date,days,profile.timeZone]),ref=useRef<HTMLDivElement>(null);
  const [width,setWidth]=useState(800),[hover,setHover]=useState<number|null>(null),[pinned,setPinned]=useState<number|null>(null),[now,setNow]=useState(Date.now);
  useEffect(()=>{const el=ref.current;if(!el)return;const observer=new ResizeObserver(()=>setWidth(Math.max(280,el.clientWidth)));observer.observe(el);return()=>observer.disconnect();},[]);
  useEffect(()=>{setHover(null);if(pinned!==null&&(pinned<start||pinned>end))setPinned(null);},[start,end,pinned]);
  const {at,isNow}=timelineReadingTime({start,end,now,pinned,hover});
  const visible=useMemo(()=>doses.filter(includeTimelineDose),[doses]);
  const {names,eventRows,groups}=useMemo(()=>{
    const names=[...new Set(visible.flatMap(plotGroups))];
    const eventRows=visible.filter(d=>!names.some(group=>contributesToGroup(d,group)));
    return {names,eventRows,groups:[...names,...(eventRows.length||!names.length?['Timeline']:[])]};
  },[visible]);
  const [analyteChoice,setAnalyteChoice]=useState<string|null>(null);
  const selectedGroup=groups.includes(analyteChoice??'')?analyteChoice!:groups[0];
  const displayedNames=names.filter(name=>name===selectedGroup);
  const unknownEarlier=useMemo(()=>visible.some(d=>doseTimestamp(d)<start&&hasMissingTimelineData([d],start,end,publishedOnly,concentrationAnalyte(d)?.group)),[visible,start,end,publishedOnly]);
  const totals=useMemo(()=>estimateTotals(visible,at,publishedOnly),[visible,at,publishedOnly]);
  const readings=useMemo(()=>totals[selectedGroup]?.items??[],[totals,selectedGroup]);
  const sleeps=useMemo(()=>sleepIntervals(start,end,profile),[start,end,profile]);
  const needsDataNote=(dose:Dose)=>(!Number.isFinite(doseTimestamp(dose))||doseTimestamp(dose)<end)&&(!!referenceForDose(dose)||!!pkReferenceForDose(dose)||hasMissingTimelineData([dose],start,end,publishedOnly)||[at,end-1,...sleeps.flatMap(sleep=>[sleep.start,sleep.end])].some(time=>contributions([dose],time,publishedOnly).some(item=>item.tail||item.evidence==='D')));
  const showDataNote=visible.some(needsDataNote)||omittedUnknownHistoryCount>0;
  const sourceIds=[...new Set(visible.flatMap(dose=>[...(products.find(product=>product.id===dose.productId)?.sourceIds??[]),...(referenceForDose(dose)?.sourceIds??[]),...(pkReferenceForDose(dose)?.sourceIds??[])]))];
  function revealDataNote(){setShowReadings(true);setShowBasis(true);requestAnimationFrame(()=>noteRef.current?.focus());}
  const dataStar=()=> <button type="button" className="text-button data-note-link" aria-label="Show sources and calculation limits" aria-controls={dataNoteId} onClick={revealDataNote}><sup>*</sup></button>;
  const sampleTimes=useMemo(()=>Array.from({length:289},(_,i)=>start+(end-start)*i/288),[start,end]);
  const headers=useMemo(()=>Array.from({length:days},(_,i)=>{const d=addDays(date,i);return {date:d,...dayWindow(d,1,profile.timeZone)};}),[date,days,profile.timeZone]);
  const W=width,H=260,L=40,R=24,T=36,B=38,iw=W-L-R;
  const panels=useMemo(()=>[selectedGroup].map(group=>{
    const timing=group==='Timeline',members=timing?eventRows:visible.filter(d=>contributesToGroup(d,group));
    const samples=timing?{series:[],curves:[],max:1}:sampleTimelinePanel(members,group,sampleTimes,publishedOnly);
    // Qualify the whole visible plot, without calling a wholly unavailable reference an estimate.
    const hasEstimate=samples.series.some(sample=>sample.tail)||samples.curves.some(curve=>
      (curve.reference||(curve.dose.assumptions?.accepted&&modelGroup(curve.dose).group===group))
      &&doseTimestamp(curve.dose)<end&&curve.values.some((value,index)=>value!==null&&sampleTimes[index]>=doseTimestamp(curve.dose)));
    const hasMissing=members.some(dose=>hasMissingTimelineData([dose],start,end,publishedOnly,timing?undefined:group));
    const dataNote=hasEstimate?'* No direct data · Estimated':hasMissing?'* No direct data':null;
    return {group,timing,members,samples,dataNote};
  }),[selectedGroup,eventRows,visible,sampleTimes,publishedOnly,start,end]);
  const plots=useMemo(()=>panels.map(panel=>({...panel,...timelinePanelGeometry(panel.samples,sampleTimes,W,panel.timing?118:H,start,end)})),[panels,sampleTimes,W,start,end]);
  const pointerPlot=useRef({width:W,left:L,right:R,start,end}),pinnedValue=useRef(pinned);
  pointerPlot.current={width:W,left:L,right:R,start,end};pinnedValue.current=pinned;
  const scrubber=useMemo(()=>createTimelinePointer({
    time:event=>timelinePointerTime(event.clientX,event.currentTarget.getBoundingClientRect(),pointerPlot.current),
    getPinned:()=>pinnedValue.current,pin:value=>{pinnedValue.current=value;setPinned(value);},hover:setHover,
  }),[]);
  useEffect(()=>{scrubber.reset();},[start,end,scrubber]);
  useEffect(()=>startTimelineClock({onTick:setNow,onResume:()=>{scrubber.reset();pinnedValue.current=null;setPinned(null);}}),[scrubber]);
  function returnToNow(){scrubber.reset();pinnedValue.current=null;setPinned(null);setNow(Date.now());}
  const x=(t:number)=>L+(t-start)/(end-start)*iw;
  const tickHours=days===1?(width<500?6:4):12;
  function move(e:React.PointerEvent<SVGGElement>,d:Dose){if(d.status==='actual'||!onMove||!e.currentTarget.hasPointerCapture(e.pointerId))return;e.stopPropagation();const r=e.currentTarget.ownerSVGElement!.getBoundingClientRect();const t=start+Math.max(0,Math.min(1,((e.clientX-r.left)/r.width*W-L)/iw))*(end-start);const step=(profile.timeIncrementMinutes||5)*60000;onMove(d.id,new Date(Math.round(t/step)*step).toISOString());}
  return <div className="simple-timeline">{groups.length>1&&<div className="chart-analyte-choice"><label className="field"><span>Concentration to display</span><select aria-label="Concentration to display" value={selectedGroup} onChange={event=>setAnalyteChoice(event.target.value)}>{groups.map(group=><option key={group} value={group}>{group}</option>)}</select></label></div>}<div className="chart-main" ref={ref}>
    {visible.length===0?<TimelineEmptyState pending={hasPendingDose||doses.some(d=>d.status==='simulated')} hasHistory={omittedHistoryCount>0||omittedUnknownHistoryCount>0||doses.some(d=>d.status==='actual')} onAddDose={onAddDose}/>:plots.map(({group,timing,members,ceiling,totalPaths,curves,dataNote,historyPath,hasCurrent},index)=>{
      const unit=!timing?totals[group]?.unit??'':'';
      const panelH=timing?118:H,panelIh=panelH-T-B;
      const y=(v:number)=>T+panelIh-v/ceiling*panelIh;
      const current=totals[group];
      return <div className="analyte-panel" key={group}><div className="chart-heading"><h2>{group}</h2><div className="chart-heading-meta"><span className="muted">{timing?'':`${unit} · estimate`}</span>{dataNote&&<button type="button" className="text-button chart-estimate-note" aria-controls={dataNoteId} onClick={revealDataNote}>{dataNote}</button>}</div></div><div className="day-headings" style={{paddingLeft:L,paddingRight:R}}>{headers.map(h=><span key={h.date} style={{width:`${(h.end-h.start)/(end-start)*100}%`}}>{new Intl.DateTimeFormat('en-US',{timeZone:profile.timeZone,weekday:'short',month:'short',day:'numeric'}).format(h.start)}</span>)}</div>
      <svg className="chart-svg" viewBox={`0 0 ${W} ${panelH}`} role="img" tabIndex={0} aria-description="Point, tap or drag horizontally to read a time. Swipe vertically to scroll the page. Use arrow keys to move through time; Escape clears the selected time." onKeyDown={event=>{const direction=event.key==='ArrowRight'?1:event.key==='ArrowLeft'?-1:0;if(direction){event.preventDefault();const next=Math.min(end,Math.max(start,at+direction*(profile.timeIncrementMinutes||5)*60000));pinnedValue.current=next;setPinned(next);}else if(event.key==='Escape'){returnToNow();}}} aria-label={timing?'Dose times':`${group}, ${unit}. Exact readings are available below.`} onPointerDown={scrubber.down} onPointerMove={scrubber.move} onPointerUp={scrubber.up} onPointerCancel={scrubber.cancel} onLostPointerCapture={scrubber.cancel} onPointerLeave={()=>{scrubber.leave();if(pinnedValue.current===null)setNow(Date.now());}}>
        <defs><clipPath id={`plot-${index}`}><rect x={L} y={T-10} width={iw} height={panelIh+22}/></clipPath></defs>
        {sleeps.map(s=><g key={s.start}><rect x={x(Math.max(start,s.start))} y={T-10} width={x(Math.min(end,s.end))-x(Math.max(start,s.start))} height={panelIh+10} fill="#e7ebef"/><text className="sleep-label" x={x(Math.min(end,s.end))-x(Math.max(start,s.start))<42?x(Math.min(end,s.end))-2:x(Math.max(start,s.start))+5} y={T-18} textAnchor={x(Math.min(end,s.end))-x(Math.max(start,s.start))<42?"end":"start"}>Sleep</text></g>)}
        {(timing?[0]:[0,1,2,3,4]).map(i=><g key={i}><line x1={L} x2={W-R} y1={y(ceiling*i/4)} y2={y(ceiling*i/4)} stroke="#e0e5ea" strokeDasharray={i?'3 4':undefined}/>{!timing&&<text x={L-8} y={y(ceiling*i/4)+4} textAnchor="end">{Number((ceiling*i/4).toPrecision(3))}</text>}</g>)}
        {headers.slice(1).map(h=><line key={h.date} x1={x(h.start)} x2={x(h.start)} y1={T-10} y2={y(0)} stroke="#b9c2cd"/>)}
        {Array.from({length:Math.ceil((end-start)/3600000/tickHours)+1},(_,i)=>start+i*tickHours*3600000).filter(t=>t<=end).map(t=><text key={t} x={x(t)} y={panelH-12} textAnchor="middle">{new Intl.DateTimeFormat('en-US',{timeZone:profile.timeZone,hour:'numeric',hour12:profile.timeFormat==='12h'}).format(t)}</text>)}
        <g clipPath={`url(#plot-${index})`}>
          {!timing&&curves.filter(curve=>!curve.reference&&!isHistoryDose(curve.dose,start)).map(({dose:d,path})=><path key={d.id} d={path} stroke={colors[visible.findIndex(v=>v.id===d.id)%colors.length]} strokeWidth="1.5" fill="none"/>)}
          {!timing&&curves.filter(curve=>curve.reference&&!isHistoryDose(curve.dose,start)).map(({dose,path})=><path className="reference-overlay-path" key={`reference-${dose.id}`} d={path} stroke={colors[visible.findIndex(item=>item.id===dose.id)%colors.length]} strokeWidth="2.3" fill="none"/>)}
          {!timing&&hasCurrent&&<><path className="total-reference-path" d={totalPaths.solid} stroke="#426a95" strokeWidth="2.7" fill="none" strokeLinejoin="round"/><path className="total-estimated-path" d={totalPaths.estimated} stroke="#426a95" strokeWidth="2.7" fill="none" strokeLinejoin="round"/></>}
          {!timing&&historyPath&&<path className="history-total-path" d={historyPath} stroke="#8c729c" strokeWidth="2.2" strokeDasharray="5 4" fill="none"/>}
          {members.filter(d=>doseTimestamp(d)>=start&&doseTimestamp(d)<=end).map(d=>{const dx=x(doseTimestamp(d)),color=colors[visible.findIndex(v=>v.id===d.id)%colors.length];return <g key={d.id} style={{cursor:d.status==='actual'||!onMove?'default':'ew-resize',touchAction:d.status==='actual'||!onMove?'pan-y':'none'}} onClick={e=>e.stopPropagation()} onPointerDown={e=>{if(d.status==='actual'||!onMove)return;e.stopPropagation();e.currentTarget.setPointerCapture(e.pointerId);}} onPointerMove={e=>move(e,d)} onPointerUp={e=>{move(e,d);if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);}}><line x1={dx} x2={dx} y1={T+14} y2={y(0)} stroke={color} opacity=".25"/><rect x={dx-22} y={y(0)-22} width="44" height="44" fill="transparent"/>{d.status==='actual'?<circle cx={dx} cy={y(0)} r="5" fill={color} stroke="white" strokeWidth="1.5"/>:<path d={`M${dx},${y(0)-5}l5,5 -5,5 -5,-5Z`} fill={color} stroke="white"/>}</g>;})}
        </g>
        {now>=start&&now<end&&<g><line x1={x(now)} x2={x(now)} y1={T+10} y2={y(0)} stroke="#8c96a3" strokeDasharray="2 4"/><text x={Math.max(L+14,Math.min(W-R-14,x(now)))} y={T+3} textAnchor="middle">Now</text></g>}
        {!timing&&visible.length>0&&<line x1={x(at)} x2={x(at)} y1={T+10} y2={y(0)} stroke="#9ca9b8" strokeDasharray="3 4"/>}
        {current&&hasKnownTotal(current,at)&&<circle cx={x(at)} cy={y(current.value)} r="4" fill="#426a95" stroke="white" strokeWidth="2"/>}
      </svg>
      {members.length>0&&<div className="chart-legend">{!timing&&<span><i style={{background:'#426a95'}}/>{current?.complete?(unit==='ng/mL'?'Estimated total':'Illustrative sum'):hasKnownTotal(current,at)?'Known contributions':'Unknown total'}</span>}{!timing&&historyPath&&<span><i className="legend-history"/>From history</span>}{timelineLegend(members.filter(d=>!isHistoryDose(d,start))).map(({key,dose:d,members:entries})=><span className="legend-medication" key={key}><span className="legend-swatches" aria-hidden="true">{entries.map(entry=><i key={entry.id} style={{background:colors[visible.findIndex(v=>v.id===entry.id)%colors.length]}}/>)}</span><span className="legend-label"><MedicationName id={d.productId} name={d.productName}/><span className="legend-strength">{d.packageStrength||d.strength} {d.strengthUnit||'mg'}</span></span></span>)}</div>}


      </div>;
    })}
  </div>
  {selectedGroup==='Timeline'&&visible.length>0&&<p className="chart-unavailable">A concentration model is not available for this formulation yet. Dose times are shown.</p>}
  <div className="chart-summary">{displayedNames.length>0&&<div className="chart-readout"><div className="reading-control"><time className="reading-time" dateTime={new Date(at).toISOString()} title={formatInstant(at,profile,true)} aria-label={`${isNow?'Now, ':''}${formatInstant(at,profile,true)}`}><span className="reading-now" aria-hidden={!isNow} style={{visibility:isNow?'visible':'hidden'}}>Now</span>{new Intl.DateTimeFormat('en-US',{timeZone:profile.timeZone,hour:'numeric',minute:'2-digit',hourCycle:profile.timeFormat==='24h'?'h23':'h12'}).format(at)}</time><div className="reading-values">{Object.entries(totals).filter(([group])=>displayedNames.includes(group)).map(([group,g])=><span key={group} className="reading-value">{groups.length>1&&<small>{group}</small>}<span><span className="reading-number"><strong>{hasKnownTotal(g,at)?g.value.toFixed(2):'—'}</strong> <small>{g.unit}</small>{(g.hasReference||g.tail||!g.complete)&&dataStar()}</span></span>{!g.complete&&hasKnownTotal(g,at)&&<small>Known contributions only</small>}</span>)}</div></div><div className="reading-actions">{pinned!==null&&<button type="button" className="text-button" onClick={returnToNow}>Unpin</button>}</div></div>}</div>
  <div className="chart-footer"><div className="chart-footer-bar">{(visible.length>0||showDataNote)&&<button type="button" className="text-button chart-readings-toggle" aria-expanded={showReadings} aria-controls={readingsId} onClick={()=>setShowReadings(value=>!value)}><ChevronRight size={14} aria-hidden="true" style={{transform:showReadings?'rotate(90deg)':undefined}}/>Readings & details{omittedUnknownHistoryCount>0&&<sup aria-hidden="true">*</sup>}</button>}{(visible.length>0||onSources)&&<button type="button" className="text-button chart-sources-toggle" onClick={visible.length>0?revealDataNote:onSources}>Sources & methods</button>}</div>
  {(visible.length>0||showDataNote)&&<div className="chart-details" id={readingsId} hidden={!showReadings}><p className="muted">{baseline==='recorded'?'Includes recorded history. Earlier unrecorded history is unknown.':'Empty earlier history is an assumption.'} Circles = taken; diamonds = not recorded.</p>
    {(visible.length>0||showDataNote)&&<details open={showBasis} onToggle={event=>setShowBasis(event.currentTarget.open)}><summary className="chart-no-data" id={dataNoteId} ref={noteRef} tabIndex={0}>{showDataNote?'* No drug data':'Sources & methods'}</summary>{showDataNote&&<p>Starred values use a reference illustration, an estimated continuation, or only the available contributions. They are not measured personal concentrations. A dash means no supported value is available.</p>}{unknownEarlier&&<p>Earlier recorded doses have unknown direct contributions. Any available reference estimates are marked with a star.</p>}{omittedUnknownHistoryCount>0&&<p>{omittedUnknownHistoryCount} earlier record{omittedUnknownHistoryCount===1?'':'s'} with unknown contributions {omittedUnknownHistoryCount===1?'is':'are'} not shown. Their absence does not establish that the medication has cleared.</p>}{timelineLegend(visible).map(({key,dose})=><div key={key}><strong><MedicationName id={dose.productId} name={dose.productName}/></strong><DoseFormula dose={dose}/></div>)}{sourceIds.length>0&&<ul>{sources.filter(source=>sourceIds.includes(source.id)).map(source=><li key={source.id}><a href={source.url} target="_blank" rel="noreferrer">{source.title}</a></li>)}</ul>}</details>}
    {readings.map(c=>{const estimate=estimateContribution(c.dose,at,c.group,publishedOnly),value=estimate?.value??null;return <div className="contribution" key={`${c.dose.id}-${c.group}`}><span><strong><MedicationName id={c.dose.productId} name={c.dose.productName} marker={needsDataNote(c.dose)?dataStar():undefined}/></strong><small>{Number.isFinite(doseTimestamp(c.dose))?formatInstant(doseTimestamp(c.dose),profile,true):'Time unavailable'} · {c.dose.quantity} {c.dose.unit} × {c.dose.packageStrength||c.dose.strength} {c.dose.strengthUnit||'mg'}{Date.parse(c.dose.administeredAt)<start?' · Earlier dose':''}</small></span><span>{(estimate?.hasReference||estimate?.tail||value===null)&&dataStar()}{value===null?'—':`${value.toFixed(3)} ${c.unit}`}<small>{value===null?'Unavailable':estimate?.hasReference?'Reference estimate':c.tail?'Estimated continuation':c.evidence==='D'?'Saved illustration':`Evidence ${c.evidence}`}</small></span></div>;})}
    {visible.some(d=>effectWindow(d))&&<details className="effect-track"><summary>Assumed effect windows</summary>{visible.map(d=>{const w=effectWindow(d);if(!w)return null;return <div key={d.id} className="effect-row"><span><MedicationName id={d.productId} name={d.productName}/></span><div className="effect-rail"><i className="effect-band uncertain" style={{left:`${Math.max(0,(w.start-start)/(end-start)*100)}%`,width:`${Math.max(0,(Math.min(end,w.maxEnd)-Math.max(start,w.start))/(end-start)*100)}%`}}/><i className="effect-band" style={{left:`${Math.max(0,(w.start-start)/(end-start)*100)}%`,width:`${Math.max(0,(Math.min(end,w.minEnd)-Math.max(start,w.start))/(end-start)*100)}%`}}/></div><small>{formatInstant(w.start,profile,true)} → end {formatInstant(w.minEnd,profile,true)}–{formatInstant(w.maxEnd,profile,true)}</small></div>;})}<p className="muted">Assumed effect intervals, not clearance times or confidence intervals.</p></details>}
    {sleeps.length>0&&<details><summary>Sleep readings</summary>{sleeps.map(s=><div key={s.start}>{[s.start,s.end].map((t,i)=><p key={t}>{i?'Wake':'Bed'} · {formatInstant(t,profile,true)}: {Object.entries(estimateTotals(visible,t,publishedOnly)).filter(([name])=>name===selectedGroup).map(([name,g],index)=><span key={name}>{index>0?'; ':''}{name}: {(g.hasReference||g.tail||!g.complete)&&dataStar()}{hasKnownTotal(g,t)?g.value.toFixed(3):'—'} {g.unit}{!g.complete&&hasKnownTotal(g,t)?' (known contributions only)':''}</span>)}</p>)}</div>)}<p className="muted">Target sleep schedule. Does not predict sleep quality. <button className="text-button" onClick={onProfile}>Edit schedule</button></p></details>}
  </div>}
  <p className="simulation-notice"><a href={`${import.meta.env?.BASE_URL??'/drug/'}terms.html#medical-scope`} target="_blank" rel="noreferrer">Simulation only · Not medical advice</a></p></div></div>;
}
