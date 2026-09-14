import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { openVaultStore, validateVaultWrite, VaultStoreError } from '../server/vault-store.mjs';
import {
  createVaultKey, decryptVault, encryptVault, exportRecoveryKey,
  unwrapVaultKey, wrapVaultKey, VaultDecryptionError,
} from '../src/lib/vault-crypto.ts';

const OWNER_A = 'synthetic-owner-A';
const OWNER_B = 'synthetic-owner-B';
const SECRET_NOTE = 'SYNTHETIC HEALTH NOTE NEVER STORED AS PLAINTEXT 7429';
const PASSPHRASE = 'Synthetic independent vault passphrase 7429';
const DATA = {
  profile: { name: 'SYNTHETIC PRIVATE NAME 7429', timeZone: 'UTC' },
  doses: [{ id: 'synthetic-dose', note: SECRET_NOTE, quantity: '1.5', amountMg: '15' }],
  scenarios: [], favorites: [], checkins: [], inventory: [],
};
const b64 = length => Buffer.alloc(length, 71).toString('base64url');
function opaqueInput(ownerId = OWNER_A, expectedRevision = 0) {
  const common = { protocol: 'dose-timeline-vault', version: 1, ownerId, cipher: 'AES-256-GCM', iv: b64(12) };
  return {
    expectedRevision,
    dataEnvelope: { ...common, kind: 'data', ciphertext: b64(17) },
    keyEnvelope: { ...common, kind: 'wrapped-key', ciphertext: b64(48), kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: 600_000, salt: b64(16) } },
  };
}
function status(expected) {
  return error => error instanceof VaultStoreError && error.status === expected;
}
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'drug-encrypted-vault-'));
  const dbPath = join(directory, 'only-synthetic.sqlite');
  const stores = [];
  const open = () => { const store = openVaultStore({ dbPath }); stores.push(store); return store; };
  t.after(async () => {
    for (const store of stores) store.close();
    await rm(directory, { recursive: true, force: true });
  });
  return { directory, dbPath, open };
}
function changeCiphertext(envelope) {
  const bytes = Buffer.from(envelope.ciphertext, 'base64url');
  bytes[0] ^= 1;
  return { ...envelope, ciphertext: bytes.toString('base64url') };
}

test('real client envelopes survive restart and export without health plaintext or recovery secrets', async t => {
  const { open, dbPath, directory } = await fixture(t);
  let store = open();
  const vaultKey = await createVaultKey();
  const recoveryKey = await exportRecoveryKey(vaultKey);
  const dataEnvelope = await encryptVault(DATA, vaultKey, OWNER_A);
  const keyEnvelope = await wrapVaultKey(vaultKey, PASSPHRASE, OWNER_A);
  const saved = store.write(OWNER_A, { expectedRevision: 0, dataEnvelope, keyEnvelope });
  assert.equal(saved.revision, 1);
  assert.deepEqual(saved.dataEnvelope, dataEnvelope);
  assert.deepEqual(saved.keyEnvelope, keyEnvelope);
  assert.equal(store.read(OWNER_B), null);
  assert.throws(() => store.export(OWNER_B), status(404));
  store.close();
  store = open();
  assert.deepEqual(store.read(OWNER_A), saved);
  const backup = store.export(OWNER_A);
  assert.deepEqual(Object.keys(backup).sort(), ['exportedAt', 'format', 'vault', 'version']);
  assert.deepEqual(Object.keys(backup.vault).sort(), ['createdAt', 'dataEnvelope', 'keyEnvelope', 'ownerId', 'revision', 'updatedAt']);
  assert.equal(backup.format, 'dose-timeline-encrypted-backup');
  const restoredKey = await unwrapVaultKey(backup.vault.keyEnvelope, PASSPHRASE, OWNER_A);
  assert.deepEqual(await decryptVault(backup.vault.dataEnvelope, restoredKey, OWNER_A), DATA);
  const serialized = JSON.stringify(backup);
  for (const secret of [SECRET_NOTE, DATA.profile.name, PASSPHRASE, recoveryKey]) {
    assert.ok(!serialized.includes(secret), 'Encrypted export contained a synthetic plaintext secret.');
    for (const filename of await readdir(directory)) {
      assert.ok(!(await readFile(join(directory, filename))).includes(Buffer.from(secret)), 'Encrypted database or journal contained a synthetic plaintext secret.');
    }
  }
  assert.equal((await stat(dbPath)).mode & 0o777, 0o600);
  // A caller changing a returned value cannot mutate the stored encrypted snapshot.
  backup.vault.dataEnvelope.ciphertext = b64(17);
  assert.deepEqual(store.read(OWNER_A), saved);
});

