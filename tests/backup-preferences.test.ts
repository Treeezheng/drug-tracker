import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBackup } from '../src/lib/reports.ts';

const profile = {
  name: 'Synthetic preference fixture', timeZone: 'UTC', timeFormat: '24h',
  sleepEnabled: false, bedtime: '', wakeTime: '', weekendEnabled: false, weekendBedtime: '', weekendWakeTime: '',
};
const scenario = { id: 'scenario-view-fixture', name: 'Synthetic view', doses: [], baseline: 'empty', modelVersion: 'fixture-v1' };
const view = { date: '2024-02-29', days: 2, timeZone: 'America/Los_Angeles', publishedOnly: false };
const backup = (savedProfile: object = profile, savedScenario: object = scenario) => JSON.stringify({
  format: 'dose-timeline-backup', schemaVersion: 1, exportedAt: '2026-09-13T12:00:00Z',
  data: { profile: savedProfile, doses: [], scenarios: [savedScenario], favorites: [], checkins: [] },
});

test('backup preserves supported time increments and complete scenario views, and accepts legacy omissions', () => {
  for (const timeIncrementMinutes of [1, 5, 10]) for (const days of [1, 2, 3]) {
    const saved = parseBackup(backup({ ...profile, timeIncrementMinutes }, { ...scenario, view: { ...view, days } }));
    assert.equal(saved.profile?.timeIncrementMinutes, timeIncrementMinutes);
    assert.deepEqual(saved.scenarios[0].view, { ...view, days });
  }
  const legacy = parseBackup(backup());
  assert.equal(legacy.profile?.timeIncrementMinutes, undefined);
  assert.equal(legacy.scenarios[0].view, undefined);
});

test('backup rejects unsupported increments and incomplete or invalid scenario views before preview', () => {
  for (const timeIncrementMinutes of [-1, 0, 2, 15, 5.5, '1', '5', null]) {
    assert.throws(() => parseBackup(backup({ ...profile, timeIncrementMinutes })), /time increment/);
  }
  for (const invalidView of [null, [], {},
    { ...view, date: '2026-02-29' }, { ...view, date: '2026-02-30' }, { ...view, date: '2026-9-13' },
    { ...view, days: 0 }, { ...view, days: 4 }, { ...view, days: 1.5 }, { ...view, days: '2' },
    { ...view, timeZone: 'No/SuchZone' }, { ...view, timeZone: '+08:00' },
    { ...view, publishedOnly: 'false' }, { ...view, publishedOnly: undefined },
  ]) assert.throws(() => parseBackup(backup(profile, { ...scenario, view: invalidView })));
});
