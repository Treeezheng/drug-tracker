import { Temporal } from '@js-temporal/polyfill';
import type { Profile } from './types';

type Disambiguation = 'earlier' | 'later';
export interface SleepInterval { start: number; end: number; label: string; }

function checkZone(zone: string): void {
  if (typeof zone !== 'string' || !zone || zone.trim() !== zone || /^[+-]|^Z$/i.test(zone)) {
    throw new RangeError('Choose a valid named time zone, such as America/Los_Angeles or UTC.');
  }
  try {
    Temporal.Instant.fromEpochMilliseconds(0).toZonedDateTimeISO(zone);
    // Formatting and calculations must both understand the saved zone.
    new Intl.DateTimeFormat('en-US', { timeZone: zone }).format(0);
  } catch {
    throw new RangeError(`Unknown time zone: ${zone}. Choose a valid named time zone.`);
  }
}

function readDate(date: string): Temporal.PlainDate {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new RangeError('Enter a complete date in YYYY-MM-DD format.');
  try {
    return Temporal.PlainDate.from(date, { overflow: 'reject' });
  } catch {
    throw new RangeError('Enter a valid calendar date.');
  }
}

function readTime(time: string): Temporal.PlainTime {
  if (!/^\d{2}:\d{2}$/.test(time)) throw new RangeError('Enter a complete time in HH:MM format.');
  try {
    return Temporal.PlainTime.from(time, { overflow: 'reject' });
  } catch {
    throw new RangeError('Enter a valid clock time between 00:00 and 23:59.');
  }
}

/** A recorded administration is never shifted through a missing clock hour. */
export function localToInstant(date: string, time: string, zone: string, disambiguation?: Disambiguation): string {
  checkZone(zone);
  if (disambiguation !== undefined && disambiguation !== 'earlier' && disambiguation !== 'later') {
    throw new RangeError('Choose the earlier or later occurrence of this time.');
  }
  const local = readDate(date).toPlainDateTime(readTime(time));
  const earlier = local.toZonedDateTime(zone, { disambiguation: 'earlier' });
  const later = local.toZonedDateTime(zone, { disambiguation: 'later' });
  if (!earlier.toPlainDateTime().equals(local) || !later.toPlainDateTime().equals(local)) {
    throw new RangeError(`${time} does not exist on ${date} in ${zone} because the clock changes. Choose another time.`);
  }
  if (earlier.epochNanoseconds !== later.epochNanoseconds && !disambiguation) {
    throw new RangeError(`${time} occurs twice on ${date} in ${zone}. Choose the earlier or later occurrence.`);
  }
  return (disambiguation === 'later' ? later : earlier).toInstant().toString();
}

export function instantToLocal(iso: string, zone: string): { date: string; time: string } {
  checkZone(zone);
  const zoned = Temporal.Instant.from(iso).toZonedDateTimeISO(zone);
  return { date: zoned.toPlainDate().toString(), time: zoned.toPlainTime().toString({ smallestUnit: 'minute' }) };
}

export function todayInZone(zone: string): string {
  checkZone(zone);
  return Temporal.Now.plainDateISO(zone).toString();
}

export function addDays(date: string, days: number): string {
  if (!Number.isSafeInteger(days)) throw new RangeError('The number of days must be a whole number.');
  return readDate(date).add({ days }).toString();
}

/** Calendar-day boundaries, rather than a fixed multiple of 24 elapsed hours. */
export function dayWindow(date: string, days: number, zone: string): { start: number; end: number } {
  checkZone(zone);
  if (!Number.isSafeInteger(days) || days < 1) throw new RangeError('Choose at least one whole calendar day.');
  const first = readDate(date);
  // Omitting a plain time returns the first real instant of that local date,
  // even in regions whose clock change skips midnight.
  const start = first.toZonedDateTime(zone);
  if (!start.toPlainDate().equals(first)) throw new RangeError(`The calendar date ${date} does not exist in ${zone}.`);
  return { start: start.epochMilliseconds, end: first.add({ days }).toZonedDateTime(zone).epochMilliseconds };
}

