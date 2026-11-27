import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Logger,
  Param,
  Patch,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type {
  MailAppPasswordCreated,
  MailAppPasswordList,
  MailEnableResult,
  MailErrorCode,
  MailSessionToken,
  MailSettingsView,
  MailStatementImportList,
  MailStatus,
  RegisterPushTokenRequest,
  UnregisterPushTokenRequest,
} from '@snap/api-contract';
import { IsBoolean, IsIn, IsOptional, IsString, IsUUID, Length, Matches } from 'class-validator';

import { RateLimiter } from '../auth/rate-limit.js';
import { CurrentSession, CurrentUser, SessionGuard, type AuthUser, type CurrentSessionInfo } from '../common/auth.guard.js';
import { ValidBody } from '../common/valid-body.decorator.js';
import { mailAvailable } from './enabled.js';
import { listImports } from './statements/imports.repo.js';
import { reasonOf } from './statements/statement-event.js';
import {
  deletePushToken,
  getMailSettings,
  ownedWorkspaceIds,
  registerPushToken,
  saveMailSettings,
  yourtalSubOf,
} from './mail.repo.js';
import {
  shapeAppPasswordCreated,
  shapeAppPasswordList,
  shapeEnable,
  shapeSession,
  shapeStatus,
  yourtalAppPasswordCreate,
  yourtalAppPasswordList,
  yourtalAppPasswordRevoke,
  yourtalMailEnable,
  yourtalMailSession,
  yourtalMailSettings,
  yourtalMailStatus,
  type MailCall,
  type MailFailure,
} from './yourtal-mail.js';

type Reply = { header: (name: string, value: string) => unknown; status: (code: number) => unknown };

const refuse = (status: HttpStatus, error: MailErrorCode | string, message: string): HttpException =>
  new HttpException({ error, message }, status);

/** Opening a mailbox or a mail session is a person's own act: a stolen request must not become a flood. */
const sessionsPerUser = new RateLimiter(20, 60_000);
const appPasswordsPerUser = new RateLimiter(10, 10 * 60_000);

export class UpdateMailSettingsDto {
  @IsOptional()
  @IsBoolean()
  statements?: boolean;

  /** null clears the choice. */
  @IsOptional()
  @IsUUID()
  workspaceId?: string | null;

  @IsOptional()
  @IsBoolean()
  alerts?: boolean;
}

export class CreateMailAppPasswordDto {
  /** What the person calls the phone or app: 1 to 40 characters, not blank. */
  @IsString()
  @Length(1, 40)
  @Matches(/\S/)
  name!: string;
}

export class RegisterPushTokenDto implements RegisterPushTokenRequest {
  /** An FCM registration token: letters, digits and `-_:.`. */
  @IsString()
  @Length(20, 4096)
  @Matches(/^[A-Za-z0-9_:.-]+$/)
  token!: string;

  @IsIn(['android'])
  platform!: 'android';
}

export class UnregisterPushTokenDto implements UnregisterPushTokenRequest {
  @IsString()
  @Length(20, 4096)
  @Matches(/^[A-Za-z0-9_:.-]+$/)
  token!: string;
}

/** An app password's id as YourTal issues it; never an arbitrary string into a request body. */
const APP_PASSWORD_ID = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Spambank mail, SnapApp's bridge (spambank/BUILD.md §5.6, ticket T11).
 *
 *   GET    /v1/mail/status               the mailbox and settings, for the Mail screen
 *   POST   /v1/mail/enable               switch the mailbox on (idempotent)
 *   POST   /v1/mail/session              a 30-minute mail token for the shared engine
 *   PATCH  /v1/mail/settings             statements on/off + workspace, alerts on/off
 *   GET    /v1/mail/app-passwords        the person's app passwords
 *   POST   /v1/mail/app-passwords        a new one (the secret is shown once)
 *   DELETE /v1/mail/app-passwords/:id    revoke one
 *   GET    /v1/mail/imports              statements imported from the mailbox (T12)
 *
 * The mailbox lives at YourTal. Each call is made by SnapApp's server client
 * naming the person by their YourTal `sub`, which is read from THEIR OWN session
 * (`mail_yourtal_sub`, 0060): nothing from the request can name anyone else.
 * USER-scoped, and each route takes `@CurrentSession`, so staff acting as a user
 * (impersonation) are refused: a mail token opens someone's inbox.
 *
 * Errors are `{ error, message }`; see `MailErrorCode`. Nothing here logs a
 * `sub`, a token or an app-password secret, and the two answers that carry a
 * credential are `Cache-Control: no-store`.
 */
@ApiTags('mail')
@Controller('v1/mail')
@UseGuards(SessionGuard)
export class MailController {
  private readonly logger = new Logger('mail');

