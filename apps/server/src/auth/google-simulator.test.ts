import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * The simulated Google sign-in — a deliberate authentication bypass built for
 * exactly one purpose (an investor demo on a public host with no real Google
 * credentials yet, docs/DEPLOY.md §3) and therefore held to the standard
 * docs/DEPLOY.md §8 sets for every gate in this system: assert the REFUSAL,
 * not just the happy path, and prove it by actually calling the guarded code.
 *
 * `config()` (apps/server/src/config.ts) validates and caches its environment
 * exactly once per process, so — same discipline as
 * `sign-in-production-gate.test.ts` — every case here resets the module
 * registry and re-imports under the environment it wants, rather than
 * mutating `process.env` after some earlier case already baked in a value.
 *
 * `repo.js` and `db.js` are mocked so the "identity IS on the allow-list, and
 * a session comes back" case can run without a real Postgres connection —
 * same seam `extraction/shadow.test.ts` already uses for the same reason.
 */

const mockListDemoAccounts = vi.fn();
const mockUpsertUserByEmail = vi.fn();
const mockListWorkspacesFor = vi.fn();

vi.mock('../repo.js', () => ({
  listDemoAccounts: (...args: unknown[]) => mockListDemoAccounts(...(args as [])),
  upsertUserByEmail: (...args: unknown[]) => mockUpsertUserByEmail(...(args as [string, string])),
  listWorkspacesFor: (...args: unknown[]) => mockListWorkspacesFor(...(args as [])),
  NotAMemberError: class NotAMemberError extends Error {},
}));
vi.mock('../db.js', () => ({ getDb: () => ({ __fakeDb: true }) }));

const DEMO_IDENTITY = {
  userId: '33333333-3333-4333-8333-333333333331',
  email: 'demo.investor@example.com',
  displayName: 'Demo Investor',
};

// Captured once, restored after every test — several other test files in
// this suite share the same worker process, and NODE_ENV / GOOGLE_CLIENT_ID
// leaking out of this file would silently change what THEY see too.
const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const ORIGINAL_DEMO_ENV = process.env.DEMO_ENV;
const ORIGINAL_SIMULATOR_FLAG = process.env.GOOGLE_SIGNIN_SIMULATOR;
const ORIGINAL_GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;

