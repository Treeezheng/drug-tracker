import test from 'node:test';
import assert from 'node:assert/strict';
import type { AppData } from '../src/lib/types.ts';
import { createVaultKey, decryptVault, encryptVault, exportRecoveryKey, importRecoveryKey, unwrapVaultKey, wrapVaultKey, VAULT_DECRYPTION_ERROR, VAULT_MAX_PLAINTEXT_BYTES, VAULT_PBKDF2_ITERATIONS, VaultDecryptionError } from '../src/lib/vault-crypto.ts';
import type { VaultDataEnvelope } from '../src/lib/vault-crypto.ts';

const ownerA = 'synthetic-owner-a', ownerB = 'synthetic-owner-b';
const passphrase = '独立的保险箱口令不用于登录🌿';
const empty = (): AppData => ({ profile: null, doses: [], scenarios: [], favorites: [], checkins: [], inventory: [] });
const encode = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64url');
const decode = (value: string) => new Uint8Array(Buffer.from(value, 'base64url'));
const alter = (value: string) => { const bytes = decode(value); bytes[0] ^= 1; return encode(bytes); };
const rejected = (result: Promise<unknown>) => assert.rejects(result, error => error instanceof VaultDecryptionError && error.message === VAULT_DECRYPTION_ERROR && !('cause' in error));

function completeData(): AppData {
  return {
    profile: { name: '小林', timeZone: 'America/Los_Angeles', timeFormat: '24h', sleepEnabled: false, bedtime: '', wakeTime: '', weekendEnabled: false, weekendBedtime: '', weekendWakeTime: '' },
    doses: [{ id: 'dose-1', productId: 'ritalin', productName: 'Ritalin IR', formulation: 'Immediate-release tablet', strength: '10', packageStrength: '10', strengthUnit: 'mg', quantity: '1.5', unit: 'tablet', amountMg: '15', administeredAt: '2026-09-13T15:03:27Z', timeZone: 'America/Los_Angeles', status: 'actual', note: '合成测试：饭后服药，不含真实病历', revision: 2, ingredients: [{ name: 'methylphenidate hydrochloride', amountMg: '15', strengthMg: '10', unit: 'mg' }] }],
    scenarios: [{ id: 'scenario-1', name: '明天的模拟', doses: [], modelVersion: 'test', baseline: 'empty' }],
    favorites: [{ id: 'favorite-1', productId: 'ritalin', strength: '10', quantity: '1.5' }],
    checkins: [{ id: 'checkin-1', date: '2026-09-13', recordedAt: '2026-09-13T18:00:00Z', timeZone: 'America/Los_Angeles', symptoms: ['headache', 'nausea'], note: '头痛，稍后好转 🫖' }],
    inventory: [{ id: 'supply-1', productId: 'ritalin', productName: 'Ritalin IR', packageStrength: '10', strengthUnit: 'mg', unit: 'tablet', quantity: '30', receivedAt: '2026-09-01T00:00:00Z', timeZone: 'UTC', note: '测试库存' }],
  };
}

test('a generated 256-bit key round-trips through its canonical 43-character recovery secret', async () => {
  const key = await createVaultKey(), recovery = await exportRecoveryKey(key), another = await createVaultKey();
  assert.equal(key.type, 'secret'); assert.equal((key.algorithm as AesKeyAlgorithm).length, 256); assert.equal(key.algorithm.name, 'AES-GCM');
  assert.match(recovery, /^[A-Za-z0-9_-]{43}$/); assert.equal(decode(recovery).byteLength, 32); assert.notEqual(await exportRecoveryKey(another), recovery);
  const restored = await importRecoveryKey(recovery); assert.equal(await exportRecoveryKey(restored), recovery);
  const envelope = await encryptVault(empty(), key, ownerA); assert.deepEqual(await decryptVault(envelope, restored, ownerA), empty());
});

