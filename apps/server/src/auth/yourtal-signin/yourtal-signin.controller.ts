import { timingSafeEqual } from 'node:crypto';

import { Controller, Get, HttpCode, Logger, Post, Req, UnauthorizedException } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional, IsString, IsUUID, Length, Matches, MaxLength } from 'class-validator';

import { ValidBody } from '../../common/valid-body.decorator.js';
import { clientIp, type IpAwareRequest } from '../client-ip.js';
import { RateLimiter } from '../rate-limit.js';
import { signedIn, type SignInResponse } from '../signed-in.js';
import { identityFromClaims, refusal, refusalCode, sameOriginPath } from './claims.js';
import { isClientConfigured, redeemCode, startAuthorization } from './oidc.js';
import { moveMismatch, openFlow, setFlowMoveUser, signInWithYourTal, takeFlow } from './repo.js';
import { authenticateSession } from '../sessions.js';
import { yourtalSignInSettings, type YourTalClientKind } from './settings.js';
import { readTeenInvite, teenInvitesConfigured } from '../../teens/invite-api.js';
import {
  attachInviteToFlow,
  hasCategories,
  inviteForSignIn,
  joinTeenSpace,
  teenEmailTaken,
  teenSpaceHeldForSignIn,
} from '../../teens/teens.repo.js';
import { seedDefaultCategories } from '../../settings/settings.repo.js';
import { availableRules, installRulesFor } from '../../taxrules/taxrules.repo.js';

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

  /** Ask YourTal for a fresh sign-in (`prompt=login`), e.g. after `staff_reauth_required`. */
  @IsOptional()
  @IsBoolean()
  freshSignIn?: boolean;

  /** `ui_locales` for YourTal's screens. */
  @IsOptional()
  @IsIn(['en-AU', 'id-ID'])
  locale?: 'en-AU' | 'id-ID';

  /** The code from a parent's join link (group 3.10): sent to YourTal as `teen_invite`. */
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{16,128}$/, { message: 'teenInvite is not an invite code.' })
  teenInvite?: string;

  /**
   * "Sign in with YourTal to keep your account" (3.6.e): the sign-in must end
   * in the account whose session makes this request. A flag only: the account
   * is read from the Authorization header, never from the body.
   */
  @IsOptional()
  @IsBoolean()
  moveCurrentAccount?: boolean;
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
      'ui_locales, prompt=create when signUp, prompt=login when freshSignIn) and a flow id that finish needs within 10 minutes. ' +
      '501 not_configured when this client is off. With teenInvite (a parent’s join link), 403 teen_invite_expired ' +
      'when the code is unknown here or past its expiry.',
  })
  async start(
    @ValidBody(YourTalStartDto) body: YourTalStartDto,
    @Req() request: IpAwareRequest & { headers?: Record<string, string | undefined> } = {},
  ): Promise<{ url: string; flowId: string; expiresAt: string }> {
    if (!(await startPerIp.consume(`yt-start:ip:${clientIp(request)}`))) throw refusal('rate_limited');
    if (!isClientConfigured(body.client)) throw refusal('not_configured');

    // The account to keep comes from the caller's own session, checked here.
    let moveUserId: string | null = null;
    if (body.moveCurrentAccount === true) {
      const header = request.headers?.authorization;
      const session = await authenticateSession(header?.startsWith('Bearer ') ? header.slice(7) : undefined);
      if (!session) {
        throw new UnauthorizedException({ error: 'session_expired', message: 'Your session has ended. Sign in again.' });
      }
      moveUserId = session.user.userId;
    }

    let returnTo: string | null = null;
    if (body.returnTo !== undefined && body.returnTo !== '') {
      returnTo = sameOriginPath(body.returnTo);
      if (!returnTo) throw refusal('invalid_return_to');
    }

    const started = await startAuthorization(body.client, {
      signUp: body.signUp === true,
      locale: body.locale ?? 'en-AU',
      freshSignIn: body.freshSignIn === true,
      ...(body.teenInvite ? { teenInvite: body.teenInvite } : {}),
    });
    const flow = await openFlow({
      client: body.client,
      state: started.state,
      nonce: started.nonce,
      codeVerifier: started.codeVerifier,
      returnTo,
      signUp: body.signUp === true,
    });
    if (moveUserId && !(await setFlowMoveUser(flow.flowId, moveUserId))) throw refusal('invalid_flow');
    // A code this server never issued (or past its expiry) could never be
    // matched to its invite at finish: say so now, before YourTal.
    if (body.teenInvite && !(await attachInviteToFlow(body.teenInvite, flow.flowId))) {
      throw refusal('teen_invite_expired');
    }
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
      'region_not_supported, teen_invite_required, teen_access_ended, teen_account_in_use, email_unverified, staff_strong_auth_required, ' +
        'staff_reauth_required, yourtal_email_mismatch (a move flow whose YourTal email is not the signed-in account’s), ' +
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
      // the flow: each flow is good for exactly one finish. A flow that
      // carries a send to Free Tax Returns (0050) is not taken here and is
      // left unused: it belongs to POST /v1/ftr-sends/finish.
      const flow = await takeFlow(body.flowId);
      if (!flow) throw refusal('invalid_flow');
      client = flow.client;

      // The flow binds this response to the browser or app that started it
      // (CSRF, docs/26 §4). `iss` is compared in redeemCode, against the
      // issuer the discovery document names (mix-up, RFC 9207).
      if (!same(body.state, flow.state)) throw refusal('invalid_flow');

      const claims = await redeemCode(flow.client, body, flow);
      const identity = identityFromClaims(claims);

      // From the move prompt: only into the account that asked, or nothing is
      // written (0048). Before the teen checks and before any sign-in write.
      if (await moveMismatch(body.flowId, identity.sub, identity.email)) throw refusal('yourtal_email_mismatch');

      // A teen (docs/26 §3.3 step 6, and §1.5's check 4 repeated here): the
      // invite must be ACCEPTED at YourTal by exactly this `sub`. Checked
      // before any account is made, at every teen sign-in.
      let teenInviteId: string | null = null;
      if (identity.ageBand === 'teen') {
        teenInviteId = teenInvitesConfigured() ? await inviteForSignIn(body.flowId, identity.sub) : null;
        if (!teenInviteId) throw refusal('teen_invite_required');
        const invite = await readTeenInvite(teenInviteId);
        if (!invite) throw refusal('yourtal_unavailable');
        if (invite.status !== 'accepted' || invite.teenSub !== identity.sub) throw refusal('teen_invite_required');
        // A teen is never linked by email (0039's rule 2 would bind, and lock,
        // someone else's account here): refused before anything is written.
        if (await teenEmailTaken(identity.sub, identity.email)) {
          this.logger.warn(`teen sign-in refused: email held by an account here client=${flow.client}`);
          throw refusal('teen_account_in_use');
        }
      }

      // A held teen space (0047) opens only to the teen's new invite, above.
      // Anyone else, such as a teen who turned 18 during the hold, waits for
      // the erasure: no session into data that is being deleted.
      if (identity.ageBand !== 'teen' && (await teenSpaceHeldForSignIn(identity.sub))) {
        throw refusal('teen_access_ended');
      }

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
          if (teenInviteId) await this.teenSpaceFor(result.userId!, body.flowId, identity);
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
        case 'erased':
          // Only reachable if YourTal re-issues a `sub` it told us it deleted
          // (say, after restoring a backup): support has to look.
          this.logger.warn(`sign-in refused: erased sub client=${flow.client}`);
          throw refusal('account_review');
      }
    } catch (error) {
      const code = refusalCode(error);
      if (code && code !== 'account_review' && code !== 'staff_strong_auth_required' && code !== 'staff_reauth_required') {
        this.logger.log(`sign-in refused: ${code} client=${client}`);
      }
      throw error;
    }
  }

  /** The teen's own space, made at their first sign-in; the parent gets read-only access (0045). */
  private async teenSpaceFor(userId: string, flowId: string, identity: { name?: string; region: 'AU' | 'ID' }) {
    let joined: { tenantId: string; created: boolean };
    try {
      const name = identity.name ? `${identity.name}’s space` : 'My space';
      joined = await joinTeenSpace(userId, { flowId, name, region: identity.region });
    } catch (error) {
      const code = (error as { cause?: { code?: string }; code?: string })?.cause?.code ?? (error as { code?: string })?.code;
      if (code === 'TS002') throw refusal('teen_invite_required');
      if (code === 'TS003') {
        this.logger.warn(`teen sign-in refused: account already has workspaces user=${userId}`);
        throw refusal('teen_account_in_use');
      }
      throw error;
    }
    // Set up like any new personal workspace: categories, and the region's tax
    // rules where this deployment has them (as onboarding does). Until it has
    // categories, so a setup that failed after the join is redone next sign-in.
    if (await hasCategories(userId, joined.tenantId)) return;
    await seedDefaultCategories(userId, joined.tenantId, 'personal');
    const rules = availableRules().find((r) => r.country === identity.region);
    if (rules) await installRulesFor(userId, joined.tenantId, rules.rulesId);
  }
}
