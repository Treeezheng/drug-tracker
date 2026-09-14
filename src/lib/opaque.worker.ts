/// <reference lib="webworker" />
import { client, ready } from '@serenity-kit/opaque';
import { readOpaqueWorkerRequest } from './crypto-worker-messages';

// Dedicated workers communicate with their creator via an implicit MessagePort:
// real events have empty origin and null source, unlike Window.postMessage.
// Never install this handler on a Window or a shared/service worker global.
if (typeof DedicatedWorkerGlobalScope === 'undefined' || !(self instanceof DedicatedWorkerGlobalScope)) throw new Error('A dedicated worker is required.');
const scope = self as unknown as DedicatedWorkerGlobalScope;
let started = false;
scope.onmessage = async (event: MessageEvent<unknown>) => {
  if (!event.isTrusted || event.origin !== '' || event.source !== null || event.ports.length !== 0 || started) return;
  started = true;
  try {
    const request = readOpaqueWorkerRequest(event.data);
    await ready;
    const result = client[request.operation](request.params as never);
    scope.postMessage({ result });
  } catch { scope.postMessage({ error: 'Secure authentication failed.' }); }
  finally { scope.close(); }
};
