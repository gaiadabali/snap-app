import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { PointBalance, PointLedgerEntry } from '@snap/api-contract';

import { CurrentUser, SessionGuard, type AuthUser } from '../common/auth.guard.js';
import { getPointBalance, listPointLedger } from './points.repo.js';

/**
 * Points — earned by scanning, spent in a different ecosystem app entirely
 * (yourtal, unbuilt). USER-scoped, not tenant-scoped — `docs/ECOSYSTEM.md`
 * D27 — so this controller uses `SessionGuard` alone. No `MembershipGuard`
 * and no `@WorkspaceId()`: a point belongs to the person, not to whichever
 * workspace happens to be active, and gating it on workspace membership
 * would be scoping it by the wrong axis entirely.
 *
 * There is no redemption endpoint here, deliberately: redemption happens in
 * yourtal, and `point_ledger` is append-only (`app_rw` has no UPDATE or
 * DELETE grant — migration 0024), so nothing in this product writes a
 * negative entry.
 */
@ApiTags('points')
@Controller('v1/points')
@UseGuards(SessionGuard)
export class PointsController {
  @Get()
  @ApiOperation({ summary: 'Your points balance' })
  async balance(@CurrentUser() user: AuthUser): Promise<PointBalance> {
    const balance = await getPointBalance(user.userId);
    return { balance };
  }

  @Get('ledger')
  @ApiOperation({
    summary: 'How your points were earned',
    description: 'Most recent first, capped at 200 rows. Redemption is not built here — it arrives with yourtal.',
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
