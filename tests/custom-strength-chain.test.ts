import test from 'node:test';
import assert from 'node:assert/strict';
import { newDose, updateDose, doseInputError } from '../src/components/DoseEditor';
import { createCloudClient } from '../src/lib/cloud-client';
import { parseBackup } from '../src/lib/reports';
import { favoriteSelection, selectFavoriteStrength } from '../src/lib/favorite-selection';
import { openVaultStore } from '../server/vault-store.mjs';
import type { AppData, Dose, Favorite } from '../src/lib/types';

test('custom favorites create exact dose snapshots and survive cloud encryption, storage and backup round trips', async t => {
  const ownerId = 'synthetic-custom-chain-owner';
  const store = openVaultStore({ dbPath: ':memory:' });
  t.after(() => store.close());
  const uploads: unknown[] = [];
  // Authentication/HTTP is covered by cloud-api.test.mjs. This bridge exercises the actual
  // client adapter, envelope validator and SQLite store without opening an extra server.
  const fetcher = (async (url: RequestInfo | URL, init: RequestInit = {}) => {
    const path = String(url).replace('/drug/api', '');
    const reply = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (path === '/session') return reply({ user: { id: ownerId, name: 'Synthetic fixture' } });
    assert.equal(new Headers(init.headers).get('X-Dose-Owner'), ownerId);
    assert.equal(path, '/vault', 'The cloud adapter must send no plaintext record endpoint.');
    if (init.method === 'PUT') {
      const body = JSON.parse(String(init.body)); uploads.push(body);
      return reply({ vault: store.write(ownerId, body) });
    }
    return reply({ vault: store.read(ownerId) });
  }) as typeof fetch;
  const client = createCloudClient({ fetch: fetcher });
  await client.session();
  await client.setupVault('Synthetic independent custom-strength vault phrase');
  let selection = favoriteSelection([]);
  const specifications = [
    ['ritalin', '7.5', '1.5', '11.25'],
    ['methylphenidate-ir', '7.5', '0.5', '3.75'],
    ['azstarys', '26.123456789/5.200000001', '1', '26.123456789'],
  ];
  for (const [index, [productId, packageStrength]] of specifications.entries()) {
    selection = selectFavoriteStrength(selection, [], productId, packageStrength, true, () => `custom-favorite-${index}`);
  }
  const recorded: Dose[] = [];
  for (const [index, favorite] of [...selection.values()].entries()) {
    const saved = await client.request<Favorite>(`/favorites/${favorite.id}`, 'PUT', { ...favorite, quantity: specifications[index][2] }, ownerId);
    let dose = updateDose(newDose(saved.productId, saved.packageStrength || saved.strength), { quantity: saved.quantity }, 'UTC');
    dose = updateDose(dose, { date: '2026-09-13', time: '08:00' }, 'UTC');
    dose = { ...dose, status: 'actual', note: 'SYNTHETIC CUSTOM STRENGTH NOTE — NOT REAL HISTORY' };
    assert.equal(doseInputError(dose), '');
    assert.equal(dose.packageStrength, specifications[index][1]);
    assert.equal(dose.quantity, specifications[index][2]);
    assert.equal(dose.amountMg, specifications[index][3]);
    recorded.push(await client.request<Dose>(`/doses/${dose.id}`, 'PUT', dose, ownerId));
  }
  assert.deepEqual(recorded[2].ingredients?.map(item => [item.strengthMg, item.amountMg]), [
    ['26.123456789', '26.123456789'], ['5.200000001', '5.200000001'],
  ]);
  assert.equal(new Set(recorded.map(dose => dose.productId)).size, 3);
  const encryptedText = JSON.stringify(uploads);
  assert.ok(!encryptedText.includes('SYNTHETIC CUSTOM STRENGTH NOTE'));
  assert.ok(!encryptedText.includes('26.123456789/5.200000001'));
  const backup = await client.request('/export', 'GET', undefined, ownerId);
  const parsed = parseBackup(JSON.stringify(backup));
  assert.deepEqual(parsed.doses, recorded);
  assert.deepEqual(parsed.favorites.map(favorite => favorite.productId), ['ritalin', 'methylphenidate-ir', 'azstarys']);
  client.lock();
  await client.unlockVault({ vaultPassphrase: 'Synthetic independent custom-strength vault phrase' });
  const reloaded = await client.request<AppData>('/data', 'GET', undefined, ownerId);
  assert.deepEqual(reloaded, parsed);
  // Nine decimals are retained exactly; a quantity requiring a tenth place must not round.
  const tooPrecise = updateDose(newDose('azstarys', '26.123456789/5.200000001'), { quantity: '0.5' }, 'UTC');
  assert.match(doseInputError(tooPrecise), /nine decimal/);
  assert.equal(tooPrecise.amountMg, '');
});
