import { join } from 'node:path';

import type { NextConfig } from 'next';

/**
 * `transpilePackages` is required, not optional.
 *
 * `@snap/api-contract` ships TypeScript source with extensionless relative
 * imports — the same constraint documented in docs/PLAN.md §6.1 that forces the
 * extraction worker to run under tsx. Next bundles it, so it resolves; raw Node
 * would not.
 */
const config: NextConfig = {
  reactStrictMode: true,
  /**
   * Ships a self-contained server with only the traced dependencies.
   *
   * Without it the runtime image had to reuse the whole build stage —
   * node_modules, build cache and all — because `next start` loads this
   * TypeScript config at process start and therefore needs `typescript`
   * present. That produced a 2.7 GB image, which is a third of the free disk
   * on the target VPS, a box already at 85% and serving live sites.
   *
   * `.next/standalone/server.js` is plain JavaScript and never reads this
   * file, so the runtime needs neither `next` nor `typescript` — which
   * removes the reason the build stage was being kept.
   */
  output: 'standalone',
  /* This repo is a pnpm workspace nested under a home directory that also has a
     lockfile. Without this, Next picks the wrong root and traces the wrong files. */
  outputFileTracingRoot: join(import.meta.dirname, '../..'),
  transpilePackages: ['@snap/api-contract'],
  eslint: { ignoreDuringBuilds: true },
  typedRoutes: false,
  /* Several agents build against this one checkout at once. Two `next dev` (or
     dev + build) processes sharing the default `.next` directory race on the
     same webpack chunk files and corrupt each other's build — set
     `NEXT_DIST_DIR` to give your own run a private build directory instead of
     fighting over the shared default. Unset, behaviour is unchanged. */
  distDir: process.env.NEXT_DIST_DIR || '.next',
};

export default config;
