import { formatUnits } from 'viem';

export const shortHex = (h: string) => (h.length > 14 ? `${h.slice(0, 6)}…${h.slice(-4)}` : h);

/** A token amount for people: at most `digits` decimals, no trailing zeros. */
export function amount(v: bigint, decimals = 18, digits = 4): string {
  const s = formatUnits(v, decimals);
  const [i, f = ''] = s.split('.');
  // a small amount keeps its first two significant digits instead of rounding to zero
  const lead = f.search(/[1-9]/);
  const keep = i === '0' && lead >= digits ? lead + 2 : digits;
  const frac = f.slice(0, keep).replace(/0+$/, '');
  return `${Number(i).toLocaleString('en-US')}${frac ? `.${frac}` : ''}`;
}

export const gas = (g: bigint | number) => `${BigInt(g).toLocaleString('en-US')} gas`;
