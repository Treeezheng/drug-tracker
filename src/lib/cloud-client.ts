import { ApiError } from './api';
import type { CloudTransport } from './api';
import type { AppData, Favorite } from './types';
import { favoriteKey, upsertFavorite } from './favorites';
import { parseBackup } from './reports';
import { cloneVaultData, cloneVaultEnvelopes, createVaultKey, decryptVault, encryptVault, exportRecoveryKey, importRecoveryKey, unwrapVaultKey, wrapVaultKey } from './vault-crypto';
import type { VaultDataEnvelope, VaultKeyEnvelope } from './vault-crypto';

export interface CloudUser { id: string; name: string; }
export interface CloudVaultSnapshot { ownerId: string; revision: number; dataEnvelope: VaultDataEnvelope; keyEnvelope: VaultKeyEnvelope; createdAt: string; updatedAt: string; }
export interface CloudClient extends CloudTransport {
  session(): Promise<CloudUser | null>;
  login(username: string, password: string): Promise<CloudUser>;
  loadVault(): Promise<{ exists: boolean; revision: number }>;
  setupVault(vaultPassphrase: string, initialData?: AppData): Promise<{ data: AppData; recoveryKey: string }>;
  unlockVault(secret: { vaultPassphrase: string } | { recoveryKey: string }): Promise<AppData>;
  lock(): void;
  logout(): Promise<void>;
  getState(): { user: CloudUser | null; locked: boolean; vaultExists: boolean | null; revision: number };
}
type Row = { id?: string; revision?: number; createdAt?: string; updatedAt?: string; [key: string]: unknown };
type Collection = Exclude<keyof AppData, 'profile'>;
const collections: Collection[] = ['doses', 'scenarios', 'favorites', 'checkins', 'inventory'];
const emptyData = (): AppData => ({ profile: null, doses: [], scenarios: [], favorites: [], checkins: [], inventory: [] });
const backupFor = (data: AppData) => ({ format: 'dose-timeline-backup', schemaVersion: 1, exportedAt: new Date().toISOString(), scope: 'current-data', data,
  disclosure: 'Current records only. Correction history and deleted records are not included. Authentication passwords, sessions and vault keys are not included.' });

