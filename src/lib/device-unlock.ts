import type { VaultKeyEnvelope } from './vault-crypto';

export const DEVICE_UNLOCK_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
export interface AutoUnlockPreference { enabled: boolean; expiresAt: number | null; }
export interface DeviceUnlockRecord {
  version: 1; id: string; scope: string; epoch: string; ownerId: string; fingerprint: string;
  createdAt: number; expiresAt: number; wrappingKey: CryptoKey; iv: Uint8Array<ArrayBuffer>; ciphertext: ArrayBuffer;
}
/** Epochs are public revocation markers, never account or encryption secrets. */
export interface DeviceUnlockStore {
  epoch(): string;
  read(): Promise<DeviceUnlockRecord | null>;
  save(record: DeviceUnlockRecord, expectedEpoch: string): Promise<boolean>;
  revoke(): Promise<void>;
}

const unavailable = () => new Error('Device auto-unlock storage is unavailable. Sign in with your password.');
const encoder = new TextEncoder();
function metadata(record: DeviceUnlockRecord): Uint8Array<ArrayBuffer> {
  return encoder.encode(JSON.stringify(['dose-device-unlock', record.version, record.id, record.scope, record.epoch,
    record.ownerId, record.fingerprint, record.createdAt, record.expiresAt]));
}
export async function vaultKeyFingerprint(envelope: VaultKeyEnvelope): Promise<string> {
  // The validated public envelope may arrive with a different JSON property order.
  const ordered = Object.keys(envelope).sort().map(field => [field, field === 'kdf'
    ? Object.entries(envelope.kdf).sort(([a], [b]) => a.localeCompare(b))
    : envelope[field as keyof VaultKeyEnvelope]]);
  const hash = await crypto.subtle.digest('SHA-256', encoder.encode(JSON.stringify(ordered)));
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}

/** Separate from the encrypted record outbox: revoking this store never deletes saves. */
export function browserDeviceUnlockStore(scope: string): DeviceUnlockStore {
  const marker = `dose-device-unlock-revocation:${scope}`;
  let connection: Promise<IDBDatabase> | null = null;
  let failedRevocation = false;
  function epoch(): string {
    if (failedRevocation || typeof window === 'undefined' || !globalThis.indexedDB) throw unavailable();
    try { return window.localStorage.getItem(marker) ?? 'initial'; } catch { throw unavailable(); }
  }
  function open(): Promise<IDBDatabase> {
    if (!globalThis.indexedDB) return Promise.reject(unavailable());
    if (!connection) connection = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('dose-device-unlock', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('keys');
      request.onerror = () => reject(unavailable());
      request.onblocked = () => reject(unavailable());
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => { db.close(); connection = null; };
        resolve(db);
      };
    }).catch(error => { connection = null; throw error; });
    return connection;
  }
  async function transaction<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore, finish: (value: T) => void) => void): Promise<T> {
    const db = await open();
    return new Promise<T>((resolve, reject) => {
      let result: T;
      const tx = db.transaction('keys', mode);
      tx.oncomplete = () => resolve(result);
      tx.onerror = tx.onabort = () => reject(unavailable());
      try { operation(tx.objectStore('keys'), value => { result = value; }); }
      catch (error) { tx.abort(); reject(error); }
    });
  }
  return {
    epoch,
    async read() {
      const expected = epoch();
      const record = await transaction<DeviceUnlockRecord | null>('readonly', (store, finish) => {
        const request = store.get(scope); request.onsuccess = () => finish(request.result ?? null);
      });
      return epoch() === expected && record?.epoch === expected ? record : null;
    },
    async save(record, expected) {
      if (epoch() !== expected || record.epoch !== expected) return false;
      return transaction<boolean>('readwrite', (store, finish) => {
        // The synchronous marker also invalidates a late write in another tab.
        if (epoch() !== expected) { finish(false); return; }
        store.put(record, scope); finish(true);
      });
    },
    revoke() {
      // Synchronous, nonsecret tombstone survives reload even if IndexedDB cleanup
      // is delayed or fails. Old wrapping keys become unusable by the restore path.
      let marked = false;
      try { window.localStorage.setItem(marker, crypto.randomUUID()); failedRevocation = false; marked = true; }
      catch { failedRevocation = true; }
      return transaction<void>('readwrite', (store, finish) => { store.delete(scope); finish(undefined); })
        .catch(error => { if (!marked) throw error; });
    },
  };
}

