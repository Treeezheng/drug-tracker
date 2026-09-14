/// <reference lib="webworker" />
import { argon2id } from 'hash-wasm';
import { readKdfWorkerRequest } from './crypto-worker-messages';

// This private dedicated-worker channel has origin="" and source=null. A web
// origin equality check used for Window messages would reject genuine callers.
if (typeof DedicatedWorkerGlobalScope === 'undefined' || !(self instanceof DedicatedWorkerGlobalScope)) throw new Error('A dedicated worker is required.');
const scope = self as unknown as DedicatedWorkerGlobalScope;
let started = false;
scope.onmessage = async (event: MessageEvent<unknown>) => {
  if (!event.isTrusted || event.origin !== '' || event.source !== null || event.ports.length !== 0 || started) return;
  started = true;
  let input: ReturnType<typeof readKdfWorkerRequest> | undefined;
  try {
    input = readKdfWorkerRequest(event.data);
    const result = await argon2id({ ...input, memorySize: 65536, iterations: 3, parallelism: 1, hashLength: 32, outputType: 'binary' });
    scope.postMessage({ result }, { transfer: [result.buffer] });
  } catch { scope.postMessage({ error: 'Key derivation failed.' }); }
  finally { input?.password.fill(0); input?.salt.fill(0); scope.close(); }
};
