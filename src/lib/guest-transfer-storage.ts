import { GUEST_STORAGE_KEY, type GuestStorage } from './guest-workspace';
import { forgetGuestChoice } from './guest-consent';

/** Only delete the exact device snapshot covered by the user's successful sync. */
export function clearTransferredGuest(storage:GuestStorage,expected:string|null):'cleared'|'changed'{
  if(storage.getItem(GUEST_STORAGE_KEY)!==expected)return 'changed';
  // Stop other tabs from saving again before removing this browser's plaintext copy.
  forgetGuestChoice(storage);
  storage.removeItem(GUEST_STORAGE_KEY);
  if(storage.getItem(GUEST_STORAGE_KEY)!==null)throw new Error('The local simulation could not be removed.');
  return 'cleared';
}
