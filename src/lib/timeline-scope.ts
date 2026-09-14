import { products } from './catalog';
import { concentrationAnalyte, CONCERTA_TRACE, contributesToGroup, doseTimestamp, modelGroup, referenceForDose } from './model';
import { hasMissingTimelineData } from './timeline-data';
import { estimateContribution } from './timeline-estimates';
import type { Dose } from './types';

export const TIMELINE_DISPLAY_THRESHOLD = 0.001;

interface TimelineScopeInput {
  actual: Dose[];
  drafts: Dose[];
  start: number;
  end: number;
  publishedOnly?: boolean;
}

export interface TimelineScope {
  doses: Dose[];
  sourceIds: string[];
  omittedHistoryCount: number;
  omittedUnknownHistoryCount: number;
}

/**
 * A conservative maximum of a single implemented profile within the view.
 * These kernels are monotone between their reference knots / one peak. Checking
 * those points and the boundaries avoids missing a narrow peak through sampling.
 * Summing individual maxima can retain an extra group, but cannot hide a group
 * whose known contributions together reach the display threshold.
 */
function maximumKnownContribution(dose: Dose, start: number, end: number, publishedOnly: boolean): number {
  const admin = doseTimestamp(dose);
  if (!Number.isFinite(admin)) return 0;
  const product = products.find(p => p.id === dose.productId);
  const reference = referenceForDose(dose);
  const elapsedHours: number[] = [];
  if (modelGroup(dose).reference || reference) {
    if (product?.model === 'concerta' || reference?.referenceProductId === 'concerta') elapsedHours.push(...CONCERTA_TRACE.map(([hours]) => hours));
    if (product?.model === 'ritalin' || reference?.referenceProductId === 'ritalin') {
      const elimination = Math.LN2 / 3.5, absorption = 1.0152449556;
      elapsedHours.push(Math.log(absorption / elimination) / (absorption - elimination));
    }
  } else if (dose.assumptions?.accepted) {
    elapsedHours.push(dose.assumptions.lagHours, dose.assumptions.lagHours + dose.assumptions.peakHours);
  }
  const points = [start, end, ...elapsedHours.map(hours => admin + hours * 3_600_000)]
    .filter(at => Number.isFinite(at) && at >= start && at <= end);
  return Math.max(0, ...points.map(at => {
    const value = estimateContribution(dose, at, modelGroup(dose).group, publishedOnly)?.value;
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
  }));
}

/**
 * Select groups to display, without changing or truncating any dose contribution.
 * A current recorded event or explicit editor row always keeps its group. Every
 * earlier record in a kept group remains, including unknown contributions.
 * History-only groups with a small known contribution may be hidden. Unknown
 * histories are counted separately; this never establishes that they cleared.
 * Every unknown dose of a displayed concentration analyte remains in its total,
 * even when a separate saved illustration uses relative units.
 */
export function scopeTimeline({ actual, drafts, start, end, publishedOnly = false }: TimelineScopeInput): TimelineScope {
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    throw new RangeError('Choose a valid timeline interval.');
  }
  const recordsById = new Map<string, Dose>();
  for (const dose of actual) {
    if (dose.status !== 'actual') continue;
    const previous = recordsById.get(dose.id);
    if (!previous || (dose.revision ?? 0) > (previous.revision ?? 0)) recordsById.set(dose.id, dose);
  }
  const editingById = new Map<string, Dose>();
  for (const dose of drafts) {
    if (!dose.productId || dose.status === 'skipped' || recordsById.has(dose.id)) continue;
    editingById.set(dose.id, dose);
  }
  const editing = [...editingById.values()];
  // Only a known future time can exclude an actual record. An invalid time
  // cannot prove that its contribution is outside the view.
  const records = [...recordsById.values()].filter(dose => !Number.isFinite(doseTimestamp(dose)) || doseTimestamp(dose) < end);
  const keep = new Set(editing.map(dose => modelGroup(dose).group));
  for (const dose of records) {
    if (!Number.isFinite(doseTimestamp(dose)) || doseTimestamp(dose) >= start) keep.add(modelGroup(dose).group);
  }
  const bounds = new Map<string, number>();
  for (const dose of records) {
    const group = modelGroup(dose).group;
    if (keep.has(group)) continue;
    bounds.set(group, (bounds.get(group) ?? 0) + maximumKnownContribution(dose, start, end, publishedOnly));
  }
  for (const [group, bound] of bounds) {
    if (bound >= TIMELINE_DISPLAY_THRESHOLD) keep.add(group);
  }
  const isKept=(dose:Dose)=>[...keep].some(group=>contributesToGroup(dose,group));
  const retained = records.filter(isKept);
  const omitted=records.filter(dose=>Date.parse(dose.administeredAt)<start&&!isKept(dose));
  const doses = [...retained, ...editing];
  const sourceIds = [...new Set(doses.flatMap(dose => [
    ...(products.find(p => p.id === dose.productId)?.sourceIds ?? []),
    ...(referenceForDose(dose)?.sourceIds ?? []),
  ]))];
  return {
    doses,
    sourceIds,
    omittedHistoryCount: omitted.length,
    omittedUnknownHistoryCount: omitted.filter(dose=>hasMissingTimelineData([dose],start,end,publishedOnly,concentrationAnalyte(dose)?.group)).length,
  };
}
