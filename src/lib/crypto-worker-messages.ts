import type { client } from '@serenity-kit/opaque';

type Operation = 'startRegistration' | 'finishRegistration' | 'startLogin' | 'finishLogin';
type OpaqueRequest = { operation: Operation; params: client.StartRegistrationParams | client.FinishRegistrationParams | client.StartLoginParams | client.FinishLoginParams };
function object(input: unknown, fields: string[]): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.getPrototypeOf(input) !== Object.prototype) throw new Error('Invalid worker input.');
  const descriptors = Object.getOwnPropertyDescriptors(input);
  if (Reflect.ownKeys(input).length !== fields.length || fields.some(field => !descriptors[field]?.enumerable || !('value' in descriptors[field]))) throw new Error('Invalid worker fields.');
  return input as Record<string, unknown>;
}
function binary(value: unknown, length: number): void {
  if (typeof value !== 'string' || value.length !== length || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid worker protocol field.');
}
/** The protocol cost and identifiers cannot be replaced by caller-supplied settings. */
export function readOpaqueWorkerRequest(input: unknown): OpaqueRequest {
  const request = object(input, ['operation', 'params']), operation = request.operation;
  if (typeof operation !== 'string' || !['startRegistration', 'finishRegistration', 'startLogin', 'finishLogin'].includes(operation)) throw new Error('Unsupported worker operation.');
  const finish = operation === 'finishRegistration' || operation === 'finishLogin';
  const state = operation === 'finishRegistration' ? 'clientRegistrationState' : 'clientLoginState';
  const response = operation === 'finishRegistration' ? 'registrationResponse' : 'loginResponse';
  const params = object(request.params, ['password', ...(finish ? [state, response, 'identifiers', 'keyStretching'] : [])]);
  if (typeof params.password !== 'string' || !params.password.length || params.password.length > 512 || [...params.password].length > 256) throw new Error('Invalid worker password length.');
  if (finish) {
    binary(params[state], operation === 'finishRegistration' ? 86 : 256);
    binary(params[response], operation === 'finishRegistration' ? 86 : 427);
    const identifiers = object(params.identifiers, ['client', 'server']);
    if (typeof identifiers.client !== 'string' || !/^[a-z0-9][a-z0-9._-]{2,63}$/.test(identifiers.client) || identifiers.server !== 'drug-tracker:opaque:v1') throw new Error('Invalid worker protocol identifiers.');
    const settings = object(params.keyStretching, ['argon2id-custom']);
    const cost = object(settings['argon2id-custom'], ['memory', 'iterations', 'parallelism']);
    if (cost.memory !== 65536 || cost.iterations !== 3 || cost.parallelism !== 1) throw new Error('Invalid worker protocol cost.');
  }
  return request as unknown as OpaqueRequest;
}

export function readKdfWorkerRequest(input: unknown): { password: Uint8Array<ArrayBuffer>; salt: Uint8Array<ArrayBuffer> } {
  const value = object(input, ['password', 'salt']);
  // Historical wrapping passwords can be up to 1,024 UTF-16 units. Keep their
  // UTF-8 representation supported, but never accept shared mutable buffers.
  if (!(value.password instanceof Uint8Array) || !(value.password.buffer instanceof ArrayBuffer) || !value.password.byteLength || value.password.byteLength > 4096
    || !(value.salt instanceof Uint8Array) || !(value.salt.buffer instanceof ArrayBuffer) || value.salt.byteLength !== 16) throw new Error('Invalid key derivation input.');
  return value as { password: Uint8Array<ArrayBuffer>; salt: Uint8Array<ArrayBuffer> };
}
