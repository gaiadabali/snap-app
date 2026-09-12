import {
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Logger,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsEmail, IsString } from 'class-validator';

import { CurrentUser, SessionGuard, type AuthUser } from '../common/auth.guard.js';
import { ValidBody } from '../common/valid-body.decorator.js';
import { config, isProduction } from '../config.js';
import { listDemoAccounts, listWorkspacesFor, upsertUserByEmail } from '../repo.js';
import { getDb } from '../db.js';
import { issueMagicLinkToken, issueSession, readMagicLinkToken } from '../tokens.js';
import { GoogleIdTokenError, verifyGoogleIdToken } from './google-verify.js';
import { tryConsume } from './magic-link-store.js';
import { getMailer } from './mailer.js';
import { RateLimiter } from './rate-limit.js';

export class SignInDto {
  @IsEmail({}, { message: 'That does not look like an email address.' })
  email!: string;
}

export class MagicLinkRequestDto {
  @IsEmail({}, { message: 'That does not look like an email address.' })
  email!: string;
}

export class MagicLinkConsumeDto {
  @IsString({ message: 'A token is required.' })
  token!: string;
}

export class GoogleExchangeDto {
  /** The raw `id_token` JWT from Google's token endpoint — verified here, not trusted. */
  @IsString({ message: 'An ID token is required.' })
  idToken!: string;

  /** The nonce the web app bound to this sign-in attempt before the redirect. */
  @IsString({ message: 'A nonce is required.' })
  nonce!: string;
}

/** The bit of the request this controller reads for rate limiting. Fastify supplies `.ip`. */
type IpAwareRequest = { ip?: string };

// Five requests per address, twenty per source IP, both per fifteen minutes —
// blunts a targeted flood of one inbox and a broad scrape across many
// addresses without needing a shared store (see RateLimiter's own comment).
const perEmailLimiter = new RateLimiter(5, 15 * 60 * 1000);
const perIpLimiter = new RateLimiter(20, 15 * 60 * 1000);

/**
 * Sign-in.
 *
 * There is no password parameter and there will not be one. In production this
 * endpoint hands off to an identity provider and the server stores only the
 * external subject; a finance application that keeps its own password table is
 * a breach waiting for a news cycle.
 *
 * For now it trusts the address, which is fine for development and must not
 * ship: the guard is `NODE_ENV`, and the replacement is an OIDC code exchange
 * that lands in this same shape.
 */
@ApiTags('auth')
@Controller('v1/auth')
export class AuthController {
  private readonly logger = new Logger('auth');

  @Post('sign-in')
  // 200, not Nest's default 201: signing in does not create a resource at a
  // URL, and a client checking for 201 would be checking the wrong thing.
  @HttpCode(200)
  @ApiOperation({
    summary: 'Exchange an email address for a session token (NON-PRODUCTION ONLY)',
    description:
      'Development stand-in for an OIDC code exchange. Creates the user if the address is unknown, in which case the session has no workspaces and the client must run onboarding. Returns 404 when NODE_ENV is production — use Google sign-in or a magic link there.',
  })
  async signIn(@ValidBody(SignInDto) body: SignInDto): Promise<{
    token: string;
    user: AuthUser;
    workspaces: Array<{ id: string; name: string; kind: string; role: string }>;
  }> {
    // THE GATE.
    //
    // This endpoint trades an email address for a full session with no proof
    // that the caller owns it. That is fine in development and is a complete
    // authentication bypass in production: anyone who can reach the API signs
    // in as anyone whose address they can guess.
    //
    // The comment above this class has said "must not ship" since it was
    // written, but nothing enforced it. `isProduction()` was applied to the
    // endpoint that LISTS demo accounts and not to the one that ISSUES
    // sessions — the list feels like the sensitive half, and it is not.
    //
    // 404 rather than 403: a production server should not advertise that a
    // bypass route exists here at all. Same reasoning as keeping expired and
    // forged tokens indistinguishable elsewhere in this file.
    if (isProduction()) {
      throw new HttpException('Not found', HttpStatus.NOT_FOUND);
    }

    const email = body.email.trim().toLowerCase();
    const nameFromEmail = (email.split('@')[0] ?? 'You')
      .replace(/[._-]+/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());

    const user = await upsertUserByEmail(email, nameFromEmail);
    // Read the memberships with a user context and no tenant context — the one
    // query that is legitimately answered in that state (migration 0012).
    const workspaces = await listWorkspacesFor(getDb(), user.userId);

    return { token: issueSession(user.userId), user, workspaces };
  }

  @Get('demo-accounts')
  @ApiOperation({
    summary: 'The seeded demo accounts',
    description:
      'So a presenter can switch person without typing an address. Returns nothing in production — a list of real sign-in addresses is not something to serve publicly.',
  })
  async demoAccounts(): Promise<Array<{ userId: string; email: string; displayName: string }>> {
    if (isProduction()) return [];
    return listDemoAccounts();
  }

  @Get('session')
  @UseGuards(SessionGuard)
  @ApiOperation({ summary: 'The signed-in user and the workspaces they belong to' })
  async session(@CurrentUser() user: AuthUser): Promise<{
    user: AuthUser;
    workspaces: Array<{ id: string; name: string; kind: string; role: string }>;
  }> {
    return { user, workspaces: await listWorkspacesFor(getDb(), user.userId) };
  }

