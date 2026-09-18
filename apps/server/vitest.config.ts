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
    // Refuses to run when CI asks for a database and there is none — a
    // skipped suite reads as a green run. See the setup file.
    globalSetup: ['../../packages/db/test/require-db.setup.ts'],
    include: ['src/**/*.test.ts'],
    // The 5s default is wrong for what this suite actually does, and it has
    // been passing on luck. These are real-HTTP, real-Postgres tests: the T7
    // cap test builds a 120-page PDF and uploads it, the e2e suites provision
    // tenants and run extraction. `statement-caps.e2e.test.ts` timed out at
    // 5000ms on a loaded machine with no code change behind it — the classic
    // shape of a test that fails in CI and not on the desk.
    //
    // `packages/db` already set 30s for the same reason ("container startup
    // and ten migrations comfortably exceed the 5s default"); this matches it
    // rather than inventing a second number.
    testTimeout: 30_000,
    hookTimeout: 60_000,
    environment: 'node',
    /**
     * One file at a time, in one thread.
     *
     * Several suites here must assert PRODUCTION behaviour — the sign-in gate,
     * the KMS refusal — and the only way to ask for that is to set
     * `process.env.NODE_ENV`, which is global to the process. Run in parallel,
     * one file flips it to 'production' while another is midway through a
     * request expecting development, and a test fails roughly one run in five
     * with no relation to the code under test.
     *
     * A flaky suite is worse than a slow one: it trains people to re-run until
     * green, which is how a real failure gets waved through. Determinism is
     * bought here with about thirty seconds.
     *
     * If this ever becomes the bottleneck, the fix is not to re-enable
     * parallelism — it is to stop mutating global env in tests, by injecting
     * the environment the way `preflight.ts` already does (it takes settings as
     * a parameter, so its tests need none of this).
     */
    fileParallelism: false,
    poolOptions: { threads: { singleThread: true } },
  },
});