function validateData(input: unknown): AppData {
  // Bound cumulative JSON bytes before stringify, then apply the shared medical-record schema.
  return parseBackup(JSON.stringify(backupFor(cloneVaultData(input))));
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new ApiError('Invalid request data.', 400);
  return value as Record<string, unknown>;
}
function readUser(value: unknown): CloudUser | null {
  if (value === null) return null;
  const row = object(value);
  if (typeof row.id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(row.id) || typeof row.name !== 'string' || row.name.length > 100) throw new ApiError('The cloud returned an invalid account.', 502);
  return { id: row.id, name: row.name };
}
function readSnapshot(value: unknown, ownerId: string): CloudVaultSnapshot | null {
  if (value === null) return null;
  const row = object(value);
  if (row.ownerId !== ownerId || !Number.isSafeInteger(row.revision) || Number(row.revision) < 1
    || typeof row.createdAt !== 'string' || typeof row.updatedAt !== 'string' || !Number.isFinite(Date.parse(row.createdAt)) || !Number.isFinite(Date.parse(row.updatedAt))) throw new ApiError('The cloud returned an invalid vault.', 502);
  try {
    const envelopes = cloneVaultEnvelopes(row.dataEnvelope, row.keyEnvelope, ownerId);
    return { ownerId, revision: Number(row.revision), createdAt: row.createdAt, updatedAt: row.updatedAt, ...envelopes };
  } catch { throw new ApiError('The cloud returned an invalid encrypted vault.', 502); }
}
function sameEnvelope(a: VaultDataEnvelope, b: VaultDataEnvelope): boolean {
  return a.protocol === b.protocol && a.version === b.version && a.kind === b.kind && a.ownerId === b.ownerId && a.cipher === b.cipher && a.iv === b.iv && a.ciphertext === b.ciphertext;
}
function sameWrappedKey(a: VaultKeyEnvelope, b: VaultKeyEnvelope): boolean {
  return a.protocol === b.protocol && a.version === b.version && a.kind === b.kind && a.ownerId === b.ownerId && a.cipher === b.cipher && a.iv === b.iv && a.ciphertext === b.ciphertext
    && a.kdf?.name === b.kdf?.name && a.kdf?.hash === b.kdf?.hash && a.kdf?.iterations === b.kdf?.iterations && a.kdf?.salt === b.kdf?.salt;
}
async function responseJson(response: Response): Promise<Record<string, unknown>> {
  const limit = 22_000_000;
  if (Number(response.headers.get('content-length')) > limit) throw new ApiError('The cloud response is too large.', 502);
  if (!response.body) throw new ApiError('The cloud returned an unreadable response.', 502);
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      length += value.byteLength;
      if (length > limit) { await reader.cancel(); throw new ApiError('The cloud response is too large.', 502); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return object(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
  } catch (error) { if (error instanceof ApiError) throw error; throw new ApiError('The cloud returned an unreadable response. Retry while keeping this page open.', 502); }
  finally { reader.releaseLock(); }
}

/** Online-only. Keys and decrypted records live in this closure, never browser storage. */
export function createCloudClient(options: { apiBase?: string; fetch?: typeof fetch } = {}): CloudClient {
  const apiBase = (options.apiBase ?? '/drug/api').replace(/\/$/, '');
  const fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);
  let user: CloudUser | null = null, snapshot: CloudVaultSnapshot | null = null, loaded = false;
  let key: CryptoKey | null = null, data: AppData | null = null, generation = 0;
  let queue: Promise<unknown> = Promise.resolve();
  type Pending = { signature: string; expectedRevision: number; dataEnvelope: VaultDataEnvelope; keyEnvelope: VaultKeyEnvelope; candidate: AppData; result: unknown };
  let pending: Pending | null = null;
  type PendingSetup = { key: CryptoKey; candidate: AppData; dataEnvelope: VaultDataEnvelope; keyEnvelope: VaultKeyEnvelope; recoveryKey: string };
  let pendingSetup: PendingSetup | null = null;
  const check = (token: number, ownerId?: string) => {
    if (generation !== token || (ownerId !== undefined && user?.id !== ownerId)) throw new ApiError('The vault was locked or the account changed. Unlock it before continuing.', 401);
  };
  const requireOwner = (expected?: string): string => {
    if (!user || (expected !== undefined && user.id !== expected)) throw new ApiError('Sign in to the account that owns these records.', 401);
    return user.id;
  };
  const requireUnlocked = (expected?: string): string => {
    const owner = requireOwner(expected);
    if (!key || !data || !snapshot) throw new ApiError('Unlock your encrypted records first.', 423);
    return owner;
  };
  function serial<T>(task: (token: number) => Promise<T>): Promise<T> {
    const token = generation;
    const run = queue.then(() => { check(token); return task(token); });
    queue = run.catch(() => undefined);
    return run;
  }
  async function wire(path: string, method = 'GET', body?: unknown, ownerId?: string): Promise<Record<string, unknown>> {
    let response: Response;
    try {
      response = await fetcher(`${apiBase}${path}`, { method, credentials: 'same-origin', cache: 'no-store',
        headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(ownerId ? { 'X-Dose-Owner': ownerId } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    } catch { throw new ApiError('Connection interrupted. Keep this page open and retry the same save. No unencrypted data was queued.', 0); }
    const result = await responseJson(response);
    if (!response.ok) throw new ApiError(typeof result.error === 'string' ? result.error : 'The cloud request failed.', response.status, result.currentRevision);
    return result;
  }
  async function readRemote(ownerId: string, token: number): Promise<CloudVaultSnapshot | null> {
    const result = await wire('/vault', 'GET', undefined, ownerId); check(token, ownerId);
    return readSnapshot(result.vault, ownerId);
  }
  function lock(): void { generation++; key = null; data = null; pending = null; pendingSetup = null; }
  async function session(): Promise<CloudUser | null> {
    const token = generation, result = await wire('/session'); check(token);
    const next = readUser(result.user);
    if (next?.id !== user?.id) { lock(); loaded = false; snapshot = null; }
    user = next; return structuredClone(user);
  }
  async function login(username: string, password: string): Promise<CloudUser> {
    lock(); user = null; snapshot = null; loaded = false;
    const token = generation;
    const result = await wire('/auth/login', 'POST', { username, password }); check(token);
    user = readUser(result.user);
    if (!user) throw new ApiError('Sign-in did not return an account.', 502);
    return structuredClone(user);
  }
  function loadVault() { return serial(async token => {
    const ownerId = requireOwner();
    const remote = await readRemote(ownerId, token);
    if (key && data) throw new ApiError('Lock the open vault before loading its encryption settings.', 409);
    snapshot = remote; loaded = true;
    return { exists: remote !== null, revision: remote?.revision ?? 0 };
  }); }
  function unlockVault(secret: { vaultPassphrase: string } | { recoveryKey: string }) {
    const supplied = { ...secret };
    return serial(async token => {
    const ownerId = requireOwner();
    const remote = await readRemote(ownerId, token);
    if (!remote) throw new ApiError('Create your encrypted vault first.', 404);
    const unlockedKey = 'recoveryKey' in supplied ? await importRecoveryKey(supplied.recoveryKey) : await unwrapVaultKey(remote.keyEnvelope, supplied.vaultPassphrase, ownerId);
    const unlockedData = validateData(await decryptVault(remote.dataEnvelope, unlockedKey, ownerId)); check(token, ownerId);
    snapshot = remote; key = unlockedKey; data = unlockedData; loaded = true; pending = null; pendingSetup = null;
    return structuredClone(data);
  }); }
  function setupVault(vaultPassphrase: string, initialData: AppData = emptyData()) {
    const initial = cloneVaultData(initialData);
    return serial(async token => {
    const ownerId = requireOwner();
    if (snapshot || key) throw new ApiError('An encrypted vault already exists. Unlock it instead.', 409);
    const candidate = validateData(initial);
    let proposed = pendingSetup;
    if (proposed) {
      // A retry must not silently accept a newly typed passphrase for an older key.
      await unwrapVaultKey(proposed.keyEnvelope, vaultPassphrase, ownerId); check(token, ownerId);
      if (JSON.stringify(proposed.candidate) !== JSON.stringify(candidate)) throw new ApiError('Retry vault creation with the original data before making changes.', 409);
      const found = await readRemote(ownerId, token);
      if (found) {
        if (found.revision === 1 && sameEnvelope(found.dataEnvelope, proposed.dataEnvelope) && sameWrappedKey(found.keyEnvelope, proposed.keyEnvelope)) {
          snapshot = found; key = proposed.key; data = proposed.candidate; loaded = true; pendingSetup = null;
          return { data: structuredClone(data), recoveryKey: proposed.recoveryKey };
        }
        pendingSetup = null; snapshot = found; loaded = true;
        throw new ApiError('An encrypted vault already exists. Unlock it instead.', 409);
      }
    } else {
      const createdKey = await createVaultKey();
      const [keyEnvelope, recoveryKey] = await Promise.all([wrapVaultKey(createdKey, vaultPassphrase, ownerId), exportRecoveryKey(createdKey)]);
      const dataEnvelope = await encryptVault(candidate, createdKey, ownerId); check(token, ownerId);
      proposed = { key: createdKey, candidate, dataEnvelope, keyEnvelope, recoveryKey };
      pendingSetup = proposed;
    }
    const { dataEnvelope, keyEnvelope, recoveryKey } = proposed;
    let remote: CloudVaultSnapshot | null;
    try { remote = readSnapshot((await wire('/vault', 'PUT', { expectedRevision: 0, dataEnvelope, keyEnvelope }, ownerId)).vault, ownerId); }
    catch (error) {
      check(token, ownerId);
      // A dropped acknowledgement may follow a successful write. Reconcile exact ciphertext once.
      if (!(error instanceof ApiError) || (error.status !== 0 && error.status < 500)) { pendingSetup = null; throw error; }
      const found = await readRemote(ownerId, token).catch(() => null);
      if (!found || !sameEnvelope(found.dataEnvelope, dataEnvelope) || !sameWrappedKey(found.keyEnvelope, keyEnvelope)) throw error;
      remote = found;
    }
    check(token, ownerId);
    if (!remote || remote.revision !== 1 || !sameEnvelope(remote.dataEnvelope, dataEnvelope) || !sameWrappedKey(remote.keyEnvelope, keyEnvelope)) throw new ApiError('The cloud did not acknowledge this encrypted vault. Reload before continuing.', 502);
    snapshot = remote; key = proposed.key; data = proposed.candidate; loaded = true; pendingSetup = null;
    return { data: structuredClone(candidate), recoveryKey };
  }); }
  async function logout(): Promise<void> {
    const ownerId = user?.id;
    // Local privacy must not depend on connectivity. The host view must unmount
    // its own previously returned data on both successful and failed sign-out.
    lock(); const token = generation;
    try { await wire('/auth/logout', 'POST', {}, ownerId); check(token, ownerId); }
    catch (error) {
      check(token, ownerId);
      throw new ApiError('This device is locked. Server sign-out could not be confirmed; the server session may still be active.', error instanceof ApiError ? error.status : 0);
    }
    user = null; snapshot = null; loaded = false;
  }
  function acceptPending(remote: CloudVaultSnapshot, proposed: Pending): void {
    snapshot = remote; data = proposed.candidate; pending = null;
  }
  async function sendPending(proposed: Pending, ownerId: string, token: number): Promise<unknown> {
    try {
      const remote = readSnapshot((await wire('/vault', 'PUT', { expectedRevision: proposed.expectedRevision, dataEnvelope: proposed.dataEnvelope, keyEnvelope: proposed.keyEnvelope }, ownerId)).vault, ownerId);
      check(token, ownerId);
      if (!remote || remote.revision !== proposed.expectedRevision + 1 || !sameEnvelope(remote.dataEnvelope, proposed.dataEnvelope) || !sameWrappedKey(remote.keyEnvelope, proposed.keyEnvelope)) throw new ApiError('The cloud did not acknowledge this save. Retry while keeping this page open.', 502);
      acceptPending(remote, proposed); return structuredClone(proposed.result);
    } catch (error) {
      check(token, ownerId);
      if (error instanceof ApiError && error.status > 0 && error.status < 500) pending = null;
      throw error;
    }
  }
  async function save(candidate: AppData, result: unknown, signature: string, ownerId: string, token: number): Promise<unknown> {
    if (pending) {
      const proposed = pending, remote = await readRemote(ownerId, token);
      if (remote && remote.revision === proposed.expectedRevision + 1 && sameEnvelope(remote.dataEnvelope, proposed.dataEnvelope) && sameWrappedKey(remote.keyEnvelope, proposed.keyEnvelope)) {
        acceptPending(remote, proposed);
        if (proposed.signature === signature) return structuredClone(proposed.result);
        throw new ApiError('The previous save succeeded. Refresh before making another change.', 409);
      }
      if (!remote || remote.revision !== proposed.expectedRevision) { pending = null; throw new ApiError('Records changed on another device. Refresh and review your unsaved entry before retrying.', 409, remote?.revision); }
      if (proposed.signature !== signature) throw new ApiError('Retry the previous save before making another change.', 409);
      return sendPending(proposed, ownerId, token);
    }
    const dataEnvelope = await encryptVault(candidate, key!, ownerId); check(token, ownerId);
    const proposed = { signature, expectedRevision: snapshot!.revision, dataEnvelope, keyEnvelope: snapshot!.keyEnvelope, candidate, result };
    pending = proposed;
    return sendPending(proposed, ownerId, token);
  }
  async function request<T>(path: string, method = 'GET', body?: unknown, ownerId?: string): Promise<T> {
    if (path === '/session' && method === 'GET') return { user: (await session()) ? { ...user!, email: '' } : null } as T;
    if (path === '/auth/logout' && method === 'POST') { if (ownerId) requireOwner(ownerId); await logout(); return { ok: true } as T; }
    // Snapshot caller-owned input before this operation waits behind another save.
    // Enclosing it in AppData applies the cumulative size/accessor/cycle checks without serializing it first.
    const input = body === undefined ? undefined : (cloneVaultData({ ...emptyData(), checkins: [body] }).checkins[0] as unknown);
    return serial(async token => {
      const owner = requireUnlocked(ownerId);
      if (path === '/data' && method === 'GET') {
        const remote = await readRemote(owner, token);
        if (!remote) throw new ApiError('The encrypted vault is unavailable. Your open records are unchanged.', 409);
        if (pending) {
          if (remote.revision === pending.expectedRevision + 1 && sameEnvelope(remote.dataEnvelope, pending.dataEnvelope) && sameWrappedKey(remote.keyEnvelope, pending.keyEnvelope)) acceptPending(remote, pending);
          else if (remote.revision === pending.expectedRevision) throw new ApiError('A save is unconfirmed. Retry the same save before refreshing.', 409);
          else pending = null;
        }
        const fresh = validateData(await decryptVault(remote.dataEnvelope, key!, owner)); check(token, owner);
        snapshot = remote; data = fresh; return structuredClone(data) as T;
      }
      if (path === '/export' && method === 'GET') return structuredClone(backupFor(data!)) as T;
      const candidate = structuredClone(data!); let result: unknown;
      if (path === '/import' && method === 'POST') {
        const incoming = object(input), archive = object(incoming.backup);
        for (const field of ['revisions', 'tombstones']) if (archive[field] !== undefined && (!Array.isArray(archive[field]) || archive[field].length)) throw new ApiError('This cloud edition imports current snapshots only. Your original full backup is unchanged; correction history and deleted records cannot be imported here.', 400);
        if (!['merge', 'replace'].includes(String(incoming.mode))) throw new ApiError('Choose merge or replace.', 400);
        const imported = parseBackup(JSON.stringify({ ...archive, data: cloneVaultData(archive.data) }));
        let added = 0, skipped = 0;
        const importedVersion = (item: unknown, old?: unknown): Row => {
          const value = item as Row, previous = old as Row | null | undefined;
          const revision = (previous?.revision ?? 0) + 1;
          if (!Number.isSafeInteger(revision)) throw new ApiError('The record revision limit was reached.', 409);
          const now = new Date().toISOString();
          return { ...value, revision, createdAt: previous?.createdAt ?? value.createdAt ?? now, updatedAt: now };
        };
        if (incoming.mode === 'replace') {
          candidate.profile = imported.profile ? importedVersion(imported.profile, candidate.profile) as unknown as AppData['profile'] : null;
          for (const collection of collections) {
            const previous = (candidate[collection] ?? []) as unknown as Row[];
            (candidate[collection] as unknown) = (imported[collection] ?? []).map(item => importedVersion(item, previous.find(old => old.id === item.id)));
          }
        }
        else {
          if (!candidate.profile && imported.profile) candidate.profile = importedVersion(imported.profile) as unknown as AppData['profile'];
          for (const collection of collections) {
            const rows = (candidate[collection] ??= []) as unknown as Row[];
            for (const item of (imported[collection] ?? []) as unknown as Row[]) {
              if (rows.some(row => row.id === item.id) || (collection === 'favorites' && rows.some(row => favoriteKey(row as unknown as Favorite) === favoriteKey(item as unknown as Favorite)))) skipped++;
              else { rows.push(importedVersion(item)); added++; }
            }
          }
        }
        result = { imported: incoming.mode === 'replace' ? collections.reduce((sum, c) => sum + (imported[c]?.length ?? 0), 0) : added, skipped, fullHistory: false };
      } else {
        const match = /^\/(doses|scenarios|favorites|checkins|inventory)\/([A-Za-z0-9_-]{1,100})$/.exec(path);
        if (!((path === '/profile' && method === 'PUT') || (match && ['PUT', 'DELETE'].includes(method)))) throw new ApiError('This action is not available in the encrypted cloud edition.', 404);
        const incoming = object(input) as Row;
        const collection = match?.[1] as Collection | undefined, id = match?.[2];
        const rows = collection ? (candidate[collection] ??= []) as unknown as Row[] : [];
        const old = collection ? rows.find(row => row.id === id) : candidate.profile as unknown as Row | null;
        if (collection === 'favorites' && method === 'PUT' && !old) {
          const duplicate = rows.find(row => favoriteKey(row as unknown as Favorite) === favoriteKey(incoming as unknown as Favorite));
          if (duplicate) throw new ApiError('This medication strength is already saved. Refresh and edit that saved item.', 409, duplicate);
        }
        const expected = incoming.revision ?? 0;
        if (!Number.isSafeInteger(expected) || expected < 0 || expected !== (old?.revision ?? 0)) throw new ApiError('This record changed. Refresh and review your unsaved entry before retrying.', 409, old);
        if (method === 'DELETE') {
          if (!old) throw new ApiError('This record is no longer present. Refresh to review the current records.', 409);
          rows.splice(rows.indexOf(old), 1); result = { ok: true };
        } else {
          if (id && incoming.id !== id) throw new ApiError('The record ID does not match this change.', 400);
          const revision = (old?.revision ?? 0) + 1;
          if (!Number.isSafeInteger(revision)) throw new ApiError('The record revision limit was reached.', 409);
          const now = new Date().toISOString();
          // PUT replaces the snapshot, as the local API does. In particular, removed
          // patch/ingredient fields must not survive a change of medication. Preserve
          // a legacy note when a caller omits this optional field entirely.
          const saved = { ...(old?.note !== undefined && incoming.note === undefined ? { note: old.note } : {}), ...incoming, revision, createdAt: old?.createdAt ?? now, updatedAt: now };
          if (collection === 'favorites') candidate.favorites = upsertFavorite(candidate.favorites, saved as unknown as Favorite);
          else if (collection) { if (old) rows.splice(rows.indexOf(old), 1); rows.push(saved); }
          else candidate.profile = saved as unknown as AppData['profile'];
          result = saved;
        }
      }
      const validated = validateData(candidate);
      // The bounded copy above rejects huge inputs before this identity serialization.
      const signature = JSON.stringify([path, method, input]);
      return await save(validated, result, signature, owner, token) as T;
    });
  }
  return { session, login, loadVault, setupVault, unlockVault, lock, logout, request,
    getState: () => ({ user: structuredClone(user), locked: !key || !data, vaultExists: loaded ? snapshot !== null : null, revision: snapshot?.revision ?? 0 }) };
}
