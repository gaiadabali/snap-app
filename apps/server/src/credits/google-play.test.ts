import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { decodeJwt } from 'jose';
import { afterEach, describe, expect, it } from 'vitest';

import { evaluateSimulations } from '../integrations/simulation.js';
import { GooglePlayApiDriver, googlePlayDriver, resetGooglePlayForTesting } from './google-play.js';

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const account = {
  client_email: 'play@snap-test.iam.gserviceaccount.com',
  private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
};

afterEach(() => resetGooglePlayForTesting());

describe('selecting the Google Play driver', () => {
  it('REFUSES the simulator on a production host: no driver, and boot fails', () => {
    const env = { NODE_ENV: 'production', GOOGLE_PLAY_SIMULATOR: 'true' };
    expect(googlePlayDriver(env)).toBeNull();
    expect(evaluateSimulations(env).refused.map((f) => f.id)).toEqual(['googleplay']);
  });

  it('runs the simulator only where simulation is permitted', () => {
    expect(googlePlayDriver({ NODE_ENV: 'development', GOOGLE_PLAY_SIMULATOR: 'true' })?.mode).toBe('simulated');
  });

  it('picks the real driver whenever a service-account file is set, never both', () => {
    const dir = mkdtempSync(join(tmpdir(), 'play-'));
    const file = join(dir, 'sa.json');
    writeFileSync(file, JSON.stringify(account));
    const driver = googlePlayDriver({ NODE_ENV: 'production', GOOGLE_PLAY_SIMULATOR: 'true', GOOGLE_PLAY_SERVICE_ACCOUNT_FILE: file });
    expect(driver?.mode).toBe('real');
  });

  it('is absent when nothing is configured', () => {
    expect(googlePlayDriver({ NODE_ENV: 'development' })).toBeNull();
  });
});

describe('the real Play Developer API driver', () => {
  function fakeGoogle(routes: Record<string, unknown>) {
    const calls: { url: string; method: string; auth?: string; body?: string }[] = [];
    const http = (async (url: string, init: RequestInit) => {
      const headers = (init.headers ?? {}) as Record<string, string>;
      calls.push({ url, method: init.method ?? 'GET', auth: headers.authorization, body: init.body?.toString() });
      if (url === 'https://oauth2.googleapis.com/token') {
        return Response.json({ access_token: 'ya29.test', expires_in: 3600 });
      }
      const key = Object.keys(routes).find((k) => url.includes(k));
      return key ? Response.json(routes[key]) : new Response('{}', { status: 404 });
    }) as typeof fetch;
    return { http, calls };
  }

  it('reads a purchase by token, with a service-account token, and consumes it', async () => {
    const { http, calls } = fakeGoogle({
      '/productsv2/tokens/tok1': {
        productLineItem: [{ productId: 'credits_50', productOfferDetails: { consumptionState: 'CONSUMPTION_STATE_YET_TO_BE_CONSUMED' } }],
        purchaseStateContext: { purchaseState: 'PURCHASED' },
        orderId: 'GPA.1234',
        obfuscatedExternalAccountId: 'tenant',
        obfuscatedExternalProfileId: 'user',
        purchaseCompletionTime: '2026-11-06T00:00:00Z',
      },
      ':consume': {},
    });
    const driver = new GooglePlayApiDriver(account, 'au.com.snapapps.app', http);

    expect(await driver.getPurchase('tok1')).toEqual({
      productId: 'credits_50',
      orderId: 'GPA.1234',
      state: 'purchased',
      consumed: false,
      accountId: 'tenant',
      profileId: 'user',
      purchasedAtMs: Date.parse('2026-11-06T00:00:00Z'),
    });
    await driver.consume('credits_50', 'tok1');

    // One token exchange, reused; the assertion is signed by the service account.
    const exchanges = calls.filter((c) => c.url.endsWith('/token'));
    expect(exchanges).toHaveLength(1);
    const claims = decodeJwt(new URLSearchParams(exchanges[0]!.body).get('assertion')!);
    expect(claims).toMatchObject({ iss: account.client_email, scope: 'https://www.googleapis.com/auth/androidpublisher' });
    expect(calls.at(-1)).toMatchObject({
      method: 'POST',
      url: 'https://androidpublisher.googleapis.com/androidpublisher/v3/applications/au.com.snapapps.app/purchases/products/credits_50/tokens/tok1:consume',
      auth: 'Bearer ya29.test',
    });
  });

  it('answers null for a token Play does not know', async () => {
    const driver = new GooglePlayApiDriver(account, 'au.com.snapapps.app', fakeGoogle({}).http);
    expect(await driver.getPurchase('nope')).toBeNull();
  });

  it('confirms a void through the Voided Purchases API, across pages', async () => {
    const pages: Record<string, unknown> = {
      'voidedpurchases?startTime': { voidedPurchases: [{ purchaseToken: 'other' }], tokenPagination: { nextPageToken: 'p2' } },
    };
    const { http } = fakeGoogle(pages);
    const second = (async (url: string, init: RequestInit) =>
      url.includes('token=p2') ? Response.json({ voidedPurchases: [{ purchaseToken: 'tok1' }] }) : http(url, init)) as typeof fetch;
    const driver = new GooglePlayApiDriver(account, 'au.com.snapapps.app', second);
    const purchase = {
      productId: 'credits_50', orderId: 'GPA.1', state: 'purchased' as const, consumed: true,
      accountId: null, profileId: null, purchasedAtMs: Date.now(),
    };
    expect(await driver.isVoided('tok1', purchase)).toBe(true);
    expect(await driver.isVoided('tok9', purchase)).toBe(false);
  });
});
