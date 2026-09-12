import { BadRequestException, Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AdminAuditLogEntry } from '@snap/api-contract';

import { CurrentUser, SessionGuard, type AuthUser } from '../common/auth.guard.js';
import * as adminRepo from './admin.repo.js';
import { CapabilityGuard, RequireCapability, StaffGuard } from './guards/staff.guard.js';

function clampLimit(raw: string | undefined): number {
  const n = Number(raw ?? 50);
  return Number.isFinite(n) ? Math.min(Math.max(Math.trunc(n), 1), 200) : 50;
}
function clampOffset(raw: string | undefined): number {
  const n = Number(raw ?? 0);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
}

/** `YYYY-MM-DDTHH:MM...` or a bare date — anything `Date.parse` reads. Refused rather than silently ignored, so a typo'd filter cannot look like "no filter" instead of an error. */
function parseTimestamp(raw: string | undefined, field: string): string | undefined {
  if (raw === undefined || raw === '') return undefined;
  if (Number.isNaN(Date.parse(raw))) {
    throw new BadRequestException(`\`${field}\` is not a readable timestamp: "${raw}".`);
  }
  return raw;
}

/**
 * The audit trail read — the one gap this migration closes that has no
 * existing controller to extend. `audit_log` is append-only (0007/0010's own
 * discipline); this controller has exactly one route, and it is a GET.
 *
 * Gated on `audit_review`, a capability distinct from `view_tenant_metadata`
 * — see `packages/db/migrations/0023_admin_audit_and_gaps.sql`'s header for
 * why reviewing who accessed whose records is not folded into the ability to
 * simply look someone up.
 */
@ApiTags('admin')
@Controller('v1/admin/audit-log')
@UseGuards(SessionGuard, StaffGuard, CapabilityGuard)
@RequireCapability('audit_review')
export class AdminAuditController {
  @Get()
  @ApiOperation({
    summary: "The platform's audit trail — impersonation, tenant/user metadata views, AI key changes",
    description:
      'Filterable by actor, tenant, action, and time range. Reading this log is itself an audited ' +
      'event (see `admin_audit_log_search`). `audit_log` is append-only: there is no write route here.',
  })
  async search(
    @CurrentUser() user: AuthUser,
    @Query('actorId') actorId?: string,
    @Query('tenantId') tenantId?: string,
    @Query('action') action?: string,
    @Query('since') since?: string,
    @Query('until') until?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ): Promise<AdminAuditLogEntry[]> {
    return adminRepo.searchAuditLog(user.userId, {
      actorId: actorId || null,
      tenantId: tenantId || null,
      action: action || null,
      since: parseTimestamp(since, 'since') ?? null,
      until: parseTimestamp(until, 'until') ?? null,
      limit: clampLimit(limit),
      offset: clampOffset(offset),
    });
  }
}
