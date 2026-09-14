import type { AppData } from './types';
import { vaultPasswordError } from './password-policy.mjs';
export { assessVaultPassphrase } from './password-policy.mjs';

/** Standalone client primitives only. This module does not use auth, network or storage APIs. */
export const VAULT_PROTOCOL = 'dose-timeline-vault' as const;
export const VAULT_VERSION = 1 as const;
export const VAULT_KEY_VERSION = 2 as const;
export const VAULT_PBKDF2_ITERATIONS = 600_000;
export const VAULT_MAX_PBKDF2_ITERATIONS = 2_000_000;
export const VAULT_MAX_PLAINTEXT_BYTES = 16_000_000;
export const VAULT_DECRYPTION_ERROR = 'Unable to unlock this encrypted vault.';
const CIPHER = 'AES-256-GCM' as const;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

export interface VaultDataEnvelope {
  protocol: typeof VAULT_PROTOCOL;
  version: typeof VAULT_VERSION;
  kind: 'data';
  ownerId: string;
  cipher: typeof CIPHER;
  iv: string;
  /** Ciphertext includes the 128-bit GCM authentication tag. */
  ciphertext: string;
}
export interface Pbkdf2Settings { name: 'PBKDF2'; hash: 'SHA-256'; iterations: number; salt: string; }
export interface Argon2Settings { name: 'Argon2id'; version: 19; memoryKiB: 65536; iterations: 3; parallelism: 1; salt: string; }
export interface OpaqueSettings { name: 'OPAQUE-export'; hash: 'SHA-256'; context: 'drug-tracker:opaque:v1'; salt: string; }
export type VaultKeyEnvelope = Omit<VaultDataEnvelope, 'kind' | 'version'> & { kind: 'wrapped-key' } & (
  { version: 1; kdf: Pbkdf2Settings } | { version: 2; kdf: Argon2Settings } | { version: 3; kdf: OpaqueSettings }
);

export class VaultDecryptionError extends Error {
  constructor() { super(VAULT_DECRYPTION_ERROR); this.name = 'VaultDecryptionError'; }
}

function webCrypto(): Crypto {
  if (!globalThis.crypto?.subtle) throw new Error('Web Crypto requires a supported secure browser context.');
  return globalThis.crypto;
}
function owner(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) throw new Error('A stable owner ID is required.');
}
function plainObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected an object.');
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new Error('Expected a plain object.');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(value).some(key => typeof key !== 'string' || !descriptors[key].enumerable || !('value' in descriptors[key]))) throw new Error('Unsupported object fields.');
  return value as Record<string, unknown>;
}
function exactKeys(value: Record<string, unknown>, keys: readonly string[]): void {
  const found = Object.keys(value);
  if (found.length !== keys.length || found.some(key => !keys.includes(key))) throw new Error('Unsupported envelope fields.');
}
function base64url(bytes: Uint8Array): string {
  const parts: string[] = [];
  for (let start = 0; start < bytes.length; start += 0x8000) parts.push(String.fromCharCode(...bytes.subarray(start, start + 0x8000)));
  return btoa(parts.join('')).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function readBase64url(value: unknown, minimumBytes: number, maximumBytes: number): Uint8Array<ArrayBuffer> {
  if (typeof value !== 'string' || !value.length || value.length > Math.ceil(maximumBytes * 4 / 3)
    || value.length % 4 === 1 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid binary encoding.');
  const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4));
  if (binary.length < minimumBytes || binary.length > maximumBytes) throw new Error('Invalid binary length.');
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
  if (base64url(bytes) !== value) throw new Error('Noncanonical binary encoding.');
  return bytes;
}
function assertVaultKey(key: CryptoKey): void {
  if (key?.type !== 'secret' || key.algorithm.name !== 'AES-GCM' || (key.algorithm as AesKeyAlgorithm).length !== 256
    || !key.usages.includes('encrypt') || !key.usages.includes('decrypt')) throw new Error('A 256-bit vault key is required.');
}
function aad(kind: 'data' | 'wrapped-key', ownerId: string, kdf?: VaultKeyEnvelope['kdf']): Uint8Array<ArrayBuffer> {
  // An ordered tuple avoids ambiguous concatenation and separates data from key-wrapping.
  return encoder.encode(JSON.stringify([VAULT_PROTOCOL, kdf?.name === 'OPAQUE-export' ? 3 : kdf?.name === 'Argon2id' ? VAULT_KEY_VERSION : VAULT_VERSION, kind, CIPHER, ownerId,
    ...(kdf?.name === 'OPAQUE-export' ? [kdf.name, kdf.hash, kdf.context, kdf.salt] : kdf?.name === 'Argon2id' ? [kdf.name, kdf.version, kdf.memoryKiB, kdf.iterations, kdf.parallelism, kdf.salt] : kdf ? [kdf.name, kdf.hash, kdf.iterations, kdf.salt] : [])]));
}

