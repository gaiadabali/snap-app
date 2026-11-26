import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { exportPKCS8, generateKeyPair, jwtVerify } from 'jose';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  FcmHttpV1Sender,
  fcmSender,
  loadFcmServiceAccount,
  resetFcmForTesting,
  SimulatedFcm,
  simulatedFcm,
  type FcmMessage,
  type ServiceAccount,
} from './fcm.js';

/**
 * The FCM sender (Spambank BUILD.md B9, §4.9), against a fake `fetch`: no
 * Firebase project and no key from Google is needed. Covers the OAuth exchange
 * (a signed JWT for a service account), the HTTP v1 request shape, every answer
 * FCM gives that the caller has to act on, and the config gate that keeps the
 * whole thing inert until credentials exist.
 */

const TOKEN_URI = 'https://oauth.test/token';
const message: FcmMessage = {
  token: 'phone-token-0123456789abcdef',
  title: 'Spambank',
  body: 'You have 3 new emails',
  data: { type: 'spambank-mail' },
  channelId: 'mail',
};

let account: ServiceAccount;
let publicKey: Awaited<ReturnType<typeof generateKeyPair>>['publicKey'];

beforeAll(async () => {
  const keys = await generateKeyPair('RS256', { extractable: true });
  publicKey = keys.publicKey;
  account = {
    client_email: 'fcm-sender@snap-test.iam.gserviceaccount.com',
    private_key: await exportPKCS8(keys.privateKey),
    token_uri: TOKEN_URI,
  };
});

type Call = { url: string; init: RequestInit };

/** A fetch that answers the token exchange itself and hands every send to `answer`. */
function fakeFcm(answer: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  let exchanges = 0;
  const http = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({ url, init });
    if (url === TOKEN_URI) {
      exchanges += 1;
      return new Response(JSON.stringify({ access_token: `access-${exchanges}`, expires_in: 3600 }), { status: 200 });
    }
    return answer({ url, init });
  }) as typeof fetch;
  return { http, calls, exchanges: () => exchanges };
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

