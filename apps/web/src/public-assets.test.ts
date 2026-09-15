import { readdirSync, statSync } from 'node:fs';
import { join, posix, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { config } from './middleware.js';

/**
 * A file in `public/` must never sit under a path the middleware guards.
 *
 * This is not hypothetical. The marketing app screenshots were first written to
 * `public/app/`, which serves at `/app/home.png` — and `/app/:path*` is the
 * signed-in panel surface. Every screenshot 307'd to `/sign-in`, so the home
 * page rendered with broken images for every logged-out visitor, which is all
 * of them. It reproduced in production as surely as in dev, and nothing in the
 * build warned about it.
 *
 * The collision is silent by nature: `public/` and the route tree are separate
 * namespaces that resolve into one URL space, so neither Next nor TypeScript
 * has any reason to complain. A test is the only thing that catches it.
 */

const PUBLIC_DIR = fileURLToPath(new URL('../public', import.meta.url));

/** Every file under `public/`, as the URL path it will be served at. */
function servedPaths(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out; // No public/ directory at all is fine.
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) servedPaths(full, out);
    else out.push('/' + relative(PUBLIC_DIR, full).split(sep).join(posix.sep));
  }
  return out;
}

/**
 * The literal prefix a matcher guards — `/app/:path*` → `/app`.
 *
 * Deliberately naive, and that is the point: it over-approximates rather than
 * parsing path-to-regexp, so a new matcher form fails loudly here instead of
 * quietly matching nothing and letting the bug back in.
 */
function guardedPrefix(matcher: string): string {
  const cut = matcher.search(/[:*(]/);
  return (cut === -1 ? matcher : matcher.slice(0, cut)).replace(/\/$/, '');
}

describe('public assets never collide with a guarded route', () => {
  const matchers = Array.isArray(config.matcher) ? config.matcher : [config.matcher];
  const prefixes = matchers.map(guardedPrefix);

  it('derives a non-empty prefix from every matcher', () => {
    expect(prefixes.length).toBeGreaterThan(0);
    for (const prefix of prefixes) {
      expect(prefix.startsWith('/')).toBe(true);
      expect(prefix.length).toBeGreaterThan(1);
    }
  });

  it('serves every file in public/ from an unguarded path', () => {
    const assets = servedPaths(PUBLIC_DIR);
    const collisions = assets.filter((asset) =>
      prefixes.some((prefix) => asset === prefix || asset.startsWith(prefix + '/')),
    );

    expect(
      collisions,
      `These public files are served from a middleware-guarded path, so a signed-out visitor gets ` +
        `a 307 to /sign-in instead of the file. Move them to a directory that does not shadow ` +
        `${prefixes.join(' or ')} — e.g. public/screens/.`,
    ).toEqual([]);
  });

  it('catches the regression it was written for', () => {
    // The exact shape of the original bug, asserted directly so this test
    // cannot silently pass by walking an empty directory.
    const wouldCollide = ['/app/home.png', '/admin/logo.svg'];
    for (const path of wouldCollide) {
      expect(prefixes.some((p) => path.startsWith(p + '/'))).toBe(true);
    }
    expect(prefixes.some((p) => '/screens/home.png'.startsWith(p + '/'))).toBe(false);
  });
});