function readEnvelope(input: unknown, expectedOwnerId: string, kind: 'data'): VaultDataEnvelope;
function readEnvelope(input: unknown, expectedOwnerId: string, kind: 'wrapped-key'): VaultKeyEnvelope;
function readEnvelope(input: unknown, expectedOwnerId: string, kind: 'data' | 'wrapped-key'): VaultDataEnvelope | VaultKeyEnvelope {
  owner(expectedOwnerId);
  const value = plainObject(input);
  exactKeys(value, ['protocol', 'version', 'kind', 'ownerId', 'cipher', 'iv', 'ciphertext', ...(kind === 'wrapped-key' ? ['kdf'] : [])]);
  if (value.protocol !== VAULT_PROTOCOL || !(value.version === 1 || (kind === 'wrapped-key' && (value.version === 2 || value.version === 3))) || value.kind !== kind || value.cipher !== CIPHER || value.ownerId !== expectedOwnerId) throw new Error('Unsupported envelope.');
  readBase64url(value.iv, 12, 12);
  readBase64url(value.ciphertext, kind === 'wrapped-key' ? 48 : 17, kind === 'wrapped-key' ? 48 : VAULT_MAX_PLAINTEXT_BYTES + 16);
  if (kind === 'wrapped-key') {
    const kdf = plainObject(value.kdf);
    if (value.version === 1) {
      exactKeys(kdf, ['name', 'hash', 'iterations', 'salt']);
      if (kdf.name !== 'PBKDF2' || kdf.hash !== 'SHA-256' || !Number.isSafeInteger(kdf.iterations)
        || Number(kdf.iterations) < VAULT_PBKDF2_ITERATIONS || Number(kdf.iterations) > VAULT_MAX_PBKDF2_ITERATIONS) throw new Error('Unsupported key derivation.');
    } else if (value.version === 2) {
      exactKeys(kdf, ['name', 'version', 'memoryKiB', 'iterations', 'parallelism', 'salt']);
      if (kdf.name !== 'Argon2id' || kdf.version !== 19 || kdf.memoryKiB !== 65536 || kdf.iterations !== 3 || kdf.parallelism !== 1) throw new Error('Unsupported key derivation.');
    } else {
      exactKeys(kdf, ['name', 'hash', 'context', 'salt']);
      if (kdf.name !== 'OPAQUE-export' || kdf.hash !== 'SHA-256' || kdf.context !== 'drug-tracker:opaque:v1') throw new Error('Unsupported key derivation.');
    }
    readBase64url(kdf.salt, 16, 16);
  }
  // Snapshot accepted public fields before any asynchronous crypto work.
  return JSON.parse(JSON.stringify(value)) as VaultDataEnvelope | VaultKeyEnvelope;
}

