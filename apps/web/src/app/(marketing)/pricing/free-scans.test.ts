/**
 * The website must advertise the free allowance the product actually grants.
 *
 * Sibling to `credit-packs.test.ts`, for the other number a visitor is sold
 * on. That file guards what a scan COSTS; nothing guarded how many are FREE,
 * and the gap showed: the largest call to action on the home page read "Scan
 * 20 free, no card" while `credits.repo.ts` grants ten. Every other surface —
 * the hero, the pricing section, /features, /how-it-works, /pricing — said
 * ten. One string had been left behind, and nothing could see it, because a
 * page that promises too much is still a page that renders, typechecks and
 * returns 200.
 *
 * Overstating a free allowance is a misleading representation under
 * Australian Consumer Law s18, exactly as a wrong price is. So this checks
 * both directions:
 *
 *   1. What the SERVER grants matches what the website's constant says.
 *   2. No marketing source states a free-scan count of its own that disagrees
 *      with that constant — in digits or in words.
 *
 * It deliberately does NOT ban the number 20 outright.
 * `pricing/pricing-plans.tsx` is unreferenced code kept on purpose (see the
 * note at the top of `pricing/page.tsx`) and describes a retired subscription
 * model with a "20 scans/month" allowance. That is a true statement about a
 * dead model, not a claim about the signup bonus, and rewriting its figures
 * would be inventing facts about a product that no longer exists. The patterns
 * below match claims about the free tier specifically.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { FREE_SCANS_AT_SIGNUP } from './credit-packs';

const MARKETING = join(__dirname, '..');
const CREDITS_REPO = join(
  __dirname,
  '../../../../../../apps/server/src/credits/credits.repo.ts',
);

/** Number words this copy could plausibly use. Extend if the grant changes. */
const NUMBER_WORDS: Record<string, number> = {
  five: 5,
  ten: 10,
  fifteen: 15,
  twenty: 20,
  twentyfive: 25,
  fifty: 50,
  hundred: 100,
};

/**
 * Comments are not claims.
 *
 * The first run of this test failed on the comment explaining the bug it
 * guards, because that comment quotes the old string. A checker that cannot
 * tell code from prose ABOUT code produces a false positive every time someone
 * documents a fix, and a check that cries wolf gets deleted. So comments come
 * out before anything is matched — what ships to a visitor is the code.
 */
function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
}

function sources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      sources(full, out);
    } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Claims about the FREE allowance, in digits or in words.
 *
 * Kept narrow on purpose: these are the shapes the copy actually uses, so a
 * monthly-allowance line in retired code cannot trip it. `{count}` in a
 * template literal is the derived form and is what we want people to write, so
 * it never matches.
 */
const DIGIT_CLAIMS = [
  /Scan\s+(\d+)\s+free/gi,
  /(\d+)\s+free\s+scans?/gi,
  /first\s+(\d+)\s+scans?/gi,
  /(\d+)\s+scans?\s+free/gi,
];

const WORD_CLAIMS = [
  /\b([a-z]+)\s+scans?\s+free/gi,
  /\b([a-z]+)\s+free\s+scans?/gi,
  /starts?\s+with\s+([a-z]+)\s+scans?/gi,
];

describe('the free scan allowance', () => {
  it('matches what the server actually grants', () => {
    const repo = readFileSync(CREDITS_REPO, 'utf8');
    // values (…, current_tenant_id(), 'scans', 10, 10, 'signup_bonus')
    const match = /'scans',\s*(\d+),\s*(\d+),\s*'signup_bonus'/.exec(repo);

    expect(match, 'the signup grant has moved in credits.repo.ts').not.toBeNull();
    const granted = Number(match?.[1]);

    expect(
      granted,
      `The website says ${FREE_SCANS_AT_SIGNUP} free scans and the server grants ` +
        `${granted}. Promising more than is handed over is a misleading ` +
        'representation under ACL s18. Change both, or change neither.',
    ).toBe(FREE_SCANS_AT_SIGNUP);
  });

  it('finds the sources it is supposed to be reading', () => {
    // A scanner matching nothing would pass the assertion below forever.
    const files = sources(MARKETING);
    expect(files.length).toBeGreaterThan(15);
    expect(files.some((f) => f.endsWith('proof.tsx'))).toBe(true);
    expect(files.join('\n')).toMatch(/page\.tsx/);
  });

  it('never states a free-scan count that disagrees with the constant', () => {
    const wrong: string[] = [];

    for (const file of sources(MARKETING)) {
      const text = stripComments(readFileSync(file, 'utf8'));
      const where = file.slice(file.indexOf('(marketing)'));

      for (const re of DIGIT_CLAIMS) {
        for (const m of text.matchAll(re)) {
          if (Number(m[1]) !== FREE_SCANS_AT_SIGNUP) {
            wrong.push(`${where}: "${m[0].trim()}"`);
          }
        }
      }

      for (const re of WORD_CLAIMS) {
        for (const m of text.matchAll(re)) {
          const word = (m[1] ?? '').toLowerCase();
          const value = NUMBER_WORDS[word];
          // Only number-words are claims; "your scans free" is not.
          if (value !== undefined && value !== FREE_SCANS_AT_SIGNUP) {
            wrong.push(`${where}: "${m[0].trim()}"`);
          }
        }
      }
    }

    expect(
      wrong,
      `A marketing surface states a free-scan count that is not ` +
        `${FREE_SCANS_AT_SIGNUP}. Write it as {FREE_SCANS_AT_SIGNUP} from ` +
        '`pricing/credit-packs` rather than as a literal, so it cannot be left ' +
        'behind when the grant changes.',
    ).toEqual([]);
  });
});
