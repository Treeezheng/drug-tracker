import { useId, useState } from 'react';
import { Check, Pencil, Trash2 } from 'lucide-react';
import type { Checkin, Profile } from '../lib/types';
import { formatInstant, localToInstant } from '../lib/time';
import { isSymptomCheckin, latestCheckins, makeSymptomCheckin, PRIMARY_SYMPTOM_IDS, SYMPTOMS, SYMPTOM_LABELS, symptomDraftFromCheckin, toggleSymptom } from '../lib/symptoms';
import type { SymptomDraft } from '../lib/symptoms';
import { currentDoseTime } from './DoseEditor';
import Modal from './Modal';
import MobileTimePicker from './MobileTimePicker';

type SaveCheckin = (entry: Checkin) => Promise<void>;
type RemoveCheckin = (entry: Checkin) => Promise<void>;

export function SymptomForm({ profile, entry, onSave, onSaved }: { profile: Profile; entry?: Checkin; onSave: SaveCheckin; onSaved?: () => void }) {
  const blank = (): SymptomDraft => ({ ...currentDoseTime(profile.timeZone, profile.timeIncrementMinutes ?? 5), symptoms: [], note: '' });
  const [draft, setDraft] = useState<SymptomDraft>(() => entry ? symptomDraftFromCheckin(entry, profile.timeZone) : blank());
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [customTime, setCustomTime] = useState(false);
  const fieldId = useId(), errorId = `${fieldId}-error`, timeErrorId = `${fieldId}-time-error`;
  let timeError = '', repeatedTime = false;
  try { localToInstant(draft.date, draft.time, profile.timeZone, draft.disambiguation); }
  catch (e) { timeError = (e as Error).message; }
  try { repeatedTime = localToInstant(draft.date, draft.time, profile.timeZone, 'earlier') !== localToInstant(draft.date, draft.time, profile.timeZone, 'later'); } catch { /* The date/time error explains incomplete or missing times. */ }
  const chip=(symptom:typeof SYMPTOMS[number])=><button key={symptom.id} type="button" className={`symptom-chip ${draft.symptoms.includes(symptom.id) ? 'selected' : ''}`} aria-pressed={draft.symptoms.includes(symptom.id)} onClick={() => setDraft(previous => ({ ...previous, symptoms: toggleSymptom(previous.symptoms, symptom.id) }))}>{draft.symptoms.includes(symptom.id) && <Check size={13} aria-hidden="true" />}{symptom.label}</button>;
  return <form className="symptom-form" noValidate onSubmit={async event => {
    event.preventDefault(); if (busy) return; setError(''); setBusy(true);
    try { await onSave(makeSymptomCheckin(!entry && !customTime ? { ...draft, ...currentDoseTime(profile.timeZone, profile.timeIncrementMinutes ?? 5) } : draft, profile.timeZone, entry)); if (!entry) { setDraft(blank()); setCustomTime(false); } onSaved?.(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }}>
    <fieldset disabled={busy}>
      <legend className="sr-only">Discomfort check-in</legend>
      <div className="symptom-chips" role="group" aria-label="Discomfort symptoms">
        {PRIMARY_SYMPTOM_IDS.map(id=>chip(SYMPTOMS.find(item=>item.id===id)!))}
      </div>
      <details className="symptom-more" open={entry?.symptoms?.some(id=>!PRIMARY_SYMPTOM_IDS.includes(id as typeof PRIMARY_SYMPTOM_IDS[number]))||undefined}><summary>More symptoms</summary><div className="symptom-chips" role="group" aria-label="Other discomfort symptoms">{SYMPTOMS.filter(item=>!PRIMARY_SYMPTOM_IDS.includes(item.id)).map(chip)}</div></details>
      <details className="symptom-time-details"><summary>Date & time</summary><div className="symptom-time-row">
        <label className="field"><span>Date</span><input type="date" aria-label="Discomfort date" aria-invalid={!!timeError} aria-describedby={timeError ? timeErrorId : undefined} value={draft.date} onChange={event => { setCustomTime(true); setDraft(previous => ({ ...previous, date: event.target.value, disambiguation: undefined })); }} /></label>
        <div className="field"><span>Time</span><MobileTimePicker minuteStep={profile.timeIncrementMinutes??5} timeFormat={profile.timeFormat} label="Discomfort time" invalid={!!timeError} describedBy={timeError?timeErrorId:undefined} value={draft.time} onChange={time => { setCustomTime(true); setDraft(previous => ({ ...previous, time, disambiguation: undefined })); }}/></div>
        <button type="button" className="button subtle" aria-label="Use current time for discomfort" onClick={() => { setCustomTime(false); setDraft(previous => ({ ...previous, ...currentDoseTime(profile.timeZone, profile.timeIncrementMinutes ?? 5) })); }}>Now</button>
      </div>
      {repeatedTime && <label className="field"><span>Clock occurrence</span><select aria-label="Discomfort clock occurrence" value={draft.disambiguation ?? ''} onChange={event => setDraft(previous => ({ ...previous, disambiguation: event.target.value as 'earlier' | 'later' || undefined }))}><option value="">Choose occurrence</option><option value="earlier">Earlier occurrence</option><option value="later">Later occurrence</option></select></label>}
      {timeError && <p id={timeErrorId} className="inline-error" role="alert">{timeError}</p>}</details>
      <details className="symptom-note"><summary>Note (optional)</summary><label className="field"><span className="sr-only">Discomfort note</span><textarea aria-label="Discomfort note (optional)" maxLength={2000} rows={2} value={draft.note} onChange={event => setDraft(previous => ({ ...previous, note: event.target.value }))} /></label></details>
      {error && <p id={errorId} className="inline-error" role="alert">{error}</p>}
      <div className="symptom-form-actions"><button className="button primary" type="submit" aria-describedby={error ? errorId : undefined}>{busy ? 'Saving…' : entry ? 'Save changes' : 'Save check-in'}</button></div>
    </fieldset>
  </form>;
}

export function SymptomRecords({ entries, profile, onSave, onRemove }: { entries: Checkin[]; profile: Profile; onSave?: SaveCheckin; onRemove?: RemoveCheckin }) {
  const [editing, setEditing] = useState<Checkin | null>(null), [busy, setBusy] = useState(''), [error, setError] = useState(''), [showAll, setShowAll] = useState(false);
  const shown = showAll ? entries : entries.slice(0, 10);
  return <>
    {error && <p className="inline-error" role="alert">{error}</p>}
    <div className="symptom-records">{shown.map(entry => {
      const label=entry.recordedAt&&Number.isFinite(Date.parse(entry.recordedAt))?formatInstant(Date.parse(entry.recordedAt),profile):`${entry.date||'Date not recorded'} · time not recorded`;
      const observation=[...(entry.symptoms??[]).map(id=>SYMPTOM_LABELS[id]||id),entry.focus!==undefined?`Focus: ${entry.focus}`:'',entry.sleepQuality!==undefined?`Sleep quality: ${entry.sleepQuality}`:''].filter(Boolean).join(' · ');
      return <div className="symptom-record" key={entry.id}>
      <div className="symptom-record-copy"><time dateTime={entry.recordedAt||entry.date}>{label}</time>{observation&&<p>{observation}</p>}{entry.note && <details><summary>Note</summary><p className="symptom-saved-note">{entry.note}</p></details>}</div>
      <div className="symptom-record-actions">{onSave && isSymptomCheckin(entry) && <button type="button" className="icon-button" disabled={!!busy} aria-label={`Edit discomfort check-in ${label}`} onClick={() => setEditing(entry)}><Pencil size={15}/></button>}{onRemove && <button type="button" className="icon-button" disabled={!!busy} aria-label={`Delete discomfort check-in ${label}`} onClick={async () => {
        if (!window.confirm('Delete this discomfort check-in?')) return;
        setError(''); setBusy(entry.id);
        try { await onRemove(entry); } catch (e) { setError((e as Error).message); } finally { setBusy(''); }
      }}><Trash2 size={15}/></button>}</div>
    </div>;})}</div>
    {!showAll && entries.length > 10 && <button type="button" className="button subtle" onClick={() => setShowAll(true)}>Show all {entries.length} check-ins</button>}
    {editing && onSave && <Modal title="Edit discomfort" onClose={() => setEditing(null)}><SymptomForm key={`${editing.id}-${editing.revision ?? 0}-${profile.timeZone}`} profile={profile} entry={editing} onSave={onSave} onSaved={() => setEditing(null)}/></Modal>}
  </>;
}

export default function Symptoms({ checkins, profile, onSave, onRemove }: { checkins: Checkin[]; profile: Profile; onSave: SaveCheckin; onRemove: RemoveCheckin }) {
  const entries = latestCheckins(checkins).sort((a,b)=>(b.recordedAt||b.date||'').localeCompare(a.recordedAt||a.date||''));
  return <details className="card symptoms-card discomfort-disclosure"><summary>Discomfort</summary><SymptomForm key={profile.timeZone} profile={profile} onSave={onSave}/>{entries.length > 0 && <details className="symptom-records-details"><summary>Saved check-ins · {entries.length}</summary><SymptomRecords entries={entries} profile={profile} onSave={onSave} onRemove={onRemove}/></details>}</details>;
}
