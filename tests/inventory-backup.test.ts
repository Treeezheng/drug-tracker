import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBackup } from '../src/lib/reports.ts';

const receipt = {
  id: 'synthetic-receipt', productId: 'azstarys', productName: 'Azstarys',
  packageStrength: '26.1/5.2', strengthUnit: 'mg', unit: 'capsule', quantity: '12.5',
  receivedAt: '2026-09-13T07:00:00.000Z', timeZone: 'America/Los_Angeles', note: 'Synthetic inventory fixture', revision: 2,
};
function backup(inventory?: unknown) {
  return JSON.stringify({ format: 'dose-timeline-backup', schemaVersion: 1, exportedAt: '2026-09-13T12:00:00Z', scope: 'current-data',
    data: { profile: null, doses: [], scenarios: [], favorites: [], checkins: [], ...(inventory === undefined ? {} : { inventory }) },
  });
}

test('inventory backup preserves exact quantity, full package strength, receipt instant and original zone', () => {
  assert.deepEqual(parseBackup(backup([receipt])).inventory, [receipt]);
});

test('legacy backups remain valid without an inventory collection', () => {
  const parsed = parseBackup(backup());
  assert.equal(parsed.inventory, undefined);
  assert.deepEqual(parsed.doses, []);
});

test('inventory import rejects invalid quantity, impossible dates, unknown zones and duplicate IDs', () => {
  for (const patch of [{ quantity: '0' }, { quantity: '-1' }, { quantity: 20 }, { packageStrength: '10/mg' }, { receivedAt: '2026-02-30T08:00:00Z' }, { timeZone: 'No/SuchZone' }]) {
    assert.throws(() => parseBackup(backup([{ ...receipt, ...patch }])));
  }
  assert.throws(() => parseBackup(backup([receipt, receipt])), /Duplicate record ID/);
  assert.throws(() => parseBackup(backup({ quantity: '10' })), /list/);
});
