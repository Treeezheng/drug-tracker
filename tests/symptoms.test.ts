import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Checkin, Dose, Profile } from '../src/lib/types.ts';
import { isSymptomCheckin, makeSymptomCheckin, summarizeSymptoms, symptomCheckinsInRange, symptomDayComparison, symptomDraftFromCheckin, symptomSelectionError, toggleSymptom } from '../src/lib/symptoms.ts';
import { instantToLocal } from '../src/lib/time.ts';
import { newDose } from '../src/components/DoseEditor.tsx';
import Symptoms, { SymptomForm } from '../src/components/Symptoms.tsx';
import SymptomHistory from '../src/components/SymptomHistory.tsx';

const zone = 'America/Los_Angeles';
const profile: Profile = { name: '', timeZone: zone, timeFormat: '24h', sleepEnabled: false, bedtime: '', wakeTime: '', weekendEnabled: false, weekendBedtime: '', weekendWakeTime: '', timeIncrementMinutes: 5 };
function check(id: string, recordedAt: string, symptoms: string[], timeZone = zone): Checkin { return { id, recordedAt, date: instantToLocal(recordedAt, timeZone).date, timeZone, symptoms }; }
function taken(id: string, recordedAt: string, product = 'ritalin', status: Dose['status'] = 'actual'): Dose { return { ...newDose(product), id, administeredAt: recordedAt, status }; }

test('No discomfort is explicit, exclusive, reversible and never selected by default', () => {
  const selected = Object.freeze(['headache', 'nausea']);
  assert.deepEqual(toggleSymptom(selected, 'none'), ['none']);
  assert.deepEqual(toggleSymptom(['none'], 'headache'), ['headache']);
  assert.deepEqual(toggleSymptom(['none'], 'none'), []);
  assert.deepEqual(toggleSymptom(selected, 'headache'), ['nausea']);
  assert.match(symptomSelectionError([]), /Choose/);
  assert.match(symptomSelectionError(['none', 'headache']), /cannot be combined/);
  assert.match(symptomSelectionError(['headache', 'headache']), /only once/);
  assert.match(symptomSelectionError(['unrecognized']), /unrecognized/);
  assert.equal(symptomSelectionError(['headache', 'nausea']), '');
});

test('a symptom requires an explicit selection and real past local time, but no reason or note', () => {
  const draft = { date: '2026-09-13', time: '08:03', symptoms: ['headache'], note: '' };
  const entry = makeSymptomCheckin(draft, zone, undefined, Date.parse('2026-09-13T16:00:00Z'));
  assert.equal(entry.recordedAt, '2026-09-13T15:03:00Z'); assert.equal(entry.note, '');
  assert.equal(isSymptomCheckin(entry), true);
  assert.throws(() => makeSymptomCheckin({ ...draft, symptoms: [] }, zone), /Choose/);
  assert.throws(() => makeSymptomCheckin({ ...draft, time: '10:00' }, zone, undefined, Date.parse('2026-09-13T16:00:00Z')), /already happened/);
  assert.throws(() => makeSymptomCheckin({ ...draft, date: '2026-03-08', time: '02:30' }, zone), /does not exist/);
  assert.throws(() => makeSymptomCheckin({ ...draft, note: 'x'.repeat(2001) }, zone), /2,000/);
});

test('editing a later DST occurrence preserves its instant and seconds without rounding to the current step', () => {
  const old = { ...check('saved', '2026-11-01T09:33:27Z', ['headache']), revision: 4, focus: 'legacy retained' };
  const draft = symptomDraftFromCheckin(old, zone);
  assert.equal(draft.time, '01:33'); assert.equal(draft.disambiguation, 'later'); assert.equal(draft.note, '');
  const edited = makeSymptomCheckin({ ...draft, symptoms: ['nausea'], note: 'Optional note' }, zone, Object.freeze(old), Date.parse('2026-11-02T12:00:00Z'));
  assert.equal(edited.recordedAt, old.recordedAt); assert.equal(edited.id, old.id); assert.equal(edited.revision, 4); assert.equal(edited.focus, 'legacy retained');
  const earlier = makeSymptomCheckin({ ...draft, disambiguation: 'earlier' }, zone, old, Date.parse('2026-11-02T12:00:00Z'));
  assert.equal(earlier.recordedAt, '2026-11-01T08:33:00Z');
  assert.throws(() => makeSymptomCheckin({ ...draft, disambiguation: undefined }, zone, old), /occurs twice/);
});