  /* ── Magic links (passwordless email sign-in / registration) ────────────── */

  @Post('magic-link/request')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Request a passwordless sign-in link',
    description:
      'Always answers 200, whether or not the address has an account and whether or not the ' +
      'send actually succeeded — a different answer for "no such user" is exactly how this kind ' +
      'of endpoint gets used to enumerate real addresses.',
  })
  async requestMagicLink(
    @ValidBody(MagicLinkRequestDto) body: MagicLinkRequestDto,
    @Req() request: IpAwareRequest,
  ): Promise<{ ok: true }> {
    const email = body.email.trim().toLowerCase();
    const ip = request.ip ?? 'unknown';

    if (!perEmailLimiter.consume(`email:${email}`) || !perIpLimiter.consume(`ip:${ip}`)) {
      throw new HttpException(
        { error: 'rate_limited', message: 'Too many requests. Try again in a few minutes.' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const { token } = issueMagicLinkToken(email);
    const link = `${config().WEB_PUBLIC_URL}/auth/magic/callback?token=${encodeURIComponent(token)}`;
    try {
      await getMailer().send({
        to: email,
        subject: 'Sign in to Snap Apps',
        text:
          `Tap to sign in — this link expires in 15 minutes and works once:\n\n${link}\n\n` +
          'If you did not request this, you can ignore it.',
      });
    } catch (error) {
      // Logged, never surfaced: the doc comment above promises the SAME 200
      // whether the address exists, the mailer is misconfigured, or a
      // provider outage drops the send. Letting a transport failure become a
      // different HTTP response than a normal send is exactly the kind of
      // side channel this endpoint exists to close off, so it is swallowed
      // here rather than left to whichever Mailer implementation happens to
      // be installed to remember not to throw.
      this.logger.error(`magic-link send to ${email} failed`, error instanceof Error ? error.stack : String(error));
    }
    return { ok: true };
  }

  @Post('magic-link/consume')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Exchange a magic-link token for a session',
    description:
      'A token that was never valid, one that has expired, and one already redeemed are all ' +
      'refused with the identical message — the same "expired and forged must be ' +
      'indistinguishable" rule tokens.ts already applies to upload and image tokens, extended one ' +
      'level up. Telling a caller WHICH of the three happened would tell them more than a failed ' +
      'guess should: in particular, "already used" only differs from "never existed" for someone ' +
      'who already holds a genuinely-signed token, which is a stronger position than guessing, but ' +
      "there is no reason to confirm it and no legitimate client needs the distinction — it just " +
      "shows the sign-in form again either way.",
  })
  async consumeMagicLink(@ValidBody(MagicLinkConsumeDto) body: MagicLinkConsumeDto): Promise<{
    token: string;
    user: AuthUser;
    workspaces: Array<{ id: string; name: string; kind: string; role: string }>;
  }> {
    const invalid = () => new UnauthorizedException('This link is invalid or has expired.');

    const decoded = readMagicLinkToken(body.token);
    if (!decoded) throw invalid();
    if (!tryConsume(decoded.jti, decoded.expiresAt)) throw invalid();

    const email = decoded.email;
    const nameFromEmail = (email.split('@')[0] ?? 'You')
      .replace(/[._-]+/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());

    const user = await upsertUserByEmail(email, nameFromEmail);
    const workspaces = await listWorkspacesFor(getDb(), user.userId);
    return { token: issueSession(user.userId), user, workspaces };
  }

  /* ── Google OAuth ─────────────────────────────────────────────────────────
   *
   * The web app runs the redirect and PKCE code exchange (it holds the OAuth
   * client secret — apps/web/src/lib/config.ts#googleOauth) and forwards the
   * raw ID token here. This endpoint does not take the web app's word that
   * the token is genuine: it re-verifies signature, issuer, audience, expiry
   * and nonce independently against Google's own published keys. Anyone who
   * can reach this HTTP endpoint could otherwise hand it any email address
   * and be signed in as that person — the web app is not this process, and a
   * network path between them is a network path an attacker could try too.
   */

  @Post('oauth/google')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Exchange a verified Google ID token for a session',
    description:
      "Independently re-verifies the ID token's signature against Google's JWKS, plus issuer, " +
      'audience, expiry and nonce, before trusting any claim in it. Answers 501 if ' +
      'GOOGLE_CLIENT_ID is not configured yet.',
  })
  async googleExchange(@ValidBody(GoogleExchangeDto) body: GoogleExchangeDto): Promise<{
    token: string;
    user: AuthUser;
    workspaces: Array<{ id: string; name: string; kind: string; role: string }>;
  }> {
    const clientId = config().GOOGLE_CLIENT_ID;
    if (!clientId) {
      throw new HttpException(
        {
          error: 'not_configured',
          message: 'Google sign-in is not configured on this server yet.',
        },
        HttpStatus.NOT_IMPLEMENTED,
      );
    }

    let identity;
    try {
      identity = await verifyGoogleIdToken(body.idToken, clientId, body.nonce);
    } catch (error) {
      const message =
        error instanceof GoogleIdTokenError ? error.message : 'Could not verify that sign-in.';
      throw new UnauthorizedException(message);
    }

    const user = await upsertUserByEmail(identity.email, identity.displayName);
    const workspaces = await listWorkspacesFor(getDb(), user.userId);
    return { token: issueSession(user.userId), user, workspaces };
  }
}