describe('FcmHttpV1Sender', () => {
  it('exchanges a signed service-account JWT, then posts the message the way FCM HTTP v1 wants it', async () => {
    const fake = fakeFcm(() => json(200, { name: 'projects/snap-test/messages/1' }));
    const sender = new FcmHttpV1Sender(account, 'snap-test', fake.http);

    expect(await sender.send(message)).toEqual({ state: 'sent' });

    const [exchange, send] = fake.calls;
    const assertion = new URLSearchParams(String(exchange!.init.body));
    expect(assertion.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer');
    const { payload } = await jwtVerify(assertion.get('assertion')!, publicKey, {
      issuer: account.client_email,
      audience: TOKEN_URI,
    });
    expect(payload.scope).toBe('https://www.googleapis.com/auth/firebase.messaging');

    expect(send!.url).toBe('https://fcm.googleapis.com/v1/projects/snap-test/messages:send');
    expect((send!.init.headers as Record<string, string>).authorization).toBe('Bearer access-1');
    expect(JSON.parse(String(send!.init.body))).toEqual({
      message: {
        token: message.token,
        notification: { title: 'Spambank', body: 'You have 3 new emails' },
        data: { type: 'spambank-mail' },
        android: { priority: 'HIGH', notification: { channel_id: 'mail' } },
      },
    });
  });

  it('reuses the access token between sends', async () => {
    const fake = fakeFcm(() => json(200, {}));
    const sender = new FcmHttpV1Sender(account, 'snap-test', fake.http);
    await sender.send(message);
    await sender.send(message);
    expect(fake.exchanges()).toBe(1);
  });

  it('reports a dead token as unregistered, by HTTP status or by FCM error code', async () => {
    const notFound = fakeFcm(() => json(404, { error: { code: 404, status: 'NOT_FOUND', details: [{ errorCode: 'UNREGISTERED' }] } }));
    expect(await new FcmHttpV1Sender(account, 'snap-test', notFound.http).send(message)).toEqual({ state: 'unregistered' });

    // FCM answers a malformed-but-once-valid token with 400 and the detail code.
    const detail = fakeFcm(() => json(400, { error: { status: 'INVALID_ARGUMENT', details: [{ errorCode: 'UNREGISTERED' }] } }));
    expect(await new FcmHttpV1Sender(account, 'snap-test', detail.http).send(message)).toEqual({ state: 'unregistered' });
  });

  it('retries a 429 or a 503, and drops a cached credential after a 401 or 403', async () => {
    for (const status of [429, 500, 503]) {
      const fake = fakeFcm(() => json(status, { error: { status: 'UNAVAILABLE' } }));
      expect(await new FcmHttpV1Sender(account, 'snap-test', fake.http).send(message)).toMatchObject({
        state: 'failed',
        retryable: true,
        status,
      });
    }

    let first = true;
    const fake = fakeFcm(() => {
      if (first) {
        first = false;
        return json(401, { error: { status: 'UNAUTHENTICATED' } });
      }
      return json(200, {});
    });
    const sender = new FcmHttpV1Sender(account, 'snap-test', fake.http);
    expect(await sender.send(message)).toMatchObject({ state: 'failed', retryable: true, status: 401, code: 'UNAUTHENTICATED' });
    expect(await sender.send(message)).toEqual({ state: 'sent' });
    // The 401 dropped the token, so the second send exchanged again.
    expect(fake.exchanges()).toBe(2);
  });

  it('does not retry a 400 that is not a dead token, and never calls it unregistered', async () => {
    const fake = fakeFcm(() => json(400, { error: { status: 'INVALID_ARGUMENT', message: 'bad payload' } }));
    expect(await new FcmHttpV1Sender(account, 'snap-test', fake.http).send(message)).toEqual({
      state: 'failed',
      retryable: false,
      status: 400,
      code: 'INVALID_ARGUMENT',
    });
  });

  it('treats a network failure or a failed token exchange as retryable, without throwing', async () => {
    const down = (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    expect(await new FcmHttpV1Sender(account, 'snap-test', down).send(message)).toEqual({
      state: 'failed',
      retryable: true,
      status: null,
      code: null,
    });

    const refused = (async () => new Response('{}', { status: 400 })) as unknown as typeof fetch;
    expect(await new FcmHttpV1Sender(account, 'snap-test', refused).send(message)).toMatchObject({ state: 'failed', retryable: true });
  });

  it('puts no token or message text in what it throws or returns', async () => {
    const fake = fakeFcm(() => json(500, { error: { status: 'INTERNAL', message: message.token } }));
    const result = await new FcmHttpV1Sender(account, 'snap-test', fake.http).send(message);
    expect(JSON.stringify(result)).not.toContain(message.token);
  });
});

describe('SimulatedFcm', () => {
  it('records what it is asked to send and delivers it', async () => {
    const fcm = new SimulatedFcm();
    expect(await fcm.send(message)).toEqual({ state: 'sent' });
    expect(fcm.sent).toEqual([message]);
  });

  it('answers unregistered for a token marked dead, and fails the next N sends on request', async () => {
    const fcm = new SimulatedFcm();
    fcm.killToken(message.token);
    expect(await fcm.send(message)).toEqual({ state: 'unregistered' });

    fcm.failNext(2);
    expect(await fcm.send({ ...message, token: 'other-token-0123456789abcd' })).toMatchObject({ state: 'failed', retryable: true });
    fcm.failNext(1, false);
    expect(await fcm.send({ ...message, token: 'other-token-0123456789abcd' })).toMatchObject({ state: 'failed', retryable: false });
  });
});

describe('fcmSender: inert until configured', () => {
  let dir: string;

  beforeEach(() => {
    resetFcmForTesting();
    dir = mkdtempSync(join(tmpdir(), 'fcm-test-'));
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(dir, { recursive: true, force: true });
  });

  const keyFile = () => {
    const path = join(dir, 'fcm-service-account.json');
    writeFileSync(path, JSON.stringify(account));
    return path;
  };

  it('is off with nothing set, and when only the project id is set', () => {
    expect(fcmSender({})).toBeNull();
    expect(fcmSender({ FCM_PROJECT_ID: 'snap-test' })).toBeNull();
    // Not simulated by lacking credentials, or by DEMO_ENV alone.
    expect(fcmSender({ DEMO_ENV: 'staging' })).toBeNull();
  });

  it('is the real sender only with BOTH the key file and the project id, and says so when half-configured', () => {
    const path = keyFile();
    expect(fcmSender({ FCM_SERVICE_ACCOUNT_FILE: path })).toBeNull();
    expect(console.warn).toHaveBeenCalledTimes(1);

    const sender = fcmSender({ FCM_SERVICE_ACCOUNT_FILE: path, FCM_PROJECT_ID: 'snap-test' });
    expect(sender?.mode).toBe('real');
    // Cached: the same sender, so its access token is reused.
    expect(fcmSender({ FCM_SERVICE_ACCOUNT_FILE: path, FCM_PROJECT_ID: 'snap-test' })).toBe(sender);
  });

  it('stays off for an unreadable or wrong key file, without throwing', () => {
    expect(fcmSender({ FCM_SERVICE_ACCOUNT_FILE: join(dir, 'missing.json'), FCM_PROJECT_ID: 'snap-test' })).toBeNull();
    const notAKey = join(dir, 'not-a-key.json');
    writeFileSync(notAKey, JSON.stringify({ hello: 'world' }));
    expect(loadFcmServiceAccount(notAKey)).toBeNull();
    expect(fcmSender({ FCM_SERVICE_ACCOUNT_FILE: notAKey, FCM_PROJECT_ID: 'snap-test' })).toBeNull();
  });

  it('is the simulator only on FCM_SIMULATOR=true outside production, and real credentials win', () => {
    const sim = fcmSender({ NODE_ENV: 'development', FCM_SIMULATOR: 'true' });
    expect(sim?.mode).toBe('simulated');
    expect(sim).toBe(simulatedFcm());
    // A production host asking for the simulator gets nothing (preflight also refuses to boot).
    expect(fcmSender({ NODE_ENV: 'production', FCM_SIMULATOR: 'true' })).toBeNull();
    // The demo host may.
    expect(fcmSender({ NODE_ENV: 'production', DEMO_ENV: 'staging', FCM_SIMULATOR: 'true' })?.mode).toBe('simulated');
    // The flag is exact-match.
    expect(fcmSender({ NODE_ENV: 'development', FCM_SIMULATOR: '1' })).toBeNull();

    const path = keyFile();
    expect(
      fcmSender({ NODE_ENV: 'development', FCM_SIMULATOR: 'true', FCM_SERVICE_ACCOUNT_FILE: path, FCM_PROJECT_ID: 'snap-test' })?.mode,
    ).toBe('real');
  });
});