/** Structural validation only; authentication still requires successful decryption. */
export function cloneVaultEnvelopes(data: unknown, wrappedKey: unknown, expectedOwnerId: string): { dataEnvelope: VaultDataEnvelope; keyEnvelope: VaultKeyEnvelope } {
  return { dataEnvelope: readEnvelope(data, expectedOwnerId, 'data'), keyEnvelope: readEnvelope(wrappedKey, expectedOwnerId, 'wrapped-key') };
}

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
/** Bounded JSON snapshot for callers that must validate before serialization. No domain validation. */
export function cloneVaultData(input: unknown): AppData { return boundedData(input); }
function boundedData(input: unknown): AppData {
  let visited = 0, jsonBytes = 0;
  const seen = new WeakSet<object>();
  const tooLarge = () => new Error('Vault data exceeds 16 MB.');
  function charge(bytes: number): void {
    jsonBytes += bytes;
    if (jsonBytes > VAULT_MAX_PLAINTEXT_BYTES) throw tooLarge();
  }
  function chargeString(value: string): void {
    // Count the exact UTF-8 size of JSON.stringify's well-formed string encoding
    // directly from UTF-16. Do not allocate escaped strings or per-field byte arrays.
    const remaining = VAULT_MAX_PLAINTEXT_BYTES - jsonBytes;
    let bytes = 2; // opening and closing quotes
    if (bytes > remaining) throw tooLarge();
    for (let index = 0; index < value.length; index++) {
      const code = value.charCodeAt(index);
      if (code === 0x22 || code === 0x5c) bytes += 2;
      else if (code < 0x20) bytes += code === 8 || code === 9 || code === 10 || code === 12 || code === 13 ? 2 : 6;
      else if (code < 0x80) bytes++;
      else if (code < 0x800) bytes += 2;
      else if (code >= 0xd800 && code <= 0xdbff) {
        const next = value.charCodeAt(index + 1);
        if (next >= 0xdc00 && next <= 0xdfff) { bytes += 4; index++; }
        else bytes += 6; // lone high surrogate becomes a JSON \uXXXX escape
      } else if (code >= 0xdc00 && code <= 0xdfff) bytes += 6;
      else bytes += 3;
      if (bytes > remaining) throw tooLarge();
    }
    charge(bytes);
  }
  function copy(value: unknown, depth: number): JsonValue {
    if (++visited > 500_000 || depth > 32) throw new Error('Vault data is too deeply nested or has too many fields.');
    if (value === null || typeof value === 'boolean') { charge(value === false ? 5 : 4); return value; }
    if (typeof value === 'number') { if (!Number.isFinite(value)) throw new Error('Invalid vault number.'); charge(String(value).length); return value; }
    if (typeof value === 'string') { if (value.length > 1_000_000) throw new Error('Vault text is too long.'); chargeString(value); return value; }
    if (typeof value !== 'object' || seen.has(value)) throw new Error('Vault data must be JSON serializable.');
    seen.add(value);
    try {
      if (Array.isArray(value)) {
        if (value.length > 50_000) throw new Error('Vault list is too long.');
        charge(2 + Math.max(0, value.length - 1)); // brackets and commas
        return Array.from(value, child => copy(child, depth + 1));
      }
      const record = plainObject(value), entries = Object.entries(record);
      if (entries.length > 100) throw new Error('Vault object has too many fields.');
      const result: { [key: string]: JsonValue } = {};
      charge(2); // braces
      let included = 0;
      for (const [key, child] of entries) {
        if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('Unsafe vault field.');
        // Optional TypeScript fields follow JSON object semantics; no array values are dropped.
        if (child !== undefined) {
          charge((included++ ? 1 : 0) + 1); // comma, then colon
          chargeString(key);
          result[key] = copy(child, depth + 1);
        }
      }
      return result;
    } finally { seen.delete(value); }
  }
  const record = plainObject(copy(input, 0));
  const fields = ['profile', 'doses', 'scenarios', 'favorites', 'checkins'];
  exactKeys(record, [...fields, ...(Object.hasOwn(record, 'inventory') ? ['inventory'] : [])]);
  if (record.profile !== null) plainObject(record.profile);
  for (const key of [...fields.slice(1), ...(Object.hasOwn(record, 'inventory') ? ['inventory'] : [])]) {
    if (!Array.isArray(record[key])) throw new Error('Missing vault collection.');
    for (const item of record[key]) plainObject(item);
  }
  // This checks safe JSON/container structure, not medication/domain-schema validity.
  // Integrators must run the application schema validator before applying restored data.
  return record as unknown as AppData;
}

