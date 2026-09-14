import type { AppData, Assumptions, Checkin, Dose, Profile } from './types';
import { addDays, dayWindow, formatInstant, instantToLocal } from './time';
import { SYMPTOM_IDS, symptomSelectionError } from './symptoms';
import { normalizeFavoritesData } from './favorites';

const SCALE = 1_000_000_000n;
const MISSING_DATA = 'No record does not prove no dose. These totals describe recorded administrations, not adherence.';
const SYMPTOM_DISCLOSURE = 'Self-reported observations. Timing alone does not establish a medication cause. No record does not prove no symptoms.';

export interface DoseSummary {
  key: string; product: string; strength: string; unit: string; count: number;
  quantity: string; amountMg: string; ingredients: { name: string; amountMg: string }[]; days: number;
  strengthUnit: string; manufacturer: string; amountBasis: Dose['amountBasis'];
}

function scaled(value: string, field: string, allowZero = false): bigint {
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d{0,11})(?:\.\d{1,9})?$/.test(value)) {
    throw new Error(`${field} must be a decimal string with up to nine decimal places.`);
  }
  const [whole, fraction = ''] = value.split('.');
  const result = BigInt(whole) * SCALE + BigInt(fraction.padEnd(9, '0'));
  if (result < 0n || (!allowZero && result === 0n)) throw new Error(`${field} must be positive.`);
  return result;
}

function decimal(value: bigint): string {
  const fraction = (value % SCALE).toString().padStart(9, '0').replace(/0+$/, '');
  return `${value / SCALE}${fraction ? `.${fraction}` : ''}`;
}

function actualRecords(doses: Dose[]): Dose[] {
  const unique = new Map<string, Dose>();
  for (const dose of doses) {
    const previous = unique.get(dose.id);
    if (!previous || (dose.revision ?? 0) > (previous.revision ?? 0)) unique.set(dose.id, dose);
    else if ((dose.revision ?? 0) === (previous.revision ?? 0) && JSON.stringify(dose) !== JSON.stringify(previous)) {
      throw new Error(`Conflicting copies of record ${dose.id}. Resolve the conflict before exporting.`);
    }
  }
  return [...unique.values()].filter(dose => dose.status === 'actual');
}

export function filterDoses(doses: Dose[], from: string, to: string, timeZone: string, productId?: string): Dose[] {
  addDays(from, 0);
  addDays(to, 0);
  if (from > to) throw new Error('The report start date must be on or before the end date.');
  const start = dayWindow(from, 1, timeZone).start;
  const end = dayWindow(to, 1, timeZone).end;
  return actualRecords(doses).filter(dose => {
    const instant = Date.parse(dose.administeredAt);
    if (!Number.isFinite(instant)) throw new Error(`Record ${dose.id} has an invalid administration time.`);
    return instant >= start && instant < end && (!productId || dose.productId === productId);
  }).sort((a, b) => Date.parse(a.administeredAt) - Date.parse(b.administeredAt) || a.id.localeCompare(b.id));
}

/** Without an explicit report zone, distinct days use each event's original zone. */
export function summarize(doses: Dose[], timeZone?: string): DoseSummary[] {
  const groups = new Map<string, {
    result: DoseSummary; quantity: bigint; amount: bigint; ingredients: Map<string, bigint>; dates: Set<string>;
  }>();
  for (const dose of actualRecords(doses)) {
    const strength = dose.packageStrength ?? decimal(scaled(dose.strength, 'Strength'));
    const strengthUnit = dose.strengthUnit ?? 'unit not recorded';
    const manufacturer = dose.manufacturer ?? '';
    const ingredientNames = (dose.ingredients ?? []).map(item => item.name).sort();
    const key = JSON.stringify([dose.productId, dose.productName, dose.formulation, strength, strengthUnit, manufacturer, dose.unit, dose.amountBasis, ingredientNames]);
    let group = groups.get(key);
    if (!group) {
      group = {
        result: { key, product: `${dose.productName} - ${dose.formulation}`, strength, strengthUnit, manufacturer, amountBasis: dose.amountBasis, unit: dose.unit, count: 0, quantity: '0', amountMg: '0', ingredients: [], days: 0 },
        quantity: 0n, amount: 0n, ingredients: new Map(), dates: new Set(),
      };
      groups.set(key, group);
    }
    group.result.count++;
    group.quantity += scaled(dose.quantity, 'Quantity');
    group.amount += scaled(dose.amountMg, 'Labeled amount');
    group.dates.add(instantToLocal(dose.administeredAt, timeZone ?? dose.timeZone).date);
    for (const ingredient of dose.ingredients ?? []) {
      group.ingredients.set(ingredient.name, (group.ingredients.get(ingredient.name) ?? 0n) + scaled(ingredient.amountMg, 'Ingredient amount'));
    }
  }
  return [...groups.values()].map(group => ({
    ...group.result, quantity: decimal(group.quantity), amountMg: decimal(group.amount), days: group.dates.size,
    ingredients: [...group.ingredients].sort(([a], [b]) => a.localeCompare(b)).map(([name, amount]) => ({ name, amountMg: decimal(amount) })),
  })).sort((a, b) => a.product.localeCompare(b.product) || a.strength.localeCompare(b.strength, 'en', { numeric: true }));
}