test('editing in a new reporting time zone retains the original instant and updates its explicit local date', () => {
  const old = check('travel', '2026-09-14T02:03:21Z', ['dry-mouth'], 'Asia/Tokyo');
  const draft = symptomDraftFromCheckin(old, zone);
  assert.equal(old.date, '2026-09-14'); assert.equal(draft.date, '2026-09-13');
  const edited = makeSymptomCheckin(draft, zone, old, Date.parse('2026-09-15T00:00:00Z'));
  assert.equal(edited.recordedAt, old.recordedAt); assert.equal(edited.date, '2026-09-13'); assert.equal(edited.timeZone, zone); assert.equal(isSymptomCheckin(edited), true);
});

test('several same-day reports are several reports and one denominator day, including changing symptoms', () => {
  const checks = [check('am', '2026-09-13T15:00:00Z', ['headache', 'nausea']), check('pm', '2026-09-13T22:00:00Z', ['headache']), check('late', '2026-09-14T02:00:00Z', ['none']), check('next', '2026-09-14T18:00:00Z', ['none'])];
  const doses = [taken('taken', '2026-09-13T14:00:00Z'), taken('unobserved-day', '2026-09-15T18:00:00Z')];
  const summary = summarizeSymptoms(checks, doses, '2026-09-13', '2026-09-15', zone);
  assert.equal(summary.entries.length, 4); assert.equal(summary.days.length, 2); assert.equal(summary.explicitNoneReports, 2);
  assert.deepEqual(summary.frequencies.find(item => item.id === 'headache'), { id: 'headache', label: 'Headache', reports: 2, days: 1 });
  assert.deepEqual(symptomDayComparison(summary, 'headache'), { withMedication: { symptomDays: 1, observedDays: 1 }, withoutMedication: { symptomDays: 0, observedDays: 1 } });
});

test('planned, skipped and simulated rows never establish a Taken day; other medications are separate', () => {
  const checks = [check('one', '2026-09-13T18:00:00Z', ['headache']), check('two', '2026-09-14T18:00:00Z', ['nausea']), check('three', '2026-09-15T18:00:00Z', ['none'])];
  const doses = [taken('plan', '2026-09-13T17:00:00Z', 'ritalin', 'planned'), taken('skip', '2026-09-13T17:00:00Z', 'ritalin', 'skipped'), taken('sim', '2026-09-13T17:00:00Z', 'ritalin', 'simulated'), taken('real1', '2026-09-14T17:00:00Z', 'ritalin'), taken('real2', '2026-09-15T17:00:00Z', 'metformin-ir')];
  const summary = summarizeSymptoms(checks, doses, '2026-09-13', '2026-09-15', zone);
  assert.deepEqual(symptomDayComparison(summary, 'headache'), { withMedication: { symptomDays: 0, observedDays: 2 }, withoutMedication: { symptomDays: 1, observedDays: 1 } });
  assert.deepEqual(symptomDayComparison(summary, 'headache', 'ritalin'), { withMedication: { symptomDays: 0, observedDays: 1 }, withoutMedication: { symptomDays: 1, observedDays: 2 } });
});

test('a newer correction replaces the earlier symptom/date and Taken status before filtering', () => {
  const original = { ...check('same-id', '2026-09-13T18:00:00Z', ['headache']), revision: 1 };
  const corrected = { ...check('same-id', '2026-09-14T18:00:00Z', ['none']), revision: 2 };
  const oldDose = { ...taken('dose-id', '2026-09-14T17:00:00Z'), revision: 1 };
  const newDose = { ...oldDose, revision: 2, status: 'skipped' as const };
  const summary = summarizeSymptoms([original, corrected, original], [oldDose, newDose, oldDose], '2026-09-13', '2026-09-14', zone);
  assert.equal(summary.entries.length, 1); assert.equal(summary.days[0].date, '2026-09-14'); assert.equal(summary.frequencies[0].reports, 0);
  assert.equal(summary.medications.length, 0); assert.equal(symptomDayComparison(summary, 'headache').withMedication.observedDays, 0);
  assert.deepEqual(symptomCheckinsInRange([original, corrected], '2026-09-13', '2026-09-13', zone), []);
});

