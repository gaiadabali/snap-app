import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The worker refuses to start without an identity.
 *
 * WHY THIS TEST EXISTS, and it is not hypothetical. `worker.ts` read
 * `process.env.WORKER_USER_ID ?? ''`. The variable was absent from
 * `deploy/.env`, so the worker booted, logged `worker up`, claimed every job
 * and failed every one with `withTenantAs: not a uuid: ""` — an error that
 * names a database helper three layers below a missing line of configuration.
 *
 * Captures piled up at `received` from 2026-09-16 to 2026-09-18 and the
 * `documents` table stayed EMPTY. Every container was healthy, every deploy
 * verified, CI was green. From the phone it looked like a slow server. It was
 * found because somebody scanned a receipt and said the app was stuck.
 *
 * So the empty-string default is gone, and this holds the line: a missing
 * identity fails at boot, naming the variable, instead of becoming a per-job
 * runtime error that reads like somebody's bug.
 *
 * The module is imported dynamically per case because the check runs at module
 * scope — which is the point. Importing it IS booting it.
 */
describe('worker identity', () => {
  const saved = process.env.WORKER_USER_ID;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    if (saved === undefined) delete process.env.WORKER_USER_ID;
    else process.env.WORKER_USER_ID = saved;
    vi.resetModules();
  });

  it('refuses to load with no WORKER_USER_ID, and says which variable', async () => {
    delete process.env.WORKER_USER_ID;
    await expect(import('./worker.js')).rejects.toThrow(/WORKER_USER_ID is not set/);
  });

  it('refuses an empty or whitespace value — the exact shape of the outage', async () => {
    // `?? ''` only guarded against undefined. An empty or blank value in
    // deploy/.env would have sailed through and failed identically per job.
    for (const bad of ['', '   ']) {
      vi.resetModules();
      process.env.WORKER_USER_ID = bad;
      await expect(import('./worker.js')).rejects.toThrow(/WORKER_USER_ID is not set/);
    }
  });

  it('refuses a non-uuid before any job runs, not inside a transaction', async () => {
    process.env.WORKER_USER_ID = 'worker@snapapps.internal';
    await expect(import('./worker.js')).rejects.toThrow(/not a uuid/);
  });

  it('loads with the real service user id', async () => {
    process.env.WORKER_USER_ID = '44444444-4444-4444-8444-444444444444';
    await expect(import('./worker.js')).resolves.toBeDefined();
  });
});