afterEach(() => {
  if (ORIGINAL_NODE_ENV === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  if (ORIGINAL_DEMO_ENV === undefined) delete process.env.DEMO_ENV;
  else process.env.DEMO_ENV = ORIGINAL_DEMO_ENV;
  if (ORIGINAL_SIMULATOR_FLAG === undefined) delete process.env.GOOGLE_SIGNIN_SIMULATOR;
  else process.env.GOOGLE_SIGNIN_SIMULATOR = ORIGINAL_SIMULATOR_FLAG;
  if (ORIGINAL_GOOGLE_CLIENT_ID === undefined) delete process.env.GOOGLE_CLIENT_ID;
  else process.env.GOOGLE_CLIENT_ID = ORIGINAL_GOOGLE_CLIENT_ID;
  vi.resetModules();
});

async function withEnv<T>(
  env: {
    nodeEnv: string;
    demoEnv?: string;
    simulatorFlag?: string;
    googleClientId?: string;
  },
  body: (controller: InstanceType<typeof import('./auth.controller.js').AuthController>) => Promise<T>,
): Promise<T> {
  vi.resetModules();
  mockListDemoAccounts.mockReset();
  mockUpsertUserByEmail.mockReset();
  mockListWorkspacesFor.mockReset();

  process.env.DATABASE_URL ??= 'postgres://unused:unused@127.0.0.1:1/unused';
  process.env.TOKEN_SECRET ??= 'test-only-secret-at-least-32-characters-long';
  process.env.WEB_PUBLIC_URL ??= 'http://127.0.0.1:3000';
  process.env.NODE_ENV = env.nodeEnv;
  if (env.demoEnv === undefined) delete process.env.DEMO_ENV;
  else process.env.DEMO_ENV = env.demoEnv;
  process.env.GOOGLE_SIGNIN_SIMULATOR = env.simulatorFlag ?? 'false';
  if (env.googleClientId === undefined) delete process.env.GOOGLE_CLIENT_ID;
  else process.env.GOOGLE_CLIENT_ID = env.googleClientId;

  const mod = await import('./auth.controller.js');
  return body(new mod.AuthController());
}

describe('the demo-host gate — refused unless all three conditions hold', () => {
  it('refuses on a plain production build: no DEMO_ENV, no opt-in, no Google', async () => {
    await withEnv({ nodeEnv: 'production' }, async (controller) => {
      await expect(controller.googleSimulatorIdentities()).rejects.toMatchObject({ status: 404 });
      await expect(
        controller.googleSimulatorSignIn({ email: DEMO_IDENTITY.email }),
      ).rejects.toMatchObject({ status: 404 });
    });
    expect(mockListDemoAccounts).not.toHaveBeenCalled();
  });

  it('refuses in production with the opt-in flag but WITHOUT DEMO_ENV=staging', async () => {
    await withEnv({ nodeEnv: 'production', simulatorFlag: 'true' }, async (controller) => {
      await expect(
        controller.googleSimulatorSignIn({ email: DEMO_IDENTITY.email }),
      ).rejects.toMatchObject({ status: 404 });
    });
  });

  it('refuses in production with DEMO_ENV=staging but WITHOUT the opt-in flag', async () => {
    await withEnv({ nodeEnv: 'production', demoEnv: 'staging' }, async (controller) => {
      await expect(
        controller.googleSimulatorSignIn({ email: DEMO_IDENTITY.email }),
      ).rejects.toMatchObject({ status: 404 });
    });
  });

  it('refuses the moment real Google credentials are configured, even with both other flags set — precedence', async () => {
    await withEnv(
      {
        nodeEnv: 'production',
        demoEnv: 'staging',
        simulatorFlag: 'true',
        googleClientId: 'real-client-id.apps.googleusercontent.com',
      },
      async (controller) => {
        await expect(
          controller.googleSimulatorSignIn({ email: DEMO_IDENTITY.email }),
        ).rejects.toMatchObject({ status: 404 });
      },
    );
    expect(mockListDemoAccounts).not.toHaveBeenCalled();
  });

  it('refuses an identity NOT on the allow-list — the critical "not any email you type" case', async () => {
    await withEnv(
      { nodeEnv: 'production', demoEnv: 'staging', simulatorFlag: 'true' },
      async (controller) => {
        mockListDemoAccounts.mockResolvedValue([DEMO_IDENTITY]);
        await expect(
          controller.googleSimulatorSignIn({ email: 'attacker-chosen@example.com' }),
        ).rejects.toMatchObject({ status: 404 });
      },
    );
    expect(mockUpsertUserByEmail).not.toHaveBeenCalled();
  });

  it('works on the demo host — production build, DEMO_ENV=staging, opted in, no Google — and matches the allow-list case-insensitively', async () => {
    await withEnv(
      { nodeEnv: 'production', demoEnv: 'staging', simulatorFlag: 'true' },
      async (controller) => {
        mockListDemoAccounts.mockResolvedValue([DEMO_IDENTITY]);
        mockUpsertUserByEmail.mockResolvedValue({
          userId: DEMO_IDENTITY.userId,
          email: DEMO_IDENTITY.email,
          displayName: DEMO_IDENTITY.displayName,
          initials: 'DI',
        });
        mockListWorkspacesFor.mockResolvedValue([
          { id: 'ws-1', name: 'Demo Co', kind: 'business', role: 'owner' },
        ]);

        const result = await controller.googleSimulatorSignIn({
          email: DEMO_IDENTITY.email.toUpperCase(),
        });

        expect(mockUpsertUserByEmail).toHaveBeenCalledWith(
          DEMO_IDENTITY.email,
          DEMO_IDENTITY.displayName,
        );
        expect(result).toEqual({
          token: expect.any(String),
          user: {
            userId: DEMO_IDENTITY.userId,
            email: DEMO_IDENTITY.email,
            displayName: DEMO_IDENTITY.displayName,
            initials: 'DI',
          },
          workspaces: [{ id: 'ws-1', name: 'Demo Co', kind: 'business', role: 'owner' }],
        });
      },
    );
  });

  it('is available outside production with just the opt-in — DEMO_ENV is only required in production', async () => {
    await withEnv({ nodeEnv: 'development', simulatorFlag: 'true' }, async (controller) => {
      mockListDemoAccounts.mockResolvedValue([DEMO_IDENTITY]);
      await expect(controller.googleSimulatorIdentities()).resolves.toEqual([DEMO_IDENTITY]);
    });
  });
});

describe('the simulated sign-in produces the same session shape as the real ones', () => {
  it('matches the {token, user, workspaces} shape POST /v1/auth/oauth/google and POST /v1/auth/sign-in return', async () => {
    await withEnv(
      { nodeEnv: 'development', simulatorFlag: 'true' },
      async (controller) => {
        mockListDemoAccounts.mockResolvedValue([DEMO_IDENTITY]);
        mockUpsertUserByEmail.mockResolvedValue({
          userId: DEMO_IDENTITY.userId,
          email: DEMO_IDENTITY.email,
          displayName: DEMO_IDENTITY.displayName,
          initials: 'DI',
        });
        mockListWorkspacesFor.mockResolvedValue([]);

        const result = await controller.googleSimulatorSignIn({ email: DEMO_IDENTITY.email });
        expect(Object.keys(result).sort()).toEqual(['token', 'user', 'workspaces']);
        expect(Object.keys(result.user).sort()).toEqual([
          'displayName',
          'email',
          'initials',
          'userId',
        ]);
      },
    );
  });
});
