import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Every workspace package an app DEPENDS ON must be COPYed into its image.
 *
 * WHY THIS EXISTS. Three times in one day a `@snap/*` dependency was declared
 * in a package.json, imported by real code, and absent from the Dockerfile:
 *
 *   apps/server   @snap/tax-rules      the API crash-looped on boot; 502 for
 *                                      ten minutes until the COPY was added
 *   apps/server   @snap/docai-preview  latent — it had been missing for as
 *                                      long as it had been a dependency, and
 *                                      survived only because nothing imported
 *                                      a runtime value from it yet
 *   apps/mobile   @snap/docai-preview  `expo export` could not resolve it;
 *                                      Publish images went red and NOTHING
 *                                      could deploy, including three images
 *                                      that had built perfectly
 *
 * NOTHING ELSE CAN CATCH IT. `pnpm -r typecheck` and every test suite resolve
 * the workspace from the repository, where the package is simply present. The
 * image is the only environment where it is missing, and CI does not run an
 * image. So green CI is evidence that the code compiles — it has never been
 * evidence that the container builds, and twice today it was green while
 * production was down.
 *
 * This reads the two files that actually disagree — the manifest and the
 * Dockerfile — and compares them. It needs no Docker daemon and runs in
 * milliseconds.
 */

const REPO = join(import.meta.dirname, '..');

/** Apps that ship as an image built from an explicit COPY list. */
function appsWithDockerfiles(): string[] {
  return readdirSync(join(REPO, 'apps'))
    .filter((name) => existsSync(join(REPO, 'apps', name, 'Dockerfile')))
    .sort();
}

function declaredWorkspaceDeps(app: string): string[] {
  const manifest = JSON.parse(
    readFileSync(join(REPO, 'apps', app, 'package.json'), 'utf8'),
  ) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  return Object.entries({ ...manifest.dependencies, ...manifest.devDependencies })
    .filter(([name, range]) => name.startsWith('@snap/') && String(range).startsWith('workspace:'))
    .map(([name]) => name.replace('@snap/', ''))
    .sort();
}

function copiedPackages(app: string): { manifests: Set<string>; sources: Set<string> } {
  const dockerfile = readFileSync(join(REPO, 'apps', app, 'Dockerfile'), 'utf8');
  const manifests = new Set<string>();
  const sources = new Set<string>();
  for (const line of dockerfile.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('COPY ')) continue;
    // `COPY packages/x/package.json packages/x/package.json` seeds the install
    // layer; `COPY packages/x packages/x` brings the source. Both are needed
    // and they fail differently, so both are checked.
    const manifest = trimmed.match(/^COPY\s+packages\/([^/\s]+)\/package\.json\s/);
    if (manifest?.[1]) manifests.add(manifest[1]);
    const source = trimmed.match(/^COPY\s+packages\/([^/\s]+)\s+packages\/\1\s*$/);
    if (source?.[1]) sources.add(source[1]);
  }
  return { manifests, sources };
}

describe('every app image contains the workspace packages it depends on', () => {
  const apps = appsWithDockerfiles();

  it('finds the apps to check — a passing suite that checked nothing would be worse', () => {
    expect(apps.length).toBeGreaterThan(0);
    expect(apps).toContain('server');
    expect(apps).toContain('mobile');
  });

  for (const app of apps) {
    describe(`apps/${app}`, () => {
      const declared = declaredWorkspaceDeps(app);

      it('declares at least one workspace dependency to check', () => {
        // If this ever fails the parser has drifted, not the Dockerfile.
        expect(declared.length).toBeGreaterThan(0);
      });

      it('COPYs every declared package manifest into the install layer', () => {
        const { manifests } = copiedPackages(app);
        const missing = declared.filter((pkg) => !manifests.has(pkg));
        expect(
          missing,
          `apps/${app}/Dockerfile is missing: ${missing
            .map((m) => `COPY packages/${m}/package.json packages/${m}/package.json`)
            .join(' ; ')}`,
        ).toEqual([]);
      });

      it('COPYs every declared package source into the image', () => {
        const { sources } = copiedPackages(app);
        const missing = declared.filter((pkg) => !sources.has(pkg));
        expect(
          missing,
          `apps/${app}/Dockerfile is missing: ${missing
            .map((m) => `COPY packages/${m} packages/${m}`)
            .join(' ; ')}`,
        ).toEqual([]);
      });
    });
  }
});

describe('the check itself can fail', () => {
  it('reports a package that is declared and not copied', () => {
    // The assertion this suite rests on, exercised against a Dockerfile that
    // is deliberately wrong. Without this, a parser that silently matched
    // nothing would make every test above pass for the wrong reason — which
    // is precisely how the three real failures got through.
    const dockerfile = [
      'FROM node:22',
      'COPY packages/api-contract/package.json packages/api-contract/package.json',
      'COPY packages/api-contract packages/api-contract',
    ].join('\n');

    const manifests = new Set<string>();
    const sources = new Set<string>();
    for (const line of dockerfile.split('\n')) {
      const trimmed = line.trim();
      const m = trimmed.match(/^COPY\s+packages\/([^/\s]+)\/package\.json\s/);
      if (m?.[1]) manifests.add(m[1]);
      const src = trimmed.match(/^COPY\s+packages\/([^/\s]+)\s+packages\/\1\s*$/);
      if (src?.[1]) sources.add(src[1]);
    }

    const declared = ['api-contract', 'docai-preview'];
    expect(declared.filter((p) => !manifests.has(p))).toEqual(['docai-preview']);
    expect(declared.filter((p) => !sources.has(p))).toEqual(['docai-preview']);
  });
});
