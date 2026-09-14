import test from 'node:test';
import assert from 'node:assert/strict';
import { addDays, dayWindow, formatInstant, instantToLocal, localToInstant, sleepIntervals, todayInZone } from '../src/lib/time';
import type { Profile } from '../src/lib/types';

const HOUR = 3_600_000;
const profile: Profile = {
  name: 'Test', timeZone: 'America/Los_Angeles', timeFormat: '24h',
  sleepEnabled: true, bedtime: '23:00', wakeTime: '07:00',
  weekendEnabled: false, weekendBedtime: '00:00', weekendWakeTime: '08:00',
};

test('actual local input rejects the missing spring hour even if an occurrence is selected', () => {
  for (const occurrence of [undefined, 'earlier', 'later'] as const) {
    assert.throws(() => localToInstant('2026-03-08', '02:30', profile.timeZone, occurrence), /does not exist/);
  }
  assert.equal(localToInstant('2026-03-08', '03:30', profile.timeZone), '2026-03-08T10:30:00Z');
});

test('actual fall input requires an explicit occurrence and preserves both different instants', () => {
  assert.throws(() => localToInstant('2026-11-01', '01:30', profile.timeZone), /occurs twice/);
  const earlier = localToInstant('2026-11-01', '01:30', profile.timeZone, 'earlier');
  const later = localToInstant('2026-11-01', '01:30', profile.timeZone, 'later');
  assert.equal(earlier, '2026-11-01T08:30:00Z');
  assert.equal(later, '2026-11-01T09:30:00Z');
  assert.equal(Date.parse(later) - Date.parse(earlier), HOUR);
  assert.deepEqual(instantToLocal(earlier, profile.timeZone), instantToLocal(later, profile.timeZone));
  assert.notEqual(formatInstant(Date.parse(earlier), profile), formatInstant(Date.parse(later), profile));
});

test('calendar-day views use real 23/25 hour days and consistent multi-day endpoints', () => {
  const spring = dayWindow('2026-03-08', 1, profile.timeZone);
  const fall = dayWindow('2026-11-01', 1, profile.timeZone);
  assert.equal((spring.end - spring.start) / HOUR, 23);
  assert.equal((fall.end - fall.start) / HOUR, 25);
  const springThreeDays = dayWindow('2026-03-07', 3, profile.timeZone);
  assert.equal((springThreeDays.end - springThreeDays.start) / HOUR, 71);
  assert.equal(springThreeDays.end, dayWindow('2026-03-09', 1, profile.timeZone).end);
});

test('calendar arithmetic handles leap dates and rejects normalizing invalid input', () => {
  assert.equal(addDays('2028-02-28', 1), '2028-02-29');
  assert.equal(addDays('2028-02-29', 1), '2028-03-01');
  assert.equal(addDays('2026-01-01', -1), '2025-12-31');
  assert.throws(() => localToInstant('2026-02-30', '08:00', profile.timeZone), /valid calendar/);
  assert.throws(() => localToInstant('2026-02-28', '24:00', profile.timeZone), /valid clock/);
  assert.throws(() => localToInstant('2026-02-28', '', profile.timeZone), /complete time/);
  assert.throws(() => localToInstant('', '08:00', profile.timeZone), /complete date/);
  assert.throws(() => localToInstant('2026-02-28', '08:00', 'Mars/Olympus'), /Unknown time zone/);
  assert.throws(() => localToInstant('2026-02-28', '08:00', '-08:00'), /named time zone/);
});

test('travel changes local labels without changing the recorded instant', () => {
  const instant = localToInstant('2026-09-13', '23:30', profile.timeZone);
  assert.equal(instant, '2026-09-14T06:30:00Z');
  assert.deepEqual(instantToLocal(instant, 'Asia/Tokyo'), { date: '2026-09-14', time: '15:30' });
  assert.equal(localToInstant('2026-09-14', '15:30', 'Asia/Tokyo'), instant);
  assert.match(formatInstant(Date.parse(instant), profile), /Sep 13, 2026/);
  assert.match(formatInstant(Date.parse(instant), { ...profile, timeFormat: '12h' }), /11:30\s?PM/);
  assert.match(todayInZone('UTC'), /^\d{4}-\d{2}-\d{2}$/);
});