/** Quote every cell and neutralize spreadsheet formula prefixes in user text. */
function csvCell(value: string | number): string {
  let text = String(value);
  if (/^[\s\u0000-\u001f]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function filterCheckins(checkins: Checkin[], from: string, to: string, timeZone: string): Checkin[] {
  addDays(from, 0);
  addDays(to, 0);
  if (from > to) throw new Error('The report start date must be on or before the end date.');
  const start = dayWindow(from, 1, timeZone).start;
  const end = dayWindow(to, 1, timeZone).end;
  const latest = new Map<string, Checkin>();
  for (const checkin of checkins) {
    const previous = latest.get(checkin.id);
    if (!previous || (checkin.revision ?? 0) > (previous.revision ?? 0)) latest.set(checkin.id, checkin);
    else if ((checkin.revision ?? 0) === (previous.revision ?? 0) && JSON.stringify(checkin) !== JSON.stringify(previous)) throw new Error(`Conflicting copies of check-in ${checkin.id}. Resolve the conflict before exporting.`);
  }
  return [...latest.values()].filter(checkin => {
    validateCheckin(checkin as unknown as RecordObject);
    if (checkin.recordedAt) return Date.parse(checkin.recordedAt) >= start && Date.parse(checkin.recordedAt) < end;
    // Date-only legacy observations have no known instant or original zone.
    return checkin.date >= from && checkin.date <= to;
  }).sort((a, b) => (a.recordedAt ? Date.parse(a.recordedAt) : dayWindow(a.date, 1, timeZone).start)
    - (b.recordedAt ? Date.parse(b.recordedAt) : dayWindow(b.date, 1, timeZone).start) || a.id.localeCompare(b.id));
}

export function csvString(doses: Dose[], profile: Profile, from: string, to: string, checkins: Checkin[] = []): string {
  const header: (string | number)[] = [
    'Record ID', 'Status', 'Date in report time zone', 'Time in report time zone', 'Report time zone',
    'Administration UTC', 'Original time zone', 'Product', 'Formulation', 'Package strength as recorded', 'Package strength unit', 'Manufacturer as recorded',
    'Quantity', 'Quantity unit', 'Labeled ingredient amount mg', 'Ingredient amounts mg', 'Amount basis', 'Nominal patch delivery mg per labeled 9-hour period', 'Patch removal UTC',
    'Unusual administration', 'Notes', 'Model version', 'Revision', 'Report from', 'Report to', 'Missing-data disclosure',
    'event_type', 'symptoms', 'checkin_time_utc', 'checkin_original_timezone', 'checkin_original_date', 'legacy_focus', 'legacy_sleep_quality',
  ];
  const events: { time: number; id: string; row: (string | number)[] }[] = [];
  for (const dose of filterDoses(doses, from, to, profile.timeZone)) {
    const local = instantToLocal(dose.administeredAt, profile.timeZone);
    // For combination products, the separate ingredient amounts are the report.
    // Do not present an addition of chemically different ingredients as one mg total.
    const isCombination = (dose.ingredients?.length ?? 0) > 1 || dose.amountBasis === 'first listed ingredient';
    const isPatchDelivery = dose.amountBasis === 'labeled delivery over 9 hours';
    events.push({ time: Date.parse(dose.administeredAt), id: dose.id, row: [
      dose.id, dose.status, local.date, local.time, profile.timeZone, dose.administeredAt, dose.timeZone,
      dose.productName, dose.formulation, dose.packageStrength ?? dose.strength, dose.strengthUnit ?? 'unit not recorded', dose.manufacturer ?? '',
      dose.quantity, dose.unit, isCombination || isPatchDelivery ? '' : dose.amountMg,
      (dose.ingredients ?? []).map(item => `${item.name}: ${item.amountMg}${isPatchDelivery ? ' (nominal delivery over 9 hours)' : ''}`).join('; '),
      dose.amountBasis ?? 'labeled ingredient', isPatchDelivery ? dose.amountMg : '', dose.removalAt ?? '',
      dose.unusual ? 'Yes - standard model may not apply' : 'No', dose.note, dose.modelVersion ?? '', dose.revision ?? '',
      from, to, MISSING_DATA,
      'dose', '', '', '', '', '', '',
    ] });
  }
  for (const checkin of filterCheckins(checkins, from, to, profile.timeZone)) {
    const local = checkin.recordedAt ? instantToLocal(checkin.recordedAt, profile.timeZone) : { date: checkin.date, time: '' };
    events.push({ time: checkin.recordedAt ? Date.parse(checkin.recordedAt) : dayWindow(checkin.date, 1, profile.timeZone).start, id: checkin.id, row: [
      checkin.id, 'self-reported', local.date, local.time, profile.timeZone,
      '', checkin.timeZone ?? '', '', '', '', '', '',
      '', '', '', '', '', '', '',
      '', checkin.note ?? '', '', checkin.revision ?? '', from, to,
      `${SYMPTOM_DISCLOSURE}${checkin.recordedAt ? '' : ' Legacy calendar date only; the observation time was not recorded.'}`,
      checkin.symptoms ? 'symptom' : 'legacy_checkin', (checkin.symptoms ?? []).join('; '), checkin.recordedAt ?? '', checkin.timeZone ?? '', checkin.date ?? '', checkin.focus ?? '', checkin.sleepQuality ?? '',
    ] });
  }
  const rows = [header, ...events.sort((a, b) => a.time - b.time || a.id.localeCompare(b.id)).map(event => event.row)];
  return `${rows.map(row => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export function downloadCsv(doses: Dose[], profile: Profile, from: string, to: string, checkins: Checkin[] = []): void {
  download(new Blob(['\uFEFF', csvString(doses, profile, from, to, checkins)], { type: 'text/csv;charset=utf-8' }), `dose-timeline-${from}-to-${to}.csv`);
}

/** Exported separately to verify pagination without starting a browser download. */
export async function buildReportPdf(doses: Dose[], profile: Profile, from: string, to: string, unsynced: number) {
  if (!Number.isSafeInteger(unsynced) || unsynced < 0) throw new Error('Invalid pending-change count. Refresh the records before exporting.');
  const selected = filterDoses(doses, from, to, profile.timeZone);
  const summary = summarize(selected, profile.timeZone);
  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF({ unit: 'mm', format: 'letter', compress: true, putOnlyUsedFonts: true });
  pdf.setProperties({ title: 'Dose Timeline - medication record', subject: `Actual administration records ${from} to ${to}`, creator: 'Dose Timeline' });
  const margin = 17;
  const width = pdf.internal.pageSize.getWidth() - margin * 2;
  const bottom = pdf.internal.pageSize.getHeight() - 20;
  let y = 20;

  const ascii = (value: string) => /^[\x20-\x7e\n\r\t]*$/.test(value);
  const canvasFor = (value: string, size: number, bold: boolean) => {
    if (typeof document === 'undefined') throw new Error('Non-Latin report text must be rendered in a browser.');
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) throw new Error('This browser could not render report text.');
    const px = size * 96 / 72 * 3;
    const font = `${bold ? '600' : '400'} ${px}px sans-serif`;
    context.font = font;
    const measured = context.measureText(value);
    canvas.width = Math.max(1, Math.ceil(measured.width + 6));
    canvas.height = Math.ceil(px * 1.5);
    context.font = font;
    context.fillStyle = '#263b37';
    context.textBaseline = 'alphabetic';
    context.fillText(value, 2, px * 1.1);
    return { canvas, width: canvas.width / 3 * 25.4 / 96, height: canvas.height / 3 * 25.4 / 96, baseline: px * 1.1 / 3 * 25.4 / 96 };
  };
  const draw = (value: string, x: number, top: number, size: number, bold = false) => {
    pdf.setFont('helvetica', bold ? 'bold' : 'normal');
    pdf.setFontSize(size);
    if (ascii(value)) pdf.text(value, x, top);
    else {
      // Preserve user-entered names/notes beyond PDF's built-in Latin glyph set.
      const rendered = canvasFor(value, size, bold);
      pdf.addImage(rendered.canvas, 'PNG', x, top - rendered.baseline, rendered.width, rendered.height);
    }
  };
  const wrap = (value: string, size: number, bold: boolean): string[] => {
    pdf.setFont('helvetica', bold ? 'bold' : 'normal');
    pdf.setFontSize(size);
    if (ascii(value)) return pdf.splitTextToSize(value, width) as string[];
    const lines: string[] = [];
    for (const paragraph of value.replace(/\r\n?/g, '\n').split('\n')) {
      let line = '';
      for (const character of paragraph) {
        const candidate = line + character;
        if (line && canvasFor(candidate, size, bold).width > width) { lines.push(line); line = character; }
        else line = candidate;
      }
      lines.push(line);
    }
    return lines;
  };
  const newPage = () => {
    pdf.addPage();
    pdf.setTextColor(81, 101, 96);
    draw('Dose Timeline / medication record', margin, 15, 9, true);
    draw(`${from} to ${to} | ${profile.timeZone}`, margin, 21, 8);
    y = 31;
  };
  const ensure = (height: number) => { if (y + height > bottom) newPage(); };
  const paragraph = (text: string, size = 10, bold = false, after = 2) => {
    const lineHeight = size * 0.48;
    pdf.setTextColor(38, 59, 55);
    for (const line of wrap(text, size, bold)) { ensure(lineHeight); draw(line, margin, y, size, bold); y += lineHeight; }
    y += after;
  };
  const section = (title: string) => {
    ensure(23);
    y += 5;
    pdf.setDrawColor(209, 219, 213);
    pdf.line(margin, y - 3, margin + width, y - 3);
    paragraph(title, 12, true, 3);
  };

  paragraph('Dose Timeline', 22, true, 2);
  paragraph('Medication record for clinician review', 12, false, 5);
  if (profile.name) paragraph(`Prepared for: ${profile.name}`, 11, true);
  paragraph(`Report dates: ${from} through ${to} (inclusive)`);
  paragraph(`Report time zone: ${profile.timeZone}`);
  paragraph(`Generated: ${formatInstant(Date.now(), profile)}`, 9);
  paragraph(unsynced > 0
    ? `Sync status: ${unsynced} change${unsynced === 1 ? '' : 's'} pending. This report uses the records currently available on this device; recent offline changes may be missing.`
    : 'Sync status: no pending changes reported. Records are stored by the local service on this Mac.', 9);
  paragraph(MISSING_DATA, 9);
  paragraph('Actual administrations only. Planned, skipped and simulated entries are excluded from consumption totals. This report does not recommend a dose or establish treatment safety.', 9);

  section('Totals by exact product and strength');
  if (!summary.length) paragraph('No actual administration records were found in this date range.');
  for (const item of summary) {
    ensure(27);
    paragraph(item.product, 10, true, 1);
    paragraph(`Package strength: ${item.strength} ${item.strengthUnit}. ${item.count} administration${item.count === 1 ? '' : 's'} across ${item.days} recorded day${item.days === 1 ? '' : 's'}.`, 9, false, 1);
    if (item.manufacturer) paragraph(`Manufacturer as recorded: ${item.manufacturer}.`, 9, false, 1);
    paragraph(`Quantity recorded: ${item.quantity} ${item.unit}.`, 9, false, 1);
    if (item.amountBasis === 'labeled delivery over 9 hours') {
      paragraph(`Nominal labeled delivery across applied patches: ${item.amountMg} mg over the labeled 9-hour wear periods. Actual absorbed or consumed mass is not measured; early removal may change delivery.`, 9, false, 1);
    } else if (item.ingredients.length) {
      for (const ingredient of item.ingredients) paragraph(`Labeled ${ingredient.name}: ${ingredient.amountMg} mg.`, 9, false, 1);
    } else paragraph(`${item.amountBasis === 'first listed ingredient' ? 'First listed ingredient only (other ingredient amounts not recorded)' : 'Total labeled amount for this product'}: ${item.amountMg} mg.`, 9, false, 1);
    y += 3;
  }
  if (summary.length) paragraph('Products and ingredients are listed separately. Amounts do not imply equivalence between formulations or medicines.', 9);

  section('Chronological administration details');
  if (!selected.length) paragraph('No recorded actual administrations to list.');
  selected.forEach((dose, index) => {
    ensure(26);
    paragraph(`${index + 1}. ${formatInstant(Date.parse(dose.administeredAt), profile)}`, 10, true, 1);
    paragraph(`${dose.productName} - ${dose.formulation}`, 10, true, 1);
    paragraph(`Package strength: ${dose.packageStrength ?? dose.strength} ${dose.strengthUnit ?? '(unit not recorded)'}; quantity: ${dose.quantity} ${dose.unit}.`, 9, false, 1);
    if (dose.manufacturer) paragraph(`Manufacturer as recorded: ${dose.manufacturer}.`, 9, false, 1);
    if (dose.amountBasis === 'labeled delivery over 9 hours') {
      paragraph(`Nominal labeled delivery: ${dose.amountMg} mg over 9 hours. This is not measured absorbed or consumed mass.`, 9, false, 1);
    } else if (dose.ingredients?.length) {
      for (const ingredient of dose.ingredients) paragraph(`Labeled ${ingredient.name}: ${ingredient.amountMg} mg.`, 9, false, 1);
    } else paragraph(`${dose.amountBasis === 'first listed ingredient' ? 'First listed ingredient only (other ingredient amounts not recorded)' : 'Labeled ingredient amount'}: ${dose.amountMg} mg.`, 9, false, 1);
    paragraph(`UTC: ${dose.administeredAt} | Original time zone: ${dose.timeZone}`, 8, false, 1);
    if (dose.removalAt) paragraph(`Patch removed: ${formatInstant(Date.parse(dose.removalAt), profile)}`, 9, false, 1);
    if (dose.unusual) paragraph('Unusual administration recorded; the standard model may not apply.', 9, false, 1);
    if (dose.note) paragraph(`Note: ${dose.note}`, 9, false, 1);
    paragraph(`Record ID: ${dose.id}${dose.revision === undefined ? '' : ` | Revision: ${dose.revision}`}`, 8, false, 3);
  });
  const pages = pdf.getNumberOfPages();
  for (let page = 1; page <= pages; page++) {
    pdf.setPage(page);
    pdf.setTextColor(99, 115, 109);
    draw('Private medication record. Review with your clinician.', margin, bottom + 10, 8);
    pdf.setFontSize(8);
    pdf.text(`${page} / ${pages}`, margin + width, bottom + 10, { align: 'right' });
  }
  return pdf;
}

export async function downloadPdf(doses: Dose[], profile: Profile, from: string, to: string, unsynced: number): Promise<void> {
  const pdf = await buildReportPdf(doses, profile, from, to, unsynced);
  await pdf.save(`dose-timeline-${from}-to-${to}.pdf`, { returnPromise: true });
}

export function downloadJson(data: AppData): void {
  const exportedAt = new Date().toISOString();
  const backup = {
    format: 'dose-timeline-backup', schemaVersion: 1, exportedAt, scope: 'current-data', data,
    disclosure: 'Contains current records, profile, favorites, check-ins and saved scenarios. Passwords and sessions are not included. Server correction history and deletion tombstones require the full server backup.',
  };
  download(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }), `dose-timeline-backup-${exportedAt.slice(0, 10)}.json`);
}

type RecordObject = Record<string, unknown>;
function object(value: unknown, field: string): RecordObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${field} must be an object.`);
  return value as RecordObject;
}
function text(value: unknown, field: string, max = 240, empty = false): string {
  if (typeof value !== 'string' || value.length > max || (!empty && !value.trim())) throw new Error(`Invalid ${field}.`);
  return value;
}
function identifier(value: unknown, field = 'record ID'): string {
  const id = text(value, field, 100);
  if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error(`Invalid ${field}.`);
  return id;
}
function boolean(value: unknown, field: string): void {
  if (typeof value !== 'boolean') throw new Error(`${field} must be true or false.`);
}
function clock(value: unknown, field: string, optional = false): void {
  if (optional && value === '') return;
  if (typeof value !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) throw new Error(`Invalid ${field}.`);
}
function zone(value: unknown): string {
  const result = text(value, 'time zone', 80);
  instantToLocal('2000-01-01T00:00:00Z', result);
  return result;
}
function instant(value: unknown, field: string): string {
  const result = text(value, field, 30);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(result)) throw new Error(`${field} must be an ISO UTC instant.`);
  const parsed = new Date(result);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 19) !== result.slice(0, 19)) throw new Error(`Invalid ${field}.`);
  return result;
}
function revision(record: RecordObject): void {
  if (record.revision !== undefined && (!Number.isSafeInteger(record.revision) || Number(record.revision) < 0)) throw new Error('Invalid record revision.');
  for (const field of ['createdAt', 'updatedAt']) if (record[field] !== undefined) instant(record[field], field);
  if (record.deleted !== undefined && record.deleted !== false) throw new Error('Deleted records cannot be imported as active records.');
}
function array(value: unknown, field: string, max = 50_000): unknown[] {
  if (!Array.isArray(value) || value.length > max) throw new Error(`${field} must be a list of at most ${max} items.`);
  return value;
}
function uniqueRecords(value: unknown, field: string, validate: (record: RecordObject) => void, max?: number): void {
  const ids = new Set<string>();
  for (const item of array(value, field, max)) {
    const record = object(item, field);
    const id = identifier(record.id);
    if (ids.has(id)) throw new Error(`Duplicate record ID in ${field}: ${id}.`);
    ids.add(id);
    revision(record);
    validate(record);
  }
}
function validateAssumptions(value: unknown): void {
  const assumed = object(value, 'Assumptions');
  for (const field of ['peakHours', 'halfLifeHours', 'lagHours', 'referenceDose', 'amplitude', 'onsetHours', 'durationMinHours', 'durationMaxHours'] as (keyof Assumptions)[]) {
    const value = assumed[field];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100_000) throw new Error(`Invalid assumption ${field}.`);
  }
  if (Number(assumed.peakHours) <= 0 || Number(assumed.halfLifeHours) <= 0 || Number(assumed.referenceDose) <= 0
    || Number(assumed.durationMinHours) > Number(assumed.durationMaxHours)) throw new Error('Invalid assumption duration or scale.');
  if (!['from_onset', 'from_administration'].includes(String(assumed.durationOrigin))) throw new Error('Invalid effect duration origin.');
  boolean(assumed.accepted, 'Assumptions accepted');
}
function validateDose(dose: RecordObject, scenario = false): void {
  identifier(dose.productId, 'product ID');
  for (const field of ['productName', 'formulation', 'unit']) text(dose[field], field);
  for (const field of ['strength', 'quantity', 'amountMg']) {
    if (!(scenario && dose[field] === '')) scaled(text(dose[field], field, 30), field);
  }
  if (dose.packageStrength !== undefined && !(scenario && dose.packageStrength === '')) packageStrength(dose.packageStrength, dose.strength);
  if (dose.strengthUnit !== undefined) text(dose.strengthUnit, 'package strength unit', 40);
  if (dose.manufacturer !== undefined) text(dose.manufacturer, 'manufacturer', 240, true);
  if (dose.amountBasis !== undefined && !['labeled ingredient', 'first listed ingredient', 'labeled delivery over 9 hours'].includes(String(dose.amountBasis))) throw new Error('Invalid labeled amount basis.');
  zone(dose.timeZone);
  if (!['actual', 'planned', 'skipped', ...(scenario ? ['simulated'] : [])].includes(String(dose.status))) throw new Error('Invalid administration status.');
  if (!(scenario && dose.administeredAt === '')) instant(dose.administeredAt, 'Administration time');
  text(dose.note, 'note', 8000, true);
  if (dose.date !== undefined && dose.date !== '') addDays(text(dose.date, 'dose date', 10), 0);
  if (dose.time !== undefined) clock(dose.time, 'dose time', scenario);
  if (dose.disambiguation !== undefined && !['earlier', 'later'].includes(String(dose.disambiguation))) throw new Error('Invalid clock occurrence.');
  if (dose.modelVersion !== undefined) text(dose.modelVersion, 'model version', 100);
  if (dose.unusual !== undefined) boolean(dose.unusual, 'Unusual administration');
  if (dose.assumptions !== undefined) validateAssumptions(dose.assumptions);
  if (dose.removalAt !== undefined && dose.removalAt !== '') {
    const removal = instant(dose.removalAt, 'Patch removal time');
    if (!dose.administeredAt || Date.parse(removal) <= Date.parse(String(dose.administeredAt))) throw new Error('Patch removal must be after application.');
  }
  if (dose.ingredients !== undefined) {
    const names = new Set<string>();
    for (const item of array(dose.ingredients, 'Ingredients', 10)) {
      const ingredient = object(item, 'Ingredient');
      const name = text(ingredient.name, 'ingredient name');
      if (names.has(name)) throw new Error('An ingredient is listed twice in one administration.');
      names.add(name);
      scaled(text(ingredient.amountMg, 'ingredient amount', 30), 'Ingredient amount');
      if (ingredient.strengthMg !== undefined) scaled(text(ingredient.strengthMg, 'ingredient strength', 30), 'Ingredient strength');
      if (ingredient.unit !== undefined) text(ingredient.unit, 'ingredient unit', 40);
    }
  }
}