test('reporting dates use instants in the selected zone, not original travel dates or UTC calendar days', () => {
  const entry = check('travel', '2026-09-14T02:00:00Z', ['headache'], 'Asia/Tokyo');
  const summary = summarizeSymptoms([entry], [taken('dose', '2026-09-13T23:00:00Z')], '2026-09-13', '2026-09-13', zone);
  assert.equal(entry.date, '2026-09-14'); assert.equal(summary.days[0].date, '2026-09-13'); assert.equal(symptomDayComparison(summary, 'headache').withMedication.symptomDays, 1);
  assert.equal(summarizeSymptoms([entry], [], '2026-09-13', '2026-09-13', 'UTC').entries.length, 0);
});

test('23-hour and 25-hour local days retain both clock occurrences and exclude the next midnight', () => {
  const fall = [check('first', '2026-11-01T08:30:00Z', ['headache']), check('second', '2026-11-01T09:30:00Z', ['headache']), check('last', '2026-11-02T07:59:00Z', ['none']), check('next', '2026-11-02T08:00:00Z', ['nausea'])];
  const summary = summarizeSymptoms(fall, [taken('last-dose', '2026-11-02T07:58:00Z')], '2026-11-01', '2026-11-01', zone);
  assert.equal(summary.entries.length, 3); assert.equal(summary.days.length, 1); assert.equal(summary.frequencies[0].reports, 2); assert.equal(summary.frequencies[0].days, 1);
  const spring = [check('start', '2026-03-08T08:00:00Z', ['none']), check('last', '2026-03-09T06:59:00Z', ['nausea']), check('next', '2026-03-09T07:00:00Z', ['headache'])];
  assert.equal(symptomCheckinsInRange(spring, '2026-03-08', '2026-03-08', zone).length, 2);
});

test('legacy notes, malformed symptom timestamps and absence of a record are unknown rather than symptom-free', () => {
  const valid = check('valid', '2026-09-13T18:00:00Z', ['none']);
  const entries: Checkin[] = [{ id: 'legacy', date: '2026-09-13', focus: '3', sleepQuality: '4', note: 'Headache text is not a structured selection' }, { ...valid, id: 'mismatch', date: '2026-09-12' }, { ...valid, id: 'invalid', recordedAt: 'invalid' }, { ...valid, id: 'empty', symptoms: [] }, { ...valid, id: 'mixed', symptoms: ['none', 'headache'] }];
  assert.ok(entries.every(entry => !isSymptomCheckin(entry)));
  const summary = summarizeSymptoms(entries, [taken('real', '2026-09-13T18:00:00Z')], '2026-09-13', '2026-09-15', zone);
  assert.equal(summary.explicitNoneReports, 0); assert.equal(summary.days.length, 0);
  assert.deepEqual(symptomDayComparison(summary, 'headache'), { withMedication: { symptomDays: 0, observedDays: 0 }, withoutMedication: { symptomDays: 0, observedDays: 0 } });
});

