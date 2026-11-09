import {
  BadRequestException,
  ConflictException,
  Controller,
  ForbiddenException,
  HttpCode,
  Logger,
  NotFoundException,
  Post,
  Req,
  ServiceUnavailableException,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { CreditPurchase, GooglePlayPurchaseRequest } from '@snap/api-contract';
import { NotAMemberError } from '@snap/db';
import { IsString, Matches, MaxLength } from 'class-validator';

import {
  CurrentUser,
  MembershipGuard,
  SessionGuard,
  WorkspaceId,
  type AuthUser,
} from '../common/auth.guard.js';
import { ValidBody } from '../common/valid-body.decorator.js';
import { requireAdmin, resumeAfterCredits, toPurchase } from './credits.controller.js';
import {
  findCreditPurchaseByProviderRef,
  grantGooglePlayPurchase,
  recordGooglePlayVoid,
  refundCreditPurchaseFromProvider,
} from './credits.repo.js';
import { DEFAULT_PACKAGE_NAME, googlePlayDriver, verifyPushToken, type GooglePlayDriver } from './google-play.js';

export class GooglePlayPurchaseDto implements GooglePlayPurchaseRequest {
  @IsString() @Matches(/^[a-z0-9_.]{1,100}$/) productId!: string;
  @IsString() @MaxLength(4096) purchaseToken!: string;
}

function driverOrRefuse(): GooglePlayDriver {
  const driver = googlePlayDriver();
  if (!driver) throw new ServiceUnavailableException('Google Play purchases are not connected on this server.');
  return driver;
}

/**
 * Credits bought through Google Play, in the Play build (group plan 8.3.b,
 * ruling 0.12.b). The phone hands over Play's purchase token; credits are
 * granted only once the driver has asked Google about it, once per token.
 *
 * Play refunds a purchase nobody acknowledges within three days. The server
 * consumes (which acknowledges) only AFTER the grant is committed, so every
 * refusal here ends with the buyer's money returned by Play, not kept.
 */
@ApiTags('credits')
@Controller('v1/credits')
@UseGuards(SessionGuard, MembershipGuard)
export class GooglePlayController {
  private readonly logger = new Logger('google-play');

  @Post('google-play')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Redeem a Google Play purchase for its credits',
    description:
      'Play build only. Verifies the purchase token with Google (or the simulator), checks it is this pack, ' +
      'paid, and made for this workspace and user, then grants the pack once per token and consumes it. ' +
      'A repeat returns the same purchase without granting again.',
  })
  async redeem(
    @CurrentUser() user: AuthUser,
    @WorkspaceId() tenantId: string,
    @ValidBody(GooglePlayPurchaseDto) body: GooglePlayPurchaseDto,
  ): Promise<CreditPurchase> {
    await requireAdmin(user, tenantId);
    const driver = driverOrRefuse();

    const purchase = await driver.getPurchase(body.purchaseToken);
    if (!purchase || purchase.productId !== body.productId) {
      throw new BadRequestException('Google Play has no purchase of that pack with this token.');
    }
    if (purchase.state === 'pending') {
      throw new ConflictException({
        error: 'pending',
        message: 'Google Play is still waiting for this payment. Your scans are added once it goes through.',
      });
    }
    if (purchase.state === 'cancelled') {
      throw new ConflictException('This Google Play purchase was cancelled or refunded, so no scans were added.');
    }
    if (purchase.state !== 'purchased') {
      this.logger.error(`Play reports an unknown state for a ${body.productId} purchase; nothing granted`);
      throw new ConflictException('Google Play could not confirm this payment. Nothing was added; try again later.');
    }
    // One pack per purchase. Multi-quantity stays off in Play Console.
    if (purchase.quantity !== 1) {
      throw new ConflictException('Buy one pack at a time. This purchase was not added, and Google Play refunds it.');
    }
    // A licence tester's test card moves no money: refused unless this host
    // is testing Play (7.5.e). Unconsumed, so Play refunds the test order.
    const allowTest = process.env.GOOGLE_PLAY_ALLOW_TEST_PURCHASES === 'true';
    if (purchase.test && !allowTest) {
      throw new ConflictException('Test purchases are not accepted here. Nothing was added.');
    }
    // The phone sets these when it opens the billing sheet. A token bought in
    // another workspace or by another person is not redeemable here.
    if (purchase.accountId !== tenantId || purchase.profileId !== user.userId) {
      throw new ForbiddenException('This Google Play purchase was made for a different workspace or account.');
    }

    const result = await grantGooglePlayPurchase(
      user.userId,
      tenantId,
      body.productId,
      body.purchaseToken,
      // Marked so test orders never read as revenue.
      `${purchase.test ? 'TEST:' : ''}${purchase.orderId ?? body.purchaseToken}`,
    );
    if (!result) throw new NotFoundException(`No such credit pack: ${body.productId}.`);
    if (result === 'other_workspace') {
      throw new ConflictException('This Google Play purchase has already been added to another workspace.');
    }
    // Voided after Google said "purchased" above (review L3).
    if (result.row.status === 'refunded') {
      throw new ConflictException('This Google Play purchase was cancelled or refunded, so no scans were added.');
    }

    if (result.row.status === 'paid' && !purchase.consumed) {
      try {
        await driver.consume(body.productId, body.purchaseToken);
      } catch (error) {
        // The credits are granted. The phone retries unfinished purchases,
        // and a retry consumes; Play only refunds if three days pass.
        this.logger.warn(`could not consume ${result.row.id}: ${String(error)}`);
      }
    }
    if (result.granted) {
      this.logger.log(
        `granted ${result.row.credits} credits for Play ${purchase.test ? 'TEST ' : ''}purchase ${result.row.id}`,
      );
      await resumeAfterCredits(user.userId, tenantId);
    }
    return toPurchase(result.row);
  }
}