function packageStrength(value: unknown, first: unknown): void {
  const components = text(value, 'package strength', 100).split('/');
  if (components.length > 10) throw new Error('Too many package strength components.');
  components.forEach(item => scaled(item, 'Package strength component'));
  if (scaled(components[0], 'First package strength component') !== scaled(text(first, 'strength', 30), 'Strength')) {
    throw new Error('Package strength does not match its first recorded component.');
  }
}

function validateCheckin(checkin: RecordObject): void {
  if (checkin.date !== undefined) addDays(text(checkin.date, 'check-in date', 10), 0);
  if (checkin.recordedAt !== undefined) instant(checkin.recordedAt, 'Check-in time');
  if (checkin.timeZone !== undefined) zone(checkin.timeZone);
  if (checkin.date === undefined && (!checkin.recordedAt || !checkin.timeZone)) throw new Error('A check-in needs a date or a recorded time with its original time zone.');
  for (const field of ['focus', 'sleepQuality']) if (checkin[field] !== undefined) text(checkin[field], field, 80, true);
  if (checkin.note !== undefined) text(checkin.note, 'check-in note', 8000, true);
  if (checkin.symptoms !== undefined) {
    const symptoms = array(checkin.symptoms, 'Symptom tags', SYMPTOM_IDS.length);
    if (symptoms.some(value => typeof value !== 'string')) throw new Error('Choose valid symptom tags.');
    const issue = symptomSelectionError(symptoms as string[]);
    if (issue) throw new Error(issue);
    const recordedAt = instant(checkin.recordedAt, 'Check-in time');
    const timeZone = zone(checkin.timeZone);
    const date = text(checkin.date, 'check-in date', 10);
    addDays(date, 0);
    if (instantToLocal(recordedAt, timeZone).date !== date) throw new Error('The check-in date must match its recorded time and original time zone.');
  }
}

