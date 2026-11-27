import {
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { GodConsentState } from '@snap/api-contract';
import { IsIn, IsString } from 'class-validator';

import { CurrentSession, CurrentUser, SessionGuard, type AuthUser, type CurrentSessionInfo } from '../common/auth.guard.js';
import { ValidBody } from '../common/valid-body.decorator.js';
import { consentErrorCode, recordGodConsent } from './god-consent.repo.js';
import { godConsentState } from './god-consent.service.js';
import { GOD_NOTICE } from './notice.js';

export class GodConsentAnswerDto {
  @IsIn(['accepted', 'declined'], { message: 'Answer accepted or declined.' })
  decision!: 'accepted' | 'declined';

  @IsString({ message: 'Say which version of the notice you were shown.' })
  version!: string;
}

const refuse = (status: HttpStatus, error: string, message: string) => new HttpException({ error, message }, status);

/**
 * The GOD Group Privacy Notice (god/TASKS.md 9.1.d; migration 0062).
 *
 *   GET  /v1/god-consent            the notice, the caller's answer, and what to show
 *   POST /v1/god-consent            accept, or decline ("Not now") at next sign-in
 *   POST /v1/god-consent/withdraw   "Stop combining my data with GOD"
 *
 * A new sign-up accepts through onboarding (`acceptedGodNotice`), which the
 * server refuses without. Everything here needs the person's OWN session:
 * staff acting as a user can neither accept nor decline for them.
 */
@ApiTags('god-consent')
@Controller('v1/god-consent')
@UseGuards(SessionGuard)
export class GodConsentController {
  @Get()
  @ApiOperation({
    summary: 'The GOD Group Privacy Notice and what to show you',
    description:
      '`prompt` is `required` for a new sign-up, `ask` for an existing account with no answer for this version, ' +
      'and `none` otherwise (and always for a teen: their parent answers).',
  })
  async get(@CurrentUser() user: AuthUser): Promise<GodConsentState> {
    return godConsentState(user.userId);
  }

  @Post()
  @HttpCode(200)
  @ApiOperation({
    summary: 'Accept or decline the GOD Group Privacy Notice',
    description:
      'Existing accounts answer on their next sign-in. Declining keeps normal app use and keeps you out of GOD; you are ' +
      'asked again only when the version changes. A new sign-up cannot decline (409 required): it accepts in onboarding. ' +
      '409 version_changed when `version` is not the current one; 403 teen_parent_accepts for a teen.',
  })
  async answer(
    @CurrentUser() user: AuthUser,
    @CurrentSession() _session: CurrentSessionInfo,
    @ValidBody(GodConsentAnswerDto) body: GodConsentAnswerDto,
  ): Promise<GodConsentState> {
    if (body.version !== GOD_NOTICE.version) {
      throw refuse(HttpStatus.CONFLICT, 'version_changed', 'The privacy notice has changed. Read the new version first.');
    }
    const before = await godConsentState(user.userId);
    if (before.teen && body.decision === 'accepted') {
      throw refuse(HttpStatus.FORBIDDEN, 'teen_parent_accepts', 'A teen’s parent or guardian accepts for them.');
    }
    if (body.decision === 'declined') {
      if (before.prompt === 'required') {
        throw refuse(HttpStatus.CONFLICT, 'required', 'Accept the privacy notice to finish setting up your account.');
      }
      if (before.accepted) {
        throw refuse(HttpStatus.CONFLICT, 'already_accepted', 'You accepted already. Use “Stop combining my data with GOD” to withdraw.');
      }
    }
    try {
      await recordGodConsent(user.userId, {
        version: body.version,
        decision: body.decision,
        // No workspace yet means this is the sign-up itself.
        method: before.prompt === 'required' ? 'registration' : 'next_sign_in',
      });
    } catch (error) {
      if (consentErrorCode(error) === 'GC001') {
        throw new ForbiddenException({ error: 'teen_parent_accepts', message: 'A teen’s parent or guardian accepts for them.' });
      }
      throw error;
    }
    return godConsentState(user.userId);
  }

  @Post('withdraw')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Stop combining my data with GOD',
    description:
      'Records `withdrawn`. Nothing else changes: the account, its data and normal app use stay as they are. ' +
      '`withdrawn: false` when there was nothing to withdraw (never accepted, or already withdrawn).',
  })
  async withdraw(
    @CurrentUser() user: AuthUser,
    @CurrentSession() _session: CurrentSessionInfo,
  ): Promise<{ withdrawn: boolean; state: GodConsentState }> {
    const withdrawn = await recordGodConsent(user.userId, {
      version: GOD_NOTICE.version,
      decision: 'withdrawn',
      method: 'next_sign_in',
    });
    return { withdrawn, state: await godConsentState(user.userId) };
  }
}