test('all AppData collections, exact quantities, revisions, Chinese and emoji remain inside one opaque payload', async () => {
  const key = await createVaultKey(), data = completeData(), before = JSON.stringify(data);
  const envelope = await encryptVault(data, key, ownerA);
  assert.deepEqual(Object.keys(envelope).sort(), ['cipher', 'ciphertext', 'iv', 'kind', 'ownerId', 'protocol', 'version']);
  assert.equal(envelope.protocol, 'dose-timeline-vault'); assert.equal(envelope.version, 1); assert.equal(envelope.cipher, 'AES-256-GCM');
  assert.doesNotMatch(JSON.stringify(envelope), /小林|Ritalin|头痛|quantity|checkins|inventory/);
  assert.deepEqual(await decryptVault(JSON.parse(JSON.stringify(envelope)), key, ownerA), data); assert.equal(JSON.stringify(data), before);
  // Independent native Web Crypto decrypt checks the actual protocol/AAD, not just helper symmetry.
  const native = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decode(envelope.iv), tagLength: 128, additionalData: new TextEncoder().encode(JSON.stringify(['dose-timeline-vault', 1, 'data', 'AES-256-GCM', ownerA])) }, key, decode(envelope.ciphertext));
  assert.deepEqual(JSON.parse(new TextDecoder().decode(native)), data);
});

test('each repeated and concurrent encryption gets a fresh 96-bit nonce and new ciphertext', async () => {
  const key = await createVaultKey();
  const values = await Promise.all(Array.from({ length: 32 }, () => encryptVault(empty(), key, ownerA)));
  assert.equal(new Set(values.map(value => value.iv)).size, values.length); assert.equal(new Set(values.map(value => value.ciphertext)).size, values.length);
  for (const value of values) { assert.equal(decode(value.iv).length, 12); assert.equal(value.iv.length, 16); }
  // This finite sample is a regression check, not a proof of random collision impossibility.
});

test('wrong key, modified ciphertext, tag or IV and changed expected owner all produce the same generic failure', async () => {
  const key = await createVaultKey(), value = await encryptVault(completeData(), key, ownerA);
  await rejected(decryptVault(value, await createVaultKey(), ownerA));
  await rejected(decryptVault(value, key, ownerB));
  await rejected(decryptVault({ ...value, ownerId: ownerB }, key, ownerB));
  await rejected(decryptVault({ ...value, ciphertext: alter(value.ciphertext) }, key, ownerA));
  const tag = decode(value.ciphertext); tag[tag.length - 1] ^= 1;
  await rejected(decryptVault({ ...value, ciphertext: encode(tag) }, key, ownerA));
  await rejected(decryptVault({ ...value, iv: alter(value.iv) }, key, ownerA));
});

test('envelope version, exact fields, algorithms, lengths and canonical encoding are enforced before decrypting', async () => {
  const key = await createVaultKey(), value = await encryptVault(empty(), key, ownerA);
  for (const malformed of [null, [], {}, { ...value, version: 2 }, { ...value, protocol: 'another-app' }, { ...value, kind: 'wrapped-key' }, { ...value, cipher: 'AES-CBC' }, { ...value, extra: 'discard me' }, { ...value, iv: 'A'.repeat(15) }, { ...value, iv: 'A'.repeat(18) }, { ...value, iv: `${value.iv}=` }, { ...value, ciphertext: 'A'.repeat(22) }, { ...value, ciphertext: `${value.ciphertext}\n` }]) await rejected(decryptVault(malformed, key, ownerA));
  const long = 'A'.repeat(Math.ceil((VAULT_MAX_PLAINTEXT_BYTES + 16) * 4 / 3) + 1);
  await rejected(decryptVault({ ...value, ciphertext: long }, key, ownerA));
  const accessor = { ...value }; Object.defineProperty(accessor, 'ownerId', { enumerable: true, get() { throw new Error('should not invoke a getter'); } });
  await rejected(decryptVault(accessor, key, ownerA));
});

