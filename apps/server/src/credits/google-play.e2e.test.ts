import { Client } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { AuthUser } from '@snap/api-contract';
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from 'jose';

import { closeDb } from '../db.js';
import { provisionTenant, wipeTenant } from '../test-support/tenant.js';
import { getCreditBalance, grantGooglePlayPurchase, listCreditPurchases } from './credits.repo.js';
import { GooglePlayController, GooglePlayNotificationsController } from './google-play.controller.js';
import { resetGooglePlayForTesting, setPushKeysForTesting, simulatedGooglePlay } from './google-play.js';

/**
 * Group plan 8.3.b: credits bought through Google Play, against a real
 * Postgres and the simulated Play. The assertions are on the BALANCE: the
 * failure this guards against is granting twice, or for the wrong pack, or
 * keeping credits Play has refunded.
 */

const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

const TENANT = 'de000000-0000-4000-8000-0000000083b1';
const OWNER = 'de000000-0000-4000-8000-0000000083b2';
const OTHER_TENANT = 'de000000-0000-4000-8000-0000000083b3';
const OTHER_OWNER = 'de000000-0000-4000-8000-0000000083b4';

const owner = { userId: OWNER } as AuthUser;

const AUDIENCE = 'https://snap-apps-api.test/v1/credits/webhooks/google-play';
const PUSHER = 'play-rtdn@snap-test.iam.gserviceaccount.com';
const pushKey = await generateKeyPair('RS256');
setPushKeysForTesting(createLocalJWKSet({ keys: [{ ...(await exportJWK(pushKey.publicKey)), kid: 'k1', alg: 'RS256' }] }));

/** The OIDC token Pub/Sub signs for an authenticated push subscription. */
async function pushToken(claims: Record<string, unknown> = {}, key = pushKey.privateKey): Promise<string> {
  return new SignJWT({ email: PUSHER, email_verified: true, ...claims })
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setIssuer('https://accounts.google.com')
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(key);
}

