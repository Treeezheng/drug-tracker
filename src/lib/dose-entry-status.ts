import { useEffect, useState } from 'react';
import { Temporal } from '@js-temporal/polyfill';
import type { Dose, Scenario } from './types';

export type DoseEntryStatus = 'actual' | 'planned';

/** Preview only. Saved records never change status because the clock advances. */
export function doseEntryStatus(administeredAt: string, now = Date.now()): DoseEntryStatus | null {
  if (!administeredAt || !Number.isFinite(now)) return null;
  try { return Temporal.Instant.from(administeredAt).epochMilliseconds > now ? 'planned' : 'actual'; }
  catch { return null; }
}

export function doseEntryLabel(administeredAt: string, now = Date.now()): 'Taken' | 'Planned' | 'New dose' {
  const status = doseEntryStatus(administeredAt, now);
  return status === 'actual' ? 'Taken' : status === 'planned' ? 'Planned' : 'New dose';
}

/** Keep previews current after a background tab wakes, without writing any records. */
export function useDoseEntryClock(): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const update = () => setNow(Date.now());
    const timer = window.setInterval(update, 1000);
    window.addEventListener('focus', update);
    document.addEventListener('visibilitychange', update);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', update); document.removeEventListener('visibilitychange', update); };
  }, []);
  return now;
}

/** Freeze one Add attempt. Retry this exact snapshot even if its time has passed. */
export function prepareDoseEntry(dose: Dose, now = Date.now()): Dose {
  const status = doseEntryStatus(dose.administeredAt, now);
  if (!status) throw new Error('Choose a complete date and time first.');
  const result = { ...structuredClone(dose), status };
  delete result.revision;
  return result;
}

/** Editing a saved plan never confirms administration; confirmation is a separate action. */
export function prepareDoseCorrection(dose: Dose, savedStatus: DoseEntryStatus, now = Date.now()): Dose {
  const classification = doseEntryStatus(dose.administeredAt, now);
  if (!classification) throw new Error('Choose a complete date and time first.');
  if (savedStatus === 'actual' && classification === 'planned') throw new Error('A taken dose cannot be in the future.');
  return { ...structuredClone(dose), status: savedStatus };
}

export function confirmPlannedDose(dose: Dose, now = Date.now()): Dose {
  if (dose.status !== 'planned') throw new Error('This dose is no longer planned. Refresh before continuing.');
  return prepareDoseCorrection(dose, 'actual', now);
}

/** Both saved states suppress a legacy Workspace copy; skipped records do too. */
export function partitionDoseEntries(records: Dose[], drafts: Dose[]): { actual: Dose[]; planned: Dose[]; drafts: Dose[] } {
  const ids = new Set(records.map(d => d.id));
  return { actual: records.filter(d => d.status === 'actual'), planned: records.filter(d => d.status === 'planned'), drafts: drafts.filter(d => !ids.has(d.id)) };
}

export function doseEntriesInWindow(doses: Dose[], start: number, end: number): Dose[] {
  return doses.filter(d => { const at = Date.parse(d.administeredAt); return at >= start && at < end; })
    .sort((a, b) => Date.parse(a.administeredAt) - Date.parse(b.administeredAt));
}

/** Remove only consumed legacy rows. Preserve its other drafts, view and comparison data. */
export function consumeWorkspaceDrafts(workspace: Scenario, records: Dose[]): Scenario | null {
  const ids = new Set(records.map(d => d.id));
  const doses = workspace.doses.filter(d => !ids.has(d.id));
  return doses.length === workspace.doses.length ? null : { ...structuredClone(workspace), doses: structuredClone(doses) };
}
