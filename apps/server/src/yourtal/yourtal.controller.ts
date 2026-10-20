import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Logger,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { YourtalLinkStatus } from '@snap/api-contract';
import { IsString, Length } from 'class-validator';

import { RateLimiter } from '../auth/rate-limit.js';
import {
  CurrentSession,
  CurrentUser,
  SessionGuard,
  VerifiedEmailGuard,
  type AuthUser,
  type CurrentSessionInfo,
} from '../common/auth.guard.js';
import { ValidBody } from '../common/valid-body.decorator.js';
import { isYourtalPartnerConfigured } from '../config.js';
import { yourtalPartnerClient, type YourtalPartnerClient } from './client.js';
import { exchangeLinkCode, normaliseLinkCode, revokeLinkAtYourtal } from './link.service.js';
import {
  insertLink,
  latestLink,
  liveLink,
  markLinkRevoked,
  receiptReportCounts,
} from './links.repo.js';

export class LinkYourtalDto {
  /** The one-time code from YourTal's Me → Linked apps. */
  @IsString()
  @Length(1, 64)
  code!: string;
}

/**
 * Per user, because every exchange spends part of YourTal's per-IP limit
 * (60 a minute) and every Snap Apps user shares this server's IP. A person
 * typing a code wrong a few times is well inside this; a script guessing
 * codes is not.
 */
const linkAttemptsPerUser = new RateLimiter(5, 15 * 60_000);

function refuse(status: HttpStatus, error: string, message: string): HttpException {
  return new HttpException({ error, message }, status);
}

/**
 * The YourTal points link, Snap Apps' side (group plan 2.4).
 *
 *   GET    /v1/yourtal/link   the state the screens show (2.6 builds them)
 *   POST   /v1/yourtal/link   { code } → link this account to a YourTal account
 *   DELETE /v1/yourtal/link   unlink (YourTal is told first)
 *
 * USER-scoped like points: `SessionGuard` and no workspace. Linking and
 * unlinking need the person's OWN session (`@CurrentSession`), so staff
 * impersonating a user can look at the state but never move it — this is the
 * switch that sends money-valued points somewhere. Linking also needs a
 * proven email address (0036: "linked accounts").
 */
@ApiTags('yourtal')
@Controller('v1/yourtal')
@UseGuards(SessionGuard)
export class YourtalLinkController {
  private readonly logger = new Logger('YourtalLink');

  /**
   * Built from config on every request, so a rotated secret file needs no
   * restart. A property rather than a constructor parameter so Nest's
   * injector never sees it; tests replace it with a client for a fake YourTal.
   */
  clientFor: () => YourtalPartnerClient | null = yourtalPartnerClient;

  @Get('link')
  @ApiOperation({ summary: 'Whether this account is linked to YourTal, and how its receipts have fared' })
  async status(@CurrentUser() user: AuthUser): Promise<YourtalLinkStatus> {
    return this.statusFor(user.userId);
  }