export function createDeviceUnlock({ scope, store = browserDeviceUnlockStore(scope), now = Date.now }: {
  scope: string; store?: DeviceUnlockStore; now?: () => number;
}) {
  let generation = 0;
  let clearing: Promise<void> = Promise.resolve();
  function valid(record: DeviceUnlockRecord | null): record is DeviceUnlockRecord {
    if (!record || record.version !== 1 || record.scope !== scope || record.epoch !== store.epoch()
      || !/^[A-Za-z0-9_-]{1,100}$/.test(record.ownerId) || !/^[0-9a-f]{64}$/.test(record.fingerprint)
      || typeof record.id !== 'string' || record.id.length > 100
      || !Number.isSafeInteger(record.createdAt) || !Number.isSafeInteger(record.expiresAt)
      || record.expiresAt - record.createdAt !== DEVICE_UNLOCK_LIFETIME_MS || now() < record.createdAt || now() >= record.expiresAt
      || record.wrappingKey?.extractable !== false || record.wrappingKey.type !== 'secret'
      || record.wrappingKey.algorithm.name !== 'AES-GCM' || (record.wrappingKey.algorithm as AesKeyAlgorithm).length !== 256
      || !record.wrappingKey.usages.includes('decrypt') || !record.wrappingKey.usages.includes('encrypt')
      || !(record.iv instanceof Uint8Array) || record.iv.length !== 12
      || !(record.ciphertext instanceof ArrayBuffer) || record.ciphertext.byteLength !== 48) return false;
    return true;
  }
  async function read(): Promise<DeviceUnlockRecord | null> {
    await clearing;
    const record = await store.read();
    if (valid(record)) return record;
    if (record) await revoke();
    return null;
  }
  function revoke(): Promise<void> {
    generation++;
    // Invoke synchronously so browser storage receives its tombstone immediately.
    let removal: Promise<void>;
    try { removal = store.revoke(); }
    catch (error) { removal = Promise.reject(error); }
    const completed = Promise.all([clearing, removal]).then(() => undefined);
    clearing = completed.catch(() => undefined);
    return completed;
  }
  return {
    epoch: () => store.epoch(),
    revoke,
    async preference(ownerId?: string): Promise<AutoUnlockPreference> {
      try {
        const record = await read();
        return record && (!ownerId || record.ownerId === ownerId)
          ? { enabled: true, expiresAt: record.expiresAt } : { enabled: false, expiresAt: null };
      } catch { return { enabled: false, expiresAt: null }; }
    },
    async enable(key: CryptoKey, ownerId: string, envelope: VaultKeyEnvelope, authenticatedAt: number, check: () => void, expectedEpoch?: string): Promise<void> {
      const token = generation, epoch = expectedEpoch ?? store.epoch();
      await clearing; check();
      if (store.epoch() !== epoch) throw unavailable();
      const fingerprint = await vaultKeyFingerprint(envelope); check();
      const wrappingKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']); check();
      const record: DeviceUnlockRecord = { version: 1, id: crypto.randomUUID(), scope, epoch, ownerId, fingerprint,
        createdAt: authenticatedAt, expiresAt: authenticatedAt + DEVICE_UNLOCK_LIFETIME_MS, wrappingKey,
        iv: crypto.getRandomValues(new Uint8Array(12)), ciphertext: new ArrayBuffer(0) };
      const raw = new Uint8Array(await crypto.subtle.exportKey('raw', key));
      try { record.ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: record.iv, additionalData: metadata(record) }, wrappingKey, raw); }
      finally { raw.fill(0); }
      check();
      if (token !== generation || !valid(record) || !await store.save(record, epoch)) throw unavailable();
      check();
      const saved = await read(); check();
      if (token !== generation || saved?.id !== record.id) throw unavailable();
    },
    async restore(ownerId: string, envelope: VaultKeyEnvelope): Promise<{ key: CryptoKey; current: () => Promise<boolean> } | null> {
      const token = generation, record = await read();
      if (!record) return null;
      if (record.ownerId !== ownerId || record.fingerprint !== await vaultKeyFingerprint(envelope)) { await revoke(); return null; }
      const raw = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: record.iv, additionalData: metadata(record) }, record.wrappingKey, record.ciphertext));
      let key: CryptoKey;
      try { key = await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']); }
      finally { raw.fill(0); }
      const current = async () => token === generation && (await read())?.id === record.id && token === generation;
      return await current() ? { key, current } : null;
    },
  };
}
