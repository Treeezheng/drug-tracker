import { createStore, getMany } from 'idb-keyval';
import type { AppData, User } from './types';
import { dedupeFavorites } from './favorites';

export class ApiError extends Error {
  constructor(message: string, public status: number, public current?: unknown) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface CloudTransport { request<T>(path: string, method?: string, body?: unknown, ownerId?: string): Promise<T>; }
let cloudMode = false;
let cloudTransport: CloudTransport | null = null;
export function configureCloudTransport(transport: CloudTransport | null): void { cloudMode = true; cloudTransport = transport; setActiveAccount(null); }
export function isCloudEdition(): boolean { return cloudMode; }

interface Queued { id: string; path: string; body: unknown; method: 'PUT' | 'DELETE'; }
export interface PendingChange { id: string; path: string; body: unknown; method: 'PUT' | 'DELETE'; }
interface LocalState { cache: AppData | undefined; queue: Queued[]; cacheEpoch: string | undefined; }
const store = createStore('keyval-store', 'keyval');
const emptyData = (): AppData => ({ profile: null, doses: [], scenarios: [], favorites: [], checkins: [], inventory: [] });
const syncing = new Map<string, Promise<void>>();
let activeAccount: string | null = null;
let accountGeneration = 0;

export function setActiveAccount(userId: string | null): void {
  activeAccount = userId;
  accountGeneration += 1;
}

function keys(userId: string): [string, string, string] {
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(userId)) throw new Error('Invalid local account identifier.');
  return [`cache:${userId}`, `queue:${userId}`, `cache-epoch:${userId}`];
}

function mutationPath(path: string): boolean {
  return path === '/profile' || /^\/(doses|scenarios|favorites|checkins|inventory)\/[A-Za-z0-9_-]{1,100}$/.test(path);
}

/** Cache and outbox updates commit in one IndexedDB transaction, across tabs. */
function changeState<T>(userId: string, change: (state: LocalState) => T): Promise<T> {
  const [cacheKey, queueKey, epochKey] = keys(userId);
  return store('readwrite', (objectStore) => new Promise<T>((resolve, reject) => {
    const cacheRequest = objectStore.get(cacheKey);
    const queueRequest = objectStore.get(queueKey);
    const epochRequest = objectStore.get(epochKey);
    let reads = 0;
    let result: T;
    let failure: unknown;
    const ready = () => {
      if (++reads !== 3) return;
      try {
        const state: LocalState = { cache: cacheRequest.result, queue: queueRequest.result || [], cacheEpoch: epochRequest.result };
        result = change(state);
        if (state.cache === undefined) objectStore.delete(cacheKey);
        else objectStore.put(state.cache, cacheKey);
        if (state.queue.length) objectStore.put(state.queue, queueKey);
        else objectStore.delete(queueKey);
        if (state.cacheEpoch === undefined) objectStore.delete(epochKey);
        else objectStore.put(state.cacheEpoch, epochKey);
      } catch (error) {
        failure = error;
        objectStore.transaction.abort();
      }
    };
    cacheRequest.onsuccess = ready;
    queueRequest.onsuccess = ready;
    epochRequest.onsuccess = ready;
    objectStore.transaction.oncomplete = () => resolve(result);
    objectStore.transaction.onerror = objectStore.transaction.onabort = () => reject(failure || objectStore.transaction.error || new Error('Browser storage could not save this change.'));
  }));
}

function withPending(data: AppData, queue: Queued[]): AppData {
  const visible = structuredClone(data);
  // Collapse legacy copies before applying a pending delete, so removing the
  // visible favorite cannot reveal a hidden duplicate from an older cache.
  visible.favorites = dedupeFavorites(visible.favorites);
  for (const mutation of queue) {
    if (mutation.path === '/profile' && mutation.method === 'PUT') {
      visible.profile = structuredClone(mutation.body) as AppData['profile'];
      continue;
    }
    const match = /^\/(doses|scenarios|favorites|checkins|inventory)\/([A-Za-z0-9_-]{1,100})$/.exec(mutation.path);
    if (!match) continue;
    const kind = match[1] as Exclude<keyof AppData, 'profile'>;
    const id = match[2];
    const rows = (visible[kind] ??= []) as { id: string }[];
    const index = rows.findIndex((row) => row.id === id);
    if (index !== -1) rows.splice(index, 1);
    if (mutation.method === 'PUT') rows.push({ ...structuredClone(mutation.body) as object, id });
  }
  visible.favorites = dedupeFavorites(visible.favorites);
  return visible;
}

