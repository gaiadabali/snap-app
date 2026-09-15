import { Controller, Get, Module } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { AdminModule } from './admin/admin.module.js';
import { AuthController } from './auth/auth.controller.js';
import { CapturesController } from './captures/captures.controller.js';
import { BusinessController } from './business/business.controller.js';
import { CreditsController } from './credits/credits.controller.js';
import { PointsController } from './credits/points.controller.js';
import { DocumentsController } from './documents/documents.controller.js';
import { DownloadsController } from './export/downloads.controller.js';
import { ImagesController } from './images/images.controller.js';
import { ReportsController } from './reports/reports.controller.js';
import { SettingsController } from './settings/settings.controller.js';
import { SummariesController } from './summaries/summaries.controller.js';
import { TransactionsController } from './transactions/transactions.controller.js';
import { WorkspacesController } from './workspaces/workspaces.controller.js';
import { getDb } from './db.js';
import { MODELS } from './ai/router.js';
import { sql } from 'drizzle-orm';

/**
 * Liveness and readiness, which are different questions.
 *
 * A load balancer asks "is this process up" and a deploy asks "can it serve".
 * Answering both with one endpoint means either a database blip takes every
 * replica out of rotation, or a replica with no database keeps receiving
 * traffic. Two endpoints, two answers.
 */
@ApiTags('health')
@Controller('v1')
export class HealthController {
  @Get('health')
  @ApiOperation({ summary: 'Liveness — the process is running' })
  health(): { ok: true } {
    return { ok: true };
  }

  @Get('ready')
  @ApiOperation({ summary: 'Readiness — the database answers' })
  async ready(): Promise<{
    ok: boolean;
    database: 'up' | 'down';
    databaseRole: string;
    rlsEnforced: boolean;
    models: Array<{ id: string; capabilities: string[]; tier: number }>;
  }> {
    let database: 'up' | 'down' = 'down';
    // Whether this connection bypasses row-level security. Reported because a
    // superuser connection silently disables every tenant boundary in the
    // database, and nothing else about the system looks different when it does.
    let rlsEnforced = false;
    let role = 'unknown';
    try {
      const who = await getDb().execute<{ role: string; bypasses: boolean }>(sql`
        select current_user as role,
               (select bool_or(rolbypassrls or rolsuper) from pg_roles
                 where rolname = current_user) as bypasses
      `);
      database = 'up';
      role = who.rows[0]?.role ?? 'unknown';
      rlsEnforced = who.rows[0]?.bypasses === false;
    } catch {
      // Reported, not thrown: readiness reports state, it does not fail.
      database = 'down';
    }
    return {
      ok: database === 'up' && rlsEnforced,
      database,
      databaseRole: role,
      rlsEnforced,
      models: MODELS.map((m) => ({ id: m.id, capabilities: m.capabilities, tier: m.tier })),
    };
  }
}

@Module({
  imports: [AdminModule],
  controllers: [
    HealthController,
    AuthController,
    WorkspacesController,
    CapturesController,
    DocumentsController,
    BusinessController,
    SummariesController,
    SettingsController,
    DownloadsController,
    ImagesController,
    TransactionsController,
    ReportsController,
    CreditsController,
    PointsController,
  ],
})
export class AppModule {}
