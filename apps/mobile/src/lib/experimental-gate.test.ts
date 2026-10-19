import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { experimentalFeaturesEnabled } from '../config';

/**
 * The experimental flag hides surfaces the server cannot honour yet (see
 * `config.ts`). Screens cannot be rendered here, so this is a narrow source
 * scan: it fails if a route literal for a hidden screen shows up in a file that
 * never mentions the flag, or if a hidden screen loses its redirect guard.
 */
const SRC = path.resolve(import.meta.dirname, '..');

const GUARDED_SCREENS = [
  'app/alerts.tsx',
  'app/rewards.tsx',
  'app/fingerprint.tsx',
  'app/wallet/add.tsx',
  'app/wallet/card.tsx',
];

/** Quotes or backticks DIRECTLY around the route, so `/v1/wallet/cards` never matches. */
const ROUTE_LITERAL = /(['"`])(\/alerts|\/rewards|\/fingerprint|\/wallet\/add|\/wallet\/card)\1/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(name) && !/\.test\.ts$/.test(name) ? [full] : [];
  });
}

describe('experimentalFeaturesEnabled', () => {
  it('is true only for the exact string "true"', () => {
    expect(experimentalFeaturesEnabled('true')).toBe(true);
  });

  it.each([undefined, '', 'false', '1', 'TRUE', ' true', 'yes'])('is false for %j', (v) => {
    expect(experimentalFeaturesEnabled(v)).toBe(false);
  });
});

describe('experimental surfaces are gated', () => {
  it('every file naming a hidden route also references the flag', () => {
    const ungated = sourceFiles(SRC)
      .filter((f) => ROUTE_LITERAL.test(readFileSync(f, 'utf8')))
      .filter((f) => !readFileSync(f, 'utf8').includes('EXPERIMENTAL_FEATURES_ENABLED'))
      .map((f) => path.relative(SRC, f).split(path.sep).join('/'));
    expect(ungated).toEqual([]);
  });

  it('the route matcher ignores API paths', () => {
    expect(ROUTE_LITERAL.test("api('/v1/wallet/cards')")).toBe(false);
    expect(ROUTE_LITERAL.test("router.push('/rewards')")).toBe(true);
    expect(ROUTE_LITERAL.test('router.push(`/wallet/add`)')).toBe(true);
  });

  it.each(GUARDED_SCREENS)('%s redirects away when the flag is off', (rel) => {
    const text = readFileSync(path.join(SRC, rel), 'utf8');
    expect(text).toContain('if (!EXPERIMENTAL_FEATURES_ENABLED) return <Redirect');
  });
});
