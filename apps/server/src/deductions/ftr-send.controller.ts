import { Body, Controller, Header, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FtrSendFinished, FtrSendStarted } from '@snap/api-contract';
import { IsIn, IsOptional, IsString, Length, Matches, MaxLength, IsUUID } from 'class-validator';

import {
  CurrentImpersonation,
  CurrentUser,
  MembershipGuard,
  SessionGuard,
  WorkspaceId,
  type AuthUser,
  type ProductImpersonation,
} from '../common/auth.guard.js';
import { ValidBody } from '../common/valid-body.decorator.js';
import { finishSend, startSend } from './ftr-send.service.js';

export class FtrSendStartDto {
  @IsIn(['web', 'mobile'], { message: 'client must be "web" or "mobile".' })
  client!: 'web' | 'mobile';

  /** `2025-26`; the newest year we hold rates for that has started when left out. */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}$/, { message: 'financialYear must be like 2025-26.' })
  financialYear?: string;

  /** A same-origin path for the website to go to afterwards. */
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  returnTo?: string;

  @IsOptional()
  @IsIn(['en-AU', 'id-ID'])
  locale?: 'en-AU' | 'id-ID';
}

export class FtrSendFinishDto {
  @IsUUID('all', { message: 'flowId must be the id returned by start.' })
  flowId!: string;

  @IsString()
  @Length(1, 512)
  state!: string;

  /** The authorization response's `code` and `iss` (RFC 9207); absent when YourTal answered with `error`. */
  @IsOptional()
  @IsString()
  @Length(1, 2048)
  code?: string;

  @IsOptional()
  @IsString()
  @Length(1, 2048)
  iss?: string;

  /** YourTal's `error` (Cancel is `access_denied`): the send is closed, nothing is sent. */
  @IsOptional()
  @IsString()
  @Length(1, 100)
  error?: string;
}

/**
 * Send deductions to Free Tax Returns (group 4.8.a; yourtal docs/30 §3, §6).
 * Both calls are the signed-in person's, in their personal workspace:
 * `fromSub` is the session's own YourTal `sub`, never anything in the body.
 */
@ApiTags('deductions')
@Controller('v1/ftr-sends')
@UseGuards(SessionGuard, MembershipGuard)
export class FtrSendController {
  @Post()
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: 'Start sending a year of deductions to Free Tax Returns',
    description:
      'Builds the bundle, opens a transfer at YourTal and answers YourTal’s authorization URL (with `transfer`), ' +
      'the flow id the finish needs within 10 minutes, and the send id. Only the owner of a personal workspace in ' +
      'Australia, signed in with YourTal, and not in a teen space. 5 a person per 15 minutes. Refusals are ' +
      '{ error, message }: 501 not_configured; 403 not_personal, not_owner, region_not_supported, teen_space, ' +
      'yourtal_sign_in_required, impersonated; 422 nothing_to_send, invalid_bundle; 429 rate_limited; ' +
      '503 yourtal_unavailable; 409 send_refused.',
  })
  async start(
    @CurrentUser() user: AuthUser,
    @WorkspaceId() tenantId: string,
    @CurrentImpersonation() impersonation: ProductImpersonation | undefined,
    @ValidBody(FtrSendStartDto) body: FtrSendStartDto,
  ): Promise<FtrSendStarted> {
    return startSend(user, tenantId, impersonation !== undefined, {
      client: body.client,
      financialYear: body.financialYear,
      returnTo: body.returnTo,
      locale: body.locale ?? 'en-AU',
    });
  }

  @Post('finish')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: 'Finish a send to Free Tax Returns',
    description:
      'Takes the flow (once; a sign-in flow is refused and left alone), loads the send under the session’s workspace, ' +
      'redeems the code, checks the ID token is an adult in Australia and the session’s own `sub`, fetches the ' +
      'assertion and posts the stored bytes to Free Tax Returns. With `error` the send is closed as cancelled. ' +
      '200 { status: "sent", importId, … } or { status: "cancelled" }; refusals are { error, message } and close the send: ' +
      'invalid_flow, send_expired, yourtal_failed, yourtal_unavailable, wrong_account, not_allowed, not_approved, ' +
      'send_refused, ftr_refused (with reason), ftr_unavailable.',
  })
  async finish(
    @CurrentUser() user: AuthUser,
    @WorkspaceId() tenantId: string,
    @ValidBody(FtrSendFinishDto) body: FtrSendFinishDto,
  ): Promise<FtrSendFinished> {
    return finishSend(user, tenantId, body);
  }
}
