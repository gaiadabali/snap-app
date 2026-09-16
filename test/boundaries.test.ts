import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, sep } from 'node:path';
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

/** Packages a CLIENT must never depend on, directly or transitively. */
const FORBIDDEN_FOR_CLIENTS = ['@snap/db', '@snap/tax-engine'];
/** Kept as the old name for the mobile-specific assertions below. */
const FORBIDDEN_FOR_MOBILE = FORBIDDEN_FOR_CLIENTS;

/**
 * The clients. Both are untrusted surfaces that a person can inspect: mobile is
 * a binary an attacker can hold in their hand, and web ships JavaScript to a
 * browser. Neither may reach the `pg` driver and the tenant-isolation helpers in
 * @snap/db, and neither may carry the tax engine whose ATO rates change every
 * 1 July — a rate change must be a deploy, not a client release.
 */
const CLIENTS = ['@snap/mobile', '@snap/web'];
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
  'apps/web',
  'packages/api-contract',
  'packages/db',
  // `packages/docai` was MISSING from this list, so no boundary rule here had
  // ever covered it — not the dependency-graph walk, not the import checks.
  // Found by breaking the duplicate-Document guard below and watching it pass
  // anyway (docs/ON-DEVICE.md OD-4 asks for this list to be updated).
  //
  // It matters now more than it did: docai gained a dependency on
  // api-contract when the DocDOM types moved there, and a package outside this
  // list can acquire any dependency at all without anything noticing.
  'packages/docai',
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
    // Derived from the FILESYSTEM, not from a second hardcoded list.
    //
    // This test previously compared `WORKSPACE_DIRS` against a literal array,
    // and both of them were missing `packages/docai`. They agreed with each
    // other perfectly, the test passed for months, and docai was invisible to
    // every rule in this file — it could have taken a dependency on anything.
    //
    // docs/DEPLOY.md §8 names the shape: *nothing checks the agreement BETWEEN
    // two correct things*. Two internally-consistent lists are not a check.
    // A package added to the repo must now fail this until it is added above.
    const onDisk = ['apps', 'packages']
      .flatMap((group) =>
        readdirSync(join(ROOT, group), { withFileTypes: true })
          .filter((e) => e.isDirectory() && existsSync(join(ROOT, group, e.name, 'package.json')))
          .map((e) => `${group}/${e.name}`),
      )
      .map((dir) => readPkg(dir)?.name)
      .filter((name): name is string => Boolean(name))
      .sort();

    expect([...graph.keys()].sort()).toEqual(onDisk);
  });

  const clientCases = CLIENTS.flatMap((client) =>
    FORBIDDEN_FOR_CLIENTS.map((forbidden) => [client, forbidden] as const),
  );

  it.each(clientCases)('%s does not depend on %s, even transitively', (client, forbidden) => {
    const reachable = closure(client);
    expect(
      reachable.has(forbidden),
      `${client} reaches ${forbidden} via ${[...reachable].join(' -> ')}. ` +
        'Heavy logic belongs on the server; put the wire types in @snap/api-contract instead.',
    ).toBe(false);
  });

  it('web depends only on the api-contract from this workspace', () => {
    const web = readPkg('apps/web');
    const snapDeps = Object.keys(web?.dependencies ?? {}).filter((d) => d.startsWith('@snap/'));
    expect(
      snapDeps.sort(),
      'The website is a browser client. It talks to the server over HTTP and shares TYPES only.',
    ).toEqual(['@snap/api-contract']);
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

  it('api-contract imports nothing from OUTSIDE itself', () => {
    // A types-only package must not pull anything in; an external `import`
    // here becomes real weight in the mobile bundle.
    //
    // Checked across EVERY entry point, not just index.ts. `docdom.ts` arrived
    // later (docs/ON-DEVICE.md OD-2) and the original check looked only at
    // index.ts, so it would have said nothing about it — a guard that does not
    // cover what was added after it was written.
    //
    // Widening it immediately found that `analytics.ts` imports `./money`.
    // That is fine and the rule is what was wrong: an import WITHIN the package
    // adds no external weight, and `money.ts` is deliberately real code (exact
    // decimal arithmetic the app shares). What must never appear is an import
    // of anything outside this package.
    for (const entry of ['index.ts', 'money.ts', 'analytics.ts', 'docdom.ts']) {
      const src = readFileSync(join(ROOT, 'packages/api-contract/src', entry), 'utf8');
      const external = (src.match(/from\s+'([^']+)'/g) ?? []).filter(
        (m) => !/from\s+'\.{1,2}\//.test(m),
      );
      expect(external, `${entry} imports from outside api-contract: ${external.join(', ')}`)
        .toEqual([]);
    }
  });

  it('DocDOM is declared exactly once in the workspace', () => {
    // The types moved to api-contract so the phone can render overlays without
    // importing docai's reading pipeline (OD-2); docai re-exports them. The
    // failure mode of that arrangement is someone re-declaring `Document`
    // locally instead of importing it — two declarations that each compile and
    // drift on the first field added to either. docs/DEPLOY.md §8: nothing
    // checks the agreement BETWEEN two correct things.
    const declarations: string[] = [];
    for (const dir of WORKSPACE_DIRS) {
      const srcDir = join(ROOT, dir, 'src');
      if (!existsSync(srcDir)) continue;
      const stack = [srcDir];
      while (stack.length > 0) {
        const current = stack.pop() as string;
        for (const entry of readdirSync(current, { withFileTypes: true })) {
          const full = join(current, entry.name);
          if (entry.isDirectory()) stack.push(full);
          else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
            if (/^export type Document = \{/m.test(readFileSync(full, 'utf8'))) {
              declarations.push(full.slice(ROOT.length + 1).split(sep).join('/'));
            }
          }
        }
      }
    }
    expect(declarations).toEqual(['packages/api-contract/src/docdom.ts']);
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