test('23:00–07:00 remains one full overnight interval at both edges of a day view', () => {
  const range = dayWindow('2026-09-14', 1, profile.timeZone);
  const intervals = sleepIntervals(range.start, range.end, profile);
  assert.equal(intervals.length, 2);
  assert.deepEqual(intervals[0], {
    start: Date.parse('2026-09-14T06:00:00Z'), end: Date.parse('2026-09-14T14:00:00Z'), label: 'Sleep',
  });
  assert.ok(intervals[0].start < range.start, 'ongoing sleep retains the original bedtime');
  assert.ok(intervals[1].end > range.end, 'next-day wake is retained after the displayed midnight');
  assert.equal(intervals[0].end - intervals[0].start, 8 * HOUR);
  const multi = dayWindow('2026-09-14', 3, profile.timeZone);
  assert.equal(sleepIntervals(multi.start, multi.end, profile).length, 4);
});

test('weekend override is chosen by the bedtime calendar date, including an ongoing Sunday night', () => {
  const range = dayWindow('2026-09-14', 1, profile.timeZone); // Monday
  const intervals = sleepIntervals(range.start, range.end, {
    ...profile, weekendEnabled: true, weekendBedtime: '23:30', weekendWakeTime: '09:00',
  });
  assert.equal(instantToLocal(new Date(intervals[0].start).toISOString(), profile.timeZone).time, '23:30');
  assert.equal(instantToLocal(new Date(intervals[0].end).toISOString(), profile.timeZone).time, '09:00');
  assert.equal(instantToLocal(new Date(intervals[1].start).toISOString(), profile.timeZone).time, '23:00');
});

test('sleep reflects elapsed DST hours without splitting the overnight interval', () => {
  for (const [date, elapsedHours] of [['2026-03-08', 7], ['2026-11-01', 9]] as const) {
    const range = dayWindow(date, 1, profile.timeZone);
    const overnight = sleepIntervals(range.start, range.end, profile)[0];
    assert.equal((overnight.end - overnight.start) / HOUR, elapsedHours);
    assert.equal(overnight.label, 'Sleep · clock change');
  }
});

test('a recurring target in a missing hour uses the documented forward shift and marks it', () => {
  const range = dayWindow('2026-03-08', 1, profile.timeZone);
  const intervals = sleepIntervals(range.start, range.end, { ...profile, bedtime: '02:30', wakeTime: '07:00' });
  assert.equal(intervals.length, 1);
  assert.equal(intervals[0].start, Date.parse('2026-03-08T10:30:00Z'));
  assert.equal(intervals[0].label, 'Sleep · clock change');
});

test('sleep range is half-open and supports daytime sleep, disabled schedules and invalid equality', () => {
  const range = dayWindow('2026-09-14', 1, profile.timeZone);
  const daytime = { ...profile, bedtime: '09:00', wakeTime: '17:00' };
  const intervals = sleepIntervals(range.start, range.end, daytime);
  assert.equal(intervals.length, 1);
  assert.equal(intervals[0].end - intervals[0].start, 8 * HOUR);
  assert.deepEqual(sleepIntervals(intervals[0].end, range.end, daytime), []);
  assert.deepEqual(sleepIntervals(range.start, range.end, { ...profile, sleepEnabled: false }), []);
  assert.throws(() => sleepIntervals(range.start, range.end, { ...profile, wakeTime: '23:00' }), /must be different/);
});

test('a historical midnight gap uses the first existing instant and an omitted date is rejected', () => {
  const midnightGap = dayWindow('2018-11-04', 1, 'America/Sao_Paulo');
  assert.equal(instantToLocal(new Date(midnightGap.start).toISOString(), 'America/Sao_Paulo').time, '01:00');
  assert.throws(() => dayWindow('2011-12-30', 1, 'Pacific/Apia'), /does not exist/);
});
