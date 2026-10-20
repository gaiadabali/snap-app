import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

/**
 * Web tests: pure logic in `src/lib/`, and presentational components rendered
 * to static markup (`*.test.tsx`, with `react-dom/server`, no DOM).
 *
 * Rendering to markup proves what each state SAYS from props alone. It is not
 * a stand-in for a browser: clicks, navigation, server actions and layout are
 * covered by driving the app directly (webapp-testing), not a jsdom stand-in
 * that can silently pass while the real page fails. Only components that take
 * their data as props are tested this way.
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
  // Next compiles JSX itself (`jsx: preserve` in tsconfig); under vitest it has
  // to be transformed here.
  oxc: { jsx: { runtime: 'automatic' } },
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    environment: 'node',
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      'server-only': fileURLToPath(new URL('./test/server-only-stub.ts', import.meta.url)),
    },
  },
});