  @Get('status')
  @ApiOperation({
    summary: 'Whether mail is available, whether this account can use it, and its mailbox',
    description:
      '`available: false` hides every mail entry (switched off here, or no YourTal client). `linked: false` means the person did not sign in with YourTal. 403 not_allowed is reported inside `mailbox.state`.',
  })
  async status(@CurrentUser() user: AuthUser, @CurrentSession() _session: CurrentSessionInfo): Promise<MailStatus> {
    const local = await getMailSettings(user.userId);
    const settings: MailSettingsView = { statements: false, workspaceId: local?.importTenantId ?? null, alerts: local?.alerts ?? true };
    if (!mailAvailable()) return { available: false, linked: false, mailbox: null, settings };

    const sub = await yourtalSubOf(user.userId);
    if (!sub) return { available: true, linked: false, mailbox: null, settings };

    const result = await yourtalMailStatus(sub);
    if (!result.ok) {
      if (result.reason === 'unknown_subject') return { available: true, linked: false, mailbox: null, settings };
      if (result.reason === 'not_allowed') {
        return { available: true, linked: true, mailbox: { state: 'not_allowed' }, settings };
      }
      throw this.failure('status', result);
    }
    const shaped = shapeStatus(result.body);
    if (!shaped) throw this.failure('status', { ok: false, reason: 'rejected', status: result.status, code: 'bad_shape' });
    return {
      available: true,
      linked: true,
      mailbox: shaped.mailbox,
      settings: { statements: shaped.statements ?? false, workspaceId: settings.workspaceId, alerts: shaped.alerts ?? settings.alerts },
    };
  }

  @Post('enable')
  @ApiOperation({
    summary: 'Switch the mailbox on',
    description: '201 for a new mailbox, 200 when it already existed (same address either way).',
  })
  async enable(
    @CurrentUser() user: AuthUser,
    @CurrentSession() _session: CurrentSessionInfo,
    @Res({ passthrough: true }) reply: Reply,
  ): Promise<MailEnableResult> {
    const sub = await this.subFor(user);
    if (!(await sessionsPerUser.consume(`mail-enable:${user.userId}`))) throw this.tooMany();
    const result = await yourtalMailEnable(sub);
    if (!result.ok) throw this.failure('enable', result);
    const shaped = shapeEnable(result.body, result.status === 201);
    if (!shaped) throw this.failure('enable', { ok: false, reason: 'rejected', status: result.status, code: 'bad_shape' });
    reply.status(result.status === 201 ? 201 : 200);
    return shaped;
  }

  @Post('session')
  @HttpCode(200)
  @ApiOperation({
    summary: 'A 30-minute mail token for the shared mail engine',
    description: 'The engine calls this again 2 minutes before the token expires, or on a 401 from the mail proxy.',
  })
  async session(
    @CurrentUser() user: AuthUser,
    @CurrentSession() _session: CurrentSessionInfo,
    @Res({ passthrough: true }) reply: Reply,
  ): Promise<MailSessionToken> {
    const sub = await this.subFor(user);
    if (!(await sessionsPerUser.consume(`mail-session:${user.userId}`))) throw this.tooMany();
    const result = await yourtalMailSession(sub);
    if (!result.ok) throw this.failure('session', result);
    const shaped = shapeSession(result.body);
    if (!shaped) throw this.failure('session', { ok: false, reason: 'rejected', status: result.status, code: 'bad_shape' });
    reply.header('Cache-Control', 'private, no-store');
    return shaped;
  }

