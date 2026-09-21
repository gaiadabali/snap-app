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
  CheckoutSession,
  CreditBalance,
  CreditPack,
  CreditPurchase,
  StartCreditPurchaseRequest,
} from '@snap/api-contract';
import { IsString } from 'class-validator';

import { isManualCreditFulfilmentEnabled } from '../config.js';
import { paymentProvider } from './payment-provider.js';
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

  @Post('credits/purchases/:id/checkout')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Ask what to do next about a pending purchase',
    description:
      'Returns a descriptor rather than a URL, because no processor has been chosen and the rails do not correspond — a card processor answers with a hosted page, in-app purchase answers with a product identifier the phone redeems itself. Today every call returns state "unavailable" with a message safe to show a customer: the order is recorded, nothing has been charged. See credits/payment-provider.ts for the seam and what wiring a real one involves.',
  })
  async checkout(
    @CurrentUser() user: AuthUser,
    @WorkspaceId() tenantId: string,
    @Param('id') id: string,
  ): Promise<CheckoutSession> {
    // Same bar as starting the purchase: this is the step that would take
    // money, so it is not open to every member of the workspace.
    await requireAdmin(user, tenantId);

    /*
     * Read the purchase back rather than trusting the caller's id: the price
     * a processor is asked to charge must come from the record, never from
     * the request. `listCreditPurchases` is tenant-scoped by RLS, so a
     * purchase belonging to another workspace simply is not in this list.
     */
    const rows = await listCreditPurchases(user.userId, tenantId);
    const row = rows.find((r) => r.id === id);
    if (!row) throw new NotFoundException('No such purchase.');
    if (row.status !== 'pending') {
      throw new ConflictException(
        `This purchase is ${row.status}, not pending — there is nothing left to pay.`,
      );
    }

    // `await`ed as of docs/INTEGRATIONS.md Lane P: selecting the provider
    // may have to start the Stripe simulator, which is an HTTP server and
    // has no address until it is listening.
    const provider = await paymentProvider();
    return provider.createCheckout({
      purchaseId: row.id,
      tenantId,
      // Carried into the processor's metadata so the WEBHOOK can re-enter
      // this tenant's RLS context. That request arrives with no session and
      // no workspace; without an identity to act as, granting the credits
      // would be a cross-tenant write.
      userId: user.userId,
      packCode: row.pack_code,
      credits: row.credits,
      priceAud: row.price_aud,
    });
  }

  @Post('credits/purchases/:id/fulfil')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Mark a purchase paid and grant the credits — non-production only',
    description:
      'The manual stand-in for a payment processor webhook. Atomically marks the purchase paid, inserts the usage_grants row, and links grant_id — the same sequence a real webhook handler must run, keyed instead by provider + provider_ref. Idempotent: fulfilling an already-paid purchase returns it unchanged rather than granting twice. Returns 404 unless CREDITS_MANUAL_FULFIL is set on a non-production or staging host: it grants paid credits without any money moving, and credits are now the entire commercial model.',
  })
  async fulfil(
    @CurrentUser() user: AuthUser,
    @WorkspaceId() tenantId: string,
    @Param('id') id: string,
  ): Promise<CreditPurchase> {
    /*
     * THE GATE, and why `requireAdmin` below is not one.
     *
     * Creating a workspace makes you its `owner` (workspaces.controller.ts),
     * so every self-service signup passes `requireAdmin` for their own
     * tenant. Start a purchase, fulfil it, and the credits are granted with
     * no money involved. That was honest while there was no payment path at
     * all — the endpoint is a stand-in and says so. Credits are now the whole
     * commercial model, which turns the same two calls into free money.
     *
     * 404 rather than 403: in production this endpoint does not exist, and
     * saying "forbidden" would confirm that it does. Same treatment the
     * development sign-in bypass gets in `auth.controller.ts`.
     */
    if (!isManualCreditFulfilmentEnabled()) {
      throw new NotFoundException('Cannot POST to this path.');
    }
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
