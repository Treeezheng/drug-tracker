import { readGuestWorkspace, saveGuestWorkspace, type GuestStorage, type GuestWorkspace } from './guest-workspace';

export const GUEST_CONSENT_KEY = 'drug-tracker:guest-storage-consent:v1';
const acknowledgement = 'adult:plaintext-device-storage:v1';

/** Old saved health data is never opened or overwritten before this choice. */
export function readGuestConsent(storage: GuestStorage) {
  return storage.getItem(GUEST_CONSENT_KEY) === acknowledgement;
}

export function rememberGuestChoice(storage: GuestStorage) {
  // Check existing content before opting into future writes; malformed data is retained.
  const workspace = readGuestWorkspace(storage);
  storage.setItem(GUEST_CONSENT_KEY, acknowledgement);
  return workspace;
}

export function forgetGuestChoice(storage: GuestStorage) {
  storage.removeItem(GUEST_CONSENT_KEY);
}

/** Recheck each write: another tab may have withdrawn device-storage consent. */
export function saveRememberedGuestWorkspace(storage: GuestStorage, workspace: GuestWorkspace) {
  if (!readGuestConsent(storage)) return false;
  saveGuestWorkspace(storage, workspace);
  return true;
}
