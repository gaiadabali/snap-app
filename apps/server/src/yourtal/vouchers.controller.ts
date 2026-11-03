import { randomUUID } from 'node:crypto';

import { Controller, HttpException, HttpStatus, Logger, Post, Res, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { RedeemYourtalVoucherRequest, RedeemYourtalVoucherResult } from '@snap/api-contract';
import { withTenantAs } from '@snap/db';
import { IsString, Length } from 'class-validator';

import { RateLimiter } from '../auth/rate-limit.js';
import {
  CurrentSession,
  CurrentUser,
  MembershipGuard,
  SessionGuard,
  VerifiedEmailGuard,
  WorkspaceId,
  type AuthUser,
  type CurrentSessionInfo,
} from '../common/auth.guard.js';
import { ValidBody } from '../common/valid-body.decorator.js';
import { getDb } from '../db.js';
import { listMembers } from '../repo.js';
import { voucherOwner, yourtalPartnerClient, type YourtalPartnerClient } from './client.js';
import { liveLink, markLinkBroken } from './links.repo.js';
import { yourtalMerchantClient, type YourtalMerchantClient } from './merchant-client.js';
import { advanceRedemption, authorizeOnce, publicRedemption, REDEMPTION_TIMING, SCANS_VOUCHER, type Mover } from './redeem.service.js';
import {
  insertRedemption,
  liveRedemptionForCode,
  releaseRedemption,
  type Enter,
  type RedemptionRow,
} from './redemptions.repo.js';
import { parseVoucherCode } from './voucher-code.js';

export class RedeemYourtalVoucherDto implements RedeemYourtalVoucherRequest {
  @IsString()
  @Length(1, 64)
  code!: string;
}

/**
 * Per user. Every attempt that reaches YourTal spends the partner rate limit
 * and, at authorize, the merchant throttle (20 failed lookups in 5 minutes
 * for ALL SnapApp users), so a typo (refused locally) does not count, and a
 * script cannot use one account to throttle everyone.
 */
const redeemAttemptsPerUser = new RateLimiter(5, 15 * 60_000);

function refuse(status: HttpStatus, error: string, message: string, extra: Record<string, unknown> = {}): HttpException {
  return new HttpException({ error, message, ...extra }, status);
}

const NOTHING_TAKEN = "YourTal isn't answering right now. Nothing was taken. Try again in a minute.";

/**
 * Redeeming a YourTal "50 SnapApp scans" voucher (group plan 2.8, yourtal
 * docs/28 §3). `POST /v1/yourtal/vouchers/redeem {code}` with the workspace
 * header; the credits go to that workspace (D4: owner or admin only).
 *
 * The person's OWN session (no staff impersonation) and a proven email,
 * like linking: this moves money-valued vouchers. The request works the
 * redemption as far as it can; an unknown outcome is answered 202 and the
 * worker's drain finishes it (`redemption-drain.ts`).
 */
@ApiTags('yourtal')
@Controller('v1/yourtal/vouchers')
@UseGuards(SessionGuard, MembershipGuard, VerifiedEmailGuard)
export class YourtalVouchersController {
  private readonly logger = new Logger('YourtalVouchers');

  /** Built per request (a rotated secret needs no restart); tests replace them. */
  partnerFor: () => YourtalPartnerClient | null = yourtalPartnerClient;
  merchantFor: () => YourtalMerchantClient | null = yourtalMerchantClient;
  now: () => Date = () => new Date();

  @Post('redeem')
  @ApiOperation({
    summary: 'Redeem a YourTal scans voucher for 50 scan credits in this workspace',
    description:
      'Only a voucher in the YourTal wallet linked to this account, by an owner or admin of the workspace. 200 granted, or 202 pending when YourTal\'s answer is not in yet (the server finishes it). Errors: see RedeemYourtalVoucherResult in the API contract.',
  })
  async redeem(
    @CurrentUser() user: AuthUser,
    @WorkspaceId() tenantId: string,
    @CurrentSession() _session: CurrentSessionInfo,
    @ValidBody(RedeemYourtalVoucherDto) body: RedeemYourtalVoucherDto,
    @Res({ passthrough: true }) reply: { status(code: number): unknown },
  ): Promise<RedeemYourtalVoucherResult> {
    const answer = await this.run(user, tenantId, body.code);
    reply.status(answer.state === 'granted' ? 200 : 202);
    return answer;
  }

  /** The flow, apart from HTTP status plumbing; tests call it directly. */
  async run(user: AuthUser, tenantId: string, typed: string): Promise<RedeemYourtalVoucherResult> {
    const members = await listMembers(user.userId, tenantId);
    const role = members.find((m) => m.user_id === user.userId)?.role;
    if (role !== 'owner' && role !== 'admin') {
      throw refuse(HttpStatus.FORBIDDEN, 'owner_or_admin_only', 'Only an owner or admin of this workspace can add scans to it.');
    }

    const partner = this.partnerFor();
    const merchant = this.merchantFor();
    if (!partner || !merchant) {
      throw refuse(HttpStatus.SERVICE_UNAVAILABLE, 'yourtal_not_configured', 'YourTal vouchers are not available yet.');
    }

    const link = await liveLink(user.userId);
    if (!link) throw refuse(HttpStatus.CONFLICT, 'not_linked', 'Link YourTal to this account first.');
    if (link.region !== 'AU') {
      throw refuse(HttpStatus.CONFLICT, 'region_not_supported', 'YourTal scans vouchers are for Australian YourTal accounts.');
    }

    const parsed = parseVoucherCode(typed);
    if ('error' in parsed) {
      throw refuse(HttpStatus.BAD_REQUEST, 'invalid_voucher_code', "That code isn't right. Check it and try again.");
    }

    const enter: Enter = (fn) => withTenantAs(getDb(), user.userId, tenantId, fn);
    const seen = await liveRedemptionForCode(enter, parsed.sha256);
    if (seen) return this.alreadySeen(seen);

    if (!(await redeemAttemptsPerUser.consume(`yourtal-voucher:${user.userId}`))) {
      throw refuse(HttpStatus.TOO_MANY_REQUESTS, 'rate_limited', 'Too many attempts. Try again in a few minutes.');
    }

    // Who holds it, before any hold: a code that is not this person's never
    // reaches the merchant API, so it cannot count towards its throttle.
    const owner = await voucherOwner(partner, { linkId: link.link_id, codeSha256: parsed.sha256 });
    if (!owner) throw refuse(HttpStatus.SERVICE_UNAVAILABLE, 'yourtal_unavailable', NOTHING_TAKEN);
    if ('linkGone' in owner) {
      await markLinkBroken(user.userId, link.id, owner.linkGone);
      throw refuse(HttpStatus.CONFLICT, 'link_broken', 'YourTal ended the link to this account. Link it again to use your vouchers.');
    }
    if (!owner.held) {
      throw refuse(HttpStatus.CONFLICT, 'not_your_voucher', "That code isn't a scans voucher in the YourTal wallet linked to this account.");
    }
    if (owner.status !== 'active') {
      const [error, message] =
        owner.status === 'redeemed' ? ['voucher_used', 'This voucher has already been used.']
        : owner.status === 'expired' ? ['voucher_expired', 'This voucher has expired.']
        : ['voucher_busy', 'This voucher is being used right now. Try again in 15 minutes.'];
      throw refuse(HttpStatus.CONFLICT, error, message);
    }
    if (owner.faceValueMinor !== SCANS_VOUCHER.faceMinor || owner.currency !== SCANS_VOUCHER.currency) {
      throw refuse(HttpStatus.CONFLICT, 'not_a_scans_voucher', "That voucher isn't a SnapApp scans voucher.");
    }

    // Committed before any value-moving call; held by this request.
    const holder = `request-${randomUUID()}`;
    const inserted = await insertRedemption(enter, {
      linkRowId: link.id,
      codeSha256: parsed.sha256,
      faceMinor: SCANS_VOUCHER.faceMinor,
      currency: SCANS_VOUCHER.currency,
      credits: SCANS_VOUCHER.credits,
      holder,
      dueInSeconds: REDEMPTION_TIMING.authorizeLookupAfterSeconds,
    });
    if (inserted === 'busy') {
      // A double submit in this workspace, or the code in use in another.
      const other = await liveRedemptionForCode(enter, parsed.sha256);
      if (other) return this.alreadySeen(other);
      throw refuse(HttpStatus.CONFLICT, 'voucher_busy', 'This voucher is being used right now. Try again in 15 minutes.');
    }

    const mover: Mover = { client: merchant, enter, holder, now: this.now, log: this.logger };
    let row: RedemptionRow = inserted;
    let mismatch = false;
    try {
      const authorized = await authorizeOnce(row, parsed.canonical, mover);
      row = authorized.row;
      mismatch = authorized.outcome === 'mismatch';
      if (authorized.outcome === 'held' || mismatch) row = await advanceRedemption(row, mover, 'request');
    } catch (error) {
      // The row exists and money may be moving: the drain finishes it, so an
      // unfinished row is answered 202 pending below, never a 500.
      this.logger.error(`voucher redemption ${row.id}: request pass failed at ${row.status} (${error instanceof Error ? error.message : String(error)}); the drain finishes it`);
    }
    // Due for the drain at once unless only an authorize is outstanding (looked up after 30 s).
    // If this fails too, the lease lapses and the drain takes the row over.
    const delay = row.status === 'authorizing' ? REDEMPTION_TIMING.authorizeLookupAfterSeconds : 0;
    await releaseRedemption(enter, row.id, holder, delay).catch((error) =>
      this.logger.error(`voucher redemption ${row.id}: could not release (${error instanceof Error ? error.message : String(error)})`),
    );

    if (row.status === 'granted') return { state: 'granted', redemption: publicRedemption(row) };
    if (mismatch) throw refuse(HttpStatus.CONFLICT, 'not_a_scans_voucher', "That voucher isn't a SnapApp scans voucher. Nothing was taken.");
    switch (row.status) {
      case 'refused':
        if (row.last_code === 'currency_mismatch') {
          throw refuse(HttpStatus.CONFLICT, 'not_a_scans_voucher', "That voucher isn't a SnapApp scans voucher.");
        }
        throw refuse(HttpStatus.CONFLICT, 'voucher_refused', "YourTal wouldn't accept this voucher. Nothing was taken.");
      case 'failed':
        if (row.last_code === 'voucher_already_held') {
          throw refuse(HttpStatus.CONFLICT, 'voucher_busy', 'This voucher is being used right now. Try again in 15 minutes.');
        }
        this.logger.warn(`voucher redemption ${row.id}: authorize failed (${row.last_code ?? 'no code'})`);
        throw refuse(HttpStatus.SERVICE_UNAVAILABLE, 'yourtal_unavailable', NOTHING_TAKEN);
      case 'voided':
      case 'expired':
      case 'abandoned':
        throw refuse(HttpStatus.SERVICE_UNAVAILABLE, 'yourtal_unavailable', NOTHING_TAKEN);
      default:
        return { state: 'pending', redemption: publicRedemption(row) };
    }
  }

  private alreadySeen(row: RedemptionRow): RedeemYourtalVoucherResult {
    if (row.status === 'granted') {
      throw refuse(HttpStatus.CONFLICT, 'already_redeemed', 'This voucher was already used to add scans here.', {
        redeemedAt: row.finished_at,
      });
    }
    return { state: 'pending', redemption: publicRedemption(row) };
  }
}
