import type { Dose, InventoryReceipt } from './types';

const SCALE = 1_000_000_000n;

function decimal(value: string): bigint {
  if (typeof value !== 'string' || !/^\d+(\.\d{1,9})?$/.test(value)) throw new Error('Invalid stock quantity or package strength.');
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * SCALE + BigInt(fraction.padEnd(9, '0'));
}

function text(value: bigint): string {
  const negative = value < 0n;
  if (negative) value = -value;
  const fraction = (value % SCALE).toString().padStart(9, '0').replace(/0+$/, '');
  return `${negative ? '-' : ''}${value / SCALE}${fraction ? `.${fraction}` : ''}`;
}

/** Canonicalize grouping only; the receipt snapshot remains unchanged. */
export function stockKey(value: { productId: string; packageStrength?: string; strength?: string; unit: string; strengthUnit?: string }): string {
  const strength = value.packageStrength || value.strength;
  if (!strength) throw new Error('Stock records need a package strength.');
  const components = strength.split('/').map(component => text(decimal(component)));
  return JSON.stringify([value.productId, components, value.strengthUnit || 'mg', value.unit]);
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, canonical(child)]));
  }
  return value;
}

/** Resolve corrections before filtering by date or status, including corrections to skipped. */
function latestRecords<T extends { id: string; revision?: number }>(records: T[]): T[] {
  const latest = new Map<string, T>();
  for (const record of records) {
    const revision = record.revision ?? 0;
    if (!Number.isSafeInteger(revision) || revision < 0) throw new Error(`Invalid stock record revision: ${record.id}.`);
    const previous = latest.get(record.id);
    if (!previous || revision > (previous.revision ?? 0)) latest.set(record.id, record);
  }
  const snapshots = new Map([...latest].map(([id, record]) => [id, JSON.stringify(canonical(record))]));
  for (const record of records) {
    if ((record.revision ?? 0) === (latest.get(record.id)!.revision ?? 0)
      && JSON.stringify(canonical(record)) !== snapshots.get(record.id)) {
      throw new Error(`Conflicting copies of stock record ${record.id}. Resolve the conflict before calculating stock.`);
    }
  }
  return [...latest.values()];
}

export function stockBalances(receipts: InventoryReceipt[], doses: Dose[], at = Date.now()) {
  const groups = new Map<string, {
    key: string; productId: string; productName: string; packageStrength: string; strengthUnit: string;
    unit: string; first: number; received: bigint; used: bigint;
  }>();
  for (const receipt of latestRecords(receipts)) {
    const date = Date.parse(receipt.receivedAt);
    if (!Number.isFinite(date) || date > at) continue;
    const key = stockKey(receipt);
    const group = groups.get(key) || {
      key, productId: receipt.productId, productName: receipt.productName,
      packageStrength: receipt.packageStrength, strengthUnit: receipt.strengthUnit,
      unit: receipt.unit, first: date, received: 0n, used: 0n,
    };
    group.first = Math.min(group.first, date);
    group.received += decimal(receipt.quantity);
    groups.set(key, group);
  }
  for (const dose of latestRecords(doses)) {
    if (dose.status !== 'actual') continue;
    const group = groups.get(stockKey(dose));
    const date = Date.parse(dose.administeredAt);
    if (group && date >= group.first && date <= at) group.used += decimal(dose.quantity);
  }
  return [...groups.values()].map(group => ({
    ...group, received: text(group.received), used: text(group.used), remaining: text(group.received - group.used),
  }));
}
