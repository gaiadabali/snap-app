import { describe, expect, it } from 'vitest';

import { bareNumbers, findAmounts, findPercents, formatAud, formatCents, mentionsMoney, microFromDecimal, microToDecimal } from './money.js';

const dollars = (text: string): string[] => findAmounts(text).map((a) => (Number(a.micro) / 1e6).toString());

describe('amounts as Australians write them', () => {
  it.each([
    ['$1,000', ['1000']],
    ['$82.50 and $ 5', ['82.5', '5']],
    ['A$10, AU$20 and US$30', ['10', '20', '30']],
    ['AUD 40 or AUD50', ['40', '50']],
    ['1000 dollars, 10 bucks, 25 AUD', ['1000', '10', '25']],
    ['3.7 cents a scan, or 3.7c', ['0.037', '0.037']],
    ['88c per km', ['0.88']],
    ['$5k or $2.5m or $1 million', ['5000', '2500000', '1000000']],
    ['$10–20 a month', ['10', '20']],
  ])('%s', (text, expected) => {
    expect(dollars(text)).toEqual(expected);
  });

  it.each([
    'Every new account gets 10 free scans',
    'Packs of 50, 100, 200, 500 and 1,000 scans',
    'Keep records for 5 years, FY2026, TD 2025/4',
    'Is 51 824 753 556 a valid ABN?',
    'Call Lifeline on 13 11 14 or 000',
    '5,000 business kilometres',
  ])('finds no money in: %s', (text) => {
    expect(findAmounts(text)).toEqual([]);
  });

  it('treats $10, $10.00 and 10 dollars as the same amount', () => {
    const keys = ['$10', '$10.00', '10 dollars'].map((t) => findAmounts(t)[0]?.micro);
    expect(new Set(keys).size).toBe(1);
  });

  it('reads percentages', () => {
    expect(findPercents('GST is 10% and 2.5 per cent and 100 percent').map(Number)).toEqual([10e6, 2.5e6, 100e6]);
  });

  it('reads bare numbers, but not inside longer tokens', () => {
    expect(bareNumbers('GST on 110 and 1,250.50 for FY2026 at 10am').map((v) => Number(v) / 1e6)).toEqual([110, 1250.5]);
  });

  it('formats without floating point', () => {
    expect(microFromDecimal('1.8500')).toBe(1_850_000n);
    expect(formatAud(1_850_000n)).toBe('$1.85');
    expect(formatAud(1_000_000_000n)).toBe('$1,000.00');
    expect(formatCents(37_000n)).toBe('3.7 cents');
    expect(microToDecimal(110_000_000n)).toBe('110.00');
    expect(microToDecimal(82_500_000n)).toBe('82.50');
  });

  it('says when a block mentions money', () => {
    expect(mentionsMoney('A pack of 100 costs $3.70.')).toBe(true);
    expect(mentionsMoney('Each scan is 3.7 cents.')).toBe(true);
    expect(mentionsMoney('Each scan is {{PRICE_PER_SCAN}}.')).toBe(false);
    expect(mentionsMoney('Credits come in packs of {{PACK_SIZES}}.')).toBe(false);
  });
});
