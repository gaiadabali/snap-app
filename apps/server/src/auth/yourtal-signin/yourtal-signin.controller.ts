import { timingSafeEqual } from 'node:crypto';

import { Controller, Get, HttpCode, Logger, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional, IsString, IsUUID, Length, MaxLength } from 'class-validator';

import { ValidBody } from '../../common/valid-body.decorator.js';
import { clientIp, type IpAwareRequest } from '../client-ip.js';
import { RateLimiter } from '../rate-limit.js';
import { signedIn, type SignInResponse } from '../signed-in.js';
import { identityFromClaims, refusal, refusalCode, sameOriginPath } from './claims.js';
import { isClientConfigured, redeemCode, startAuthorization } from './oidc.js';
import { openFlow, signInWithYourTal, takeFlow } from './repo.js';
import { yourtalSignInSettings, type YourTalClientKind } from './settings.js';

export class YourTalStartDto {
  @IsIn(['web', 'mobile'], { message: 'client must be "web" or "mobile".' })
  client!: YourTalClientKind;

  /** A same-origin path for the website to go to afterwards. */
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  returnTo?: string;

  /** Open YourTal's sign-up form instead of sign-in (`prompt=create`). */
  @IsOptional()
  @IsBoolean()
  signUp?: boolean;

  /** `ui_locales` for YourTal's screens. */
  @IsOptional()
  @IsIn(['en-AU', 'id-ID'])
  locale?: 'en-AU' | 'id-ID';
}

export class YourTalFinishDto {
  @IsUUID('all', { message: 'flowId must be the id returned by start.' })
  flowId!: string;

  @IsString()
  @Length(1, 2048)
  code!: string;

  @IsString()
  @Length(1, 512)
  state!: string;

  /** The `iss` authorization response parameter (RFC 9207). */
  @IsString()
  @Length(1, 2048)
  iss!: string;
}

export type YourTalFinishResponse = SignInResponse & {
  /** Where the website goes next: the same-origin path stored at start, if any. */
  returnTo: string | null;
  /** `linked`: an existing SnapApp account was connected to YourTal just now. */
  outcome: 'signed_in' | 'linked' | 'created';
};

// Per caller, fifteen-minute windows, counted in Postgres like every other
// auth limit (rate-limit.ts). A sign-in is two calls; thirty of each covers a
// household behind one address with room to spare.
const startPerIp = new RateLimiter(30, 15 * 60 * 1000);
const finishPerIp = new RateLimiter(30, 15 * 60 * 1000);

/** Constant-time string comparison for `state` and `iss`. */
function same(a: string, b: string): boolean {
  const x = Buffer.from(a, 'utf8');
  const y = Buffer.from(b, 'utf8');
  return x.byteLength === y.byteLength && timingSafeEqual(x, y);
}

/**
 * Sign in with YourTal (group task 3.3; yourtal/docs/26-sign-in-with-yourtal.md
 * §1.9 is the flow, §1.10 the linking rules).
 *
 *   1. The website or phone app calls `start`, saying which client it is. The
 *      server makes `state`, `nonce` and a PKCE verifier, keeps them in a
 *      ten-minute single-use flow row, and returns YourTal's authorization
 *      URL and the flow id.
 *   2. The person signs in at YourTal, which returns `code`, `state` and `iss`
 *      to the redirect URI.
 *   3. The website or app hands them to `finish` with the flow id. The server
 *      redeems the code (the website's client with its private key, the phone
 *      app's as a public client), verifies the ID token, re-checks the claims,
 *      links or creates the account in one SQL function (0039) and opens an
 *      ordinary SnapApp session.
 *
 * Nothing YourTal issues — code, tokens, ID token — is logged, stored or
 * returned. The log line is the outcome.
 */
@ApiTags('auth')
@Controller('v1/auth/yourtal')
export class YourTalSignInController {
  private readonly logger = new Logger('yourtal-signin');

  @Get()
  @ApiOperation({
    summary: 'Whether Sign in with YourTal is available, per client',
    description: 'Public. `web` and `mobile` are true when that client is configured on this server.',
  })
  status(): { web: boolean; mobile: boolean } {
    return { web: isClientConfigured('web'), mobile: isClientConfigured('mobile') };
  }

