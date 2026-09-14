import { client, ready } from '@serenity-kit/opaque';
// Same-origin bundled WASM; one call per worker. The caller terminates on lock or completion.
self.onmessage = async (event: MessageEvent<{ operation: keyof typeof client; params: never }>) => {
  try {
    await ready;
    if (!['startRegistration', 'finishRegistration', 'startLogin', 'finishLogin'].includes(event.data.operation)) throw new Error('Unsupported operation.');
    const result = client[event.data.operation](event.data.params);
    self.postMessage({ result });
  } catch { self.postMessage({ error: 'Secure authentication failed.' }); }
};
