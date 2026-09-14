import type { Checkin, Dose } from './types';
import { dayWindow, instantToLocal, localToInstant } from './time';

export const SYMPTOMS = [
  { id: 'headache', label: 'Headache' },
  { id: 'low-appetite', label: 'Low appetite' },
  { id: 'nausea', label: 'Nausea' },
  { id: 'dry-mouth', label: 'Dry mouth' },
  { id: 'sleep-trouble', label: 'Trouble sleeping' },
  { id: 'anxiety', label: 'Anxiety' },
  { id: 'palpitations', label: 'Palpitations' },
  { id: 'other', label: 'Other' },
  { id: 'concentrated', label: 'Concentrated' },
  { id: 'high-heart-rate', label: 'High heart rate' },
  { id: 'refreshed', label: 'Refreshed' },
  { id: 'none', label: 'No discomfort' },
] as const;
export type SymptomId = typeof SYMPTOMS[number]['id'];
export const PRIMARY_SYMPTOM_IDS: readonly SymptomId[] = ['concentrated', 'refreshed', 'low-appetite', 'sleep-trouble', 'headache', 'nausea', 'anxiety', 'high-heart-rate', 'none'];
export const POSITIVE_SYMPTOM_IDS: readonly SymptomId[] = ['concentrated', 'refreshed', 'none'];
export const SYMPTOM_IDS: readonly string[] = SYMPTOMS.map(item => item.id);
export const SYMPTOM_LABELS: Readonly<Record<string, string>> = Object.fromEntries(SYMPTOMS.map(item => [item.id, item.label]));

export function symptomSelectionError(values: readonly string[]): string {
  if (!values.length) return 'Choose a feeling, symptom or No discomfort.';
  if (values.some(value => !SYMPTOM_IDS.includes(value))) return 'Review the unrecognized selection.';
  if (new Set(values).size !== values.length) return 'Each choice can be selected only once.';
  if (values.includes('none') && values.length > 1) return 'No discomfort cannot be combined with another choice.';
  return '';
}

export function toggleSymptom(values: readonly string[], id: SymptomId): string[] {
  if (id === 'none') return values.includes('none') ? [] : ['none'];
  const selected = new Set(values.filter(value => value !== 'none'));
  if (selected.has(id)) selected.delete(id); else selected.add(id);
  return SYMPTOM_IDS.filter(value => selected.has(value));
}

export function latestCheckins(checkins: readonly Checkin[]): Checkin[] {
  const latest = new Map<string, Checkin>();
  for (const entry of checkins) {
    const previous = latest.get(entry.id);
    if (!previous || (entry.revision ?? 0) > (previous.revision ?? 0)) latest.set(entry.id, entry);
  }
  return [...latest.values()];
}

export function isSymptomCheckin(entry: Checkin): boolean {
  if (!Array.isArray(entry.symptoms) || symptomSelectionError(entry.symptoms) || !entry.recordedAt || !entry.timeZone) return false;
  try { return instantToLocal(entry.recordedAt, entry.timeZone).date === entry.date; } catch { return false; }
}

export interface SymptomDraft {
  date: string;
  time: string;
  disambiguation?: 'earlier' | 'later';
  symptoms: string[];
  note: string;
}

export function symptomDraftFromCheckin(entry: Checkin, timeZone: string): SymptomDraft {
  if (!entry.recordedAt) throw new Error('This older check-in has no precise time.');
  const local = instantToLocal(entry.recordedAt, timeZone);
  const earlier = localToInstant(local.date, local.time, timeZone, 'earlier');
  const later = localToInstant(local.date, local.time, timeZone, 'later');
  const disambiguation = earlier === later ? undefined
    : Math.floor(Date.parse(entry.recordedAt) / 60_000) === Math.floor(Date.parse(later) / 60_000) ? 'later' as const : 'earlier' as const;
  return { ...local, disambiguation, symptoms: [...entry.symptoms ?? []], note: entry.note ?? '' };
}

