import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeDb } from '../db.js';
import { provisionTenant, wipeTenant } from '../test-support/tenant.js';
import { SettingsController } from './settings.controller.js';

/**
 * Settings writes that change what a workspace is or how it files receipts
 * (business, occupation, categories) are an owner or manager action, and a
 * personal workspace is never offered the sole trader. Real Postgres, as the
 * application role.
 */
process.env.TOKEN_SECRET ??= 'test-only-secret-at-least-32-characters-long';
const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

const BIZ = 'd0d0d0d0-0000-4000-8000-0000000000f1';
const PERSONAL = 'd0d0d0d0-0000-4000-8000-0000000000f2';
const OWNER = 'd0d0d0d0-0000-4000-8000-0000000000f3';
const READONLY = 'd0d0d0d0-0000-4000-8000-0000000000f4';
const P_OWNER = 'd0d0d0d0-0000-4000-8000-0000000000f5';

const u = (userId: string) => ({ userId, email: `${userId}@t.test`, displayName: 'T', initials: 'T', emailVerified: true });

describeIfDb('settings: roles and the personal workspace', () => {
  let admin: Client;
  let adminP: Client;
  const c = new SettingsController();

  beforeAll(async () => {
    admin = await provisionTenant({
      tenantId: BIZ,
      name: 'Settings roles co',
      users: [
        { id: OWNER, role: 'owner', subject: 'test|sr-owner', email: 'sr-o@t.test' },
        { id: READONLY, role: 'readonly', subject: 'test|sr-ro', email: 'sr-r@t.test' },
      ],
    });
    adminP = await provisionTenant({ tenantId: PERSONAL, name: 'Household', users: [{ id: P_OWNER, role: 'owner', subject: 'test|sr-p', email: 'sr-p@t.test' }] });
    await adminP.query(`update tenants set kind = 'personal', abn = null, gst_registered = false where id = $1`, [PERSONAL]);
  });

  afterAll(async () => {
    await wipeTenant(admin, BIZ, [OWNER, READONLY]);
    await wipeTenant(adminP, PERSONAL, [P_OWNER]);
    await admin.end();
    await adminP.end();
    await closeDb();
  });

  it('refuses a read-only member on every occupation and category write (403)', async () => {
    const ro = u(READONLY);
    const writes = [
      () => c.updateBusiness(ro, BIZ, { occupationProfileId: null } as never),
      () => c.addCategory(ro, BIZ, { name: 'Nope' } as never),
      () => c.toggleCategory(ro, BIZ, 'Nope', { active: false, privateUsePercent: 10 } as never),
      () => c.removeCategory(ro, BIZ, 'Nope'),
    ];
    for (const w of writes) await expect(w()).rejects.toMatchObject({ status: 403 });
  });

  it('lets the owner do them', async () => {
    const o = u(OWNER);
    await c.updateBusiness(o, BIZ, { name: 'Renamed co' } as never);
    const added = await c.addCategory(o, BIZ, { name: 'Owner made', privateUsePercent: 20 } as never);
    expect(added.find((x) => x.name === 'Owner made')?.privateUsePercent).toBe(20);
    const toggled = await c.toggleCategory(o, BIZ, 'Owner made', { active: false } as never);
    expect(toggled.find((x) => x.name === 'Owner made')?.active).toBe(false);
    const removed = await c.removeCategory(o, BIZ, 'Owner made');
    expect(removed.some((x) => x.name === 'Owner made')).toBe(false);
  });

  it('a personal workspace refuses the sole trader occupation and does not list it', async () => {
    const o = u(P_OWNER);
    await expect(c.updateBusiness(o, PERSONAL, { occupationProfileId: 'sole' } as never)).rejects.toMatchObject({
      status: 400,
    });
    const groups = await c.occupations(o, PERSONAL);
    expect(groups.flatMap((g) => g.profiles.map((p) => p.id))).not.toContain('sole');
    const bizGroups = await c.occupations(u(OWNER), BIZ);
    expect(bizGroups.flatMap((g) => g.profiles.map((p) => p.id))).toContain('sole');
  });
});
