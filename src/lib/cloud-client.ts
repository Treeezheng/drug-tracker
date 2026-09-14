import { ApiError } from './api';
import type { CloudTransport } from './api';
import type { AppData, Favorite } from './types';
import { favoriteKey, upsertFavorite } from './favorites';
import { parseBackup } from './reports';
import { mergeGuestTransfer } from './guest-transfer';
import { accountPasswordError, vaultPasswordError, masterPasswordError } from './password-policy.mjs';
import { cloneVaultData, cloneVaultEnvelopes, createVaultKey, decryptVault, encryptVault, exportRecoveryKey, importRecoveryKey, passwordMatchesWrappedKey, unwrapVaultKey, wrapVaultKey, wrapVaultKeyOpaque, unwrapVaultKeyOpaque, createSecureRecoveryKey, readSecureRecoveryKey } from './vault-crypto';
import { opaqueClient } from './opaque-client';
import { opaqueConfig, opaqueLogin, opaqueField, secureUsername, finishOpaqueRegistration } from './cloud-opaque-flow';
import type { OpaqueAction } from './cloud-opaque-flow';
import type { VaultDataEnvelope, VaultKeyEnvelope } from './vault-crypto';

export interface CloudUser { id: string; name: string; username?: string; authMode?: 'opaque-v1' | 'legacy-scrypt'; }
export interface CloudVaultSnapshot { ownerId: string; revision: number; dataEnvelope: VaultDataEnvelope; keyEnvelope: VaultKeyEnvelope; createdAt: string; updatedAt: string; }
export type VaultSecret = { vaultPassphrase: string } | { recoveryKey: string };
export interface CloudClient extends CloudTransport {
  session(): Promise<CloudUser | null>;
  login(username: string, password: string): Promise<CloudUser>;
  register(username: string, password: string, name?: string): Promise<CloudUser>;
  registerSecure(username: string, masterPassword: string, name?: string): Promise<{ recoveryKey: string }>;
  loginSecure(username: string, masterPassword: string): Promise<void>;
  recoverSecure(username: string, recoveryCode: string, newMasterPassword: string): Promise<{ recoveryKey: string }>;
  migrateToSecure(newMasterPassword: string, legacyAccountPassword: string): Promise<{ recoveryKey: string }>;
  loadVault(): Promise<{ exists: boolean; revision: number }>;
  setupVault(vaultPassphrase: string, initialData?: AppData): Promise<{ data: AppData; recoveryKey: string }>;
  unlockVault(secret: { vaultPassphrase: string } | { recoveryKey: string }): Promise<AppData>;
  lock(): void;
  logout(): Promise<void>;
  deleteAccount(password: string): Promise<void>;
  changeVaultPassword(currentSecret: VaultSecret, newPassphrase: string, accountPassword: string): Promise<{ recoveryKeyChanged: false }>;
  rotateVaultKey(currentSecret: VaultSecret, newPassphrase: string, accountPassword: string): Promise<{ recoveryKey: string }>;
  logoutAll(password: string): Promise<void>;
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
  if (row.username !== undefined && (typeof row.username !== 'string' || !/^[a-z0-9][a-z0-9._-]{2,63}$/.test(row.username))) throw new ApiError('The cloud returned an invalid username.', 502);
  if (row.authMode !== undefined && !['opaque-v1', 'legacy-scrypt'].includes(String(row.authMode))) throw new ApiError('The cloud returned an invalid authentication mode.', 502);
  return { id: row.id, name: row.name, ...(row.username === undefined ? {} : { username: row.username as string }), ...(row.authMode === undefined ? {} : { authMode: row.authMode as CloudUser['authMode'] }) };
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
    && Object.keys(a.kdf).length === Object.keys(b.kdf).length
    && Object.entries(a.kdf).every(([field, value]) => (b.kdf as unknown as Record<string, unknown>)[field] === value);
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
  let cryptoAbort = new AbortController();
  let queue: Promise<unknown> = Promise.resolve();
  // Serialize cookie-changing requests even after the caller locks/cancels. A late
  // Set-Cookie from an old login or logout must settle before the next auth request.
  let authQueue: Promise<unknown> = Promise.resolve();
  type Pending = { signature: string; expectedRevision: number; dataEnvelope: VaultDataEnvelope; keyEnvelope: VaultKeyEnvelope; candidate: AppData; result: unknown };
  let pending: Pending | null = null;
  type PendingSetup = { key: CryptoKey; candidate: AppData; dataEnvelope: VaultDataEnvelope; keyEnvelope: VaultKeyEnvelope; recoveryKey: string };
  let pendingSetup: PendingSetup | null = null;
  type VaultChange = { kind: 'password' | 'rotate'; original: CloudVaultSnapshot; key: CryptoKey; dataEnvelope: VaultDataEnvelope; keyEnvelope: VaultKeyEnvelope; recoveryKey?: string };
  let pendingVaultChange: VaultChange | null = null;
  type SecureCandidate = { kind: 'register' | 'recover' | 'migrate' | 'change' | 'rotate'; username: string; ownerId: string; key: CryptoKey; dataEnvelope: VaultDataEnvelope; keyEnvelope: VaultKeyEnvelope; recoveryKey?: string; recoveryAuthHash?: string; retrySalt?: string; retryTag?: string; original?: CloudVaultSnapshot | null };
  let pendingSecure: SecureCandidate | null = null;
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
  function serialAuth<T>(token: number, task: () => Promise<T>): Promise<T> {
    const run = authQueue.then(() => { check(token); return task(); });
    authQueue = run.catch(() => undefined);
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
    const remote = readSnapshot(result.vault, ownerId);
    if (remote && snapshot?.ownerId === ownerId && remote.revision < snapshot.revision) throw new ApiError('The server returned an older record snapshot. Your open records are unchanged. Try again after checking the server.', 409, remote.revision);
    return remote;
  }
  function lock(): void { generation++; cryptoAbort.abort(); cryptoAbort = new AbortController(); key = null; data = null; pending = null; pendingSetup = null; pendingVaultChange = null; pendingSecure = null; }
  async function session(): Promise<CloudUser | null> {
    const token = generation;
    await authQueue; check(token);
    const result = await wire('/session'); check(token);
    const next = readUser(result.user);
    if (next?.id !== user?.id) { lock(); loaded = false; snapshot = null; }
    user = next; return structuredClone(user);
  }
  async function login(username: string, password: string): Promise<CloudUser> {
    lock(); user = null; snapshot = null; loaded = false;
    const token = generation;
    return serialAuth(token, async () => {
      const result = await wire('/auth/login', 'POST', { username, password }); check(token);
      user = readUser(result.user);
      if (!user) throw new ApiError('Sign-in did not return an account.', 502);
      return structuredClone(user);
    });
  }
  async function register(username: string, password: string, name?: string): Promise<CloudUser> {
    lock(); user = null; snapshot = null; loaded = false;
    const token = generation;
    return serialAuth(token, async () => {
      const result = await wire('/auth/register', 'POST', { username, password, ...(name === undefined ? {} : { name }) }); check(token);
      user = readUser(result.user);
      if (!user) throw new ApiError('Registration did not return an account.', 502);
      return structuredClone(user);
    });
  }
  async function acceptSecure(result: Record<string, unknown>, exportKey: string | null, token: number, expected?: SecureCandidate): Promise<void> {
    const next = readUser(result.user);
    if (!next || next.authMode !== 'opaque-v1' || !next.username || (expected && (next.id !== expected.ownerId || next.username !== expected.username))) throw new ApiError('Secure authentication returned a different account.', 502);
    const remote = readSnapshot(result.vault, next.id);
    if (!remote || remote.keyEnvelope.version !== 3) throw new ApiError('Secure authentication did not return encrypted records.', 502);
    if (expected && !sameWrappedKey(remote.keyEnvelope, expected.keyEnvelope)) throw new ApiError('The pending security change does not match the server. Keep the recovery code and sign in again.', 409);
    if (snapshot?.ownerId === next.id && remote.revision < snapshot.revision) throw new ApiError('The server returned an older encrypted snapshot.', 409);
    const nextKey = exportKey === null ? expected!.key : await unwrapVaultKeyOpaque(remote.keyEnvelope, exportKey, next.id);
    const fresh = validateData(await decryptVault(remote.dataEnvelope, nextKey, next.id)); check(token);
    user = next; key = nextKey; data = fresh; snapshot = remote; loaded = true; pending = null; pendingSetup = null; pendingVaultChange = null; pendingSecure = null;
  }
  async function loginSecure(usernameInput: string, masterPassword: string): Promise<void> {
    const username = secureUsername(usernameInput);
    lock(); user = null; snapshot = null; loaded = false; const token = generation;
    return serialAuth(token, async () => {
      const signed = await opaqueLogin(wire, username, masterPassword, cryptoAbort.signal, () => check(token));
      if (readUser(signed.result.user)?.username !== username) throw new ApiError('The secure sign-in account changed.', 502);
      await acceptSecure(signed.result, signed.exportKey, token);
    });
  }
  async function newMaster(value: string, username: string, token: number) {
    const policy = await masterPasswordError(value, username); check(token);
    if (policy) throw new ApiError(policy, 400);
  }
  async function secureFinish(path: string, body: unknown, proposed: SecureCandidate, password: string, token: number, ownerId?: string) {
    proposed.retrySalt = crypto.randomUUID();
    proposed.retryTag = await retryIdentity(password, proposed.retrySalt); check(token);
    if (proposed.original === undefined) proposed.original = snapshot;
    pendingSecure = proposed;
    try {
      const result = await wire(`/auth/opaque/${path}`, 'POST', body, ownerId); check(token);
      await acceptSecure(result, null, token, proposed);
    } catch (error) {
      check(token);
      if (error instanceof ApiError && error.status > 0 && error.status < 500) { pendingSecure = null; throw error; }
      // An atomic finish may have committed before its response was lost. A fresh
      // OPAQUE login verifies the new credentials and exact wrapper before opening.
      try {
        const signed = await opaqueLogin(wire, proposed.username, password, cryptoAbort.signal, () => check(token));
        await acceptSecure(signed.result, signed.exportKey, token, proposed);
      } catch {
        check(token);
        throw new ApiError('Security change is unconfirmed. Keep this page open and retry with the same password. Keep both old and new passwords until sign-in confirms which one is active.', 0);
      }
    }
  }
  async function retryIdentity(password: string, salt: string): Promise<string> {
    // This ephemeral, salted comparison only identifies a pending retry in this
    // already-decrypted process. It is not an auth verifier or a key derivation.
    const bytes = new TextEncoder().encode(JSON.stringify(['pending-security-retry', salt, password]));
    try { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join(''); }
    finally { bytes.fill(0); }
  }
  async function resumeSecure(kind: SecureCandidate['kind'], username: string, password: string, token: number) {
    const proposed = pendingSecure;
    if (!proposed) return null;
    if (proposed.kind !== kind || proposed.username !== username) throw new ApiError('Finish the pending security change before another operation.', 409);
    if (await retryIdentity(password, proposed.retrySalt!) !== proposed.retryTag) throw new ApiError('Retry using the same password as the unconfirmed security change.', 400);
    check(token);
    let signed: Awaited<ReturnType<typeof opaqueLogin>>;
    try { signed = await opaqueLogin(wire, username, password, cryptoAbort.signal, () => check(token)); }
    catch (error) {
      check(token);
      // An explicit failed PAKE proves that the proposed credentials are not
      // currently accepted. Restarting still requires the old auth/recovery proof.
      if (error instanceof ApiError && error.status === 403) { pendingSecure = null; return null; }
      throw error;
    }
    const remote = readSnapshot(signed.result.vault, proposed.ownerId);
    if (remote && proposed.original && remote.revision === proposed.original.revision && sameWrappedKey(remote.keyEnvelope, proposed.original.keyEnvelope) && sameEnvelope(remote.dataEnvelope, proposed.original.dataEnvelope)) { pendingSecure = null; return null; }
    await acceptSecure(signed.result, signed.exportKey, token, proposed);
    return proposed;
  }
  function registerSecure(usernameInput: string, masterPassword: string, name?: string): Promise<{ recoveryKey: string }> {
    const username = secureUsername(usernameInput), token = generation;
    return serial(async () => serialAuth(token, async () => {
      if (user || key) throw new ApiError('Sign out before creating another account.', 409);
      await newMaster(masterPassword, username, token);
      const resumed = await resumeSecure('register', username, masterPassword, token); if (resumed) return { recoveryKey: resumed.recoveryKey! };
      const publicKey = await opaqueConfig(wire, () => check(token));
      const start = await opaqueClient('startRegistration', { password: masterPassword }, cryptoAbort.signal); check(token);
      const response = await wire('/auth/opaque/register/start', 'POST', { username, registrationRequest: start.registrationRequest, ...(name === undefined ? {} : { name }) }); check(token);
      if (response.username !== username) throw new ApiError('Registration returned a different username.', 502);
      const ownerId = opaqueField(response.ownerId, 'owner');
      const finished = await finishOpaqueRegistration(start.clientRegistrationState, response.registrationResponse, masterPassword, username, publicKey, cryptoAbort.signal); check(token);
      const nextKey = await createVaultKey(), recovery = await createSecureRecoveryKey(nextKey, ownerId);
      const dataEnvelope = await encryptVault(emptyData(), nextKey, ownerId), keyEnvelope = await wrapVaultKeyOpaque(nextKey, finished.exportKey, ownerId); check(token);
      const proposed: SecureCandidate = { kind: 'register', username, ownerId, key: nextKey, dataEnvelope, keyEnvelope, ...recovery };
      await secureFinish('register/finish', { challengeId: opaqueField(response.challengeId, 'challenge'), registrationRecord: finished.registrationRecord, dataEnvelope, keyEnvelope, recoveryAuthHash: recovery.recoveryAuthHash }, proposed, masterPassword, token);
      return { recoveryKey: recovery.recoveryKey };
    }));
  }
  function recoverSecure(usernameInput: string, recoveryCode: string, newMasterPassword: string): Promise<{ recoveryKey: string }> {
    const username = secureUsername(usernameInput), token = generation;
    return serial(async () => serialAuth(token, async () => {
      if (key) throw new ApiError('Lock the open records before recovering an account.', 409);
      await newMaster(newMasterPassword, username, token);
      const resumed = await resumeSecure('recover', username, newMasterPassword, token); if (resumed) return { recoveryKey: resumed.recoveryKey! };
      const recovery = await readSecureRecoveryKey(recoveryCode); check(token);
      const publicKey = await opaqueConfig(wire, () => check(token));
      const start = await opaqueClient('startRegistration', { password: newMasterPassword }, cryptoAbort.signal); check(token);
      const challenge = await wire('/auth/opaque/recover/start', 'POST', { ownerId: recovery.ownerId, registrationRequest: start.registrationRequest }); check(token);
      const response = await wire('/auth/opaque/recover/authorize', 'POST', { challengeId: opaqueField(challenge.challengeId, 'challenge'), recoveryAuthSecret: recovery.authToken }); check(token);
      if (response.ownerId !== recovery.ownerId || response.username !== username) throw new ApiError('The recovery key does not belong to this username.', 400);
      const old = readSnapshot(response.vault, recovery.ownerId);
      if (!old || old.keyEnvelope.version !== 3) throw new ApiError('The encrypted account could not be recovered.', 400);
      const recoveredData = validateData(await decryptVault(old.dataEnvelope, recovery.key, recovery.ownerId)); check(token);
      const finished = await finishOpaqueRegistration(start.clientRegistrationState, response.registrationResponse, newMasterPassword, username, publicKey, cryptoAbort.signal); check(token);
      const nextKey = await createVaultKey(), nextRecovery = await createSecureRecoveryKey(nextKey, recovery.ownerId);
      const dataEnvelope = await encryptVault(recoveredData, nextKey, recovery.ownerId), keyEnvelope = await wrapVaultKeyOpaque(nextKey, finished.exportKey, recovery.ownerId); check(token);
      const proposed: SecureCandidate = { kind: 'recover', username, ownerId: recovery.ownerId, key: nextKey, dataEnvelope, keyEnvelope, original: old, ...nextRecovery };
      await secureFinish('recover/finish', { recoveryGrant: opaqueField(response.recoveryGrant, 'recovery confirmation'), registrationRecord: finished.registrationRecord, expectedRevision: old.revision, dataEnvelope, keyEnvelope, recoveryAuthHash: nextRecovery.recoveryAuthHash }, proposed, newMasterPassword, token);
      return { recoveryKey: nextRecovery.recoveryKey };
    }));
  }
  function migrateToSecure(newMasterPassword: string, legacyAccountPassword: string): Promise<{ recoveryKey: string }> {
    return serial(async token => serialAuth(token, async () => {
      const ownerId = requireOwner(), username = user!.username;
      if (!username || user!.authMode === 'opaque-v1') throw new ApiError('Use the older account migration flow.', 409);
      if (newMasterPassword === legacyAccountPassword) throw new ApiError('Choose a new password that you have never used as the old account password.', 400);
      await newMaster(newMasterPassword, username, token);
      const resumed = await resumeSecure('migrate', username, newMasterPassword, token); if (resumed) return { recoveryKey: resumed.recoveryKey! };
      if (pending || pendingSetup || pendingVaultChange) throw new ApiError('Finish the pending record change before migration.', 409);
      const remote = await readRemote(ownerId, token);
      if (remote && (!key || !data || !snapshot || remote.revision !== snapshot.revision || !sameWrappedKey(remote.keyEnvelope, snapshot.keyEnvelope) || !sameEnvelope(remote.dataEnvelope, snapshot.dataEnvelope))) throw new ApiError('Unlock and refresh the old encrypted records before migrating.', 409);
      const publicKey = await opaqueConfig(wire, () => check(token, ownerId));
      const start = await opaqueClient('startRegistration', { password: newMasterPassword }, cryptoAbort.signal); check(token, ownerId);
      const response = await wire('/auth/opaque/migrate/start', 'POST', { legacyPassword: legacyAccountPassword, registrationRequest: start.registrationRequest, expectedRevision: remote?.revision ?? 0 }, ownerId); check(token, ownerId);
      if (response.ownerId !== ownerId || response.username !== username) throw new ApiError('The migration account changed.', 502);
      const finished = await finishOpaqueRegistration(start.clientRegistrationState, response.registrationResponse, newMasterPassword, username, publicKey, cryptoAbort.signal); check(token, ownerId);
      const nextKey = await createVaultKey(), recovery = await createSecureRecoveryKey(nextKey, ownerId);
      const dataEnvelope = await encryptVault(data ?? emptyData(), nextKey, ownerId), keyEnvelope = await wrapVaultKeyOpaque(nextKey, finished.exportKey, ownerId); check(token, ownerId);
      const proposed: SecureCandidate = { kind: 'migrate', username, ownerId, key: nextKey, dataEnvelope, keyEnvelope, ...recovery };
      await secureFinish('migrate/finish', { challengeId: opaqueField(response.challengeId, 'challenge'), registrationRecord: finished.registrationRecord, expectedRevision: remote?.revision ?? 0, dataEnvelope, keyEnvelope, recoveryAuthHash: recovery.recoveryAuthHash }, proposed, newMasterPassword, token, ownerId);
      return { recoveryKey: recovery.recoveryKey };
    }));
  }
  function loadVault() { return serial(async token => {
    const ownerId = requireOwner();
    const remote = await readRemote(ownerId, token);
    if (key && data) throw new ApiError('Lock the open vault before loading its encryption settings.', 409);
    snapshot = remote; loaded = true;
    return { exists: remote !== null, revision: remote?.revision ?? 0 };
  }); }
  function unlockVault(secret: { vaultPassphrase: string } | { recoveryKey: string }) {
    if (user?.authMode === 'opaque-v1') return Promise.reject(new ApiError('Sign in securely with your single password to unlock this account.', 400));
    const supplied = { ...secret };
    return serial(async token => {
    const ownerId = requireOwner();
    const remote = await readRemote(ownerId, token);
    if (!remote) throw new ApiError('Create your encrypted vault first.', 404);
    const unlockedKey = 'recoveryKey' in supplied ? await importRecoveryKey(supplied.recoveryKey) : await unwrapVaultKey(remote.keyEnvelope, supplied.vaultPassphrase, ownerId, cryptoAbort.signal);
    const unlockedData = validateData(await decryptVault(remote.dataEnvelope, unlockedKey, ownerId)); check(token, ownerId);
    snapshot = remote; key = unlockedKey; data = unlockedData; loaded = true; pending = null; pendingSetup = null; pendingVaultChange = null;
    return structuredClone(data);
  }); }
  function setupVault(vaultPassphrase: string, initialData: AppData = emptyData()) {
    if (user?.authMode === 'opaque-v1') return Promise.reject(new ApiError('This account already uses secure one-password setup.', 400));
    const initial = cloneVaultData(initialData);
    return serial(async token => {
    const ownerId = requireOwner();
    const signal = cryptoAbort.signal;
    if (snapshot || key) throw new ApiError('An encrypted vault already exists. Unlock it instead.', 409);
    const candidate = validateData(initial);
    let proposed = pendingSetup;
    if (proposed) {
      // A retry must not silently accept a newly typed passphrase for an older key.
      await unwrapVaultKey(proposed.keyEnvelope, vaultPassphrase, ownerId, signal); check(token, ownerId);
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
      check(token, ownerId);
      const [keyEnvelope, recoveryKey] = await Promise.all([wrapVaultKey(createdKey, vaultPassphrase, ownerId, signal), exportRecoveryKey(createdKey)]);
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
    return serialAuth(token, async () => {
      try { await wire('/auth/logout', 'POST', {}, ownerId); check(token, ownerId); }
      catch (error) {
        check(token, ownerId);
        throw new ApiError('This device is locked. Server sign-out could not be confirmed; the server session may still be active.', error instanceof ApiError ? error.status : 0);
      }
      user = null; snapshot = null; loaded = false;
    });
  }
  function deleteAccount(password: string): Promise<void> {
    if (user?.authMode === 'opaque-v1') return secureAccountAction('delete-account', password);
    if (typeof password !== 'string' || !password || password.length > 256) return Promise.reject(new ApiError('Enter your account password.', 400));
    // Reserve the record queue now, then serialize the cookie-changing request.
    // Earlier saves settle first; work queued after successful deletion sees the
    // incremented generation and cannot restore plaintext or upload another save.
    return serial(async token => {
      const ownerId = requireOwner();
      return serialAuth(token, async () => {
        check(token, ownerId);
        const result = await wire('/account', 'DELETE', { password }, ownerId);
        check(token, ownerId);
        if (result.ok !== true) throw new ApiError('Account deletion could not be confirmed. Check the account before trying again.', 502);
        lock(); user = null; snapshot = null; loaded = false;
      });
    });
  }
  async function logoutAll(password: string): Promise<void> {
    if (user?.authMode === 'opaque-v1') { lock(); return secureAccountAction('logout-all', password); }
    const ownerId = requireOwner();
    lock(); const token = generation;
    // Also wait for earlier record work: its generation is now canceled locally.
    return serial(async () => serialAuth(token, async () => {
      const result = await wire('/auth/logout-all', 'POST', { password }, ownerId); check(token, ownerId);
      if (result.ok !== true) throw new ApiError('All-device sign-out could not be confirmed.', 502);
      user = null; snapshot = null; loaded = false;
    }));
  }
  function secureAccountAction(action: 'delete-account' | 'logout-all', password: string): Promise<void> {
    return serial(async token => serialAuth(token, async () => {
      const ownerId = requireOwner(), username = user!.username!;
      const proof = await opaqueLogin(wire, username, password, cryptoAbort.signal, () => check(token, ownerId), { ownerId, action });
      // Server confirmation is single-use and bound to this account, session and action.
      const reauthGrant = opaqueField(proof.result.reauthGrant, 'confirmation');
      let result: Record<string, unknown>;
      try { result = await wire(action === 'delete-account' ? '/account' : '/auth/logout-all', action === 'delete-account' ? 'DELETE' : 'POST', { reauthGrant }, ownerId); check(token, ownerId); }
      catch (error) {
        check(token, ownerId);
        if (!(error instanceof ApiError) || error.status === 0 || error.status >= 500) { lock(); throw new ApiError('This device is locked. The server operation is unconfirmed; sign in again to check its result.', 401); }
        throw error;
      }
      if (result.ok !== true) throw new ApiError('The account operation was not confirmed.', 502);
      lock(); user = null; snapshot = null; loaded = false;
    }));
  }
  function changeSecure(kind: 'change' | 'rotate', currentPassword: string, newPassword = currentPassword): Promise<{ recoveryKey?: string; user: CloudUser }> {
    return serial(async token => serialAuth(token, async () => {
      const ownerId = requireUnlocked(), username = user!.username!;
      if (pending || pendingSetup || pendingVaultChange) throw new ApiError('Finish the pending save before changing security settings.', 409);
      if (kind === 'change') await newMaster(newPassword, username, token);
      const resumed = await resumeSecure(kind, username, newPassword, token); if (resumed) return { recoveryKey: resumed.recoveryKey, user: structuredClone(user!) };
      const remote = await readRemote(ownerId, token);
      if (!remote || remote.revision !== snapshot!.revision || !sameWrappedKey(remote.keyEnvelope, snapshot!.keyEnvelope) || !sameEnvelope(remote.dataEnvelope, snapshot!.dataEnvelope)) throw new ApiError('Records changed elsewhere. Refresh before changing security settings.', 409);
      const action: OpaqueAction = kind === 'change' ? 'change-password' : 'rotate-recovery';
      const proof = await opaqueLogin(wire, username, currentPassword, cryptoAbort.signal, () => check(token, ownerId), { ownerId, action });
      const currentKey = await unwrapVaultKeyOpaque(remote.keyEnvelope, proof.exportKey, ownerId);
      await decryptVault(remote.dataEnvelope, currentKey, ownerId); check(token, ownerId);
      const reauthGrant = opaqueField(proof.result.reauthGrant, 'confirmation');
      if (kind === 'rotate') {
        const nextKey = await createVaultKey(), recovery = await createSecureRecoveryKey(nextKey, ownerId);
        const dataEnvelope = await encryptVault(data!, nextKey, ownerId), keyEnvelope = await wrapVaultKeyOpaque(nextKey, proof.exportKey, ownerId); check(token, ownerId);
        const proposed: SecureCandidate = { kind, username, ownerId, key: nextKey, dataEnvelope, keyEnvelope, ...recovery };
        await secureFinish('rotate-recovery', { reauthGrant, expectedRevision: remote.revision, dataEnvelope, keyEnvelope, recoveryAuthHash: recovery.recoveryAuthHash }, proposed, currentPassword, token, ownerId);
        return { recoveryKey: recovery.recoveryKey, user: structuredClone(user!) };
      }
      const publicKey = await opaqueConfig(wire, () => check(token, ownerId));
      const start = await opaqueClient('startRegistration', { password: newPassword }, cryptoAbort.signal); check(token, ownerId);
      const response = await wire('/auth/opaque/change/start', 'POST', { reauthGrant, registrationRequest: start.registrationRequest, expectedRevision: remote.revision }, ownerId); check(token, ownerId);
      if (response.ownerId !== ownerId || response.username !== username) throw new ApiError('The account changed during password setup.', 502);
      const finished = await finishOpaqueRegistration(start.clientRegistrationState, response.registrationResponse, newPassword, username, publicKey, cryptoAbort.signal); check(token, ownerId);
      const keyEnvelope = await wrapVaultKeyOpaque(key!, finished.exportKey, ownerId); check(token, ownerId);
      const proposed: SecureCandidate = { kind, username, ownerId, key: key!, dataEnvelope: remote.dataEnvelope, keyEnvelope };
      await secureFinish('change/finish', { challengeId: opaqueField(response.challengeId, 'challenge'), registrationRecord: finished.registrationRecord, expectedRevision: remote.revision, dataEnvelope: remote.dataEnvelope, keyEnvelope }, proposed, newPassword, token, ownerId);
      return { user: structuredClone(user!) };
    }));
  }
  async function verifyVaultSecret(secret: VaultSecret, value: CloudVaultSnapshot, ownerId: string, token: number): Promise<void> {
    const verifiedKey = 'recoveryKey' in secret ? await importRecoveryKey(secret.recoveryKey) : await unwrapVaultKey(value.keyEnvelope, secret.vaultPassphrase, ownerId, cryptoAbort.signal);
    await decryptVault(value.dataEnvelope, verifiedKey, ownerId); check(token, ownerId);
  }
  async function acceptVaultChange(proposed: VaultChange, remote: CloudVaultSnapshot, ownerId: string, token: number) {
    const fresh = validateData(await decryptVault(remote.dataEnvelope, proposed.key, ownerId)); check(token, ownerId);
    key = proposed.key; data = fresh; snapshot = remote; pendingVaultChange = null;
    return proposed.kind === 'rotate' ? { recoveryKey: proposed.recoveryKey! } : { recoveryKeyChanged: false as const };
  }
  function changeVault(kind: VaultChange['kind'], supplied: VaultSecret, newPassphrase: string, accountPassword: string) {
    if (user?.authMode === 'opaque-v1') return Promise.reject(new ApiError('Use the one-password security settings for this account.', 400));
    const secret = { ...supplied };
    return serial(async token => {
      const ownerId = requireUnlocked(), signal = cryptoAbort.signal;
      if (pending || pendingSetup) throw new ApiError('Finish the unconfirmed save before changing encryption.', 409);
      if (typeof accountPassword !== 'string' || !accountPassword || accountPassword.length > 256) throw new ApiError('Enter your current account password.', 400);
      if (newPassphrase === accountPassword) throw new ApiError('Use different account and encryption passwords.', 400);
      const policy = await vaultPasswordError(newPassphrase); check(token, ownerId);
      if (policy) throw new ApiError(policy, 400);
      const verified = await serialAuth(token, () => wire('/auth/verify-password', 'POST', { password: accountPassword }, ownerId)); check(token, ownerId);
      if (verified.ok !== true) throw new ApiError('Account authentication could not be confirmed.', 502);
      let proposed = pendingVaultChange;
      if (proposed) {
        if (proposed.kind !== kind) throw new ApiError('Retry the pending encryption change before starting another one.', 409);
        await verifyVaultSecret(secret, proposed.original, ownerId, token);
        await unwrapVaultKey(proposed.keyEnvelope, newPassphrase, ownerId, signal); check(token, ownerId);
      }
      const remote = await readRemote(ownerId, token);
      if (!remote) throw new ApiError('The encrypted records are unavailable. Nothing was replaced.', 409);
      if (proposed) {
        if (remote.revision > proposed.original.revision && sameWrappedKey(remote.keyEnvelope, proposed.keyEnvelope)) return acceptVaultChange(proposed, remote, ownerId, token);
        if (remote.revision !== proposed.original.revision || !sameEnvelope(remote.dataEnvelope, proposed.original.dataEnvelope) || !sameWrappedKey(remote.keyEnvelope, proposed.original.keyEnvelope)) {
          pendingVaultChange = null;
          throw new ApiError('Records or encryption settings changed elsewhere. Lock and unlock again before retrying.', 409);
        }
      } else {
        if (remote.revision !== snapshot!.revision || !sameEnvelope(remote.dataEnvelope, snapshot!.dataEnvelope) || !sameWrappedKey(remote.keyEnvelope, snapshot!.keyEnvelope)) throw new ApiError('Records changed elsewhere. Refresh before changing encryption.', 409);
        await verifyVaultSecret(secret, remote, ownerId, token);
        const nextKey = kind === 'rotate' ? await createVaultKey() : key!; check(token, ownerId);
        const keyEnvelope = await wrapVaultKey(nextKey, newPassphrase, ownerId, signal); check(token, ownerId);
        const dataEnvelope = kind === 'rotate' ? await encryptVault(data!, nextKey, ownerId) : remote.dataEnvelope; check(token, ownerId);
        const recoveryKey = kind === 'rotate' ? await exportRecoveryKey(nextKey) : undefined; check(token, ownerId);
        proposed = { kind, original: remote, key: nextKey, keyEnvelope, dataEnvelope, recoveryKey };
        pendingVaultChange = proposed;
      }
      let acknowledged: CloudVaultSnapshot | null;
      try {
        acknowledged = readSnapshot((await wire('/vault', 'PUT', { expectedRevision: proposed.original.revision, dataEnvelope: proposed.dataEnvelope, keyEnvelope: proposed.keyEnvelope }, ownerId)).vault, ownerId);
        check(token, ownerId);
        if (!acknowledged || acknowledged.revision !== proposed.original.revision + 1 || !sameEnvelope(acknowledged.dataEnvelope, proposed.dataEnvelope) || !sameWrappedKey(acknowledged.keyEnvelope, proposed.keyEnvelope)) throw new ApiError('The encryption change was not acknowledged.', 502);
      } catch (error) {
        check(token, ownerId);
        if (error instanceof ApiError && error.status > 0 && error.status < 500) { pendingVaultChange = null; throw error; }
        const found = await readRemote(ownerId, token).catch(() => null); check(token, ownerId);
        if (found && found.revision > proposed.original.revision && sameWrappedKey(found.keyEnvelope, proposed.keyEnvelope)) return acceptVaultChange(proposed, found, ownerId, token);
        throw new ApiError('Encryption change is unconfirmed. Keep this page open and retry with the same current secret and new password. If you close it, keep both passwords: the server may already require the new one.', error instanceof ApiError ? error.status : 0);
      }
      return acceptVaultChange(proposed, acknowledged, ownerId, token);
    });
  }
  function changeVaultPassword(currentSecret: VaultSecret, newPassphrase: string, accountPassword: string) { return changeVault('password', currentSecret, newPassphrase, accountPassword) as Promise<{ recoveryKeyChanged: false }>; }
  function rotateVaultKey(currentSecret: VaultSecret, newPassphrase: string, accountPassword: string) { return changeVault('rotate', currentSecret, newPassphrase, accountPassword) as Promise<{ recoveryKey: string }>; }
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
    if (user?.authMode === 'opaque-v1' && path === '/auth/change-password' && method === 'POST') {
      if (ownerId) requireOwner(ownerId);
      const incoming = object(input);
      if (Object.keys(incoming).length !== 2 || typeof incoming.currentPassword !== 'string' || typeof incoming.newPassword !== 'string') throw new ApiError('Enter the current and new passwords.', 400);
      return await changeSecure('change', incoming.currentPassword, incoming.newPassword) as T;
    }
    if (user?.authMode === 'opaque-v1' && path === '/vault/rotate-key' && method === 'POST') {
      if (ownerId) requireOwner(ownerId);
      const incoming = object(input);
      if (Object.keys(incoming).length !== 1 || typeof incoming.password !== 'string') throw new ApiError('Enter your current password.', 400);
      return await changeSecure('rotate', incoming.password) as T;
    }
    if (user?.authMode === 'opaque-v1' && path === '/vault/change-password') throw new ApiError('Use Change password for this account.', 400);
    if (path === '/auth/logout-all' && method === 'POST') {
      if (ownerId) requireOwner(ownerId);
      const incoming = object(input);
      if (Object.keys(incoming).length !== 1 || typeof incoming.password !== 'string') throw new ApiError('Enter your account password.', 400);
      await logoutAll(incoming.password); return { ok: true } as T;
    }
    if (['/vault/change-password', '/vault/rotate-key'].includes(path) && method === 'POST') {
      if (ownerId) requireOwner(ownerId);
      const incoming = object(input);
      if (Object.keys(incoming).length !== 4 || typeof incoming.currentSecret !== 'string' || typeof incoming.useRecovery !== 'boolean' || typeof incoming.newPassphrase !== 'string' || typeof incoming.accountPassword !== 'string') throw new ApiError('Enter the current account password, current encryption secret and a new encryption password.', 400);
      const secret: VaultSecret = incoming.useRecovery ? { recoveryKey: incoming.currentSecret } : { vaultPassphrase: incoming.currentSecret };
      return await (path === '/vault/rotate-key' ? rotateVaultKey(secret, incoming.newPassphrase, incoming.accountPassword) : changeVaultPassword(secret, incoming.newPassphrase, incoming.accountPassword)) as T;
    }
    if ((path === '/security' && method === 'GET') || (path === '/auth/change-password' && method === 'POST')) return serial(async token => {
      const owner = requireUnlocked(ownerId);
      return serialAuth(token, async () => {
        if (path === '/security') { const result = await wire('/security', 'GET', undefined, owner); check(token, owner); return result as T; }
        if (pendingVaultChange) throw new ApiError('Finish the unconfirmed encryption change before changing the account password.', 409);
        const incoming = object(input);
        if (Object.keys(incoming).length !== 2 || typeof incoming.currentPassword !== 'string' || typeof incoming.newPassword !== 'string') throw new ApiError('Enter the current and new account passwords.', 400);
        const policy = await accountPasswordError(incoming.newPassword, user?.name); check(token, owner);
        if (policy) throw new ApiError(policy, 400);
        // Check current server encryption settings, including a key change from
        // another device, before transmitting a proposed account password.
        const remote = await readRemote(owner, token);
        if (!remote) throw new ApiError('Encryption settings are unavailable. The account password was not sent.', 409);
        const matchesVault = await passwordMatchesWrappedKey(remote.keyEnvelope, incoming.newPassword, owner, cryptoAbort.signal);
        check(token, owner);
        if (matchesVault) throw new ApiError('Use different account and encryption passwords.', 400);
        const result = await wire('/auth/change-password', 'POST', { currentPassword: incoming.currentPassword, newPassword: incoming.newPassword }, owner); check(token, owner);
        const nextUser = readUser(result.user);
        if (nextUser?.id !== owner) { lock(); throw new ApiError('The account changed. Sign in again.', 401); }
        user = nextUser; return result as T;
      });
    });
    if (path === '/account' && method === 'DELETE') {
      if (ownerId) requireOwner(ownerId);
      const incoming = object(input);
      if (Object.keys(incoming).length !== 1 || typeof incoming.password !== 'string') throw new ApiError('Enter your account password.', 400);
      await deleteAccount(incoming.password);
      return { ok: true } as T;
    }
    return serial(async token => {
      const owner = requireUnlocked(ownerId);
      if ((pendingVaultChange || pendingSecure) && path !== '/export') throw new ApiError('Finish the unconfirmed encryption change before refreshing or saving records.', 409);
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
      if (path === '/guest-import' && method === 'POST' && !pending) {
        // A transfer must merge with the latest confirmed account snapshot, also
        // on retry after a CAS conflict. An uncertain save retains its exact
        // pending envelopes instead and is reconciled by save() below.
        const remote = await readRemote(owner, token);
        if (!remote) throw new ApiError('The encrypted vault is unavailable. Your local simulation is unchanged.', 409);
        const fresh = validateData(await decryptVault(remote.dataEnvelope, key!, owner)); check(token, owner);
        snapshot = remote; data = fresh;
      }
      let candidate = structuredClone(data!); let result: unknown;
      if (path === '/guest-import' && method === 'POST') {
        candidate = mergeGuestTransfer(candidate, input);
        result = { ok: true };
      } else if (path === '/import' && method === 'POST') {
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
  return { session, login, register, registerSecure, loginSecure, recoverSecure, migrateToSecure, loadVault, setupVault, unlockVault, lock, logout, logoutAll, deleteAccount, changeVaultPassword, rotateVaultKey, request,
    getState: () => ({ user: structuredClone(user), locked: !key || !data, vaultExists: loaded ? snapshot !== null : null, revision: snapshot?.revision ?? 0 }) };
}
