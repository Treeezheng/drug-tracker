import type { Product } from './types';

/** A package's slash format, not its number of named salts, defines its components. */
export function parseCustomStrength(product: Product, value: string): string {
  const counts = new Set(product.strengths.map(strength => strength.split('/').length));
  const count = product.strengths[0]?.split('/').length;
  if (!count || count > 10 || counts.size !== 1) throw new Error('This medication’s package format needs review.');
  if (typeof value !== 'string' || value.length > 200) throw new Error('Enter a shorter package strength.');
  const parts = value.trim().split('/');
  if (parts.length !== count) throw new Error(count > 1
    ? `Enter all ${count} ingredient strengths, separated by / in the package order.`
    : 'Enter one package strength, without /.');
  const normalized = parts.map(part => {
    const text = part.trim();
    if (!/^(?:\d+(?:\.\d{0,9})?|\.\d{1,9})$/.test(text)) throw new Error('Use a positive decimal with up to nine decimal places.');
    const [whole = '', fraction = ''] = text.split('.');
    const integer = whole.replace(/^0+/, '') || '0';
    if (integer.length > 12) throw new Error('A strength can have at most 12 digits before the decimal point.');
    if (BigInt(integer) * 1_000_000_000n + BigInt(fraction.padEnd(9, '0')) <= 0n) throw new Error('Package strength must be greater than zero.');
    const decimal = fraction.replace(/0+$/, '');
    return `${integer}${decimal ? `.${decimal}` : ''}`;
  }).join('/');
  if (normalized.length > 100) throw new Error('The complete package strength is too long.');
  return normalized;
}
