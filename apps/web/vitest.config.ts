import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

/**
 * Web tests: pure logic in `src/lib/`. Nothing here renders a component —
 * that needs a browser and is covered by driving the app directly
 * (webapp-testing), not a jsdom stand-in that can silently pass while the
 * real page fails.
 *
 * Two aliases, both because vitest does not apply Next's bundler-specific
 * module resolution:
 *  - `@/*` is `tsconfig.json`'s path alias for `src/*`, which only Next's own
 *    webpack/Turbopack config understands out of the box.
 *  - `server-only` is aliased to a real no-op (see test/server-only-stub.ts)
 *    because the real package unconditionally throws outside of a bundler
 *    that specifically substitutes it for server code.
 */
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      'server-only': fileURLToPath(new URL('./test/server-only-stub.ts', import.meta.url)),
    },
  },
});
