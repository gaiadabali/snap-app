import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Refuses to run when CI asks for a database and there is none — a
    // skipped suite reads as a green run. See the setup file.
    // Two guards, deliberately separate. The first is shared with
    // `apps/server`; the second is this package's alone, because these suites
    // are the schema owner's and `apps/server`'s must stay unprivileged.
    globalSetup: ['./test/require-db.setup.ts', './test/require-owner-role.setup.ts'],
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
