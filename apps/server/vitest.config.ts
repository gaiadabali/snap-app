import { defineConfig } from 'vitest/config';

/**
 * Server tests.
 *
 * The extraction validators are pure and run here. Anything that calls a
 * vision provider costs money and needs a network, so it lives behind
 * `scripts/extract.ts` and is run deliberately, never in the test suite.
 */
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
