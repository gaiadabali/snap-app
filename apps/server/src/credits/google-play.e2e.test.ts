import { Client } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { AuthUser } from '@snap/api-contract';

import { closeDb } from '../db.js';
import { provisionTenant, wipeTenant } from '../test-support/tenant.js';
import { getCreditBalance, grantGooglePlayPurchase, listCreditPurchases } from './credits.repo.js';
import { GooglePlayController, GooglePlayNotificationsController } from './google-play.controller.js';
import { resetGooglePlayForTesting, simulatedGooglePlay } from './google-play.js';

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

describeIfDb('Google Play purchases', () => {
  let admin: Client;
  let other: Client;
  const play = new GooglePlayController();
  const rtdn = new GooglePlayNotificationsController();

  const buy = (productId: string, ids = { accountId: TENANT, profileId: OWNER }) =>
    simulatedGooglePlay().issue(productId, ids);
  const redeem = (productId: string, purchaseToken: string) =>
    play.redeem(owner, TENANT, { productId, purchaseToken });
  const notify = (note: object) =>
    rtdn.notify({
      body: {
        message: {
          data: Buffer.from(JSON.stringify({ packageName: 'au.com.snapapps.app', ...note })).toString('base64'),
        },
      },
    });

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
    resetGooglePlayForTesting();
  });

  afterEach(async () => {
    delete process.env.GOOGLE_PLAY_SIMULATOR;
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
    await rtdn.notify({ body: { message: { data: 'not base64 json' } } });

    expect(await getCreditBalance(OWNER, TENANT)).toBe(before + 50);
  });

  it('says Play is not connected when no driver is configured', async () => {
    delete process.env.GOOGLE_PLAY_SIMULATOR;
    resetGooglePlayForTesting();
    await expect(redeem('credits_50', 'anything')).rejects.toThrow(/not connected/);
  });
});
