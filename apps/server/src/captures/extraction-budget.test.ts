import { randomBytes } from 'node:crypto';

import { HttpException } from '@nestjs/common';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { AuthUser } from '../common/auth.guard.js';
import { config } from '../config.js';
import { countExtractionsToday, enqueueExtraction } from '../repo.js';
import { provisionTenant, wipeTenant } from '../test-support/tenant.js';
import { CapturesController, CreateCaptureDto } from './captures.controller.js';

/**
 * The per-tenant DAILY extraction budget at intake — Task 10's second cost
 * cap (audit item 20).
 *
 * The page cap (`statements/pdf-statement-import.ts`) bounds what ONE
 * document may cost; without a tenant budget, volume was still unbounded —
 * one legal capture at a time. This suite proves the intake refusal
 * directly against the real controller and real Postgres, no HTTP harness:
 * `CapturesController` has no injected dependencies (its repo calls are
 * module-level imports), so `new CapturesController()` IS the endpoint, and
 * the suite that boots real HTTP (`statement-caps.e2e.test.ts`) already
 * covers the wiring this shares.
 *
 * The budget env var is set to 1 at module scope, BEFORE `config()`'s first
 * call in this process — the config singleton caches on first read, so the
 * test must speak before it does. That is also why these assertions live in
 * their own file: another suite in the same worker wanting the 200 default
 * would be reading a cache this file poisoned.
 */
process.env.TOKEN_SECRET ??= 'test-only-secret-at-least-32-characters-long';
process.env.EXTRACTION_DAILY_BUDGET ??= '1';

const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

const TENANT = 'd5d5d5d5-0000-4000-8000-000000000001';
const USER = 'd5d5d5d5-0000-4000-8000-000000000002';

const user: AuthUser = { userId: USER, displayName: 'Budget Test', email: 'budget@test', initials: 'BT' };

function dto(sha256?: string): CreateCaptureDto {
  const page = { sha256: sha256 ?? randomBytes(32).toString('hex'), mimeType: 'image/jpeg', byteSize: 1024 };
  const body = new CreateCaptureDto();
  body.pages = [page];
  return body;
}

describeIfDb('the daily extraction budget at intake', () => {
  let admin: Client;
  let controller: CapturesController;
  // The capture created while the budget was unspent — its bytes are what
  // the duplicate test re-declares once the budget is spent.
  let underBudgetSha: string;

  beforeAll(async () => {
    admin = await provisionTenant({
      tenantId: TENANT,
      name: 'Budget Test Co',
      users: [{ id: USER, role: 'owner' }],
    });
    controller = new CapturesController();
  });

  afterAll(async () => {
    await admin.query(`DELETE FROM jobs WHERE tenant_id = $1`, [TENANT]);
    await admin.query(`DELETE FROM capture_pages WHERE tenant_id = $1`, [TENANT]);
    await admin.query(`DELETE FROM captures WHERE tenant_id = $1`, [TENANT]);
    await wipeTenant(admin, TENANT, [USER]);
    await admin.end();
  });

  it("admits intake while today's count is under the budget", async () => {
    expect(await countExtractionsToday(USER, TENANT)).toBe(0);

    const first = dto();
    const response = await controller.create(user, TENANT, first);
    underBudgetSha = first.pages[0]!.sha256;

    expect(response.duplicate).toBe(false);
    expect(response.quotaExhausted).toBeUndefined();
  });

  it('refuses a FRESH capture with 429 once the budget is spent', async () => {
    // Spend the budget (1): one extraction job for this tenant today.
    await enqueueExtraction(USER, TENANT, (await controller.create(user, TENANT, dto())).captureId);
    expect(await countExtractionsToday(USER, TENANT)).toBe(1);

    const error = await controller.create(user, TENANT, dto()).catch((e) => e);
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(429);
    expect((error as HttpException).getResponse()).toMatchObject({ error: 'quota_exhausted' });
  });

  it('answers a DUPLICATE with quotaExhausted instead of refusing — the capture is already stored', async () => {
    // Re-declare the bytes first captured under the budget: answered as a
    // duplicate, not refused, with the contract field set.
    const again = await controller.create(user, TENANT, dto(underBudgetSha));

    expect(again.duplicate).toBe(true);
    expect(again.quotaExhausted).toBe(true);
    expect(config().EXTRACTION_DAILY_BUDGET).toBe(1); // the env var this suite runs under
  });
});
