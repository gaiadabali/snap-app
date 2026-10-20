import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { PointBalance, PointLedgerEntry } from '@snap/api-contract';

import { CurrentUser, SessionGuard, type AuthUser } from '../common/auth.guard.js';
import { getPointBalance, listPointLedger } from './points.repo.js';

/**
 * The RETIRED Snap Apps points, read only — `docs/ECOSYSTEM.md` D33.
 *
 * Snap Apps no longer writes `point_ledger`: YourTal points are the only
 * points with value, and what YourTal paid for the receipts reported from this
 * account is `pointsReported` on `GET /v1/yourtal/link`. These two reads stay
 * so an app version that still asks for them keeps loading, and so the history
 * stays readable. Nothing in the current apps or website calls them. They
 * return what was earned before the retirement and never change.
 *
 * USER-scoped, not tenant-scoped, so `SessionGuard` alone: no
 * `MembershipGuard` and no `@WorkspaceId()`.
 */
@ApiTags('points')
@Controller('v1/points')
@UseGuards(SessionGuard)
export class PointsController {
  @Get()
  @ApiOperation({
    summary: 'DEPRECATED: your retired Snap Apps points balance',
    description: 'Frozen: Snap Apps stopped awarding points on 2026-10-20. YourTal points are shown from GET /v1/yourtal/link.',
  })
  async balance(@CurrentUser() user: AuthUser): Promise<PointBalance> {
    const balance = await getPointBalance(user.userId);
    return { balance };
  }

  @Get('ledger')
  @ApiOperation({
    summary: 'DEPRECATED: how your retired Snap Apps points were earned',
    description: 'History only, most recent first, capped at 200 rows. Snap Apps stopped awarding points on 2026-10-20. YourTal pays its own points for each receipt once the account is linked (GET /v1/yourtal/link).',
  })
  async ledger(
    @CurrentUser() user: AuthUser,
    @Query('limit') limitParam?: string,
  ): Promise<PointLedgerEntry[]> {
    const parsed = limitParam ? Number(limitParam) : NaN;
    const limit = Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, 200) : 50;
    const rows = await listPointLedger(user.userId, limit);
    return rows.map((r) => ({
      id: r.id,
      delta: r.delta,
      reason: r.reason,
      ref: r.ref,
      app: r.app,
      createdAt: r.created_at,
    }));
  }
}
