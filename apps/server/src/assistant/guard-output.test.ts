import { describe, expect, it } from 'vitest';

import { factsFromPacks } from './facts.js';
import { allowedHref, createOutputFilter, findPromise, MAX_CHARS, safeCut, type FilterEnd } from './guard-output.js';
import { findAmounts, keyOf, microFromDecimal } from './money.js';
import { PACK_ROWS } from './test-support.js';

const facts = factsFromPacks(PACK_ROWS);
const official = { supportEmail: facts.supportEmail };
const pct = (n: string): string => keyOf(microFromDecimal(n) ?? 0n);

function filterWith(extra: { money?: string[]; percents?: string[]; intent?: string; pagePath?: string } = {}) {
  const allowedMoney = new Set<string>(facts.allowedMoney);
  for (const t of extra.money ?? []) for (const a of findAmounts(t)) allowedMoney.add(keyOf(a.micro));
  return createOutputFilter({
    facts,
    intent: extra.intent ?? 'question',
    official,
    allowedMoney,
    allowedPercents: new Set([pct('10'), pct('100'), ...(extra.percents ?? []).map(pct)]),
    pagePath: extra.pagePath,
  });
}

/** Stream `text` through a filter in pieces of `size` characters. */
function run(text: string, size = 3, f = filterWith()): { shown: string; end: FilterEnd; stopped: boolean } {
  let shown = '';
  let stopped = false;
  for (let i = 0; i < text.length && !stopped; i += size) {
    const r = f.push(text.slice(i, i + size));
    shown += r.text;
    if (r.stop) stopped = true;
  }
  const end = f.end();
  shown += end.tail;
  return { shown, end, stopped };
}

describe('the money guard', () => {
  it('lets FACTS prices through, in any format', () => {
    for (const text of [
      'A scan is 3.7 cents, so 100 scans are $3.70.',
      'The 1,000-scan pack is $37.00, and 50 scans cost $1.85.',
      'That works out at 3.7c a scan.',
    ]) {
      const r = run(text);
      expect(r.end.replace, text).toBeUndefined();
      expect(r.shown).toBe(text);
    }
  });

  it('replaces an invented price with the safe answer, and stops the model', () => {
    const r = run('Sure. A monthly plan is $9.99 and covers unlimited scans.');
    expect(r.stopped).toBe(true);
    expect(r.end.replace).toContain("I'd rather not put a number on that");
    expect(r.end.replace).toContain('3.7 cents');
    expect(r.end.flags).toContain('price');
    // nothing of the invented figure ever went out
    expect(r.shown).not.toContain('9.99');
  });

  it('allows a VERIFIED tool figure and an amount the visitor typed, not a different one', () => {
    const allowed = { money: ['$110.00 $10.00 $100.00', '$250'] };
    expect(run('The GST in $110 is $10.00, so $100 before GST. On your $250 docket, ask me again.', 4, filterWith(allowed)).end.replace).toBeUndefined();
    expect(run('The GST in $110 is $11.00.', 4, filterWith(allowed)).end.replace).toBeDefined();
  });

  it('catches an amount arriving one character at a time', () => {
    const r = run('It costs $4.50 a month.', 1);
    expect(r.end.replace).toBeDefined();
    expect(r.shown).not.toContain('4.5');
  });

  it.each(['1000 dollars', '5 cents', '9c', 'AUD 20', '$2k'])('catches "%s"', (amount) => {
    expect(run(`That would be ${amount} for you.`).end.replace).toBeDefined();
  });

  it('treats an unlisted percentage the same way, but allows the GST rate', () => {
    expect(run('GST is 10% of the price before GST.').end.replace).toBeUndefined();
    const r = run('It reads receipts with 98% accuracy.');
    expect(r.end.replace).toBeDefined();
    expect(r.end.flags).toContain('percent');
  });
});

describe('the guarantee guard', () => {
  it.each([
    'We guarantee every receipt is read correctly.',
    'I promise it will be accepted by the ATO.',
    'Snap Apps is 100% accurate.',
    'It is never wrong about GST.',
  ])('replaces: %s', (text) => {
    const r = run(text);
    expect(r.end.replace).toContain("won't promise");
    expect(r.end.flags).toContain('guarantee');
  });

  it.each([
    "No reader can guarantee a perfect result, so check the flagged lines.",
    "I can't promise that, but it flags what it is unsure of.",
    'No app is 100% accurate.',
  ])('allows the negated form: %s', (text) => {
    expect(findPromise(text)).toBeNull();
  });
});