test('a separate passphrase wraps the same random key with fresh salt and nonce on every wrap', async () => {
  const key = await createVaultKey(), recovery = await exportRecoveryKey(key);
  const first = await wrapVaultKey(key, passphrase, ownerA), second = await wrapVaultKey(key, passphrase, ownerA);
  assert.equal(first.kdf.name, 'PBKDF2'); assert.equal(first.kdf.hash, 'SHA-256'); assert.equal(first.kdf.iterations, VAULT_PBKDF2_ITERATIONS);
  assert.equal(decode(first.kdf.salt).length, 16); assert.equal(decode(first.iv).length, 12); assert.equal(decode(first.ciphertext).length, 48);
  assert.notEqual(first.kdf.salt, second.kdf.salt); assert.notEqual(first.iv, second.iv); assert.notEqual(first.ciphertext, second.ciphertext);
  assert.doesNotMatch(JSON.stringify(first), new RegExp(passphrase)); assert.ok(!JSON.stringify(first).includes(recovery));
  assert.equal(await exportRecoveryKey(await unwrapVaultKey(first, passphrase, ownerA)), recovery);
  assert.equal(await exportRecoveryKey(await unwrapVaultKey(second, passphrase, ownerA)), recovery);
});

test('wrong passphrase, owner, wrapping metadata and wrap/data substitution cannot unlock a key', async () => {
  const key = await createVaultKey(), value = await wrapVaultKey(key, passphrase, ownerA), data = await encryptVault(empty(), key, ownerA);
  await rejected(unwrapVaultKey(value, 'different vault passphrase', ownerA));
  await rejected(unwrapVaultKey(value, passphrase, ownerB));
  await rejected(unwrapVaultKey({ ...value, ownerId: ownerB }, passphrase, ownerB));
  await rejected(unwrapVaultKey({ ...value, ciphertext: alter(value.ciphertext) }, passphrase, ownerA));
  await rejected(unwrapVaultKey({ ...value, iv: alter(value.iv) }, passphrase, ownerA));
  await rejected(unwrapVaultKey({ ...value, kdf: { ...value.kdf, salt: alter(value.kdf.salt) } }, passphrase, ownerA));
  await rejected(unwrapVaultKey({ ...value, kdf: { ...value.kdf, iterations: 600_001 } }, passphrase, ownerA));
  await rejected(unwrapVaultKey(data, passphrase, ownerA)); await rejected(decryptVault(value, key, ownerA));
});

test('KDF work limits reject downgrade, CPU-exhaustion, different algorithms and unexpected fields', async () => {
  const key = await createVaultKey(), value = await wrapVaultKey(key, passphrase, ownerA);
  for (const kdf of [{ ...value.kdf, iterations: 599_999 }, { ...value.kdf, iterations: 2_000_001 }, { ...value.kdf, iterations: 600_000.5 }, { ...value.kdf, iterations: '600000' }, { ...value.kdf, hash: 'SHA-1' }, { ...value.kdf, name: 'HKDF' }, { ...value.kdf, salt: 'A'.repeat(20) }, { ...value.kdf, secret: 'never accepted' }]) await rejected(unwrapVaultKey({ ...value, kdf }, passphrase, ownerA));
  await rejected(unwrapVaultKey({ ...value, ciphertext: 'A'.repeat(63) }, passphrase, ownerA));
  await rejected(unwrapVaultKey({ ...value, ciphertext: 'A'.repeat(65) }, passphrase, ownerA));
  await rejected(unwrapVaultKey({ ...value, recoveryKey: await exportRecoveryKey(key) }, passphrase, ownerA));
});

test('recovery input rejects padding, whitespace, noncanonical pad bits and wrong lengths', async () => {
  const recovery = await exportRecoveryKey(await createVaultKey());
  for (const invalid of ['', `${recovery}=`, ` ${recovery}`, `${recovery}\n`, recovery.slice(1), `${recovery}A`, 'A'.repeat(42) + 'B', '+'.repeat(43)]) await rejected(importRecoveryKey(invalid));
});

