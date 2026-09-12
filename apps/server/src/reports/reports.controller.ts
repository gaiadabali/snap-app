import { BadRequestException, Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import {
  CurrentUser,
  MembershipGuard,
  SessionGuard,
  WorkspaceId,
  type AuthUser,
} from '../common/auth.guard.js';
import { basReport, type BasReport } from './reports.repo.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Reporting surfaces derived from the ledger. Just BAS for now.
 *
 * Everything here is read-only and posted-only: `v_bas_lines` (migration
 * 0006) already filters to `status = 'posted'`, so nothing in this
 * controller can turn a draft into something a person lodges.
 */
@ApiTags('reports')
@Controller('v1/reports')
@UseGuards(SessionGuard, MembershipGuard)
export class ReportsController {
  @Get('bas')
  @ApiOperation({
    summary: 'BAS: G1, G10, G11, 1A, 1B and the unclaimable-GST figure',
    description:
      "Over POSTED transactions only — a draft is not a lodgement. Dated by the tenant's GST basis (cash/accrual) against the underlying document's issue date, never a capture or posting timestamp. `1B` excludes every split whose evidence document is not a valid tax invoice; that GST does not vanish, it shows up in `unclaimableGst`. Ships `reconciliation` as a sanity check — `1A` against `G1`, `1B` against `G10`+`G11` — each divided by 11.",
  })
  async bas(
    @CurrentUser() user: AuthUser,
    @WorkspaceId() tenantId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ): Promise<BasReport> {
    if (!from || !DATE_RE.test(from)) {
      throw new BadRequestException('from must be a YYYY-MM-DD date.');
    }
    if (!to || !DATE_RE.test(to)) {
      throw new BadRequestException('to must be a YYYY-MM-DD date.');
    }
    if (from > to) {
      throw new BadRequestException('from must not be after to.');
    }
    return basReport(user.userId, tenantId, from, to);
  }
}
