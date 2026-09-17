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
import { IsEmail, IsOptional, IsString } from 'class-validator';

import { CurrentUser, SessionGuard, type AuthUser } from '../common/auth.guard.js';
import { ValidBody } from '../common/valid-body.decorator.js';
import { config, isGoogleSignInSimulatorEnabled, isProduction } from '../config.js';
import {
  listDemoAccounts,
  listWorkspacesFor,
  passwordRecordFor,
  registerWithPassword,
  upsertUserByEmail,
} from '../repo.js';
import { getDb } from '../db.js';
import { issueMagicLinkToken, issueSession, readMagicLinkToken } from '../tokens.js';
import { GoogleIdTokenError, verifyGoogleIdToken } from './google-verify.js';
import { tryConsume } from './magic-link-store.js';
import { getMailer } from './mailer.js';
import {
  dummyHash,
  hashPassword,
  passwordProblem,
  verifyPassword,
} from './passwords.js';
import { RateLimiter } from './rate-limit.js';

export class SignInDto {
  @IsEmail({}, { message: 'That does not look like an email address.' })
  email!: string;
}

export class PasswordCredentialsDto {
  @IsEmail({}, { message: 'That does not look like an email address.' })
  email!: string;

  @IsString({ message: 'A password is required.' })
  password!: string;
}

export class RegisterDto extends PasswordCredentialsDto {
  /** Optional: falls back to the local part of the address. */
  @IsOptional()
  @IsString({ message: 'A name must be text.' })
  displayName?: string;
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

export class GoogleSimulatorSignInDto {
  /** Must exactly match one of `listDemoAccounts()` — never an arbitrary address. */
  @IsEmail({}, { message: 'That does not look like an email address.' })
  email!: string;
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
    // A DEMO HOST is the one exception, and it is deliberately narrow.
    //
    // The native app signs in through this endpoint. It has no browser, so the
    // Google simulator's redirect flow is not available to it, and closing
    // this outright left the app with no way in at all — "not found" on
    // sign-in and an empty account picker, which is what a reviewer hit.
    //
    // So on a demo host it stays reachable, but ONLY for addresses already
    // seeded as demo identities: the same allow-list the Google simulator
    // enforces. The dangerous property stays closed. This is never "sign in as
    // anyone", it is "sign in as one of a fixed set of demo people". A real
    // production deployment sets no DEMO_ENV, fails
    // `isGoogleSignInSimulatorEnabled()`, and gets the 404 unconditionally.
    const demoHost = isGoogleSignInSimulatorEnabled();
    if (isProduction() && !demoHost) {
      throw new HttpException('Not found', HttpStatus.NOT_FOUND);
    }

    const email = body.email.trim().toLowerCase();

    if (isProduction()) {
      const identities = await listDemoAccounts();
      if (!identities.some((candidate) => candidate.email.toLowerCase() === email)) {
        // Still 404 — the status must not distinguish "wrong address" from
        // "no such route", or it becomes an oracle for which accounts exist.
        //
        // The MESSAGE can be helpful here, though, and only here: a demo host
        // publishes its identities on the sign-in screen itself, so naming the
        // situation reveals nothing that is not already on the page. A bare
        // "Not found" sent a reviewer looking for a bug that did not exist.
        // A real production host never reaches this branch.
        throw new HttpException(
          'That address is not one of this demo host’s accounts. Pick one from the list below.',
          HttpStatus.NOT_FOUND,
        );
      }
    }

    const nameFromEmail = nameFromAddress(email);

    const user = await upsertUserByEmail(email, nameFromEmail);
    // Read the memberships with a user context and no tenant context — the one
    // query that is legitimately answered in that state (migration 0012).
    const workspaces = await listWorkspacesFor(getDb(), user.userId);

    return { token: issueSession(user.userId), user, workspaces };
  }

  @Post('register')
  @HttpCode(201)
  @ApiOperation({
    summary: 'Create an account with an email address and a password',
    description:
      'Registration is the same account the website dashboard uses: one users row, one memberships row per workspace. There is NO password reset in this build, because no mail transport is configured.',
  })
  async register(@ValidBody(RegisterDto) body: RegisterDto): Promise<{
    token: string;
    user: AuthUser;
    workspaces: Array<{ id: string; name: string; kind: string; role: string }>;
  }> {
    const email = body.email.trim().toLowerCase();
    const ip = 'register';
    // Registration is a write and a scrypt hash, so it is rate limited on the
    // same limiters the magic link uses rather than left open.
    if (!perEmailLimiter.consume(`register:${email}`) || !perIpLimiter.consume(`ip:${ip}`)) {
      throw new HttpException('Too many attempts. Try again shortly.', HttpStatus.TOO_MANY_REQUESTS);
    }

    const problem = passwordProblem(body.password);
    if (problem) throw new HttpException(problem, HttpStatus.BAD_REQUEST);

    const displayName = (body.displayName ?? '').trim() || nameFromAddress(email);
    const user = await registerWithPassword(email, displayName, await hashPassword(body.password));
    if (!user) {
      // The address already carries a password. This DOES disclose that an
      // account exists, and that is unavoidable for a registration endpoint:
      // the alternative is to accept the request and silently not create
      // anything, which leaves the person stuck with no way to tell why they
      // cannot sign in. Enumeration is closed on sign-in, where it matters.
      throw new HttpException('That address already has an account.', HttpStatus.CONFLICT);
    }

    const workspaces = await listWorkspacesFor(getDb(), user.userId);
    return { token: issueSession(user.userId), user, workspaces };
  }

