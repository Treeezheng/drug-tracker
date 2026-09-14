import type { CloudUser } from './cloud-client';

/** Restore only server authentication metadata. Never fetch or unlock a vault. */
export function startCloudSessionRestore({ readSession, onLock, onSession, onUnavailable, events = window }: {
  readSession: () => Promise<CloudUser | null>;
  onLock: () => void;
  onSession: (user: CloudUser | null) => void;
  onUnavailable: () => void;
  events?: EventTarget;
}) {
  let generation = 0, stopped = false;
  const cancel = () => { generation++; };
  async function restore() {
    const token = ++generation;
    try {
      const user = await readSession();
      if (!stopped && token === generation) onSession(user);
    } catch {
      if (!stopped && token === generation) onUnavailable();
    }
  }
  function hide() { cancel(); onLock(); }
  function show(event: Event) {
    if (!(event as PageTransitionEvent).persisted) return;
    // A restored page must recheck the cookie after immediately clearing keys.
    hide(); void restore();
  }
  events.addEventListener('pagehide', hide);
  events.addEventListener('pageshow', show);
  void restore();
  return {
    cancel,
    stop() {
      stopped = true; cancel();
      events.removeEventListener('pagehide', hide);
      events.removeEventListener('pageshow', show);
    },
  };
}
