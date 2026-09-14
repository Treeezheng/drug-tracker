import { useState } from 'react';
import type { Checkin, Dose, Profile } from '../lib/types';
import { POSITIVE_SYMPTOM_IDS, summarizeSymptoms, symptomDayComparison } from '../lib/symptoms';
import { SymptomRecords } from './Symptoms';
import { filterCheckins } from '../lib/reports';

export default function SymptomHistory({ checkins, doses, profile, from, to, onSave, onRemove }: { checkins: Checkin[]; doses: Dose[]; profile: Profile; from: string; to: string; onSave?: (entry: Checkin) => Promise<void>; onRemove?: (entry: Checkin) => Promise<void> }) {
  const [symptom, setSymptom] = useState('headache'), [medication, setMedication] = useState('');
  let summary,entries;
  try { summary = summarizeSymptoms(checkins, doses, from, to, profile.timeZone); entries=filterCheckins(checkins,from,to,profile.timeZone).reverse(); }
  catch { return <section className="card symptoms-card"><h2>Feeling / discomfort</h2><p className="muted">Choose a valid date range to view check-ins.</p></section>; }
  const selectedMedication = summary.medications.some(item => item.id === medication) ? medication : '';
  const comparison = symptomDayComparison(summary, symptom, selectedMedication), largest = Math.max(1, ...summary.frequencies.map(item => item.reports));
  return <section className="card symptoms-card symptom-history">
    <div className="symptom-heading"><h2>Feeling / discomfort</h2><span>{entries.length} check-in{entries.length === 1 ? '' : 's'}</span></div>
    {!entries.length ? <p className="muted symptom-empty">No check-ins in this period.</p> : <>
      <div className="symptom-frequency" aria-label="Feeling / discomfort report counts">{summary.frequencies.filter(item => item.reports > 0).map(item => <div className={`symptom-frequency-row${POSITIVE_SYMPTOM_IDS.includes(item.id) ? ' positive' : ''}`} key={item.id}><span>{item.label}</span><span className="symptom-bar" aria-hidden="true"><i style={{ width: `${100 * item.reports / largest}%` }}/></span><span className="symptom-count">{item.reports} report{item.reports === 1 ? '' : 's'} <small>· {item.days} day{item.days === 1 ? '' : 's'}</small></span></div>)}</div>
      {summary.explicitNoneReports > 0 && <p className="symptom-none">No discomfort · {summary.explicitNoneReports} check-ins</p>}
      {summary.entries.length>0&&<details className="symptom-comparison"><summary>Same-day medication records</summary>
        <div className="symptom-comparison-filters"><label className="field"><span>Feeling / discomfort</span><select aria-label="Compare feeling / discomfort" value={symptom} onChange={event => setSymptom(event.target.value)}>{summary.frequencies.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label><label className="field"><span>Medication</span><select aria-label="Compare check-in medication" value={selectedMedication} onChange={event => setMedication(event.target.value)}><option value="">Any medication</option>{summary.medications.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></div>
        <div className="symptom-comparison-counts">{([{ label: 'With a Taken record', value: comparison.withMedication }, { label: 'Without a Taken record', value: comparison.withoutMedication }]).map(item => <div key={item.label}><span>{item.label}</span><strong>{item.value.observedDays ? `${item.value.symptomDays} / ${item.value.observedDays}` : '—'}</strong><small>{item.value.observedDays ? 'days with this selection / check-in days' : 'No observed days'}</small></div>)}</div>
        <p className="symptom-method">Only days with a feeling / discomfort check-in are counted, in {profile.timeZone}. Same-day records do not show cause; no Taken record does not confirm that no medication was taken.</p>
      </details>}
      <details className="symptom-records-details"><summary>Check-ins · {entries.length}</summary><SymptomRecords entries={entries} profile={profile} onSave={onSave} onRemove={onRemove}/></details>
    </>}
  </section>;
}