/** Extractable only to support explicit encrypted wrapping and recovery-key export. Keep in memory. */
export async function createVaultKey(): Promise<CryptoKey> {
  return webCrypto().subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

/** The returned 43-character string is the full secret vault key, not an auth recovery code. */
export async function exportRecoveryKey(key: CryptoKey): Promise<string> {
  assertVaultKey(key);
  const raw = new Uint8Array(await webCrypto().subtle.exportKey('raw', key));
  try { return base64url(raw); } finally { raw.fill(0); }
}

/** Recovery imports never access an account, browser storage, clipboard, URL or network. */
export async function importRecoveryKey(recoveryKey: string): Promise<CryptoKey> {
  let raw: Uint8Array<ArrayBuffer> | undefined;
  try {
    raw = readBase64url(recoveryKey, 32, 32);
    return await webCrypto().subtle.importKey('raw', raw, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
  } catch { throw new VaultDecryptionError(); }
  finally { raw?.fill(0); }
}

/** Only OPAQUE's client-only export key is accepted. Its shared session key is never used here. */
async function opaqueWrappingKey(exportKey: string, kdf: OpaqueSettings, ownerId: string): Promise<CryptoKey> {
  const raw = readBase64url(exportKey, 64, 64);
  try {
    const material = await webCrypto().subtle.importKey('raw', raw, 'HKDF', false, ['deriveKey']);
    const info = encoder.encode(JSON.stringify([VAULT_PROTOCOL, 3, 'opaque-export-wrap', CIPHER, ownerId, kdf.context]));
    return await webCrypto().subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: readBase64url(kdf.salt, 16, 16), info }, material, { name: 'AES-GCM', length: 256 }, false, ['wrapKey', 'unwrapKey']);
  } finally { raw.fill(0); }
}
export async function wrapVaultKeyOpaque(key: CryptoKey, exportKey: string, ownerId: string): Promise<VaultKeyEnvelope> {
  owner(ownerId); assertVaultKey(key);
  const kdf: OpaqueSettings = { name: 'OPAQUE-export', hash: 'SHA-256', context: 'drug-tracker:opaque:v1', salt: base64url(webCrypto().getRandomValues(new Uint8Array(16))) };
  const kek = await opaqueWrappingKey(exportKey, kdf, ownerId), iv = webCrypto().getRandomValues(new Uint8Array(12));
  const wrapped = await webCrypto().subtle.wrapKey('raw', key, kek, { name: 'AES-GCM', iv, additionalData: aad('wrapped-key', ownerId, kdf), tagLength: 128 });
  return { protocol: VAULT_PROTOCOL, version: 3, kind: 'wrapped-key', ownerId, cipher: CIPHER, iv: base64url(iv), ciphertext: base64url(new Uint8Array(wrapped)), kdf };
}
export async function unwrapVaultKeyOpaque(envelope: unknown, exportKey: string, expectedOwnerId: string): Promise<CryptoKey> {
  try {
    const value = readEnvelope(envelope, expectedOwnerId, 'wrapped-key');
    if (value.kdf.name !== 'OPAQUE-export') throw new Error('OPAQUE key wrapping required.');
    const kek = await opaqueWrappingKey(exportKey, value.kdf, expectedOwnerId);
    return await webCrypto().subtle.unwrapKey('raw', readBase64url(value.ciphertext, 48, 48), kek,
      { name: 'AES-GCM', iv: readBase64url(value.iv, 12, 12), additionalData: aad('wrapped-key', expectedOwnerId, value.kdf), tagLength: 128 },
      { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
  } catch { throw new VaultDecryptionError(); }
}

/** The versioned code contains two independent secrets. Only authToken may leave the client. */
export async function createSecureRecoveryKey(key: CryptoKey, ownerId: string): Promise<{ recoveryKey: string; recoveryAuthHash: string }> {
  owner(ownerId); assertVaultKey(key);
  const token = webCrypto().getRandomValues(new Uint8Array(32));
  try {
    const auth = base64url(token), dek = await exportRecoveryKey(key);
    const recoveryAuthHash = Array.from(new Uint8Array(await webCrypto().subtle.digest('SHA-256', token)), byte => byte.toString(16).padStart(2, '0')).join('');
    return { recoveryKey: `DTR1.${ownerId}.${auth}.${dek}`, recoveryAuthHash };
  } finally { token.fill(0); }
}
export async function readSecureRecoveryKey(value: string): Promise<{ ownerId: string; authToken: string; key: CryptoKey }> {
  try {
    if (typeof value !== 'string' || value.length > 224) throw new Error('Invalid recovery code.');
    const pieces = value.trim().split('.');
    if (pieces.length !== 4 || pieces[0] !== 'DTR1') throw new Error('Invalid recovery code.');
    owner(pieces[1]); readBase64url(pieces[2], 32, 32).fill(0);
    return { ownerId: pieces[1], authToken: pieces[2], key: await importRecoveryKey(pieces[3]) };
  } catch { throw new VaultDecryptionError(); }
}

export async function encryptVault(data: AppData, key: CryptoKey, ownerId: string): Promise<VaultDataEnvelope> {
  owner(ownerId); assertVaultKey(key);
  const plaintext = encoder.encode(JSON.stringify(boundedData(data)));
  try {
    if (plaintext.byteLength > VAULT_MAX_PLAINTEXT_BYTES) throw new Error('Vault data exceeds 16 MB.');
    const iv = webCrypto().getRandomValues(new Uint8Array(12));
    const encrypted = await webCrypto().subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad('data', ownerId), tagLength: 128 }, key, plaintext);
    return { protocol: VAULT_PROTOCOL, version: VAULT_VERSION, kind: 'data', ownerId, cipher: CIPHER, iv: base64url(iv), ciphertext: base64url(new Uint8Array(encrypted)) };
  } finally { plaintext.fill(0); }
}

