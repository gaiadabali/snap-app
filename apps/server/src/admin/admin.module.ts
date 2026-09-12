import { Module } from '@nestjs/common';

import { AdminAiController } from './ai.controller.js';
import { AdminAnalyticsController } from './analytics.controller.js';
import { AdminBillingController } from './billing.controller.js';
import { AdminImpersonationController } from './impersonation.controller.js';
import { AdminOperationsController } from './operations.controller.js';
import { AdminSettingsController } from './settings.controller.js';
import { AdminStaffController } from './staff.controller.js';
import { AdminTenantsController } from './tenants.controller.js';

/**
 * The platform admin plane — `docs/WEB.md` §6.
 *
 * Every controller here connects to Postgres as the SAME `app_rw` role every
 * other route uses (never `BYPASSRLS`); the cross-tenant access is entirely
 * inside the SECURITY DEFINER functions of `packages/db/migrations/
 * 0021_admin_plane.sql`, granted to `app_rw` by name. See that migration's
 * header for the whole design, and `packages/db/test/admin_plane.test.ts`
 * for the negative proof.
 */
@Module({
  controllers: [
    AdminAnalyticsController,
    AdminTenantsController,
    AdminImpersonationController,
    AdminBillingController,
    AdminSettingsController,
    AdminAiController,
    AdminOperationsController,
    AdminStaffController,
  ],
})
export class AdminModule {}
