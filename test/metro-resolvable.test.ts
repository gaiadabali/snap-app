import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Nothing the phone's bundler has to read may use a `.js` relative specifier.
 *
 * WHAT THIS CATCHES. `packages/docai-preview/src/index.ts` said
 * `export * from './structure.js'` while the source file is `structure.ts`.
 * TypeScript is happy — the package is `moduleResolution: "bundler"` and
 * `noEmit: true`, so the extension was decorative. Metro is not: it resolves a
 * relative specifier literally, found no `structure.js`, and the mobile image
 * build failed. Because poll-deploy needs the whole Publish images run green,
 * that one line made main undeployable while three other images published
 * perfectly.
 *
 * WHY IT SURVIVED SO LONG. Nothing on the phone imported that package until
 * OD-8. `@snap/tax-rules` is written in the same `.js` style throughout and is
 * perfectly fine, because Metro never reaches it — it is server-only. So the
 * rule is not "never write `.js`"; it is "not in anything the phone imports",
 * and which packages those are changes as features land.
 *
 * A metro.config.js with a resolveRequest that strips the extension would also
 * work and would make the class impossible. It is not what this does: a custom
 * resolver silently changes how every module in the app resolves, and a test
 * that names the offending line is easier to act on than a resolver that
 * quietly papers over it. If the rule starts costing more than it saves, the
 * resolver is the escape hatch.
 */

const REPO = join(import.meta.dirname, '..');

/** Workspace packages `apps/mobile` declares — the ones Metro must traverse. */
function packagesReachableFromMobile(): string[] {
  const manifest = JSON.parse(
    readFileSync(join(REPO, 'apps', 'mobile', 'package.json'), 'utf8'),
  ) as { dependencies?: Record<string, string> };
  return Object.entries(manifest.dependencies ?? {})
    .filter(([name, range]) => name.startsWith('@snap/') && String(range).startsWith('workspace:'))
    .map(([name]) => name.replace('@snap/', ''))
    .filter((pkg) => existsSync(join(REPO, 'packages', pkg, 'src')))
    .sort();
}

/** Relative imports ending in `.js`, via git grep so it never walks node_modules. */
function jsSpecifiersIn(paths: string[]): string[] {
  if (paths.length === 0) return [];
  try {
    const out = execFileSync(
      'git',
      ['grep', '-nE', String.raw`from '\.{1,2}/[^']*\.js'`, '--', ...paths],
      { cwd: REPO, encoding: 'utf8' },
    );
    return out.split('\n').filter(Boolean);
  } catch (error) {
    // git grep exits 1 when it matches nothing. That is the good case.
    const status = (error as { status?: number }).status;
    if (status === 1) return [];
    throw error;
  }
}

describe('everything Metro bundles resolves without a .js extension', () => {
  const packages = packagesReachableFromMobile();

  it('knows which packages the phone actually pulls in', () => {
    // A passing suite that checked nothing would be worse than none. OD-8
    // made docai-preview the first such package; if this list ever empties,
    // the parser has drifted rather than the dependency graph.
    expect(packages.length).toBeGreaterThan(0);
    expect(packages).toContain('docai-preview');
  });

  it('finds no .js relative specifier in the mobile app or the packages it imports', () => {
    const paths = ['apps/mobile/src', ...packages.map((p) => `packages/${p}/src`)];
    const offenders = jsSpecifiersIn(paths);
    expect(
      offenders,
      `Metro resolves these literally and the file is .ts, so the mobile image build fails:\n${offenders.join('\n')}\nDrop the extension.`,
    ).toEqual([]);
  });

  it('does NOT complain about server-only packages written in that style', () => {
    // @snap/tax-rules uses `.js` throughout and is correct: Node ESM wants the
    // extension and Metro never sees it. A rule that failed on it would be
    // wrong, and would get switched off.
    if (!existsSync(join(REPO, 'packages', 'tax-rules', 'src'))) return;
    expect(packages).not.toContain('tax-rules');
  });
});