export function makeSymptomCheckin(draft: SymptomDraft, timeZone: string, existing?: Checkin, now = Date.now()): Checkin {
  const issue = symptomSelectionError(draft.symptoms);
  if (issue) throw new Error(issue);
  if (draft.note.length > 2000) throw new Error('Keep the note within 2,000 characters.');
  let recordedAt = localToInstant(draft.date, draft.time, timeZone, draft.disambiguation);
  // Editing only tags/notes should preserve any seconds in a saved instant.
  if (existing?.recordedAt) {
    try {
      const old = instantToLocal(existing.recordedAt, timeZone);
      if (old.date === draft.date && old.time === draft.time && Math.floor(Date.parse(existing.recordedAt) / 60_000) === Math.floor(Date.parse(recordedAt) / 60_000)) recordedAt = existing.recordedAt;
    } catch { /* An explicit time correction can repair invalid legacy input. */ }
  }
  if (Date.parse(recordedAt) > now + 60_000) throw new Error('Choose a time that has already happened.');
  return {
    ...existing, id: existing?.id ?? crypto.randomUUID(), date: draft.date, recordedAt, timeZone,
    symptoms: SYMPTOM_IDS.filter(id => draft.symptoms.includes(id)), note: draft.note,
  };
}

export function symptomCheckinsInRange(checkins: readonly Checkin[], from: string, to: string, timeZone: string): Checkin[] {
  if (from > to) throw new Error('Choose a start date on or before the end date.');
  const start = dayWindow(from, 1, timeZone).start, end = dayWindow(to, 1, timeZone).end;
  return latestCheckins(checkins).filter(entry => isSymptomCheckin(entry) && Date.parse(entry.recordedAt!) >= start && Date.parse(entry.recordedAt!) < end)
    .sort((a, b) => Date.parse(b.recordedAt!) - Date.parse(a.recordedAt!));
}

export interface SymptomSummary {
  entries: Checkin[];
  days: { date: string; symptoms: string[]; medicationIds: string[]; reports: number }[];
  frequencies: { id: SymptomId; label: string; reports: number; days: number }[];
  medications: { id: string; name: string }[];
  explicitNoneReports: number;
}

/** Counts are descriptive same-day records, not exposure attribution or causal estimates. */
export function summarizeSymptoms(checkins: readonly Checkin[], doses: readonly Dose[], from: string, to: string, timeZone: string): SymptomSummary {
  const entries = symptomCheckinsInRange(checkins, from, to, timeZone);
  const dayMap = new Map<string, { date: string; symptoms: Set<string>; medicationIds: Set<string>; reports: number }>();
  for (const entry of entries) {
    const date = instantToLocal(entry.recordedAt!, timeZone).date;
    const day = dayMap.get(date) ?? { date, symptoms: new Set<string>(), medicationIds: new Set<string>(), reports: 0 };
    for (const id of entry.symptoms!) if (id !== 'none') day.symptoms.add(id);
    day.reports++;
    dayMap.set(date, day);
  }
  const medicationMap = new Map<string, string>();
  const latestDoses = new Map<string, Dose>();
  for (const dose of doses) {
    const previous = latestDoses.get(dose.id);
    if (!previous || (dose.revision ?? 0) > (previous.revision ?? 0)) latestDoses.set(dose.id, dose);
  }
  for (const dose of latestDoses.values()) {
    if (dose.status !== 'actual' || !dose.productId || !dose.administeredAt) continue;
    try {
      const day = dayMap.get(instantToLocal(dose.administeredAt, timeZone).date);
      if (!day) continue;
      day.medicationIds.add(dose.productId);
      medicationMap.set(dose.productId, dose.productName);
    } catch { /* An invalid instant cannot establish same-day co-occurrence. */ }
  }
  const days = [...dayMap.values()].map(day => ({ ...day, symptoms: [...day.symptoms], medicationIds: [...day.medicationIds] })).sort((a, b) => a.date.localeCompare(b.date));
  return {
    entries, days,
    frequencies: SYMPTOMS.filter(item => item.id !== 'none').map(item => ({ ...item, reports: entries.filter(entry => entry.symptoms!.includes(item.id)).length, days: days.filter(day => day.symptoms.includes(item.id)).length })),
    medications: [...medicationMap.entries()].map(([id, name]) => ({ id, name })),
    explicitNoneReports: entries.filter(entry => entry.symptoms!.includes('none')).length,
  };
}

export function symptomDayComparison(summary: SymptomSummary, symptomId: string, productId = '') {
  const withMedication = summary.days.filter(day => productId ? day.medicationIds.includes(productId) : day.medicationIds.length > 0);
  const withoutMedication = summary.days.filter(day => productId ? !day.medicationIds.includes(productId) : day.medicationIds.length === 0);
  return {
    withMedication: { symptomDays: withMedication.filter(day => day.symptoms.includes(symptomId)).length, observedDays: withMedication.length },
    withoutMedication: { symptomDays: withoutMedication.filter(day => day.symptoms.includes(symptomId)).length, observedDays: withoutMedication.length },
  };
}
