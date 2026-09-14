import type { Dose } from './types';
import { addDays, instantToLocal } from './time';
import { exactSumValues, ingredientAmount } from './history-amounts';

export interface HistoryBar { period: string; count: number; amount: string; }
export interface HistoryBars { title: string; daily: boolean; yearsPerBar: number; bars: HistoryBar[]; }

/** Bound the number of bars by widening calendar periods, never by dropping the
 * end of the selected range. Each record's local date is evaluated only once.
 * Amounts stay exact decimals; callers may convert only for drawing height. */
export function historyBars(rows: readonly Dose[], from: string, to: string, timeZone: string, ingredient: string): HistoryBars {
  addDays(from, 0); addDays(to, 0);
  if (from > to) throw new RangeError('Choose a report start date on or before its end.');
  const dayCount = Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;
  const firstYear = Number(from.slice(0, 4)), lastYear = Number(to.slice(0, 4));
  const firstMonth = firstYear * 12 + Number(from.slice(5, 7)) - 1;
  const lastMonth = lastYear * 12 + Number(to.slice(5, 7)) - 1;
  const daily = dayCount <= 62, monthly = !daily && lastMonth - firstMonth < 1200;
  const yearsPerBar = daily || monthly ? 0 : Math.ceil((lastYear - firstYear + 1) / 1200);
  const yearText = (year: number) => String(year).padStart(4, '0');
  const yearPeriod = (year: number) => {
    const first = firstYear + Math.floor((year - firstYear) / yearsPerBar) * yearsPerBar;
    const last = Math.min(lastYear, first + yearsPerBar - 1);
    return first === last ? yearText(first) : `${yearText(first)}–${yearText(last)}`;
  };
  const periods: string[] = [];
  if (daily) for (let day = 0; day < dayCount; day++) periods.push(addDays(from, day));
  else if (monthly) for (let month = firstMonth; month <= lastMonth; month++) periods.push(`${yearText(Math.floor(month / 12))}-${String(month % 12 + 1).padStart(2, '0')}`);
  else for (let year = firstYear; year <= lastYear; year += yearsPerBar) periods.push(yearPeriod(year));
  const totals = new Map(periods.map(period => [period, { count: 0, amounts: [] as string[] }]));
  for (const dose of rows) {
    if (dose.status !== 'actual') continue;
    const date = instantToLocal(dose.administeredAt, timeZone).date;
    if (date < from || date > to) continue;
    const period = daily ? date : monthly ? date.slice(0, 7) : yearPeriod(Number(date.slice(0, 4)));
    const total = totals.get(period)!;
    total.count++;
    total.amounts.push(ingredientAmount(dose, ingredient));
  }
  return {
    title: daily ? 'Daily amount' : monthly ? 'Monthly amount' : yearsPerBar === 1 ? 'Yearly amount' : `Amount by ${yearsPerBar}-year period`,
    daily, yearsPerBar,
    bars: [...totals].map(([period, total]) => ({ period, count: total.count, amount: exactSumValues(total.amounts) })),
  };
}