/** Never infer the expected owner from untrusted envelope.ownerId. All failures are generic. */
export async function decryptVault(envelope: unknown, key: CryptoKey, expectedOwnerId: string): Promise<AppData> {
  let plaintext: Uint8Array<ArrayBuffer> | undefined;
  try {
    const value = readEnvelope(envelope, expectedOwnerId, 'data'); assertVaultKey(key);
    plaintext = new Uint8Array(await webCrypto().subtle.decrypt({ name: 'AES-GCM', iv: readBase64url(value.iv, 12, 12), additionalData: aad('data', expectedOwnerId), tagLength: 128 }, key, readBase64url(value.ciphertext, 17, VAULT_MAX_PLAINTEXT_BYTES + 16)));
    if (plaintext.byteLength > VAULT_MAX_PLAINTEXT_BYTES) throw new Error('Oversized plaintext.');
    return boundedData(JSON.parse(decoder.decode(plaintext)));
  } catch { throw new VaultDecryptionError(); }
  finally { plaintext?.fill(0); }
}

async function argon2Bytes(password: Uint8Array<ArrayBuffer>, salt: Uint8Array<ArrayBuffer>, signal?: AbortSignal): Promise<Uint8Array<ArrayBuffer>> {
  signal?.throwIfAborted();
  if (typeof window === 'undefined') {
    const { argon2id } = await import('hash-wasm');
    signal?.throwIfAborted();
    return new Uint8Array(await argon2id({ password, salt, memorySize: 65536, iterations: 3, parallelism: 1, hashLength: 32, outputType: 'binary' }));
  }
  // Worker code and its WASM are same-origin build assets, with no CDN requests.
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./vault-kdf.worker.ts', import.meta.url), { type: 'module', name: 'drug-vault-kdf' });
    const cleanup = () => { signal?.removeEventListener('abort', abort); worker.terminate(); };
    const abort = () => { cleanup(); reject(new DOMException('Key derivation canceled.', 'AbortError')); };
    worker.onerror = () => { cleanup(); reject(new Error('Key derivation failed. Use a supported browser and retry.')); };
    worker.onmessage = (event: MessageEvent<{ result?: Uint8Array }>) => {
      const result = event.data.result;
      cleanup();
      if (signal?.aborted) reject(new DOMException('Key derivation canceled.', 'AbortError'));
      else if (result instanceof Uint8Array && result.byteLength === 32) resolve(new Uint8Array(result));
      else reject(new Error('Key derivation failed.'));
      result?.fill(0);
    };
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) { abort(); return; }
    const copiedPassword = password.slice(), copiedSalt = salt.slice();
    try { worker.postMessage({ password: copiedPassword, salt: copiedSalt }, [copiedPassword.buffer, copiedSalt.buffer]); }
    catch (error) { copiedPassword.fill(0); copiedSalt.fill(0); cleanup(); reject(error); }
  });
}