test('independent connections use compare-and-swap for the entire data/key pair and isolate owners', async t => {
  const { open } = await fixture(t);
  const first = open(), second = open();
  assert.equal(first.read(OWNER_A), null);
  assert.equal(second.read(OWNER_A), null);
  const original = first.write(OWNER_A, opaqueInput());
  assert.throws(() => second.write(OWNER_A, opaqueInput()), error => status(409)(error) && error.currentRevision === 1);
  const replacement = opaqueInput(OWNER_A, 1);
  replacement.dataEnvelope.ciphertext = b64(40);
  replacement.keyEnvelope.iv = Buffer.alloc(12, 99).toString('base64url');
  const updated = second.write(OWNER_A, replacement);
  assert.equal(updated.revision, 2);
  assert.equal(updated.createdAt, original.createdAt);
  assert.deepEqual(first.read(OWNER_A), updated);
  assert.deepEqual(updated.dataEnvelope, replacement.dataEnvelope);
  assert.deepEqual(updated.keyEnvelope, replacement.keyEnvelope);
  const other = second.write(OWNER_B, opaqueInput(OWNER_B));
  assert.equal(other.revision, 1);
  assert.deepEqual(first.read(OWNER_A), updated);
  assert.deepEqual(first.export(OWNER_B).vault, other);
  assert.throws(() => first.write(OWNER_B, opaqueInput(OWNER_A, 1)), status(403));
  assert.deepEqual(first.read(OWNER_B), other);
});

test('concurrent first writers and database initialization produce one winner without partial rows', async t => {
  const { dbPath, open } = await fixture(t);
  const moduleUrl = new URL('../server/vault-store.mjs', import.meta.url).href;
  const workers = Array.from({ length: 4 }, () => new Worker(`
    const { parentPort, workerData } = require('node:worker_threads');
    import(workerData.moduleUrl).then(({ openVaultStore }) => {
      const store = openVaultStore({ dbPath: workerData.dbPath });
      parentPort.postMessage({ ready: true });
      parentPort.once('message', () => {
        try { parentPort.postMessage({ saved: store.write(workerData.owner, workerData.input) }); }
        catch (error) { parentPort.postMessage({ status: error.status, revision: error.currentRevision, message: error.message }); }
        finally { store.close(); }
      });
    }).catch(error => { parentPort.postMessage({ fatal: error.message }); });
  `, { eval: true, workerData: { moduleUrl, dbPath, owner: OWNER_A, input: opaqueInput() } }));
  t.after(async () => { await Promise.all(workers.map(worker => worker.terminate())); });
  await Promise.all(workers.map(worker => new Promise((resolve, reject) => {
    worker.once('error', reject);
    worker.once('message', message => message.ready ? resolve() : reject(new Error(JSON.stringify(message))));
  })));
  const completed = workers.map(worker => new Promise((resolve, reject) => { worker.once('message', resolve); worker.once('error', reject); }));
  for (const worker of workers) worker.postMessage('write');
  const outcomes = await Promise.all(completed);
  assert.equal(outcomes.filter(outcome => outcome.saved).length, 1);
  assert.deepEqual(outcomes.filter(outcome => !outcome.saved).map(outcome => [outcome.status, outcome.revision]), [[409, 1], [409, 1], [409, 1]]);
  const store = open();
  assert.equal(store.read(OWNER_A).revision, 1);
  assert.equal(store.read(OWNER_B), null);
});

test('plaintext, extra fields, invalid versions, owner mismatches and malformed key updates leave previous data intact', async t => {
  const { open } = await fixture(t);
  const store = open();
  const original = store.write(OWNER_A, opaqueInput());
  const variants = [
    input => ({ ...input, health: DATA }),
    input => ({ ...input, password: PASSPHRASE }),
    input => ({ ...input, recoveryKey: b64(32) }),
    input => ({ ...input, dataEnvelope: DATA }),
    input => ({ ...input, expectedRevision: '1' }),
    input => ({ ...input, expectedRevision: -1 }),
    input => ({ ...input, expectedRevision: 1.5 }),
    input => ({ ...input, expectedRevision: Number.MAX_SAFE_INTEGER + 1 }),
    input => ({ ...input, dataEnvelope: { ...input.dataEnvelope, version: 2 } }),
    input => ({ ...input, dataEnvelope: { ...input.dataEnvelope, cipher: 'none' } }),
    input => ({ ...input, dataEnvelope: { ...input.dataEnvelope, note: SECRET_NOTE } }),
    input => ({ ...input, keyEnvelope: { ...input.keyEnvelope, kdf: { ...input.keyEnvelope.kdf, iterations: 1 } } }),
    input => ({ ...input, keyEnvelope: { ...input.keyEnvelope, kdf: { ...input.keyEnvelope.kdf, salt: b64(15) } } }),
  ];
  for (const vary of variants) {
    const candidate = vary(opaqueInput(OWNER_A, 1));
    // The otherwise-valid data change must not be partially committed when key validation fails.
    if (candidate.dataEnvelope?.ciphertext) candidate.dataEnvelope.ciphertext = b64(50);
    assert.throws(() => store.write(OWNER_A, candidate), status(400));
    assert.deepEqual(store.read(OWNER_A), original);
  }
  const wrongKeyOwner = opaqueInput(OWNER_A, 1);
  wrongKeyOwner.keyEnvelope.ownerId = OWNER_B;
  assert.throws(() => store.write(OWNER_A, wrongKeyOwner), status(403));
  assert.deepEqual(store.read(OWNER_A), original);
  assert.equal(store.write(OWNER_A, opaqueInput(OWNER_A, 1)).revision, 2, 'Rejected writes must release the transaction and not consume a revision.');
});

