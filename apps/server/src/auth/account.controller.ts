import {
  BadRequestException,
  Controller,
  Headers,
  HttpCode,
  HttpException,
  HttpStatus,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsEmail, IsString } from 'class-validator';

import {
  CurrentSession,
  CurrentUser,
  SessionGuard,
  type AuthUser,
  type CurrentSessionInfo,
} from '../common/auth.guard.js';
import { ValidBody } from '../common/valid-body.decorator.js';
import { passwordRecordFor } from '../repo.js';
import {
  dispatchMail,
  emailVerificationMessage,
  passwordChangedMessage,
  passwordResetMessage,
} from './account-mail.js';
import {
  changePassword as storeChangedPassword,
  consumeEmailVerification,
  consumePasswordReset,
  hashLinkSecret,
  issueEmailVerification,
  issuePasswordReset,
  newLinkSecret,
  passwordResetIsLive,
} from './account.repo.js';
import { clientIp, type IpAwareRequest } from './client-ip.js';
import { hashPassword, passwordProblem, verifyPassword } from './passwords.js';
import { RateLimiter } from './rate-limit.js';
import { revokeAllSessions, revokeSession } from './sessions.js';
import { signedIn, type SignInResponse } from './signed-in.js';
import { isLinkedToYourTal } from './yourtal-signin/repo.js';

/** Asked about when there is no account, so an unknown address costs the same query. */
const NIL_UUID = '00000000-0000-0000-0000-000000000000';

export class PasswordResetRequestDto {
  @IsEmail({}, { message: 'That does not look like an email address.' })
  email!: string;
}

export class PasswordResetConfirmDto {
  @IsString({ message: 'The reset link is missing its token.' })
  token!: string;

  @IsString({ message: 'A new password is required.' })
  newPassword!: string;
}

export class PasswordChangeDto {
  @IsString({ message: 'Your current password is required.' })
  currentPassword!: string;

  @IsString({ message: 'A new password is required.' })
  newPassword!: string;
}

export class EmailVerificationConfirmDto {
  @IsString({ message: 'The link is missing its token.' })
  token!: string;
}

/*
 * The limits (task 1.2). Fifteen-minute fixed windows, the same as the
 * sign-in limiters, counted in Postgres so every replica shares them.
 *
 *   reset request    3 per address, 10 per IP — each one mails the address,
 *                    so the per-address limit is what stops an inbox being
 *                    flooded; the per-IP limit stops a scrape across many.
 *   reset confirm    10 per IP — the token is 256 bits and cannot be
 *                    guessed; this bounds the scrypt work a caller can buy.
 *   password change  5 per account — the current password IS guessable, so
 *                    a stolen session cannot be used to brute-force it.
 *   verify resend    3 per account, 10 per IP — mails the account's address.
 *   verify confirm   20 per IP — unguessable token; bounds the noise.
 */
const WINDOW = 15 * 60 * 1000;
const resetPerEmail = new RateLimiter(3, WINDOW);
const resetPerIp = new RateLimiter(10, WINDOW);
const resetConfirmPerIp = new RateLimiter(10, WINDOW);
const changePerUser = new RateLimiter(5, WINDOW);
const resendPerUser = new RateLimiter(3, WINDOW);
const resendPerIp = new RateLimiter(10, WINDOW);
const verifyConfirmPerIp = new RateLimiter(20, WINDOW);

const tooMany = () =>
  new HttpException(
    { error: 'rate_limited', message: 'Too many requests. Try again in a few minutes.' },
    HttpStatus.TOO_MANY_REQUESTS,
  );

/**
 * Account safety: password reset and change, email verification, sign-out
 * (task 1.2, migration 0036).
 *
 * Separate from `AuthController` because nothing here signs anybody in from
 * scratch except a completed reset — these are the routes that look after
 * an account that already exists.
 */
@ApiTags('auth')
@Controller('v1/auth')
export class AccountController {
  /* ── Password reset ──────────────────────────────────────────────────── */