describeIfDb('Google Play purchases', () => {
  let admin: Client;
  let other: Client;
  const play = new GooglePlayController();
  const rtdn = new GooglePlayNotificationsController();

  const buy = (productId: string, ids = { accountId: TENANT, profileId: OWNER }) =>
    simulatedGooglePlay().issue(productId, ids);
  const redeem = (productId: string, purchaseToken: string) =>
    play.redeem(owner, TENANT, { productId, purchaseToken });
  const body = (note: object) => ({
    message: { data: Buffer.from(JSON.stringify({ packageName: 'au.com.snapapps.app', ...note })).toString('base64') },
  });
  const notify = async (note: object, authorization?: string) =>
    rtdn.notify({ body: body(note), headers: { authorization: authorization ?? `Bearer ${await pushToken()}` } });

  beforeAll(async () => {
    admin = await provisionTenant({
      tenantId: TENANT,
      name: 'Play billing test co',
      users: [{ id: OWNER, role: 'owner', subject: 'test|play-owner', email: 'owner@play.test' }],
    });
    other = await provisionTenant({
      tenantId: OTHER_TENANT,
      name: 'Play billing other co',
      users: [{ id: OTHER_OWNER, role: 'owner', subject: 'test|play-other', email: 'other@play.test' }],
    });
  });

  beforeEach(() => {
    process.env.GOOGLE_PLAY_SIMULATOR = 'true';
    process.env.GOOGLE_PLAY_RTDN_AUDIENCE = AUDIENCE;
    process.env.GOOGLE_PLAY_RTDN_PUSH_ACCOUNT = PUSHER;
    resetGooglePlayForTesting();
  });

  afterEach(async () => {
    delete process.env.GOOGLE_PLAY_SIMULATOR;
    delete process.env.GOOGLE_PLAY_ALLOW_TEST_PURCHASES;
    resetGooglePlayForTesting();
    for (const t of [TENANT, OTHER_TENANT]) {
      await admin.query('DELETE FROM credit_purchases WHERE tenant_id = $1', [t]);
      await admin.query('DELETE FROM usage_grants WHERE tenant_id = $1', [t]);
    }
  });

  afterAll(async () => {
    await wipeTenant(admin, TENANT, [OWNER]);
    await wipeTenant(other, OTHER_TENANT, [OTHER_OWNER]);
    await admin.end();
    await other.end();
    await closeDb();
  });

  it('grants the pack once, records provider google, and consumes the purchase', async () => {
    const before = await getCreditBalance(OWNER, TENANT);
    const token = buy('credits_50');

    const purchase = await redeem('credits_50', token);

    expect(purchase).toMatchObject({ status: 'paid', provider: 'google', credits: 50, packCode: 'credits_50' });
    expect(await getCreditBalance(OWNER, TENANT)).toBe(before + 50);
    const { rows } = await admin.query(
      'SELECT provider::text, provider_ref, payment_ref FROM credit_purchases WHERE id = $1',
      [purchase.id],
    );
    expect(rows[0]).toMatchObject({ provider: 'google', provider_ref: token });
    expect(rows[0].payment_ref).toMatch(/^GPA\.SIM-/);
    expect((await simulatedGooglePlay().getPurchase(token))?.consumed).toBe(true);
  });

  it('a duplicate token, repeated or concurrent, grants exactly once', async () => {
    const before = await getCreditBalance(OWNER, TENANT);
    const token = buy('credits_100');

    const results = await Promise.all([1, 2, 3, 4].map(() => redeem('credits_100', token)));
    const again = await redeem('credits_100', token);

    expect(new Set([...results, again].map((r) => r.id)).size).toBe(1);
    expect(await getCreditBalance(OWNER, TENANT)).toBe(before + 100);
    expect((await listCreditPurchases(OWNER, TENANT)).filter((p) => p.provider === 'google')).toHaveLength(1);
  });

  it('refuses a token redeemed as a different pack, and grants nothing', async () => {
    const before = await getCreditBalance(OWNER, TENANT);
    const token = buy('credits_50');

    await expect(redeem('credits_250', token)).rejects.toThrow(/no purchase of that pack/);
    expect(await getCreditBalance(OWNER, TENANT)).toBe(before);
  });

  it('refuses a token the simulated Play never issued', async () => {
    await expect(redeem('credits_50', 'simplay.made-up')).rejects.toThrow(/no purchase of that pack/);
  });

  it('refuses a purchase made for another workspace, and a token already added to one', async () => {
    const theirs = buy('credits_50', { accountId: OTHER_TENANT, profileId: OTHER_OWNER });
    await expect(redeem('credits_50', theirs)).rejects.toThrow(/different workspace/);

    // The unique token holds across workspaces even past the controller's check.
    const ours = buy('credits_50');
    expect(await grantGooglePlayPurchase(OTHER_OWNER, OTHER_TENANT, 'credits_50', ours, 'GPA.X')).toMatchObject({
      granted: true,
    });
    const before = await getCreditBalance(OWNER, TENANT);
    await expect(redeem('credits_50', ours)).rejects.toThrow(/another workspace/);
    expect(await getCreditBalance(OWNER, TENANT)).toBe(before);
  });

  it('a pending Play payment grants nothing yet', async () => {
    const before = await getCreditBalance(OWNER, TENANT);
    const token = simulatedGooglePlay().issue('credits_50', { accountId: TENANT, profileId: OWNER }, 'pending');
    await expect(redeem('credits_50', token)).rejects.toThrow();
    expect(await getCreditBalance(OWNER, TENANT)).toBe(before);
  });

  it('a voided purchase takes back the credits not yet spent', async () => {
    const before = await getCreditBalance(OWNER, TENANT);
    const token = buy('credits_50');
    const purchase = await redeem('credits_50', token);
    // Twenty scans spent before the refund: those stay spent.
    await admin.query(
      'UPDATE usage_grants SET remaining = remaining - 20 WHERE id = (SELECT grant_id FROM credit_purchases WHERE id = $1)',
      [purchase.id],
    );

    simulatedGooglePlay().voidPurchase(token);
    const voided = { voidedPurchaseNotification: { purchaseToken: token, orderId: 'x', productType: 2, refundType: 1 } };
    await notify(voided);
    await notify(voided); // Pub/Sub redelivers; the second takes nothing.

    expect(await getCreditBalance(OWNER, TENANT)).toBe(before);
    expect((await listCreditPurchases(OWNER, TENANT)).find((p) => p.id === purchase.id)?.status).toBe('refunded');
    // And a refunded token cannot be redeemed again.
    await expect(redeem('credits_50', token)).rejects.toThrow(/cancelled or refunded/);
  });

  it('a void notification Play does not confirm takes nothing', async () => {
    const before = await getCreditBalance(OWNER, TENANT);
    const token = buy('credits_50');
    await redeem('credits_50', token);

    await notify({ voidedPurchaseNotification: { purchaseToken: token, productType: 2, refundType: 1 } });
    await notify({ packageName: 'com.someone.else', voidedPurchaseNotification: { purchaseToken: token, productType: 2 } });
    await rtdn.notify({
      body: { message: { data: 'not base64 json' } },
      headers: { authorization: `Bearer ${await pushToken()}` },
    });

    expect(await getCreditBalance(OWNER, TENANT)).toBe(before + 50);
  });

  it("refuses a licence tester's test purchase unless this host accepts them", async () => {
    const before = await getCreditBalance(OWNER, TENANT);
    const token = simulatedGooglePlay().issue('credits_50', { accountId: TENANT, profileId: OWNER }, 'purchased', {
      test: true,
    });
    await expect(redeem('credits_50', token)).rejects.toThrow(/Test purchases are not accepted/);
    expect(await getCreditBalance(OWNER, TENANT)).toBe(before);
    // Not consumed, so Play refunds the test order.
    expect((await simulatedGooglePlay().getPurchase(token))?.consumed).toBe(false);

    process.env.GOOGLE_PLAY_ALLOW_TEST_PURCHASES = 'true';
    const purchase = await redeem('credits_50', token);
    expect(await getCreditBalance(OWNER, TENANT)).toBe(before + 50);
    const { rows } = await admin.query('SELECT payment_ref FROM credit_purchases WHERE id = $1', [purchase.id]);
    expect(rows[0].payment_ref).toMatch(/^TEST:GPA\.SIM-/);
  });

  it('refuses a purchase of more than one unit', async () => {
    const before = await getCreditBalance(OWNER, TENANT);
    const token = simulatedGooglePlay().issue('credits_50', { accountId: TENANT, profileId: OWNER }, 'purchased', {
      quantity: 3,
    });
    await expect(redeem('credits_50', token)).rejects.toThrow(/one pack at a time/);
    expect(await getCreditBalance(OWNER, TENANT)).toBe(before);
  });

  it('never grants, and never takes back, on a state Play does not name', async () => {
    const before = await getCreditBalance(OWNER, TENANT);
    const token = simulatedGooglePlay().issue('credits_50', { accountId: TENANT, profileId: OWNER }, 'unknown');
    await expect(redeem('credits_50', token)).rejects.toThrow(/could not confirm/);

    // A granted purchase whose state later reads as unknown keeps its credits; the push is retried.
    const good = buy('credits_50');
    await redeem('credits_50', good);
    Object.assign((simulatedGooglePlay() as unknown as { purchases: Map<string, { state: string }> }).purchases.get(good)!, {
      state: 'unknown',
    });
    await expect(
      notify({ voidedPurchaseNotification: { purchaseToken: good, productType: 2, refundType: 1 } }),
    ).rejects.toThrow(/unknown/i);
    expect(await getCreditBalance(OWNER, TENANT)).toBe(before + 50);
  });

  it('refuses a notification without a valid Pub/Sub token, before asking Google anything', async () => {
    const before = await getCreditBalance(OWNER, TENANT);
    const token = buy('credits_50');
    await redeem('credits_50', token);
    simulatedGooglePlay().voidPurchase(token);
    const voided = { voidedPurchaseNotification: { purchaseToken: token, productType: 2, refundType: 1 } };
    const stranger = await generateKeyPair('RS256');

    await expect(notify(voided, 'Bearer nope')).rejects.toThrow(/Not a Google Play notification/);
    await expect(rtdn.notify({ body: body(voided), headers: {} })).rejects.toThrow(/Not a Google Play notification/);
    await expect(notify(voided, `Bearer ${await pushToken({}, stranger.privateKey)}`)).rejects.toThrow(/Not a Google/);
    await expect(notify(voided, `Bearer ${await pushToken({ email: 'someone@else.test' })}`)).rejects.toThrow(
      /Not a Google/,
    );
    await expect(notify(voided, `Bearer ${await pushToken({ email_verified: false })}`)).rejects.toThrow(/Not a Google/);
    expect(await getCreditBalance(OWNER, TENANT)).toBe(before + 50);

    // Unconfigured: every push refused.
    delete process.env.GOOGLE_PLAY_RTDN_AUDIENCE;
    await expect(notify(voided)).rejects.toThrow(/Not a Google Play notification/);
    process.env.GOOGLE_PLAY_RTDN_AUDIENCE = AUDIENCE;

    await notify(voided);
    expect(await getCreditBalance(OWNER, TENANT)).toBe(before);
  });

  it('says Play is not connected when no driver is configured', async () => {
    delete process.env.GOOGLE_PLAY_SIMULATOR;
    resetGooglePlayForTesting();
    await expect(redeem('credits_50', 'anything')).rejects.toThrow(/not connected/);
  });
});