/** Validate a versioned backup for preview. This function never writes data. */
export function parseBackup(source: string): AppData {
  if (source.length > 16_000_000 || new TextEncoder().encode(source).length > 16_000_000) throw new Error('This backup is too large (maximum 16 MB of text).');
  let parsed: unknown;
  try { parsed = JSON.parse(source); } catch { throw new Error('This file is not valid JSON.'); }
  let visited = 0;
  const shape = (value: unknown, depth = 0): void => {
    if (++visited > 500_000 || depth > 16) throw new Error('This backup contains too much nested data.');
    if (value === null || typeof value === 'boolean') return;
    if (typeof value === 'string') { if (value.length > 16_000) throw new Error('A text field in this backup is too long.'); return; }
    if (typeof value === 'number') { if (!Number.isFinite(value)) throw new Error('This backup contains an invalid number.'); return; }
    if (Array.isArray(value)) { array(value, 'Backup list'); value.forEach(item => shape(item, depth + 1)); return; }
    const entries = Object.entries(object(value, 'Backup data'));
    if (entries.length > 100) throw new Error('A backup object has too many fields.');
    for (const [key, child] of entries) {
      if (['__proto__', 'prototype', 'constructor'].includes(key)) throw new Error('This backup contains an unsafe field name.');
      shape(child, depth + 1);
    }
  };
  shape(parsed);
  const wrapper = object(parsed, 'Backup');
  if (wrapper.format !== 'dose-timeline-backup' || wrapper.schemaVersion !== 1) throw new Error('Unsupported backup format or schema version.');
  instant(wrapper.exportedAt, 'Backup export time');
  const data = object(wrapper.data, 'Backup data');
  if (data.profile !== null) {
    const profile = object(data.profile, 'Profile');
    revision(profile);
    text(profile.name, 'profile name', 100, true);
    zone(profile.timeZone);
    if (!['12h', '24h'].includes(String(profile.timeFormat))) throw new Error('Invalid profile time format.');
    if (profile.timeIncrementMinutes !== undefined && ![5, 10].includes(profile.timeIncrementMinutes as number)) throw new Error('Choose a 5 or 10 minute time increment.');
    boolean(profile.sleepEnabled, 'Sleep enabled');
    boolean(profile.weekendEnabled, 'Weekend enabled');
    for (const field of ['bedtime', 'wakeTime', 'weekendBedtime', 'weekendWakeTime']) clock(profile[field], field, true);
    if (profile.sleepEnabled && (!profile.bedtime || !profile.wakeTime || profile.bedtime === profile.wakeTime)) throw new Error('Choose distinct bedtime and wake time.');
    if (profile.sleepEnabled && profile.weekendEnabled && (!profile.weekendBedtime || !profile.weekendWakeTime || profile.weekendBedtime === profile.weekendWakeTime)) throw new Error('Choose distinct weekend bedtime and wake time.');
  }
  uniqueRecords(data.doses, 'Dose history', dose => validateDose(dose));
  uniqueRecords(data.scenarios, 'Scenarios', scenario => {
    text(scenario.name, 'scenario name', 150, true);
    text(scenario.modelVersion, 'scenario model version', 100);
    if (!['empty', 'recorded'].includes(String(scenario.baseline))) throw new Error('Invalid scenario baseline.');
    if (scenario.baselineNote !== undefined) text(scenario.baselineNote, 'baseline note', 8000, true);
    if (scenario.view !== undefined) {
      const view = object(scenario.view, 'Scenario view');
      addDays(text(view.date, 'scenario view date', 10), 0);
      if (![1, 2, 3].includes(view.days as number)) throw new Error('Choose 1, 2, or 3 days for the scenario view.');
      zone(view.timeZone);
      boolean(view.publishedOnly, 'Scenario published-only setting');
    }
    uniqueRecords(scenario.doses, 'Scenario doses', dose => validateDose(dose, true), 500);
    if (scenario.comparisonDoses !== undefined) uniqueRecords(scenario.comparisonDoses, 'Comparison doses', dose => validateDose(dose, true), 500);
  }, 5000);
  uniqueRecords(data.favorites, 'Favorites', favorite => {
    identifier(favorite.productId, 'favorite product ID');
    for (const field of ['strength', 'quantity']) scaled(text(favorite[field], field, 30), field);
    if (favorite.packageStrength !== undefined) packageStrength(favorite.packageStrength, favorite.strength);
    if (favorite.inventory !== undefined && favorite.inventory !== '') scaled(text(favorite.inventory, 'inventory', 30), 'Inventory', true);
  }, 1000);
  uniqueRecords(data.checkins, 'Check-ins', validateCheckin);
  uniqueRecords(data.inventory ?? [], 'Inventory receipts', receipt => {
    identifier(receipt.productId, 'inventory product ID');
    for (const field of ['productName', 'strengthUnit', 'unit']) text(receipt[field], field);
    const strength = text(receipt.packageStrength, 'package strength', 100);
    packageStrength(strength, strength.split('/')[0]);
    scaled(text(receipt.quantity, 'received quantity', 30), 'Received quantity');
    instant(receipt.receivedAt, 'Receipt time');
    zone(receipt.timeZone);
    if (receipt.note !== undefined) text(receipt.note, 'receipt note', 8000, true);
  });
  return normalizeFavoritesData(data as unknown as AppData);
}