  @Post('password/sign-in')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Exchange an email address and password for a session token',
    description:
      'Answers identically for an unknown address, an account with no password, and a wrong password.',
  })
  async passwordSignIn(@ValidBody(PasswordCredentialsDto) body: PasswordCredentialsDto): Promise<{
    token: string;
    user: AuthUser;
    workspaces: Array<{ id: string; name: string; kind: string; role: string }>;
  }> {
    const email = body.email.trim().toLowerCase();
    if (!perEmailLimiter.consume(`pwd:${email}`) || !perIpLimiter.consume('ip:password')) {
      throw new HttpException('Too many attempts. Try again shortly.', HttpStatus.TOO_MANY_REQUESTS);
    }

    const record = await passwordRecordFor(email);
    // Three cases, ONE answer and one cost. An unknown address still spends a
    // full scrypt verification against a hash of a random secret, so "no such
    // account", "account exists but signs in with Google", and "wrong password"
    // are indistinguishable from outside — by response and by timing.
    const stored = record?.passwordHash ?? (await dummyHash());
    const ok = await verifyPassword(body.password, stored);
    if (!ok || !record || !record.passwordHash) {
      throw new HttpException('Email or password is incorrect.', HttpStatus.UNAUTHORIZED);
    }

    const workspaces = await listWorkspacesFor(getDb(), record.user.userId);
    return { token: issueSession(record.user.userId), user: record.user, workspaces };
  }

  @Get('demo-accounts')
  @ApiOperation({
    summary: 'The seeded demo accounts',
    description:
      'So a presenter can switch person without typing an address. Returns nothing in production — a list of real sign-in addresses is not something to serve publicly.',
  })
  async demoAccounts(): Promise<Array<{ userId: string; email: string; displayName: string }>> {
    // Empty on a real production host — a list of sign-in addresses is not
    // something to serve publicly. Populated on a demo host, because the app's
    // account picker is the only way a reviewer signs in there, and the same
    // triple gate that permits the simulator permits this. These are seeded
    // fixtures, not real customers.
    if (isProduction() && !isGoogleSignInSimulatorEnabled()) return [];
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

  /* ── Simulated Google sign-in (staging/demo host only) ───────────────────
   *
   * Stands in for the real `oauth/google` exchange above for exactly one
   * reason: an investor demo on a public host that has no Google OAuth
   * credentials yet and whose mailer is still `NoopMailer`, so on a real
   * deploy today nobody can sign in at all (docs/DEPLOY.md §3).
   *
   * `isGoogleSignInSimulatorEnabled()` (apps/server/src/config.ts) is the
   * actual boundary — three independent conditions, none satisfiable by a
   * plain production build, and it returns false unconditionally the moment
   * real Google credentials exist, so the genuine flow above always takes
   * precedence with nothing to unset.
   *
   * This only ever simulates the IDENTITY ASSERTION. The identity itself is
   * still constrained to the fixed, seeded accounts `listDemoAccounts()`
   * already serves elsewhere in this file — never an arbitrary address — and
   * everything downstream is the exact same `upsertUserByEmail` +
   * `issueSession` call the real flow makes, so the session shape, cookie,
   * onboarding and workspace/RBAC behaviour are identical either way.
   */

  @Get('google-simulator/identities')
  @ApiOperation({
    summary: 'The identities the Google sign-in simulator may sign in as (DEMO HOST ONLY)',
    description:
      '404 unless isGoogleSignInSimulatorEnabled() is true — same refusal shape as every other ' +
      'gate in this controller. The same fixed, seeded accounts as GET /v1/auth/demo-accounts.',
  })
  async googleSimulatorIdentities(): Promise<
    Array<{ userId: string; email: string; displayName: string }>
  > {
    if (!isGoogleSignInSimulatorEnabled()) {
      throw new HttpException('Not found', HttpStatus.NOT_FOUND);
    }
    return listDemoAccounts();
  }

  @Post('google-simulator/sign-in')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Sign in as a seeded demo identity, simulating Google (DEMO HOST ONLY)',
    description:
      '404 unless isGoogleSignInSimulatorEnabled() is true. The requested email must exactly ' +
      'match one of listDemoAccounts() (case-insensitive) — anything else gets the identical ' +
      '404, before this touches the database for anything beyond that lookup, so a stranger who ' +
      'finds this host cannot enumerate or sign in as an address of their choosing.',
  })
  async googleSimulatorSignIn(
    @ValidBody(GoogleSimulatorSignInDto) body: GoogleSimulatorSignInDto,
  ): Promise<{
    token: string;
    user: AuthUser;
    workspaces: Array<{ id: string; name: string; kind: string; role: string }>;
  }> {
    // THE GATE. Checked first and unconditionally, same as `signIn` above —
    // a production server (the demo host included, absent its two extra
    // opt-ins) must not admit this route exists any more than that one does.
    if (!isGoogleSignInSimulatorEnabled()) {
      throw new HttpException('Not found', HttpStatus.NOT_FOUND);
    }

    const requested = body.email.trim().toLowerCase();
    const identities = await listDemoAccounts();
    const identity = identities.find((candidate) => candidate.email.toLowerCase() === requested);
    if (!identity) {
      // Same status and message as "the simulator does not exist" — an
      // address that is not on the allow-list learns nothing about which
      // addresses ARE on it.
      throw new HttpException('Not found', HttpStatus.NOT_FOUND);
    }

    const user = await upsertUserByEmail(identity.email, identity.displayName);
    const workspaces = await listWorkspacesFor(getDb(), user.userId);
    return { token: issueSession(user.userId), user, workspaces };
  }
}

/** `jo.smith@x.com` -> `Jo Smith`. Used wherever an account is created. */
function nameFromAddress(email: string): string {
  return (email.split('@')[0] ?? 'You')
    .replace(/[._-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