test('simple chips expose selection state and optional note; exact existing minute remains editable', () => {
  const html = renderToStaticMarkup(createElement(Symptoms, { checkins: [], profile, onSave: async () => {}, onRemove: async () => {} }));
  const primary=html.match(/aria-label="Discomfort symptoms">([\s\S]*?)<\/div>/)?.[1]||'';
  assert.equal((primary.match(/aria-pressed="false"/g) ?? []).length, 6); assert.doesNotMatch(html, /aria-pressed="true"/);
  assert.match(html,/<details class="symptom-more"><summary>More symptoms<\/summary>/);
  for(const label of ['Dry mouth','Palpitations','Other'])assert.ok(html.includes(`>${label}</button>`));
  assert.match(html, /Note \(optional\)/); assert.match(html, /Save check-in/); assert.match(html, /novalidate=""/i);
  const existing = check('precise', '2026-09-13T15:03:21Z', ['headache']);
  const editing = renderToStaticMarkup(createElement(SymptomForm, { entry: existing, profile, onSave: async () => {} }));
  assert.match(editing, /aria-label="Discomfort time: 08:03"/); assert.equal((editing.match(/aria-pressed="true"/g) ?? []).length, 1);
});

test('empty history avoids percentages and invalid date ranges render safely', () => {
  const props = { checkins: [], doses: [], profile, from: '2026-09-13', to: '2026-09-14' };
  const html = renderToStaticMarkup(createElement(SymptomHistory, props));
  assert.match(html, /No check-ins in this period/); assert.doesNotMatch(html, /0%|0 \/ 0|symptom-free/);
  const invalid = renderToStaticMarkup(createElement(SymptomHistory, { ...props, from: '2026-09-16' }));
  assert.match(invalid, /valid date range/);
  const noMedication = renderToStaticMarkup(createElement(SymptomHistory, { ...props, checkins: [check('one', '2026-09-13T18:00:00Z', ['headache'])] }));
  assert.match(noMedication, /No observed days/); assert.match(noMedication, /Without a Taken record/); assert.match(noMedication, /do not show cause/);
});

test('common new tags and existing dry-mouth observations survive editing without requiring a note',()=>{
  const existing=check('old','2026-09-13T18:00:00Z',['dry-mouth']);
  const draft=symptomDraftFromCheckin(existing,zone);
  for(const id of ['anxiety','palpitations','other'] as const)draft.symptoms=toggleSymptom(draft.symptoms,id);
  const updated=makeSymptomCheckin(draft,zone,existing,Date.parse('2026-09-14T00:00:00Z'));
  assert.deepEqual(updated.symptoms,['dry-mouth','anxiety','palpitations','other']);
  assert.equal(updated.id,existing.id);assert.equal(updated.recordedAt,existing.recordedAt);assert.equal(updated.note,'');
  assert.deepEqual(existing.symptoms,['dry-mouth']);
  const html=renderToStaticMarkup(createElement(SymptomForm,{entry:existing,profile,onSave:async()=>{}}));
  assert.match(html,/<details class="symptom-more" open="">/);assert.match(html,/aria-pressed="true"[^>]*>[\s\S]*?Dry mouth/);
  for(const id of ['anxiety','palpitations','other'])assert.match(symptomSelectionError([id,'none']),/cannot be combined/);
});

test('History and saved check-ins retain date-only and timestamp-only legacy observations without inventing symptom days',()=>{
  const legacy:Checkin={id:'legacy',date:'2026-09-13',focus:'3',sleepQuality:'4',note:'Original legacy note'};
  const timestamp={id:'timestamp-only',recordedAt:'2026-09-13T18:00:00Z',timeZone:zone,note:'Timestamp-only note'} as Checkin;
  const before=JSON.stringify([legacy,timestamp]);
  const html=renderToStaticMarkup(createElement(SymptomHistory,{checkins:[legacy,timestamp],doses:[],profile,from:'2026-09-13',to:'2026-09-14'}));
  assert.match(html,/2 check-ins/);assert.match(html,/Original legacy note|Timestamp-only note/);
  assert.match(html,/2026-09-13 · time not recorded/);assert.match(html,/Focus: 3 · Sleep quality: 4/);
  assert.doesNotMatch(html,/Same-day medication records|No discomfort ·|symptom-free/);
  const saved=renderToStaticMarkup(createElement(Symptoms,{checkins:[legacy,timestamp],profile,onSave:async()=>{},onRemove:async()=>{}}));
  assert.match(saved,/Saved check-ins · 2/);assert.match(saved,/Original legacy note/);
  assert.equal(JSON.stringify([legacy,timestamp]),before);
});
