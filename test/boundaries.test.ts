import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * WORKSPACE BOUNDARIES.
 *
 * The mobile app is thin by design and the server carries everything heavy. That
 * is easy to say in a document and easy to erode with one convenient import, so
 * it is a test.
 *
 * The reason is not bundle size. The tax engine's ATO rates change every
 * 1 July. If the engine shipped inside the app, a rate change would require an
 * App Store release, and every user who had not updated would silently compute
 * the wrong deductions for the new financial year. Server-side, the annual rate
 * update is a deploy. The same argument applies to @snap/db: it carries the `pg`
 * driver and the tenant-isolation helpers, neither of which belongs on a device
 * that an attacker can hold in their hand.
 */

const ROOT = join(import.meta.dirname, '..');

/** Packages the mobile app must never depend on, directly or transitively. */
const FORBIDDEN_FOR_MOBILE = ['@snap/db', '@snap/tax-engine'];
/** The only workspace package mobile may use: types, zero runtime weight. */
const ALLOWED_FOR_MOBILE = ['@snap/api-contract'];

type Pkg = {
  name?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};

function readPkg(rel: string): Pkg | null {
  const p = join(ROOT, rel, 'package.json');
  return existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as Pkg) : null;
}

const WORKSPACE_DIRS = [
  'apps/mobile',
  'apps/server',
  'packages/api-contract',
  'packages/db',
  'packages/tax-engine',
];

/** name -> its declared @snap/* runtime deps, for transitive walking. */
const graph = new Map<string, string[]>();
for (const dir of WORKSPACE_DIRS) {
  const pkg = readPkg(dir);
  if (!pkg?.name) continue;
  graph.set(pkg.name, Object.keys(pkg.dependencies ?? {}).filter((d) => d.startsWith('@snap/')));
}

/** Every @snap/* package reachable from `start` through runtime dependencies. */
function closure(start: string): Set<string> {
  const seen = new Set<string>();
  const queue = [...(graph.get(start) ?? [])];
  while (queue.length) {
    const next = queue.shift()!;
    if (seen.has(next)) continue;
    seen.add(next);
    queue.push(...(graph.get(next) ?? []));
  }
  return seen;
}

describe('workspace boundaries', () => {
  it('knows about every workspace package', () => {
    expect([...graph.keys()].sort()).toEqual([
      '@snap/api-contract',
      '@snap/db',
      '@snap/mobile',
      '@snap/server',
      '@snap/tax-engine',
    ]);
  });

  it.each(FORBIDDEN_FOR_MOBILE)('mobile does not depend on %s, even transitively', (forbidden) => {
    const reachable = closure('@snap/mobile');
    expect(
      reachable.has(forbidden),
      `@snap/mobile reaches ${forbidden} via ${[...reachable].join(' -> ')}. ` +
        'Heavy logic belongs on the server; put the wire types in @snap/api-contract instead.',
    ).toBe(false);
  });

  it('mobile depends only on the api-contract from this workspace', () => {
    const mobile = readPkg('apps/mobile');
    const snapDeps = Object.keys(mobile?.dependencies ?? {}).filter((d) => d.startsWith('@snap/'));
    expect(snapDeps.sort()).toEqual([...ALLOWED_FOR_MOBILE].sort());
  });

  it('api-contract stays types-only, with no runtime dependencies', () => {
    const pkg = readPkg('packages/api-contract');
    expect(Object.keys(pkg?.dependencies ?? {})).toEqual([]);
  });

  it('api-contract imports nothing at all', () => {
    // A types-only package must not pull anything in; an `import` here would
    // become real weight in the mobile bundle.
    const src = readFileSync(join(ROOT, 'packages/api-contract/src/index.ts'), 'utf8');
    const imports = src.match(/^\s*import\s.+$/gm) ?? [];
    expect(imports, `unexpected imports:\n${imports.join('\n')}`).toEqual([]);
  });

  it('tax-engine has no runtime dependencies', () => {
    const pkg = readPkg('packages/tax-engine');
    expect(Object.keys(pkg?.dependencies ?? {})).toEqual([]);
  });

  it('the server is where the heavy packages are used', () => {
    const reachable = closure('@snap/server');
    for (const p of FORBIDDEN_FOR_MOBILE) {
      expect(reachable.has(p), `@snap/server should depend on ${p}`).toBe(true);
    }
  });
});
