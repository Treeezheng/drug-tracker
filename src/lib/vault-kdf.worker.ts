import { argon2id } from 'hash-wasm';
// One calculation per disposable worker. The caller terminates it after completion or lock.
self.onmessage = async (event: MessageEvent<{ password: Uint8Array; salt: Uint8Array }>) => {
  const { password, salt } = event.data;
  try {
    const result = await argon2id({ password, salt, memorySize: 65536, iterations: 3, parallelism: 1, hashLength: 32, outputType: 'binary' });
    self.postMessage({ result }, { transfer: [result.buffer] });
  } catch { self.postMessage({ error: 'Key derivation failed.' }); }
  finally { password.fill(0); salt.fill(0); }
};
