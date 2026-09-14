import { ApiError } from './api';
import { opaqueClient, opaqueIdentifiers, OPAQUE_KSF, OPAQUE_SERVER_ID } from './opaque-client';
export type OpaqueWire = (path: string, method?: string, body?: unknown, ownerId?: string) => Promise<Record<string, unknown>>;
export type OpaqueAction = 'delete-account' | 'logout-all' | 'change-password' | 'rotate-recovery';
export function secureUsername(value: string): string {
  const username = value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{2,63}$/.test(username)) throw new ApiError('Use a username with 3–64 letters, numbers, dots, underscores or hyphens.', 400);
  return username;
}
export function opaqueField(value: unknown, name: string, length?: number): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value) || value.length > 1000 || (length !== undefined && value.length !== length)) throw new ApiError(`Invalid secure authentication ${name}.`, 502);
  return value;
}
export async function opaqueConfig(wire: OpaqueWire, check: () => void) {
  const config = await wire('/auth/opaque/config'); check();
  if (config.protocol !== 'opaque-v1' || config.serverIdentifier !== OPAQUE_SERVER_ID) throw new ApiError('The server does not support this secure sign-in protocol.', 502);
  return opaqueField(config.serverPublicKey, 'server key', 43);
}
export async function finishOpaqueRegistration(state: string, response: unknown, password: string, username: string, publicKey: string, signal: AbortSignal) {
  const result = await opaqueClient('finishRegistration', { password, clientRegistrationState: state, registrationResponse: opaqueField(response, 'registration response', 86), identifiers: opaqueIdentifiers(username), keyStretching: OPAQUE_KSF }, signal);
  if (result.serverStaticPublicKey !== publicKey) throw new ApiError('The secure authentication server changed during registration.', 502);
  return { registrationRecord: result.registrationRecord, exportKey: result.exportKey };
}
/** No fallback to a raw-password endpoint, including legacy or unknown-user failures. */
export async function opaqueLogin(wire: OpaqueWire, username: string, password: string, signal: AbortSignal, check: () => void, reauth?: { ownerId: string; action: OpaqueAction }) {
  if (typeof password !== 'string' || new TextDecoder().decode(new TextEncoder().encode(password)) !== password || !password.length || [...password].length > 256) throw new ApiError('Enter your password.', 400);
  const publicKey = await opaqueConfig(wire, check);
  const start = await opaqueClient('startLogin', { password }, signal); check();
  const prefix = reauth ? 'reauth' : 'login';
  const response = await wire(`/auth/opaque/${prefix}/start`, 'POST', reauth ? { action: reauth.action, startLoginRequest: start.startLoginRequest } : { username, startLoginRequest: start.startLoginRequest }, reauth?.ownerId); check();
  const finished = await opaqueClient('finishLogin', { password, clientLoginState: start.clientLoginState, loginResponse: opaqueField(response.loginResponse, 'login response', 427), identifiers: opaqueIdentifiers(username), keyStretching: OPAQUE_KSF }, signal); check();
  if (!finished) throw new ApiError('The username or password is incorrect.', 403);
  if (finished.serverStaticPublicKey !== publicKey) throw new ApiError('The secure authentication server changed during sign-in.', 502);
  const result = await wire(`/auth/opaque/${prefix}/finish`, 'POST', { challengeId: opaqueField(response.challengeId, 'challenge'), finishLoginRequest: finished.finishLoginRequest }, reauth?.ownerId); check();
  if (reauth && result.action !== reauth.action) throw new ApiError('The authentication confirmation has the wrong purpose.', 502);
  return { result, exportKey: finished.exportKey };
}