/**
 * Google Play's Real-time developer notifications, pushed by Cloud Pub/Sub.
 *
 * Authenticated by the OIDC token Pub/Sub signs for the push subscription
 * (`verifyPushToken`): anything else is 401 before Google is asked anything,
 * so forged pushes cannot spend the Play API quota. Even then the message is
 * only a hint: nothing is taken back until Google confirms the void.
 *
 * Status codes speak to Pub/Sub: 200 acks (including "nothing to do"), and a
 * 5xx makes it redeliver, which is right when Google or our database failed.
 */
@ApiTags('credits')
@Controller('v1/credits/webhooks')
export class GooglePlayNotificationsController {
  private readonly logger = new Logger('google-play-rtdn');

  @Post('google-play')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Google Play RTDN (Pub/Sub push): a voided purchase takes its unspent credits back',
  })
  async notify(
    @Req() request: { body?: unknown; headers: Record<string, string | string[] | undefined> },
  ): Promise<{ received: true }> {
    const auth = request.headers.authorization;
    try {
      await verifyPushToken(Array.isArray(auth) ? auth[0] : auth);
    } catch (error) {
      this.logger.warn(`refused a Play notification: ${error instanceof Error ? error.message : String(error)}`);
      throw new UnauthorizedException('Not a Google Play notification.');
    }
    const data = (request.body as { message?: { data?: unknown } } | undefined)?.message?.data;
    let note: {
      packageName?: string;
      voidedPurchaseNotification?: { purchaseToken?: string; productType?: number; refundType?: number };
    };
    try {
      note = JSON.parse(Buffer.from(String(data), 'base64').toString('utf8'));
    } catch {
      this.logger.warn('ignored a Play notification that is not base64 JSON');
      return { received: true };
    }
    const expected = process.env.GOOGLE_PLAY_PACKAGE_NAME ?? DEFAULT_PACKAGE_NAME;
    if (note?.packageName !== expected) return { received: true };

    const voided = note.voidedPurchaseNotification;
    // One-time products only (2); purchases arrive from the phone, tests and
    // subscriptions need nothing.
    if (!voided?.purchaseToken || voided.productType !== 2) return { received: true };
    if (voided.refundType !== undefined && voided.refundType !== 1) {
      this.logger.error(`Play partially voided a purchase (refundType ${voided.refundType}): credits left for a person`);
      return { received: true };
    }

    const driver = googlePlayDriver();
    if (!driver) {
      // Redelivered until Play purchases are connected, so the void is not lost.
      throw new ServiceUnavailableException('Google Play purchases are not connected on this server.');
    }
    const token = voided.purchaseToken;
    const purchase = await driver.getPurchase(token);
    if (!purchase) {
      this.logger.error('a voided Play purchase is unknown to Google Play; nothing taken back');
      return { received: true };
    }
    if (purchase.state === 'unknown') {
      // Never take credits back on a state nobody can read. Redelivered later.
      this.logger.error(`Play reports an unknown state for voided order ${purchase.orderId}; retrying later`);
      throw new ServiceUnavailableException('Purchase state unknown.');
    }
    if (!(await driver.isVoided(token, purchase))) {
      // Google's read APIs can lag the notification. Pushes are authenticated,
      // so asking Pub/Sub to redeliver is safe (review L3); nothing taken yet.
      this.logger.warn(`a Play void Google does not confirm yet for order ${purchase.orderId}; retrying later`);
      throw new ServiceUnavailableException('Void not confirmed by Google Play yet.');
    }
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuid.test(purchase.accountId ?? '') || !uuid.test(purchase.profileId ?? '')) {
      this.logger.error(`voided Play order ${purchase.orderId} names no workspace; nothing taken back`);
      return { received: true };
    }

    const [userId, tenantId] = [purchase.profileId!, purchase.accountId!];
    let found: { id: string; payment_ref: string | null } | null;
    try {
      found = await findCreditPurchaseByProviderRef(userId, tenantId, 'google', token);
      if (!found) {
        // Never granted, or a redeem is granting it right now: record the void
        // so that grant adds nothing (review L3).
        const recorded = await recordGooglePlayVoid(userId, tenantId, purchase.productId, token, purchase.orderId ?? token);
        if (recorded !== 'exists') {
          this.logger.log(`voided Play order ${purchase.orderId} was never granted; recorded so it never is`);
          return { received: true };
        }
        // A redeem committed meanwhile: take that grant back below.
        found = await findCreditPurchaseByProviderRef(userId, tenantId, 'google', token);
      }
    } catch (error) {
      if (!(error instanceof NotAMemberError)) throw error;
      // The buyer has left the workspace since, so RLS will not let us in as them.
      this.logger.error(`voided Play order ${purchase.orderId}: the buyer is no longer a member; take the credits back by hand`);
      return { received: true };
    }
    if (!found) {
      // The token is recorded in a workspace the order does not name.
      this.logger.error(`voided Play order ${purchase.orderId} is recorded in another workspace; check it by hand`);
      return { received: true };
    }
    const result = await refundCreditPurchaseFromProvider(
      purchase.profileId!,
      purchase.accountId!,
      found.id,
      found.payment_ref!,
    );
    this.logger.log(`voided Play purchase ${found.id}: took back ${result?.clawedBack ?? 0} credits`);
    return { received: true };
  }
}