  @Post('start')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Start Sign in with YourTal',
    description:
      'Returns YourTal’s authorization URL (state, nonce, PKCE S256, scopes openid email profile account, ' +
      'ui_locales, and prompt=create when signUp) and a flow id that finish needs within 10 minutes. ' +
      '501 not_configured when this client is off.',
  })
  async start(
    @ValidBody(YourTalStartDto) body: YourTalStartDto,
    @Req() request: IpAwareRequest = {},
  ): Promise<{ url: string; flowId: string; expiresAt: string }> {
    if (!(await startPerIp.consume(`yt-start:ip:${clientIp(request)}`))) throw refusal('rate_limited');
    if (!isClientConfigured(body.client)) throw refusal('not_configured');

    let returnTo: string | null = null;
    if (body.returnTo !== undefined && body.returnTo !== '') {
      returnTo = sameOriginPath(body.returnTo);
      if (!returnTo) throw refusal('invalid_return_to');
    }

    const started = await startAuthorization(body.client, {
      signUp: body.signUp === true,
      locale: body.locale ?? 'en-AU',
    });
    const flow = await openFlow({
      client: body.client,
      state: started.state,
      nonce: started.nonce,
      codeVerifier: started.codeVerifier,
      returnTo,
      signUp: body.signUp === true,
    });
    return { url: started.url, flowId: flow.flowId, expiresAt: flow.expiresAt.toISOString() };
  }

  @Post('finish')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Finish Sign in with YourTal and open a SnapApp session',
    description:
      'Takes the flow (once), checks state and iss, redeems the code, verifies the ID token, re-checks ' +
      'region and age band, then finds, links or creates the account and answers like every sign-in. ' +
      'Refusals are { error, message } with error one of invalid_flow, yourtal_failed, yourtal_unavailable, ' +
      'region_not_supported, teen_invite_required, email_unverified, staff_strong_auth_required, ' +
        'staff_reauth_required, ' +
      'account_review, try_again, rate_limited, not_configured.',
  })
  async finish(
    @ValidBody(YourTalFinishDto) body: YourTalFinishDto,
    @Req() request: IpAwareRequest = {},
  ): Promise<YourTalFinishResponse> {
    let client: YourTalClientKind | 'unknown' = 'unknown';
    try {
      if (!(await finishPerIp.consume(`yt-finish:ip:${clientIp(request)}`))) throw refusal('rate_limited');

      const settings = yourtalSignInSettings();
      if (!settings) throw refusal('not_configured');

      // Taken BEFORE anything is compared, so a wrong state or a replay burns
      // the flow: each flow is good for exactly one finish.
      const flow = await takeFlow(body.flowId);
      if (!flow) throw refusal('invalid_flow');
      client = flow.client;

      // The flow binds this response to the browser or app that started it
      // (CSRF, docs/26 §4). `iss` is compared in redeemCode, against the
      // issuer the discovery document names (mix-up, RFC 9207).
      if (!same(body.state, flow.state)) throw refusal('invalid_flow');

      const claims = await redeemCode(flow.client, body, flow);
      const identity = identityFromClaims(claims);

      const result = await signInWithYourTal({
        sub: identity.sub,
        email: identity.email,
        emailVerified: identity.emailVerified,
        name: identity.name,
        strongAuth: identity.strongAuth,
        recentAuth: identity.recentAuth,
      });

      switch (result.outcome) {
        case 'signed_in':
        case 'linked':
        case 'created': {
          const session = await signedIn(result.userId!, 'yourtal');
          this.logger.log(
            `sign-in ok: ${result.outcome} client=${flow.client} user=${result.userId}` +
              (result.emailFlagged ? ' email-copy-kept (collision, sent to review)' : ''),
          );
          return { ...session, returnTo: flow.returnTo, outcome: result.outcome };
        }
        case 'second_sub':
        case 'unlinkable_account':
          this.logger.warn(`sign-in refused: ${result.outcome} client=${flow.client} (sent to review)`);
          throw refusal('account_review');
        case 'email_unverified':
          throw refusal('email_unverified');
        case 'staff_strong_auth_required':
          this.logger.warn(`sign-in refused: staff without a passkey client=${flow.client} user=${result.userId}`);
          throw refusal('staff_strong_auth_required');
        case 'staff_reauth_required':
          this.logger.warn(`sign-in refused: staff sign-in older than 12h client=${flow.client} user=${result.userId}`);
          throw refusal('staff_reauth_required');
        case 'retry':
          throw refusal('try_again');
      }
    } catch (error) {
      const code = refusalCode(error);
      if (code && code !== 'account_review' && code !== 'staff_strong_auth_required' && code !== 'staff_reauth_required') {
        this.logger.log(`sign-in refused: ${code} client=${client}`);
      }
      throw error;
    }
  }
}