test('changing the vault passphrase rewraps the same key and keeps existing data decryptable', async () => {
  const key = await createVaultKey(), data = await encryptVault(completeData(), key, ownerA), first = await wrapVaultKey(key, passphrase, ownerA);
  const unlocked = await unwrapVaultKey(first, passphrase, ownerA), changed = await wrapVaultKey(unlocked, 'another independent vault secret', ownerA);
  assert.deepEqual(await decryptVault(data, await unwrapVaultKey(changed, 'another independent vault secret', ownerA), ownerA), completeData());
  await rejected(unwrapVaultKey(changed, passphrase, ownerA));
  // Old wrapped-key copies still work with the old passphrase: true revocation needs key rotation.
  assert.equal(await exportRecoveryKey(await unwrapVaultKey(first, passphrase, ownerA)), await exportRecoveryKey(key));
});

test('passphrases preserve Unicode exactly and weak, oversized or malformed new passphrases are rejected', async () => {
  const key = await createVaultKey(), composed = 'separate vault café passphrase';
  const wrapped = await wrapVaultKey(key, composed, ownerA);
  await rejected(unwrapVaultKey(wrapped, composed.normalize('NFD'), ownerA));
  for (const invalid of ['short', 'x'.repeat(1025), 'a valid long string\ud800']) await assert.rejects(wrapVaultKey(key, invalid, ownerA));
  await assert.rejects(encryptVault(empty(), key, '')); await assert.rejects(encryptVault(empty(), key, 'owner with spaces'));
  const small = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 128 }, true, ['encrypt', 'decrypt']);
  await assert.rejects(encryptVault(empty(), small, ownerA));
});

test('safe JSON structure is bounded without silently dropping collections or normalizing exact values', async () => {
  const key = await createVaultKey(), legacy = empty(); delete legacy.inventory;
  assert.deepEqual(await decryptVault(await encryptVault(legacy, key, ownerA), key, ownerA), legacy);
  const optional = completeData(); optional.doses[0].removalAt = undefined;
  assert.deepEqual(await decryptVault(await encryptVault(optional, key, ownerA), key, ownerA), JSON.parse(JSON.stringify(optional)));
  const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
  const unsafe = JSON.parse('{"profile":null,"doses":[],"scenarios":[],"favorites":[],"checkins":[{"__proto__":{"polluted":true}}]}');
  let nested: unknown = {}; for (let i = 0; i < 34; i++) nested = { next: nested };
  for (const invalid of [{ ...empty(), doses: null }, { ...empty(), extra: [] }, { ...empty(), checkins: [cyclic] }, unsafe, { ...empty(), checkins: [nested] }, { ...empty(), checkins: Array(50_001).fill({}) }, { ...empty(), checkins: [{ score: NaN }] }, { ...empty(), checkins: [new Date()] }]) await assert.rejects(encryptVault(invalid as AppData, key, ownerA));
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
  const huge = { ...empty(), checkins: Array.from({ length: 16 }, (_, i) => ({ id: `big-${i}`, date: '2026-09-13', note: 'x'.repeat(1_000_000) })) };
  await assert.rejects(encryptVault(huge, key, ownerA), /16 MB/);
});

test('authenticated invalid JSON or unsafe inner objects fail generically after decryption', async () => {
  const key = await createVaultKey();
  for (const text of ['{broken', 'null', '{"profile":null,"doses":[],"scenarios":[],"favorites":[],"checkins":[{"constructor":{}}]}']) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, tagLength: 128, additionalData: new TextEncoder().encode(JSON.stringify(['dose-timeline-vault', 1, 'data', 'AES-256-GCM', ownerA])) }, key, new TextEncoder().encode(text));
    const envelope: VaultDataEnvelope = { protocol: 'dose-timeline-vault', version: 1, kind: 'data', ownerId: ownerA, cipher: 'AES-256-GCM', iv: encode(iv), ciphertext: encode(new Uint8Array(ciphertext)) };
    await rejected(decryptVault(envelope, key, ownerA));
  }
});