describe('links and contacts', () => {
  it('keeps site links (with anchors) and the support mailto, drops the rest to their words', () => {
    expect(allowedHref('/pricing', official)).toBe('/pricing');
    expect(allowedHref('/docs/data-retention#csv', official)).toBe('/docs/data-retention#csv');
    expect(allowedHref('https://snap-apps.gaiada.com/download/', official)).toBe('/download');
    expect(allowedHref('mailto:support@snapapps.com.au', official)).toBe('mailto:support@snapapps.com.au');
    expect(allowedHref('mailto:someone@else.com', official)).toBeNull();
    expect(allowedHref('/admin', official)).toBeNull();
    expect(allowedHref('https://evil.example/pricing', official)).toBeNull();
    expect(allowedHref('javascript:alert(1)', official)).toBeNull();
  });

  it('streams a link out whole, and strips a foreign one to its label', () => {
    const r = run('See [Pricing](/pricing) or [this deal](https://evil.example/x) for more.\n[[next: How do credits work?]]');
    expect(r.shown).toBe('See [Pricing](/pricing) or this deal for more.');
    expect(r.end.flags).toContain('link-dropped');
    expect(r.end.sources).toEqual([{ title: 'Pricing', url: '/pricing' }]);
  });

  it('removes bare foreign URLs, keeps our own domain readable', () => {
    const r = run('Try https://scam.example/free or www.other.com, or visit snap-apps.gaiada.com/download today.');
    expect(r.shown).not.toMatch(/scam|other\.com/);
    expect(r.shown).toContain('snap-apps.gaiada.com/download');
    expect(r.end.flags).toContain('url-dropped');
  });

  it('replaces any other email address or phone number with the support address', () => {
    const r = run('Email help@snapapps.example or call 0412 345 678, or support@snapapps.com.au.');
    expect(r.shown).toBe('Email support@snapapps.com.au or call support@snapapps.com.au, or support@snapapps.com.au.');
  });

  it('removes markup', () => {
    const r = run('# Heading\n<b>bold</b> ![x](/img.png) done');
    expect(r.shown).toBe('**Heading**\nbold  done');
  });
});

describe('directives and actions', () => {
  it('turns [[next]] and [[cta]] into actions and never shows them', () => {
    const r = run('Grab the Android app from the download page.\n\n[[next: Is there an iPhone app? | How do I install it?]]\n[[cta: app]]', 5);
    expect(r.shown).toBe('Grab the Android app from the download page.');
    expect(r.end.actions).toEqual({ chips: ['Is there an iPhone app?', 'How do I install it?'], cta: 'app' });
  });

  it('reads an unterminated directive at the very end', () => {
    const r = run('Happy to help.\n[[next: What does it cost? | How do I start');
    expect(r.shown).toBe('Happy to help.');
    expect(r.end.actions.chips).toEqual(['What does it cost?', 'How do I start']);
  });

  it('falls back to the intent CTA, and drops a chip carrying a figure', () => {
    const r = run('Start free at the register page.\n[[next: Is $5 enough? | What does it cost?]]', 3, filterWith({ intent: 'start' }));
    expect(r.end.actions).toEqual({ chips: ['What does it cost?'], cta: 'start' });
  });

  it('replaces an empty answer', () => {
    const r = run('[[next: Hello]]');
    expect(r.end.replace).toContain('support');
    expect(r.end.actions.cta).toBe('human');
  });

  it('stops a runaway answer', () => {
    const long = 'word '.repeat(Math.ceil(MAX_CHARS / 5) + 50);
    const r = run(long, 50);
    expect(r.stopped).toBe(true);
    expect(r.end.flags).toContain('runaway');
  });
});

describe('safeCut', () => {
  it('holds a word being written, a trailing number, a half link and a half directive', () => {
    expect(safeCut('hello wor')).toBe(6);
    expect(safeCut('it costs $1')).toBe(9);
    expect(safeCut('see [Pri')).toBe(4);
    expect(safeCut('see [Pricing](/pri')).toBe(4);
    expect(safeCut('done [[cta: ap')).toBe(5);
  });
});