  @Patch('settings')
  @ApiOperation({
    summary: 'Mailed statements (on/off and which workspace) and new-mail alerts',
    description:
      'The workspace must be one the person owns or administers (403 not_workspace_admin). Turning statements on with no workspace chosen picks the first such workspace. Answers the settings as they now stand.',
  })
  async updateSettings(
    @CurrentUser() user: AuthUser,
    @CurrentSession() _session: CurrentSessionInfo,
    @ValidBody(UpdateMailSettingsDto) body: UpdateMailSettingsDto,
  ): Promise<MailSettingsView> {
    const sub = await this.subFor(user);

    const owned = await ownedWorkspaceIds(user.userId);
    if (typeof body.workspaceId === 'string' && !owned.includes(body.workspaceId.toLowerCase())) {
      // Also what a workspace the person does not belong to gets: no hint which it is.
      throw refuse(HttpStatus.FORBIDDEN, 'not_workspace_admin', 'Mailed statements can only go into a workspace you own or administer.');
    }

    const stored = await getMailSettings(user.userId);
    let workspaceId = body.workspaceId === undefined ? (stored?.importTenantId ?? null) : (body.workspaceId?.toLowerCase() ?? null);
    // Turning statements on with nowhere to put them: the first workspace they run.
    if (body.statements === true && !workspaceId) workspaceId = owned[0] ?? null;
    if (body.statements === true && !workspaceId) {
      throw refuse(HttpStatus.FORBIDDEN, 'not_workspace_admin', 'Mailed statements need a workspace you own or administer.');
    }

    const yourtalChange: { statementsToSnapApp?: boolean; newMailAlerts?: boolean } = {
      ...(body.statements === undefined ? {} : { statementsToSnapApp: body.statements }),
      ...(body.alerts === undefined ? {} : { newMailAlerts: body.alerts }),
    };
    // YourTal first: if it refuses, nothing here changes.
    if (Object.keys(yourtalChange).length > 0) {
      const changed = await yourtalMailSettings(sub, yourtalChange);
      if (!changed.ok) throw this.failure('settings', changed);
    }
    const workspaceChanged = workspaceId !== (stored?.importTenantId ?? null);
    const saved = await saveMailSettings(user.userId, {
      ...(workspaceChanged ? { importTenantId: workspaceId } : {}),
      ...(body.alerts === undefined ? {} : { alerts: body.alerts }),
    });

    // What YourTal now holds, for the two switches it keeps.
    const now = await yourtalMailStatus(sub);
    const shaped = now.ok ? shapeStatus(now.body) : null;
    return {
      statements: shaped?.statements ?? body.statements ?? false,
      workspaceId: saved.importTenantId,
      alerts: shaped?.alerts ?? saved.alerts,
    };
  }

  @Get('app-passwords')
  @ApiOperation({ summary: 'App passwords for a phone mail app (names and dates; never the secret)' })
  async listAppPasswords(
    @CurrentUser() user: AuthUser,
    @CurrentSession() _session: CurrentSessionInfo,
  ): Promise<MailAppPasswordList> {
    const sub = await this.subFor(user);
    const result = await yourtalAppPasswordList(sub);
    if (!result.ok) throw this.failure('app-passwords/list', result);
    const shaped = shapeAppPasswordList(result.body);
    if (!shaped) throw this.failure('app-passwords/list', { ok: false, reason: 'rejected', status: result.status, code: 'bad_shape' });
    return shaped;
  }

  @Post('app-passwords')
  @HttpCode(201)
  @ApiOperation({
    summary: 'Make an app password',
    description:
      'The `secret` is in this answer ONCE, with the IMAP and SMTP settings for a phone mail app. At most 5 per mailbox.',
  })
  async createAppPassword(
    @CurrentUser() user: AuthUser,
    @CurrentSession() _session: CurrentSessionInfo,
    @ValidBody(CreateMailAppPasswordDto) body: CreateMailAppPasswordDto,
    @Res({ passthrough: true }) reply: Reply,
  ): Promise<MailAppPasswordCreated> {
    const sub = await this.subFor(user);
    if (!(await appPasswordsPerUser.consume(`mail-app-password:${user.userId}`))) throw this.tooMany();
    const result = await yourtalAppPasswordCreate(sub, body.name.trim());
    if (!result.ok) throw this.failure('app-passwords/create', result);
    const shaped = shapeAppPasswordCreated(result.body);
    if (!shaped) throw this.failure('app-passwords/create', { ok: false, reason: 'rejected', status: result.status, code: 'bad_shape' });
    reply.header('Cache-Control', 'private, no-store');
    return shaped;
  }