  @Post('password/reset/request')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Email a password-reset link',
    description:
      'Always answers 200 {ok:true}, whether or not the address has an account, and in the same ' +
      'time: the database work is one call either way and the mail is sent after the response. ' +
      'The link works once, for 30 minutes, and a newer request replaces it. 429 past 3 requests ' +
      'per address or 10 per IP in 15 minutes — counted before the address is looked up, so the ' +
      'limit cannot tell you whether it exists either.',
  })
  async requestPasswordReset(
    @ValidBody(PasswordResetRequestDto) body: PasswordResetRequestDto,
    @Req() request: IpAwareRequest = {},
  ): Promise<{ ok: true }> {
    const email = body.email.trim().toLowerCase();
    if (
      !(await resetPerIp.consume(`reset:ip:${clientIp(request)}`)) ||
      !(await resetPerEmail.consume(`reset:email:${email}`))
    ) {
      throw tooMany();
    }

    // The secret is made whether or not it will be used, so both paths do
    // the same work up to the one database call.
    const link = newLinkSecret();
    const account = await issuePasswordReset(email, link.hash);
    // An account linked to YourTal has no SnapApp password door any more
    // (docs/26 §1.10), so it gets no reset link: the row just written holds
    // only a hash of a secret that is never sent, and dies unused. The check
    // runs either way, so both paths still cost the same.
    const linked = await isLinkedToYourTal(account?.userId ?? NIL_UUID);
    if (account && !linked) dispatchMail('password_reset', passwordResetMessage(account.email, link.secret));
    return { ok: true };
  }

  @Post('password/reset/confirm')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Set a new password with a reset link, and sign in',
    description:
      'Redeems the link (once), sets the password, marks the address verified, revokes EVERY ' +
      'session of the account, mails a "password changed" notice, and returns a fresh session. ' +
      'An unknown, used, superseded and expired link all answer the same 401.',
  })
  async confirmPasswordReset(
    @ValidBody(PasswordResetConfirmDto) body: PasswordResetConfirmDto,
    @Req() request: IpAwareRequest = {},
  ): Promise<SignInResponse> {
    if (!(await resetConfirmPerIp.consume(`reset-confirm:ip:${clientIp(request)}`))) {
      throw tooMany();
    }

    const problem = passwordProblem(body.newPassword);
    if (problem) throw new BadRequestException(problem);

    const invalid = () =>
      new UnauthorizedException({
        error: 'invalid_link',
        message: 'This reset link has expired or has already been used. Ask for a new one.',
      });

    const hash = hashLinkSecret(body.token);
    // Checked BEFORE hashing the password: a dead link should not cost the
    // server 32 MB of scrypt. The consume below re-checks atomically, so a
    // race between the two cannot redeem a link twice.
    if (!(await passwordResetIsLive(hash))) throw invalid();

    const account = await consumePasswordReset(hash, await hashPassword(body.newPassword));
    if (!account) throw invalid();

    dispatchMail('security_notice', passwordChangedMessage(account.email));
    return signedIn(account.userId, 'snapapp');
  }

  /* ── Password change (signed in) ─────────────────────────────────────── */

  @Post('password/change')
  @UseGuards(SessionGuard)
  @HttpCode(200)
  @ApiOperation({
    summary: 'Change your password',
    description:
      'Needs the current password. Revokes every OTHER session of the account (this one stays ' +
      'signed in) and mails a "password changed" notice. An account with no password yet is ' +
      'told to use the reset link instead.',
  })
  async changePassword(
    @CurrentUser() user: AuthUser,
    @CurrentSession() session: CurrentSessionInfo,
    @ValidBody(PasswordChangeDto) body: PasswordChangeDto,
  ): Promise<{ ok: true }> {
    if (!(await changePerUser.consume(`password-change:${user.userId}`))) throw tooMany();

    const problem = passwordProblem(body.newPassword);
    if (problem) throw new BadRequestException(problem);

    const record = await passwordRecordFor(user.email);
    if (!record?.passwordHash) {
      throw new BadRequestException(
        'This account has no password yet. Use "Forgot password" to set one — the link proves the address first.',
      );
    }
    const ok = await verifyPassword(body.currentPassword, record.passwordHash);
    if (!ok) {
      throw new UnauthorizedException({
        error: 'wrong_password',
        message: 'Your current password is not right.',
      });
    }

    const changed = await storeChangedPassword(session.tokenHash, await hashPassword(body.newPassword));
    // No row means this very session ended between the guard and here.
    if (!changed) throw new UnauthorizedException('Your session has ended. Sign in again.');

    dispatchMail('security_notice', passwordChangedMessage(changed.email));
    return { ok: true };
  }

  /* ── Email verification ──────────────────────────────────────────────── */

  @Post('email/verification/resend')
  @UseGuards(SessionGuard)
  @HttpCode(200)
  @ApiOperation({
    summary: 'Mail a new verification link to your address',
    description:
      'Replaces any earlier link. Answers {alreadyVerified:true} and sends nothing when the ' +
      'address is already proven. 429 past 3 per account or 10 per IP in 15 minutes.',
  })
  async resendVerification(
    @CurrentUser() user: AuthUser,
    @CurrentSession() _session: CurrentSessionInfo,
    @Req() request: IpAwareRequest = {},
  ): Promise<{ alreadyVerified: boolean }> {
    if (user.emailVerified) return { alreadyVerified: true };
    if (
      !(await resendPerIp.consume(`verify-resend:ip:${clientIp(request)}`)) ||
      !(await resendPerUser.consume(`verify-resend:user:${user.userId}`))
    ) {
      throw tooMany();
    }

    const link = newLinkSecret();
    const pending = await issueEmailVerification(user.userId, link.hash);
    if (!pending) return { alreadyVerified: true };
    dispatchMail('email_verification', emailVerificationMessage(pending.email, link.secret));
    return { alreadyVerified: false };
  }

  @Post('email/verification/confirm')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Confirm an email address with the mailed link',
    description:
      'Needs no session: the link is the proof. Works once; a newer link replaces an older one. ' +
      'An unknown, used, superseded and expired link all answer the same 401.',
  })
  async confirmVerification(
    @ValidBody(EmailVerificationConfirmDto) body: EmailVerificationConfirmDto,
    @Req() request: IpAwareRequest = {},
  ): Promise<{ verified: true; email: string }> {
    if (!(await verifyConfirmPerIp.consume(`verify-confirm:ip:${clientIp(request)}`))) {
      throw tooMany();
    }
    const confirmed = await consumeEmailVerification(hashLinkSecret(body.token));
    if (!confirmed) {
      throw new UnauthorizedException({
        error: 'invalid_link',
        message: 'This link has expired or has already been used. Ask for a new one in Settings.',
      });
    }
    return { verified: true, email: confirmed.email };
  }

  /* ── Sign-out ────────────────────────────────────────────────────────── */

  @Post('sign-out')
  @HttpCode(204)
  @ApiOperation({
    summary: 'End this session',
    description:
      'Revokes the session named by the bearer token. Always 204 — a token that is already ' +
      'invalid, expired or revoked is already signed out, and a client must be able to sign out ' +
      'without first proving its session is alive.',
  })
  async signOut(@Headers('authorization') authorization?: string): Promise<void> {
    const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : undefined;
    await revokeSession(token);
  }

  @Post('sign-out-everywhere')
  @UseGuards(SessionGuard)
  @HttpCode(200)
  @ApiOperation({
    summary: 'End every session of your account, this one included',
    description: 'For a lost phone or a shared computer. Returns how many sessions were ended.',
  })
  async signOutEverywhere(
    @CurrentSession() session: CurrentSessionInfo,
  ): Promise<{ revoked: number }> {
    return { revoked: await revokeAllSessions(session.tokenHash) };
  }
}
