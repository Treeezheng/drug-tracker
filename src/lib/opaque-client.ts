import type { client } from '@serenity-kit/opaque';

export const OPAQUE_SERVER_ID = 'drug-tracker:opaque:v1';
export const OPAQUE_KSF = { 'argon2id-custom': { memory: 65536, iterations: 3, parallelism: 1 } } as const;
export type OpaqueOperation = 'startRegistration' | 'finishRegistration' | 'startLogin' | 'finishLogin';
type ParametersByOperation = {
  startRegistration: client.StartRegistrationParams;
  finishRegistration: client.FinishRegistrationParams;
  startLogin: client.StartLoginParams;
  finishLogin: client.FinishLoginParams;
};
type ResultsByOperation = {
  startRegistration: client.StartRegistrationResult;
  finishRegistration: client.FinishRegistrationResult;
  startLogin: client.StartLoginResult;
  finishLogin: client.FinishLoginResult | undefined;
};
/** Disposable worker: password/client state/export key never use network or browser storage. */
export async function opaqueClient<T extends OpaqueOperation>(operation: T, params: ParametersByOperation[T], signal?: AbortSignal): Promise<ResultsByOperation[T]> {
  signal?.throwIfAborted();
  if (typeof window === 'undefined') {
    const opaque = await import('@serenity-kit/opaque'); await opaque.ready; signal?.throwIfAborted();
    const result = (opaque.client[operation] as unknown as (params: ParametersByOperation[T]) => ResultsByOperation[T])(params);
    signal?.throwIfAborted(); return result;
  }
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./opaque.worker.ts', import.meta.url), { type: 'module', name: 'drug-opaque' });
    const cleanup = () => { signal?.removeEventListener('abort', abort); worker.terminate(); };
    const abort = () => { cleanup(); reject(new DOMException('Authentication canceled.', 'AbortError')); };
    worker.onerror = () => { cleanup(); reject(new Error('Secure authentication could not run. Use a supported browser and retry.')); };
    worker.onmessage = event => {
      cleanup();
      if (signal?.aborted) reject(new DOMException('Authentication canceled.', 'AbortError'));
      else if (event.data.error) reject(new Error('Secure authentication failed.'));
      else resolve(event.data.result);
    };
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) { abort(); return; }
    try { worker.postMessage({ operation, params }); } catch (error) { cleanup(); reject(error); }
  });
}
export const opaqueIdentifiers = (username: string) => ({ client: username, server: OPAQUE_SERVER_ID });
