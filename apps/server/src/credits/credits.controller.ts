import {
  ConflictException,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type {
  CreditBalance,
  CreditPack,
  CreditPurchase,
  StartCreditPurchaseRequest,
} from '@snap/api-contract';
import { IsString } from 'class-validator';

import {
  CurrentUser,
  MembershipGuard,
  SessionGuard,
  WorkspaceId,
  type AuthUser,
} from '../common/auth.guard.js';
import { ValidBody } from '../common/valid-body.decorator.js';
import { listMembers } from '../repo.js';
import {
  CreditPurchaseNotPendingError,
  fulfilCreditPurchase,
  getCreditBalance,
  listCreditPacks,
  listCreditPurchases,
  startCreditPurchase,
  type CreditPurchaseRow,
} from './credits.repo.js';

export class StartCreditPurchaseDto implements StartCreditPurchaseRequest {
  @IsString() packCode!: string;
}

/** Same bar as `workspaces.controller.ts`'s invite/role endpoints: a
 *  purchase — even an unfulfilled one today — commits the workspace to a
 *  cost, so it is gated the same way seats and roles are. */
async function requireAdmin(user: AuthUser, tenantId: string): Promise<void> {
  const members = await listMembers(user.userId, tenantId);
  const role = members.find((m) => m.user_id === user.userId)?.role;
  if (role !== 'owner' && role !== 'admin') {
    throw new ConflictException('Only an owner or manager can do that.');
  }
}

function toPurchase(row: CreditPurchaseRow): CreditPurchase {
  return {
    id: row.id,
    packCode: row.pack_code,
    credits: row.credits,
    priceAud: row.price_aud,
    status: row.status,
    provider: row.provider,
    createdAt: row.created_at,
    paidAt: row.paid_at,
  };
}

/**
 * Credits — bought with money, or granted free at signup. Tenant-scoped;
 * `docs/ECOSYSTEM.md` D27. There is no payment processor here: Stripe is
 * phase 6.5 and unwired, so `POST .../purchases` only ever produces a
 * `pending` record. See `credits.repo.ts#fulfilCreditPurchase` for what a
 * real processor's webhook must do instead of the manual fulfil endpoint
 * below.
 */
@ApiTags('credits')
@Controller('v1')
@UseGuards(SessionGuard, MembershipGuard)
export class CreditsController {
  @Get('credit-packs')
  @ApiOperation({ summary: 'The credit packs on offer, active only' })
  async packs(
    @CurrentUser() user: AuthUser,
    @WorkspaceId() tenantId: string,
  ): Promise<CreditPack[]> {
    const rows = await listCreditPacks(user.userId, tenantId);
    return rows.map((r) => ({
      code: r.code,
      credits: r.credits,
      priceAud: r.price_aud,
      sortOrder: r.sort_order,
    }));
  }

  @Get('credits')
  @ApiOperation({
    summary: 'The credits balance, alone',
    description:
      'NOT the plan quota — GET /v1/plan already folds credits into scansRemaining for the "can I scan right now" question. This is the number that never resets: what was bought or granted free. See docs/ECOSYSTEM.md D27.',
  })
  async balance(
    @CurrentUser() user: AuthUser,
    @WorkspaceId() tenantId: string,
  ): Promise<CreditBalance> {
    const creditsRemaining = await getCreditBalance(user.userId, tenantId);
    return { creditsRemaining };
  }

  @Get('credits/purchases')
  @ApiOperation({ summary: 'Purchase history for this workspace' })
  async purchases(
    @CurrentUser() user: AuthUser,
    @WorkspaceId() tenantId: string,
  ): Promise<CreditPurchase[]> {
    const rows = await listCreditPurchases(user.userId, tenantId);
    return rows.map(toPurchase);
  }

  @Post('credits/purchases')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Start a purchase',
    description:
      'Records intent to buy a pack. Returns it "pending" — there is no checkout to send anyone to yet. A real purchase becomes "paid" only once someone (for now, an operator) fulfils it; see docs/ECOSYSTEM.md D27.',
  })
  async startPurchase(
    @CurrentUser() user: AuthUser,
    @WorkspaceId() tenantId: string,
    @ValidBody(StartCreditPurchaseDto) body: StartCreditPurchaseDto,
  ): Promise<CreditPurchase> {
    await requireAdmin(user, tenantId);
    const row = await startCreditPurchase(user.userId, tenantId, body.packCode);
    if (!row) throw new NotFoundException(`No such credit pack: ${body.packCode}.`);
    return toPurchase(row);
  }

  @Post('credits/purchases/:id/fulfil')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Mark a purchase paid and grant the credits',
    description:
      'The manual stand-in for a payment processor webhook (Stripe is phase 6.5 and unwired). Atomically marks the purchase paid, inserts the usage_grants row, and links grant_id — the same sequence a real webhook handler must run, keyed instead by provider + provider_ref. Idempotent: fulfilling an already-paid purchase returns it unchanged rather than granting twice.',
  })
  async fulfil(
    @CurrentUser() user: AuthUser,
    @WorkspaceId() tenantId: string,
    @Param('id') id: string,
  ): Promise<CreditPurchase> {
    await requireAdmin(user, tenantId);
    try {
      const row = await fulfilCreditPurchase(user.userId, tenantId, id);
      if (!row) throw new NotFoundException('No such purchase.');
      return toPurchase(row);
    } catch (error) {
      if (error instanceof CreditPurchaseNotPendingError) {
        throw new ConflictException(
          `This purchase is ${error.status}, not pending — it cannot be fulfilled.`,
        );
      }
      throw error;
    }
  }
}