function acknowledge(state: LocalState, mutation: Queued, saved: unknown): void {
  let path = mutation.path;
  const favorite = saved as { id?: unknown } | null;
  if (mutation.method === 'PUT' && /^\/favorites\/[A-Za-z0-9_-]{1,100}$/.test(path)
    && typeof favorite?.id === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(favorite.id)) {
    const requestedId = path.split('/').at(-1);
    if (favorite.id !== requestedId && state.cache) state.cache.favorites = state.cache.favorites.filter(item => item.id !== requestedId);
    path = `/favorites/${favorite.id}`;
  }
  state.cache = withPending(state.cache || emptyData(), [{ ...mutation, path, body: saved }]);
}

async function readState(userId: string): Promise<LocalState> {
  const [cache, queue, cacheEpoch] = await getMany<AppData | Queued[] | string>(keys(userId), store);
  return { cache: cache as AppData | undefined, queue: queue as Queued[] | undefined || [], cacheEpoch: cacheEpoch as string | undefined };
}

async function request<T>(path: string, method = 'GET', body?: unknown, ownerId?: string): Promise<T> {
  const response = await fetch(`${import.meta.env?.BASE_URL || '/'}api${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(ownerId ? { 'X-Dose-Owner': ownerId } : {}),
    },
    credentials: 'same-origin',
    cache: 'no-store',
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  let data: T & { error?: string; current?: unknown };
  try { data = await response.json(); }
  catch { throw new ApiError('The local server returned an unreadable response. Please restart it and retry.', response.status || 502); }
  if (!response.ok) throw new ApiError(data.error || 'The request could not be completed.', response.status, data.current);
  return data;
}

/** Pass ownerId explicitly from the calling view for private operations. */
export async function api<T>(path: string, method = 'GET', body?: unknown, ownerId?: string): Promise<T> {
  if (cloudMode) {
    if (!cloudTransport) throw new Error('Unlock your encrypted records first.');
    const generation = accountGeneration;
    const data = await cloudTransport.request<T>(path, method, body, ownerId ?? activeAccount ?? undefined);
    if (path === '/session' && generation === accountGeneration) setActiveAccount((data as { user: User | null }).user?.id ?? null);
    if (path === '/auth/logout') setActiveAccount(null);
    return data;
  }
  const isSession = path === '/session';
  const isAuth = path.startsWith('/auth/');
  const owner = ownerId ?? activeAccount ?? undefined;
  let requestCacheEpoch: string | undefined;
  if (owner && path === '/import' && method === 'POST' && (await readState(owner)).queue.length) {
    throw new ApiError('Sync or resolve pending changes before importing a backup.', 409);
  }
  if (owner && ['PUT', 'DELETE'].includes(method) && mutationPath(path)) {
    const { queue, cacheEpoch } = await readState(owner);
    requestCacheEpoch = cacheEpoch;
    if (queue.some((item) => item.path === path)) {
      throw new ApiError('This record has an unsynced change. Sync and review it before changing it again.', 409);
    }
  }
  const generation = accountGeneration;
  const data = await request<T>(path, method, body, isSession || isAuth ? undefined : owner);
  if (owner && ['PUT', 'DELETE'].includes(method) && mutationPath(path)) {
    try {
      await changeState(owner, (state) => {
        // A different tab may have signed out or deleted the account after
        // this request began. Never recreate the health cache it cleared.
        if (state.cacheEpoch !== requestCacheEpoch) return;
        acknowledge(state, { id: '', path, body, method: method as Queued['method'] }, data);
      });
    } catch {
      // The database has acknowledged the write. Cache failure must not turn
      // that success into a failed save or cause an additional queued retry.
    }
  }
  if (isSession && generation === accountGeneration) setActiveAccount((data as { user: User | null }).user?.id ?? null);
  if (['/auth/login', '/auth/register', '/auth/recover', '/auth/local-setup', '/auth/local-unlock', '/auth/local-recover'].includes(path)) setActiveAccount((data as { user: User }).user.id);
  if (path === '/auth/logout' || (path === '/account' && method === 'DELETE')) setActiveAccount(null);
  return data;
}

/** Return the visible saved-plus-pending view; never overwrite a queued edit. */
export async function cacheData(userId: string, data: AppData): Promise<AppData> {
  if (cloudMode) return structuredClone(data);
  return changeState(userId, (state) => {
    state.cache = structuredClone(data);
    return withPending(state.cache, state.queue);
  });
}

export async function cachedData(userId: string): Promise<AppData | undefined> {
  if (cloudMode) return undefined;
  const { cache, queue } = await readState(userId);
  return cache || queue.length ? withPending(cache || emptyData(), queue) : undefined;
}

export async function queueMutation(userId: string, path: string, body: unknown, method = 'PUT'): Promise<void> {
  if (cloudMode) throw new Error('An internet connection is required to save. Your entry has not been saved; keep this page open and retry.');
  if (!mutationPath(path) || !['PUT', 'DELETE'].includes(method) || (path === '/profile' && method !== 'PUT')) {
    throw new Error('This action cannot be saved to the offline queue. Reconnect and try again.');
  }
  if (activeAccount && activeAccount !== userId) throw new ApiError('The active account changed. Sign in to the account that owns these changes.', 401);
  const mutation: Queued = { id: crypto.randomUUID(), path, body: structuredClone(body), method: method as Queued['method'] };
  await changeState(userId, (state) => {
    if (state.queue.some((item) => item.path === path)) throw new ApiError('This record already has an unsynced change. Reconnect before changing it again.', 409);
    state.queue.push(mutation);
  });
}

export async function queueCount(userId: string): Promise<number> {
  if (cloudMode) return 0;
  return (await readState(userId)).queue.length;
}

export async function pendingChanges(userId: string): Promise<PendingChange[]> {
  if (cloudMode) return [];
  if (activeAccount && activeAccount !== userId) throw new ApiError('The active account changed. Sign in to review these pending changes.', 401);
  return structuredClone((await readState(userId)).queue);
}

/** Call only after the user explicitly chooses to keep the server version. */
export async function discardPendingChange(userId: string, queueId: string): Promise<void> {
  if (cloudMode) return;
  if (activeAccount && activeAccount !== userId) throw new ApiError('The active account changed. Sign in before resolving these pending changes.', 401);
  await changeState(userId, (state) => {
    if (!state.queue.some((item) => item.id === queueId)) return;
    state.queue = state.queue.filter((item) => item.id !== queueId);
    // An older browser cache may already contain that optimistic edit. Fetch a
    // fresh server snapshot before displaying records after this operation.
    state.cache = undefined;
  });
}

export async function syncQueue(userId: string): Promise<void> {
  if (cloudMode) return;
  const existing = syncing.get(userId);
  if (existing) return existing;
  const run = async () => {
    while (true) {
      const next = (await readState(userId)).queue[0];
      if (!next) return;
      const session = await request<{ user: User | null }>('/session');
      if (session.user?.id !== userId) throw new ApiError('Sign in to the account that owns these pending changes before syncing.', 401);
      // The expected-owner header also closes the race if another tab changes
      // its session between the preceding check and this mutation.
      const saved = await request(next.path, next.method, next.body, userId);
      await changeState(userId, (state) => {
        if (!state.queue.some((item) => item.id === next.id)) return;
        acknowledge(state, next, saved);
        // Remove only the acknowledged request. Concurrently queued edits stay.
        state.queue = state.queue.filter((item) => item.id !== next.id);
      });
    }
  };
  const operation = (async () => {
    if (typeof navigator !== 'undefined' && navigator.locks) await navigator.locks.request(`dose-timeline-sync:${userId}`, run);
    else await run();
  })().finally(() => { syncing.delete(userId); });
  syncing.set(userId, operation);
  return operation;
}

/** Only explicit account deletion should discard pending health records. */
export async function clearCache(userId: string, discardPending = false): Promise<void> {
  if (cloudMode) return;
  await changeState(userId, (state) => {
    if (state.queue.length && !discardPending) throw new Error('Pending changes remain on this device. Sync or export them before signing out.');
    state.cache = undefined;
    // Persist the invalidation across tabs; it contains no health data.
    state.cacheEpoch = crypto.randomUUID();
    if (discardPending) state.queue = [];
  });
}