export function formatInstant(ms: number, profile: Profile, includeDate = true): string {
  checkZone(profile.timeZone);
  if (!Number.isFinite(ms)) throw new RangeError('Cannot format an invalid instant.');
  return new Intl.DateTimeFormat('en-US', {
    timeZone: profile.timeZone,
    ...(includeDate ? { month: 'short' as const, day: 'numeric' as const, year: 'numeric' as const } : {}),
    hour: '2-digit', minute: '2-digit',
    hourCycle: profile.timeFormat === '24h' ? 'h23' : 'h12',
    timeZoneName: 'short',
  }).format(ms);
}

/**
 * Target schedules recur by local calendar date; weekend means the bedtime day
 * is Saturday or Sunday. Return whole intervals so bedtime/wake readings remain
 * meaningful when a view begins or ends during sleep.
 *
 * A target boundary in a DST gap moves forward by the gap; an ambiguous boundary
 * uses its earlier occurrence (Temporal's compatible policy). Label the affected
 * interval. This policy applies to recurring targets only, never actual events.
 */
export function sleepIntervals(start: number, end: number, profile: Profile): SleepInterval[] {
  if (!profile.sleepEnabled) return [];
  checkZone(profile.timeZone);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end < start) {
    throw new RangeError('Choose a valid sleep chart range.');
  }
  if (start === end) return [];
  const regular = { bed: readTime(profile.bedtime), wake: readTime(profile.wakeTime) };
  const weekend = profile.weekendEnabled
    ? { bed: readTime(profile.weekendBedtime), wake: readTime(profile.weekendWakeTime) }
    : regular;
  for (const schedule of [regular, weekend]) {
    if (schedule.bed.equals(schedule.wake)) throw new RangeError('Bedtime and wake time must be different. Clear the sleep schedule to turn it off.');
  }
  const zone = profile.timeZone;
  const first = Temporal.Instant.fromEpochMilliseconds(start).toZonedDateTimeISO(zone).toPlainDate().subtract({ days: 1 });
  const last = Temporal.Instant.fromEpochMilliseconds(end - 1).toZonedDateTimeISO(zone).toPlainDate();
  const intervals: SleepInterval[] = [];
  for (let date = first; Temporal.PlainDate.compare(date, last) <= 0; date = date.add({ days: 1 })) {
    const schedule = profile.weekendEnabled && date.dayOfWeek >= 6 ? weekend : regular;
    const wakeDate = Temporal.PlainTime.compare(schedule.wake, schedule.bed) < 0 ? date.add({ days: 1 }) : date;
    const localBed = date.toPlainDateTime(schedule.bed);
    const localWake = wakeDate.toPlainDateTime(schedule.wake);
    const bed = localBed.toZonedDateTime(zone, { disambiguation: 'compatible' });
    const wake = localWake.toZonedDateTime(zone, { disambiguation: 'compatible' });
    // A civil date can be omitted entirely by a time-zone change. Do not create
    // another bedtime occurrence on the following date in its place.
    if (!bed.toPlainDate().equals(date) || wake.epochMilliseconds <= bed.epochMilliseconds) continue;
    if (wake.epochMilliseconds <= start || bed.epochMilliseconds >= end) continue;
    const adjusted = bed.offset !== wake.offset
      || !bed.toPlainDateTime().equals(localBed) || !wake.toPlainDateTime().equals(localWake)
      || localBed.toZonedDateTime(zone, { disambiguation: 'later' }).epochNanoseconds !== bed.epochNanoseconds
      || localWake.toZonedDateTime(zone, { disambiguation: 'later' }).epochNanoseconds !== wake.epochNanoseconds;
    intervals.push({ start: bed.epochMilliseconds, end: wake.epochMilliseconds, label: adjusted ? 'Sleep · clock change' : 'Sleep' });
  }
  return intervals;
}
