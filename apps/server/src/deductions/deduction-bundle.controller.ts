import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  HttpException,
  HttpStatus,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { FINANCIAL_YEAR_PATTERN, isFinancialYear, type DeductionBundle } from '@snap/api-contract/deduction-bundle';
import { KNOWN_FYS } from '@snap/tax-engine';

import { RateLimiter } from '../auth/rate-limit.js';
import {
  CurrentUser,
  MembershipGuard,
  SessionGuard,
  WorkspaceId,
  type AuthUser,
} from '../common/auth.guard.js';
import { requireOwnerOrAdmin } from '../common/roles.js';
import { readTenant } from '../repo.js';
import { sydneyToday } from '../summaries/summaries.controller.js';
import { buildDeductionBundle } from './deduction-bundle.js';
import { fyLabel, fyStartYear } from './deduction-totals.js';
import { deductionTotals } from './deductions.repo.js';

// Per person: a bundle is a query over a year of receipts.
const exportPerUser = new RateLimiter(20, 60_000);

/** `2025-26` -> 2025 (the year it starts), or null when it is not a financial year we hold rates for. */
/**
 * The year a person means by "this year's deductions": the newest year we hold rates for
 * that has already started (today 2025-26), not the calendar's current one.
 */
export function defaultFyStart(today: string): number {
  const starts = KNOWN_FYS.map((end) => end - 1);
  const open = starts.filter((s) => s <= fyStartYear(today));
  return open.length ? Math.max(...open) : Math.min(...starts);
}

export function parseFy(fy: string | undefined, today: string = sydneyToday()): number | null {
  if (fy === undefined) return defaultFyStart(today);
  const m = FINANCIAL_YEAR_PATTERN.exec(fy);
  if (!m || !isFinancialYear(fy)) return null;
  const start = Number(m[1]);
  // KNOWN_FYS holds END years (2026 = 2025-26).
  return KNOWN_FYS.includes(start + 1) ? start : null;
}

@ApiTags('deductions')
@Controller('v1')
@UseGuards(SessionGuard, MembershipGuard)
export class DeductionBundleController {
  @Get('deduction-bundle/year')
  @ApiOperation({ summary: 'The financial year the export covers when `fy` is left out, like 2025-26' })
  year(): { financialYear: string } {
    return { financialYear: fyLabel(defaultFyStart(sydneyToday())) };
  }

  @Get('deduction-bundle')
  @ApiOperation({
    summary: 'Deductions for one financial year, as a file for Free Tax Returns',
    description:
      'Deduction bundle v1 for the signed-in person\'s PERSONAL workspace. `fy` is `2025-26`; it defaults to the newest year we hold rates for that has started. Amounts are the work share per receipt line (private use already applied). Sent as an attachment.',
  })
  async bundle(
    @CurrentUser() user: AuthUser,
    @WorkspaceId() tenantId: string,
    @Res({ passthrough: true }) reply: { header: (k: string, v: string) => void },
    @Query('fy') fy?: string,
  ): Promise<DeductionBundle> {
    const start = parseFy(fy);
    if (start === null) {
      throw new BadRequestException('`fy` must be a financial year we support, like 2025-26.');
    }
    if (!(await exportPerUser.consume(`deduction-bundle:${user.userId}`))) {
      throw new HttpException(
        { error: 'rate_limited', message: 'Too many exports. Try again in a minute.' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const tenant = await readTenant(user.userId, tenantId);
    if (tenant?.kind !== 'personal') {
      throw new ForbiddenException('Deductions are exported from a personal workspace.');
    }
    // Handing a year of receipts to another service is an owner or manager action.
    await requireOwnerOrAdmin(user.userId, tenantId);
    const totals = await deductionTotals(user.userId, tenantId, start);
    const bundle = buildDeductionBundle(totals, {
      generatedAt: new Date(),
      occupation: tenant.occupation_profile_id,
    });
    reply.header('Cache-Control', 'private, no-store');
    reply.header(
      'Content-Disposition',
      `attachment; filename="snap-deductions-${bundle.financialYear}.json"`,
    );
    return bundle;
  }
}