async function deriveWrappingKey(vaultPassphrase: string, kdf: VaultKeyEnvelope['kdf'], signal?: AbortSignal): Promise<CryptoKey> {
  if (kdf.name === 'OPAQUE-export') throw new Error('This account requires OPAQUE authentication.');
  // Exact Unicode, no trimming or normalization; a new vault UI must request an independent secret.
  if (typeof vaultPassphrase !== 'string' || vaultPassphrase.length > 1024 || [...vaultPassphrase].length < 12) throw new Error('Use a vault passphrase of 12–1,024 characters.');
  const bytes = encoder.encode(vaultPassphrase);
  try {
    if (decoder.decode(bytes) !== vaultPassphrase) throw new Error('Use valid Unicode in the vault passphrase.');
    signal?.throwIfAborted();
    if (kdf.name === 'Argon2id') {
      const raw = await argon2Bytes(bytes, readBase64url(kdf.salt, 16, 16), signal);
      try { signal?.throwIfAborted(); return await webCrypto().subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['wrapKey', 'unwrapKey']); }
      finally { raw.fill(0); }
    }
    const material = await webCrypto().subtle.importKey('raw', bytes, { name: 'PBKDF2' }, false, ['deriveKey']);
    return await webCrypto().subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: readBase64url(kdf.salt, 16, 16), iterations: kdf.iterations }, material, { name: 'AES-GCM', length: 256 }, false, ['wrapKey', 'unwrapKey']);
  } finally { bytes.fill(0); }
}

/** This passphrase is client-only and must never be the authentication password. */
export async function wrapVaultKey(key: CryptoKey, vaultPassphrase: string, ownerId: string, signal?: AbortSignal): Promise<VaultKeyEnvelope> {
  owner(ownerId); assertVaultKey(key);
  const error = await vaultPasswordError(vaultPassphrase); if (error) throw new Error(error);
  const kdf: Argon2Settings = { name: 'Argon2id', version: 19, memoryKiB: 65536, iterations: 3, parallelism: 1, salt: base64url(webCrypto().getRandomValues(new Uint8Array(16))) };
  const kek = await deriveWrappingKey(vaultPassphrase, kdf, signal);
  const iv = webCrypto().getRandomValues(new Uint8Array(12));
  const wrapped = await webCrypto().subtle.wrapKey('raw', key, kek, { name: 'AES-GCM', iv, additionalData: aad('wrapped-key', ownerId, kdf), tagLength: 128 });
  return { protocol: VAULT_PROTOCOL, version: VAULT_KEY_VERSION, kind: 'wrapped-key', ownerId, cipher: CIPHER, iv: base64url(iv), ciphertext: base64url(new Uint8Array(wrapped)), kdf };
}

export async function unwrapVaultKey(envelope: unknown, vaultPassphrase: string, expectedOwnerId: string, signal?: AbortSignal): Promise<CryptoKey> {
  try {
    const value = readEnvelope(envelope, expectedOwnerId, 'wrapped-key');
    const kek = await deriveWrappingKey(vaultPassphrase, value.kdf, signal);
    return await webCrypto().subtle.unwrapKey('raw', readBase64url(value.ciphertext, 48, 48), kek,
      { name: 'AES-GCM', iv: readBase64url(value.iv, 12, 12), additionalData: aad('wrapped-key', expectedOwnerId, value.kdf), tagLength: 128 },
      { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
  } catch { throw new VaultDecryptionError(); }
}

/** Used before transmitting a proposed ACCOUNT password. Derivation failures fail closed. */
export async function passwordMatchesWrappedKey(envelope: unknown, candidate: string, expectedOwnerId: string, signal?: AbortSignal): Promise<boolean> {
  const value = readEnvelope(envelope, expectedOwnerId, 'wrapped-key');
  const kek = await deriveWrappingKey(candidate, value.kdf, signal);
  signal?.throwIfAborted();
  try {
    await webCrypto().subtle.unwrapKey('raw', readBase64url(value.ciphertext, 48, 48), kek,
      { name: 'AES-GCM', iv: readBase64url(value.iv, 12, 12), additionalData: aad('wrapped-key', expectedOwnerId, value.kdf), tagLength: 128 },
      { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
    return true;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'OperationError') return false;
    throw error;
  }
}