test('encoding, length, and KDF boundaries match the browser envelope protocol', () => {
  const candidate = opaqueInput();
  assert.doesNotThrow(() => validateVaultWrite(OWNER_A, candidate));
  for (const ciphertext of [b64(16), `${b64(17)}=`, 'A', '*'.repeat(24), b64(17).slice(0, -1) + 'd']) {
    assert.throws(() => validateVaultWrite(OWNER_A, { ...candidate, dataEnvelope: { ...candidate.dataEnvelope, ciphertext } }), status(400));
  }
  for (const length of [11, 13]) assert.throws(() => validateVaultWrite(OWNER_A, {
    ...candidate, dataEnvelope: { ...candidate.dataEnvelope, iv: b64(length) },
  }), status(400));
  for (const length of [47, 49]) assert.throws(() => validateVaultWrite(OWNER_A, {
    ...candidate, keyEnvelope: { ...candidate.keyEnvelope, ciphertext: b64(length) },
  }), status(400));
  for (const iterations of [599_999, 2_000_001, 600_000.5, '600000']) assert.throws(() => validateVaultWrite(OWNER_A, {
    ...candidate, keyEnvelope: { ...candidate.keyEnvelope, kdf: { ...candidate.keyEnvelope.kdf, iterations } },
  }), status(400));
  const maximum = opaqueInput();
  maximum.dataEnvelope.ciphertext = b64(16_000_016);
  maximum.keyEnvelope.kdf.iterations = 2_000_000;
  assert.doesNotThrow(() => validateVaultWrite(OWNER_A, maximum));
  maximum.dataEnvelope.ciphertext = b64(16_000_017);
  assert.throws(() => validateVaultWrite(OWNER_A, maximum), status(400));
});

test('opaque storage accepts structurally valid tampering, while client authentication rejects it', async t => {
  const { open } = await fixture(t);
  const store = open(), key = await createVaultKey();
  const dataEnvelope = await encryptVault(DATA, key, OWNER_A);
  const keyEnvelope = await wrapVaultKey(key, PASSPHRASE, OWNER_A);
  store.write(OWNER_A, { expectedRevision: 0, dataEnvelope, keyEnvelope });
  const tampered = store.write(OWNER_A, { expectedRevision: 1, dataEnvelope: changeCiphertext(dataEnvelope), keyEnvelope });
  await assert.rejects(decryptVault(tampered.dataEnvelope, key, OWNER_A), VaultDecryptionError);
  const tamperedKey = store.write(OWNER_A, { expectedRevision: 2, dataEnvelope, keyEnvelope: changeCiphertext(keyEnvelope) });
  await assert.rejects(unwrapVaultKey(tamperedKey.keyEnvelope, PASSPHRASE, OWNER_A), VaultDecryptionError);
  // Re-labeling public owner metadata cannot authenticate old ciphertext for another owner.
  const relabeled = store.write(OWNER_B, {
    expectedRevision: 0, dataEnvelope: { ...dataEnvelope, ownerId: OWNER_B }, keyEnvelope: { ...keyEnvelope, ownerId: OWNER_B },
  });
  await assert.rejects(decryptVault(relabeled.dataEnvelope, key, OWNER_B), VaultDecryptionError);
  await assert.rejects(unwrapVaultKey(relabeled.keyEnvelope, PASSPHRASE, OWNER_B), VaultDecryptionError);
  assert.equal(store.read(OWNER_A).revision, 3);
});

test('owner selection and plain envelopes are mandatory, getters never run, and closed stores reject operations', () => {
  assert.throws(() => openVaultStore(), status(400));
  const store = openVaultStore({ dbPath: ':memory:' });
  for (const owner of [undefined, null, '', '../owner', 'a@b.test', 'a'.repeat(129)]) {
    assert.throws(() => store.read(owner), status(400));
    assert.throws(() => store.write(owner, opaqueInput()), status(400));
    assert.throws(() => store.export(owner), status(400));
  }
  const getter = opaqueInput();
  let calls = 0;
  Object.defineProperty(getter.dataEnvelope, 'ciphertext', { enumerable: true, get() { calls++; return b64(17); } });
  assert.throws(() => store.write(OWNER_A, getter), status(400));
  assert.equal(calls, 0);
  const extraSymbol = opaqueInput();
  extraSymbol.keyEnvelope[Symbol('secret')] = 'recovery-secret';
  assert.throws(() => store.write(OWNER_A, extraSymbol), status(400));
  const inherited = opaqueInput();
  Object.setPrototypeOf(inherited.dataEnvelope, { note: SECRET_NOTE });
  assert.throws(() => store.write(OWNER_A, inherited), status(400));
  assert.equal(store.read(OWNER_A), null);
  store.close();
  store.close();
  for (const operation of [() => store.read(OWNER_A), () => store.export(OWNER_A), () => store.write(OWNER_A, opaqueInput())]) {
    assert.throws(operation, status(503));
  }
});