  @Post('link')
  @UseGuards(VerifiedEmailGuard)
  @HttpCode(200)
  @ApiOperation({
    summary: 'Link this account to YourTal with a one-time code',
    description:
      'The code comes from YourTal (Me → Linked apps → Generate code), is valid for 10 minutes and works once. Only adult YourTal accounts can link.',
  })
  async link(
    @CurrentUser() user: AuthUser,
    @CurrentSession() _session: CurrentSessionInfo,
    @ValidBody(LinkYourtalDto) body: LinkYourtalDto,
  ): Promise<YourtalLinkStatus> {
    const client = this.clientFor();
    if (!client) {
      throw refuse(HttpStatus.SERVICE_UNAVAILABLE, 'yourtal_not_configured', 'Linking YourTal is not available yet.');
    }

    // Before spending the code: an account that is already linked keeps its
    // link, and the code stays usable for whatever the person meant instead.
    if (await liveLink(user.userId)) {
      throw refuse(HttpStatus.CONFLICT, 'already_linked', 'This account is already linked to YourTal. Unlink it first to link a different YourTal account.');
    }

    if (!(await linkAttemptsPerUser.consume(`yourtal-link:${user.userId}`))) {
      throw refuse(HttpStatus.TOO_MANY_REQUESTS, 'rate_limited', 'Too many attempts. Try again in a few minutes.');
    }

    const code = normaliseLinkCode(body.code);
    if (!code) {
      throw refuse(HttpStatus.BAD_REQUEST, 'invalid_link_code', 'That code is not right. Check it, or get a new one in YourTal under Me → Linked apps.');
    }

    const exchanged = await exchangeLinkCode(client, code);
    if (!exchanged.ok) {
      switch (exchanged.reason) {
        case 'invalid_link_code':
          throw refuse(
            HttpStatus.BAD_REQUEST,
            'invalid_link_code',
            'That code is not valid any more. Codes last 10 minutes and work once — get a new one in YourTal under Me → Linked apps.',
          );
        case 'teen_consent_not_allowed':
          throw refuse(
            HttpStatus.FORBIDDEN,
            'teen_consent_not_allowed',
            'Only adult YourTal accounts can earn points for receipts.',
          );
        case 'unavailable':
          this.logger.warn(`link exchange: YourTal unavailable (${exchanged.detail})`);
          throw refuse(HttpStatus.SERVICE_UNAVAILABLE, 'yourtal_unavailable', 'YourTal is not answering right now. Try again in a minute.');
        default:
          this.logger.error(`link exchange: YourTal refused our request (${exchanged.detail})`);
          throw refuse(HttpStatus.BAD_GATEWAY, 'yourtal_rejected', 'Something went wrong linking YourTal. Try again later.');
      }
    }

    const stored = await insertLink(user.userId, { linkId: exchanged.linkId, region: exchanged.region });
    if (!stored.ok) {
      if (stored.reason === 'linked_to_another_account') {
        throw refuse(
          HttpStatus.CONFLICT,
          'linked_to_another_account',
          'That YourTal account is already linked to another Snap Apps account. Unlink it there first.',
        );
      }
      // Lost a race with another link request from this same account (two
      // taps, two devices). The same YourTal account is simply success. A
      // different one was linked by the other request: the link YourTal just
      // issued to THIS request is an orphan nothing will ever use, so end it
      // rather than leave a live link at YourTal that Snap Apps has forgotten.
      const current = await liveLink(user.userId);
      if (current?.link_id === exchanged.linkId) return this.statusFor(user.userId);
      const orphan = await revokeLinkAtYourtal(client, exchanged.linkId);
      if (!orphan.ok) this.logger.warn(`link race: could not revoke the orphaned link at YourTal (${orphan.detail})`);
      throw refuse(HttpStatus.CONFLICT, 'already_linked', 'This account is already linked to YourTal.');
    }
    return this.statusFor(user.userId);
  }

  @Delete('link')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Unlink YourTal',
    description:
      'Tells YourTal first, then forgets the link here, so the link cannot keep earning. Receipts not yet reported are not sent. Unlinking an account that is not linked is not an error.',
  })
  async unlink(
    @CurrentUser() user: AuthUser,
    @CurrentSession() _session: CurrentSessionInfo,
  ): Promise<YourtalLinkStatus> {
    const link = await liveLink(user.userId);
    if (!link) return this.statusFor(user.userId);

    const client = this.clientFor();
    if (!client) {
      // Without credentials YourTal cannot be told, and forgetting the link
      // here alone would leave it able to earn the day credentials return.
      throw refuse(HttpStatus.SERVICE_UNAVAILABLE, 'yourtal_not_configured', 'Unlinking YourTal is not available right now. Try again later.');
    }

    const revoked = await revokeLinkAtYourtal(client, link.link_id);
    if (!revoked.ok) {
      if (revoked.reason === 'unavailable') {
        this.logger.warn(`unlink: YourTal unavailable (${revoked.detail})`);
        throw refuse(HttpStatus.SERVICE_UNAVAILABLE, 'yourtal_unavailable', 'YourTal is not answering right now, so the link is still on. Try again in a minute.');
      }
      this.logger.error(`unlink: YourTal refused our revoke (${revoked.detail})`);
      throw refuse(HttpStatus.BAD_GATEWAY, 'yourtal_rejected', 'Something went wrong unlinking YourTal. Try again later.');
    }

    await markLinkRevoked(user.userId, link.id);
    return this.statusFor(user.userId);
  }

  private async statusFor(userId: string): Promise<YourtalLinkStatus> {
    const [link, counts] = await Promise.all([latestLink(userId), receiptReportCounts(userId)]);
    const live = link && !link.revoked_at && !link.broken_at ? link : null;
    const broken = !live && link?.broken_at && !link.revoked_at ? link : null;
    const shown = live ?? broken;
    return {
      available: isYourtalPartnerConfigured(),
      state: live ? 'linked' : broken ? 'broken' : 'unlinked',
      region: shown?.region ?? null,
      linkedAt: shown?.linked_at ?? null,
      brokenReason: broken?.broken_reason ?? null,
      receipts: {
        pending: counts.pending,
        rewarded: counts.rewarded,
        refused: counts.refused,
        skippedDuplicate: counts.skippedDuplicate,
      },
      pointsReported: counts.pointsReported,
    };
  }
}
