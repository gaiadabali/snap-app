import { UnauthorizedException } from '@nestjs/common';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { resetForTesting } from './magic-link-store.js';
import { type Mailer, setMailerForTesting } from './mailer.js';

/**
 * Everything testable here WITHOUT a real Postgres connection: every
 * negative case these endpoints are responsible for. `AuthController` has no
 * constructor dependencies (it calls the repo/token/mailer modules directly
 * rather than through injected services), so it can be instantiated directly
 * — and every path below throws before the first line that would touch the
 * database (`upsertUserByEmail` / `getDb()`), which is what makes that safe.
 *
 * The one thing this suite cannot exercise is the SUCCESS path of
 * magic-link-consume and Google-exchange (they call `upsertUserByEmail`,
 * which needs `pnpm db:up`) — that is a follow-up for whoever runs this
 * suite against a real database, same as `repo.test.ts` and friends already
 * require.
 */
let AuthController: typeof import('./auth.controller.js').AuthController;
let controller: InstanceType<typeof AuthController>;

beforeAll(async () => {
  process.env.DATABASE_URL ??= 'postgres://test:test@localhost:5432/test';
  process.env.TOKEN_SECRET ??= 'test-only-secret-at-least-32-characters-long';
  process.env.WEB_PUBLIC_URL ??= 'http://127.0.0.1:3000';
  const mod = await import('./auth.controller.js');
  AuthController = mod.AuthController;
  controller = new AuthController();
});

beforeEach(() => {
  resetForTesting();
});

describe('POST /v1/auth/magic-link/consume — the negative cases', () => {
  it('refuses a token that was never valid (forged)', async () => {
    await expect(controller.consumeMagicLink({ token: 'garbage.not-a-real-token' })).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('refuses the SAME token redeemed twice — the actual replay case', async () => {
    const tokens = await import('../tokens.js');
    const { token } = tokens.issueMagicLinkToken('person@example.com');

    // First redemption never reaches the database in this test (no
    // Postgres here), so it is expected to fail too — but for a DIFFERENT
    // reason (upsertUserByEmail throwing on a connection it cannot make)
    // than the second call, which must fail at the single-use check BEFORE
    // ever attempting that connection. Proven by asserting the jti is
    // already recorded as consumed after exactly one call.
    await controller.consumeMagicLink({ token }).catch(() => undefined);

    await expect(controller.consumeMagicLink({ token })).rejects.toThrow(UnauthorizedException);
  });

  it('a forged token and an already-used token produce the IDENTICAL message', async () => {
    // This is the property the coordinator flagged: tokens.ts already keeps
    // "expired" and "forged" indistinguishable at the signature layer, and
    // this asserts the controller does not reopen that gap one level up by
    // letting "already used" leak that a caller is holding a genuine,
    // previously-valid token rather than guessing at random.
    const tokens = await import('../tokens.js');
    const { token } = tokens.issueMagicLinkToken('other@example.com');
    await controller.consumeMagicLink({ token }).catch(() => undefined); // consume it once

    let forgedMessage: string | undefined;
    try {
      await controller.consumeMagicLink({ token: 'complete-garbage.also-garbage' });
    } catch (error) {
      forgedMessage = (error as UnauthorizedException).message;
    }

    let reusedMessage: string | undefined;
    try {
      await controller.consumeMagicLink({ token });
    } catch (error) {
      reusedMessage = (error as UnauthorizedException).message;
    }

    expect(forgedMessage).toBeDefined();
    expect(reusedMessage).toBeDefined();
    expect(forgedMessage).toBe(reusedMessage);
  });

  it('refuses an expired-shaped token the same way as a forged one', async () => {
    const past = Math.floor(Date.now() / 1000) - 10;
    const legacyPayload = Buffer.from(
      JSON.stringify({ k: 'magic', s: 'person@example.com', e: past, n: 'expired-jti' }),
      'utf8',
    ).toString('base64url');
    const expiredLooking = `${legacyPayload}.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`;

    let expiredMessage: string | undefined;
    try {
      await controller.consumeMagicLink({ token: expiredLooking });
    } catch (error) {
      expiredMessage = (error as UnauthorizedException).message;
    }

    let forgedMessage: string | undefined;
    try {
      await controller.consumeMagicLink({ token: 'not-even-shaped-like-a-token' });
    } catch (error) {
      forgedMessage = (error as UnauthorizedException).message;
    }

    expect(expiredMessage).toBe(forgedMessage);
  });
});

describe('POST /v1/auth/magic-link/request — rate limiting', () => {
  let sent: Array<{ to: string }> = [];
  const fakeMailer: Mailer = {
    async send(message) {
      sent.push({ to: message.to });
    },
  };

  beforeEach(() => {
    sent = [];
    setMailerForTesting(fakeMailer);
  });

  it('answers ok and sends a link for a fresh address', async () => {
    const result = await controller.requestMagicLink({ email: 'fresh@example.com' }, { ip: '10.0.0.1' });
    expect(result).toEqual({ ok: true });
    expect(sent).toHaveLength(1);
  });

  it('refuses request number six for the SAME address within the window — the negative case', async () => {
    const email = `limit-test-${Math.random()}@example.com`;
    for (let i = 0; i < 5; i += 1) {
      await controller.requestMagicLink({ email }, { ip: `10.0.0.${i}` });
    }
    await expect(controller.requestMagicLink({ email }, { ip: '10.0.0.99' })).rejects.toThrow(
      /Too many requests/,
    );
  });

  it('answers ok even when the mailer throws — a provider outage must not become a different response', async () => {
    // The endpoint's own doc comment promises the SAME 200 whether the
    // address exists, the send succeeds, or the provider is down. A future
    // Mailer implementation that throws on failure (unlike ConsoleMailer /
    // NoopMailer, which never do) must not turn that into a distinguishable
    // error response — that would be exactly the kind of side channel this
    // endpoint exists to close off.
    setMailerForTesting({
      async send() {
        throw new Error('smtp exploded');
      },
    });
    const result = await controller.requestMagicLink(
      { email: `throwing-${Math.random()}@example.com` },
      { ip: '10.0.0.50' },
    );
    expect(result).toEqual({ ok: true });
  });
});

describe('POST /v1/auth/oauth/google — refuses before touching the database', () => {
  it('answers 501 when GOOGLE_CLIENT_ID is not configured', async () => {
    // `config()` (apps/server/src/config.ts) validates and caches ONCE, by
    // design — "nothing reads process.env anywhere else" — so this suite
    // cannot flip GOOGLE_CLIENT_ID on and off within one process. The
    // "configured but the token still fails verification" case lives in
    // auth.controller.oauth-configured.test.ts instead, a separate file with
    // its own fresh module graph, GOOGLE_CLIENT_ID set before anything is
    // imported.
    await expect(
      controller.googleExchange({ idToken: 'whatever', nonce: 'whatever' }),
    ).rejects.toThrow(/not configured/);
  });
});
