import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // The drift and RLS tests talk to a real Postgres; container startup and
    // ten migrations comfortably exceed the 5s default.
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // Tests share one database, so they must not race each other.
    fileParallelism: false,
  },
});