  @Delete('app-passwords/:id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Revoke an app password' })
  async revokeAppPassword(
    @CurrentUser() user: AuthUser,
    @CurrentSession() _session: CurrentSessionInfo,
    @Param('id') id: string,
  ): Promise<void> {
    if (!APP_PASSWORD_ID.test(id)) throw refuse(HttpStatus.BAD_REQUEST, 'invalid_id', 'That is not an app password id.');
    const sub = await this.subFor(user);
    const result = await yourtalAppPasswordRevoke(sub, id);
    if (!result.ok) throw this.failure('app-passwords/revoke', result);
  }

  @Get('imports')
  @ApiOperation({
    summary: 'Statements imported from Spambank: the last 50 mailed files and what became of each',
    description:
      'Read from SnapApps alone (no call to YourTal). The workspace is named, and the statement document linked, only where the person is still a member. See `MailStatementImportReason` for the reasons.',
  })
  async imports(@CurrentUser() user: AuthUser, @CurrentSession() _session: CurrentSessionInfo): Promise<MailStatementImportList> {
    if (!mailAvailable()) throw refuse(HttpStatus.NOT_FOUND, 'mail_unavailable', 'Mail is not available.');
    const rows = await listImports(user.userId);
    return {
      items: rows.map((r) => {
        const { reason, message } = reasonOf(r.detail);
        return {
          id: r.id,
          fileName: r.fileName,
          receivedAt: r.receivedAt,
          status: r.status,
          reason,
          message,
          workspace: r.workspace,
          documentId: r.documentId,
          createdAt: r.createdAt,
        };
      }),
    };
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  /** The person's YourTal `sub`, after the checks every mail route shares: mail on here, person signed in with YourTal. */
  private async subFor(user: AuthUser): Promise<string> {
    if (!mailAvailable()) throw refuse(HttpStatus.NOT_FOUND, 'mail_unavailable', 'Mail is not available.');
    const sub = await yourtalSubOf(user.userId);
    if (!sub) {
      throw refuse(HttpStatus.CONFLICT, 'yourtal_not_linked', 'Sign in with YourTal to use your Spambank mail.');
    }
    return sub;
  }

  private tooMany(): HttpException {
    return refuse(HttpStatus.TOO_MANY_REQUESTS, 'rate_limited', 'Too many tries. Wait a minute and try again.');
  }

  /** A YourTal answer we cannot pass on, as the person's refusal. Logs the route, status and code; nothing else. */
  private failure(route: string, call: Extract<MailCall, { ok: false }>): HttpException {
    if (call.reason === 'unavailable' || call.reason === 'rejected' || call.reason === 'spambank_unavailable') {
      this.logger.warn(`mail ${route}: ${call.reason} (status ${call.status ?? 'none'}, code ${call.code ?? 'none'})`);
    }
    return mailFailure(call.reason);
  }
}

/** The refusal a client sees for each way a YourTal call can fail. */
export function mailFailure(reason: MailFailure): HttpException {
  switch (reason) {
    case 'unavailable':
      return refuse(HttpStatus.SERVICE_UNAVAILABLE, 'yourtal_unavailable', 'YourTal is not answering right now. Try again in a minute.');
    case 'spambank_unavailable':
      return refuse(HttpStatus.SERVICE_UNAVAILABLE, 'spambank_unavailable', 'Mail is not answering right now. Try again in a minute.');
    case 'unknown_subject':
      return refuse(HttpStatus.CONFLICT, 'yourtal_not_linked', 'Sign in with YourTal to use your Spambank mail.');
    case 'not_allowed':
      return refuse(HttpStatus.FORBIDDEN, 'not_allowed', 'Spambank mail is not available for this account.');
    case 'not_enabled':
      return refuse(HttpStatus.CONFLICT, 'not_enabled', 'Switch your mailbox on first.');
    case 'rate_limited':
      return refuse(HttpStatus.TOO_MANY_REQUESTS, 'rate_limited', 'Too many tries. Wait a minute and try again.');
    default:
      return refuse(HttpStatus.BAD_GATEWAY, 'yourtal_rejected', 'Something went wrong with mail. Try again later.');
  }
}

/**
 * Phones' push tokens (spambank/BUILD.md §5.6, §4.9): the Android app registers
 * its Firebase Cloud Messaging token so the SnapApp worker can send "You have 3
 * new emails" when a `spambank-mail` event arrives.
 *
 *   POST   /v1/devices/push-token   { token, platform: 'android' } register or refresh
 *   DELETE /v1/devices/push-token   { token }                      forget (sign-out)
 *
 * USER-scoped and the person's own session only. Not gated on mail being on
 * here: a token is a device fact, and registering one does nothing until an
 * alert arrives. A token registered by a second account moves to it.
 */
@ApiTags('mail')
@Controller('v1/devices')
@UseGuards(SessionGuard)
export class DevicesController {
  @Post('push-token')
  @HttpCode(204)
  @ApiOperation({ summary: 'Register this phone for new-mail notifications' })
  async register(
    @CurrentUser() user: AuthUser,
    @CurrentSession() _session: CurrentSessionInfo,
    @ValidBody(RegisterPushTokenDto) body: RegisterPushTokenDto,
  ): Promise<void> {
    await registerPushToken(user.userId, body.token, body.platform);
  }

  @Delete('push-token')
  @HttpCode(204)
  @ApiOperation({ summary: 'Stop sending this phone new-mail notifications', description: 'Forgetting a token that is not there is not an error.' })
  async unregister(
    @CurrentUser() user: AuthUser,
    @CurrentSession() _session: CurrentSessionInfo,
    @ValidBody(UnregisterPushTokenDto) body: UnregisterPushTokenDto,
  ): Promise<void> {
    await deletePushToken(user.userId, body.token);
  }
}
