import type { AppData, Scenario } from './types';
import { favoriteKey } from './favorites';
import { parseGuestWorkspace } from './guest-workspace';
import type { GuestWorkspace } from './guest-workspace';
import { MODEL_VERSION } from './model';
import { parseBackup } from './reports';
import { cloneVaultData } from './vault-crypto';

/** Keep this detached snapshot unchanged until the encrypted save is acknowledged. */
export interface GuestTransfer { workspace: GuestWorkspace; scenarioId: string; }
const empty = (): AppData => ({ profile: null, doses: [], scenarios: [], favorites: [], checkins: [], inventory: [] });
function checkedData(input: unknown): AppData {
  return parseBackup(JSON.stringify({ format: 'dose-timeline-backup', schemaVersion: 1,
    exportedAt: '2026-09-13T00:00:00Z', data: cloneVaultData(input) }));
}
function readTransfer(input: unknown): GuestTransfer {
  // Reject accessors, cycles and cumulative oversize before JSON serialization.
  const value = cloneVaultData({ ...empty(), checkins: [input] }).checkins[0] as unknown as Record<string, unknown>;
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 2
    || !Object.hasOwn(value, 'workspace') || typeof value.scenarioId !== 'string'
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value.scenarioId)) throw new Error('Invalid guest transfer. Keep the original simulation and try again.');
  const workspace = parseGuestWorkspace(JSON.stringify(value.workspace));
  // Guest editors can retain half-entered values. Do not silently drop or coerce
  // these when moving into the stricter encrypted account snapshot.
  try { checkedData({ ...empty(), profile: workspace.profile, favorites: workspace.favorites,
    scenarios: [{ id: value.scenarioId, name: 'Workspace', doses: workspace.drafts, modelVersion: MODEL_VERSION, baseline: 'empty' }] }); }
  catch { throw new Error('Complete or remove unfinished simulation doses before syncing. Your local copy is unchanged.'); }
  return { workspace, scenarioId: value.scenarioId };
}

/** A fresh attempt gets one namespace; retries must reuse the returned object. */
export function prepareGuestTransfer(workspace: GuestWorkspace): GuestTransfer {
  return readTransfer({ workspace, scenarioId: crypto.randomUUID() });
}

/** Pure merge. No storage, network, promotion to taken, or deletion of account records. */
export function mergeGuestTransfer(account: AppData, input: unknown): AppData {
  const { workspace, scenarioId } = readTransfer(input), candidate = checkedData(account);
  const namespace = `guest_${scenarioId.replaceAll('-', '')}`;
  if (!candidate.profile) candidate.profile = { ...workspace.profile, revision: 1 };

  const favorites = new Set(candidate.favorites.map(favoriteKey));
  for (const [index, favorite] of workspace.favorites.entries()) {
    const identity = favoriteKey(favorite);
    if (favorites.has(identity)) continue;
    const id = `${namespace}_favorite_${index}`;
    if (candidate.favorites.some(row => row.id === id)) throw new Error('A transferred favorite changed. Refresh and review before retrying.');
    candidate.favorites.push({ ...favorite, id, revision: 1 }); favorites.add(identity);
  }

  const existing = candidate.scenarios.find(row => row.name === 'Workspace');
  if (!existing && candidate.scenarios.some(row => row.id === scenarioId)) throw new Error('The simulation destination changed. Keep your local copy and start a new transfer.');
  // A repeated, acknowledged transfer must not recreate a draft already promoted
  // to a formal account record. Existing rows with these IDs are never replaced.
  const doseIds = new Set([...candidate.doses, ...candidate.scenarios.flatMap(row => [...row.doses, ...(row.comparisonDoses ?? [])])].map(row => row.id));
  const additions = workspace.drafts.flatMap((dose, index) => {
    const id = `${namespace}_dose_${index}`;
    return doseIds.has(id) ? [] : [{ ...dose, id, status: 'simulated' as const, revision: 1 }];
  });
  if (additions.length) {
    if (existing) {
      const revision = (existing.revision ?? 0) + 1;
      if (!Number.isSafeInteger(revision)) throw new Error('The simulation revision limit was reached. Your local copy is unchanged.');
      existing.doses.push(...additions); existing.revision = revision;
    } else {
      const scenario: Scenario = { id: scenarioId, name: 'Workspace', doses: additions, modelVersion: MODEL_VERSION, baseline: 'empty', revision: 1,
        view: { date: workspace.date, days: workspace.days, timeZone: workspace.profile.timeZone, publishedOnly: workspace.publishedOnly } };
      candidate.scenarios.push(scenario);
    }
  }
  return checkedData(candidate);
}
