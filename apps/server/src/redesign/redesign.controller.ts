import {
  BadRequestException,
  Body,
  Controller,
  NotImplementedException,
  Get,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type {
  AlertItem,
  NotificationPrefs,
  PrivacySettings,
  UsageKind,
  UsagePeriod,
} from '@snap/api-contract';

import {
  CurrentUser,
  MembershipGuard,
  SessionGuard,
  WorkspaceId,
  type AuthUser,
} from '../common/auth.guard.js';
import { listCreditUsage, listCreditUsageMonths } from '../credits/credits.repo.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * ⚠ STUBS. Everything in this file is in-process state, not a database.
 *
 * These endpoints exist so the 2026-09-19 mobile redesign has something real
 * to talk to while the surfaces it introduced — an alert feed,
 * per-user notification and privacy choices — get their migrations written.
 * They answer with the right shapes and they mutate consistently within one
 * process, which is enough to develop and demo against.
 *
 * What they are NOT:
 *   - durable. A restart resets every one of them.
 *   - correct across replicas. Two pods disagree, immediately and silently.
 *
 * Before any of this ships to a user:
 *   1. add tables — `alerts`, `notification_prefs`, `privacy_settings` —
 *      all USER-scoped, none tenant-scoped;
 *   2. delete this file's `Map`s and point the controllers at repos.
 *
 * The saved-cards wallet that was here is gone (group task 7.5.d): cards are
 * typed on the processor's hosted checkout page, never into this API.
 *
 * Until those tables exist the mobile client hides the alerts
 * and fingerprint surfaces behind `EXPERIMENTAL_FEATURES_ENABLED`
 * (`apps/mobile/src/config.ts`), off by default. Notification and privacy
 * preferences are NOT hidden: they are still shown, and they still reset to
 * their defaults on a restart.
 *
 * `GET /v1/usage` is the exception: it reads `credit_spends` (7.1.e).
 */

/* ── In-process state, keyed by user ──────────────────────────────────────── */

const alertsRead = new Map<string, string>();
const notificationPrefs = new Map<string, NotificationPrefs>();
const privacySettings = new Map<string, PrivacySettings>();

const DEFAULT_NOTIFICATIONS: NotificationPrefs = {
  budgetTight: true,
  reviewNeeded: true,
  lowCredits: true,
  recurringDue: true,
  productNews: false,
};

/** Every default is the private one. See `PrivacySettings` in the contract. */
const DEFAULT_PRIVACY: PrivacySettings = {
  analyticsOptIn: false,
  crashReports: false,
  contributeToModel: false,
  retentionMonths: 60,
};

/**
 * Copies the known keys of a PATCH body, and nothing else, onto a fresh object.
 *
 * Spreading the raw body stored whatever a client sent — unknown keys, and a
 * known key with the wrong type (`"false"` is truthy). A known key with the
 * wrong type is a 400; an unknown key is ignored. The global ValidationPipe
 * cannot do this here: the body is typed as an interface, not a DTO class.
 */
function pickPrefs<T extends object>(
  body: unknown,
  keys: readonly (keyof T & string)[],
  check: (key: keyof T & string, value: unknown) => string | null,
): Partial<T> {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new BadRequestException('Expected a JSON object.');
  }
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    if (!Object.hasOwn(body, key)) continue;
    const value = (body as Record<string, unknown>)[key];
    const problem = check(key, value);
    if (problem) throw new BadRequestException(`${key}: ${problem}`);
    out[key] = value;
  }
  return out as Partial<T>;
}

const NOTIFICATION_KEYS = Object.keys(DEFAULT_NOTIFICATIONS) as (keyof NotificationPrefs & string)[];
const PRIVACY_KEYS = Object.keys(DEFAULT_PRIVACY) as (keyof PrivacySettings & string)[];

/* ── Usage ────────────────────────────────────────────────────────────────── */

@ApiTags('usage')
@Controller('v1/usage')
@UseGuards(SessionGuard, MembershipGuard)
export class UsageController {
  /**
   * What this workspace's scans spent, one month at a time (group plan
   * 7.1.e), from `credit_spends`. Points are retired here (D33; YourTal's are
   * shown from `GET /v1/yourtal/link`), so `kind=points` is always empty.
   * Paged within the month: `limit` (default 100, at most 500) and `before`.
   */
  @Get()
  @ApiOperation({ summary: 'Itemised scan credit spend for one month (YYYY-MM)' })
  async period(
    @CurrentUser() user: AuthUser,
    @WorkspaceId() tenantId: string,
    @Query('kind') kind: UsageKind,
    @Query('month') month: string,
    @Query('limit') limitParam?: string,
    @Query('before') before?: string,
  ): Promise<UsagePeriod> {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month ?? '')) {
      throw new BadRequestException('month must be YYYY-MM.');
    }
    if (before !== undefined && !UUID.test(before)) throw new BadRequestException('before is not valid.');
    if (kind === 'points') return { month, kind: 'points', total: 0, items: [], nextBefore: null };
    const parsed = Number(limitParam);
    const limit = Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, 500) : 100;
    const page = await listCreditUsage(user.userId, tenantId, month, limit, before ?? null);
    return {
      month,
      kind: 'credits',
      total: page.total,
      items: page.items.map((r) => ({
        id: r.id,
        label: r.label,
        occurredAt: r.occurred_at,
        amount: r.amount,
        ...(r.refunded ? { refunded: true } : {}),
      })),
      nextBefore: page.nextBefore,
    };
  }

  @Get('months')
  @ApiOperation({ summary: 'Months with scan credit spend, newest first' })
  async months(
    @CurrentUser() user: AuthUser,
    @WorkspaceId() tenantId: string,
    @Query('kind') kind?: UsageKind,
  ): Promise<string[]> {
    if (kind === 'points') return [];
    return listCreditUsageMonths(user.userId, tenantId);
  }
}

/* ── Alerts ───────────────────────────────────────────────────────────────── */

@ApiTags('alerts')
@Controller('v1/alerts')
@UseGuards(SessionGuard)
export class AlertsController {
  /**
   * ⚠ Returns nothing, always.
   *
   * Real alerts are derived state — a budget crossing a threshold, a capture
   * coming back low-confidence, credits running down — and deriving them needs
   * a job that watches those events. Until it exists this answers honestly
   * with an empty feed rather than sample rows a user would try to act on.
   */
  @Get()
  @ApiOperation({ summary: 'Your alert feed (STUB — returns empty)' })
  list(): AlertItem[] {
    return [];
  }

  @Post('read')
  @ApiOperation({ summary: 'Mark everything read (STUB)' })
  markRead(@CurrentUser() user: AuthUser): void {
    alertsRead.set(user.userId, new Date().toISOString());
  }
}

/* ── Per-user preferences ─────────────────────────────────────────────────── */

@ApiTags('me')
@Controller('v1/me')
@UseGuards(SessionGuard)
export class MePreferencesController {
  @Get('notifications')
  @ApiOperation({ summary: 'Notification switches (STUB — in-process)' })
  getNotifications(@CurrentUser() user: AuthUser): NotificationPrefs {
    return notificationPrefs.get(user.userId) ?? DEFAULT_NOTIFICATIONS;
  }

  @Patch('notifications')
  @ApiOperation({ summary: 'Change a notification switch (STUB)' })
  setNotifications(
    @CurrentUser() user: AuthUser,
    @Body() body: unknown,
  ): NotificationPrefs {
    const patch = pickPrefs<NotificationPrefs>(body, NOTIFICATION_KEYS, (_k, v) =>
      typeof v === 'boolean' ? null : 'must be true or false',
    );
    const next = { ...(notificationPrefs.get(user.userId) ?? DEFAULT_NOTIFICATIONS), ...patch };
    notificationPrefs.set(user.userId, next);
    return next;
  }

  @Get('privacy')
  @ApiOperation({ summary: 'Privacy choices (STUB — in-process)' })
  getPrivacy(@CurrentUser() user: AuthUser): PrivacySettings {
    return privacySettings.get(user.userId) ?? DEFAULT_PRIVACY;
  }

  @Patch('privacy')
  @ApiOperation({ summary: 'Change a privacy choice (STUB)' })
  setPrivacy(
    @CurrentUser() user: AuthUser,
    @Body() body: unknown,
  ): PrivacySettings {
    const patch = pickPrefs<PrivacySettings>(body, PRIVACY_KEYS, (k, v) => {
      if (k === 'retentionMonths') {
        return typeof v === 'number' && Number.isInteger(v) ? null : 'must be a whole number';
      }
      return typeof v === 'boolean' ? null : 'must be true or false';
    });
    const next = { ...(privacySettings.get(user.userId) ?? DEFAULT_PRIVACY), ...patch };
    // The ATO substantiation floor is five years and is not the client's to
    // lower. Clamped here as well as in the UI: a server that trusts a client
    // to enforce a retention minimum does not enforce one.
    next.retentionMonths = Math.max(60, next.retentionMonths);
    privacySettings.set(user.userId, next);
    return next;
  }
}

/* ── Codes and password reset ─────────────────────────────────────────────── */

/**
 * ⚠ These REFUSE. They are not stubbed, and that is the point.
 *
 * Every other endpoint in this file answers with plausible data so the app can
 * be developed against it. These must not, because a stubbed
 * `POST /v1/auth/otp/verify` that returns a session is an authentication
 * bypass — it hands a caller somebody else's account for the price of any six
 * digits, and it would sit in the codebase looking exactly like the others.
 *
 * They exist as explicit refusals rather than as missing routes so that the
 * reason is written down where someone would otherwise add the stub.
 *
 * Making them real needs, in order:
 *   1. a mail or SMS provider (there is none configured);
 *   2. a `login_codes` table holding a HASH of the code, its purpose, an
 *      expiry and an attempt counter — never the code itself;
 *   3. constant-time comparison, a hard attempt cap, and a rate limit per
 *      address AND per IP;
 *   4. a response that is identical whether or not the address exists, which
 *      `RequestOtpResponse` in the contract is already shaped for.
 */
@ApiTags('auth')
@Controller('v1/auth')
export class AuthCodesController {
  @Post('otp/request')
  @ApiOperation({ summary: 'Send a sign-in code (NOT IMPLEMENTED — refuses)' })
  request(): never {
    throw new NotImplementedException(
      'Email codes are not available: no mail provider is configured.',
    );
  }

  @Post('otp/verify')
  @ApiOperation({ summary: 'Check a sign-in code (NOT IMPLEMENTED — refuses)' })
  verify(): never {
    throw new NotImplementedException(
      'Email codes are not available: no mail provider is configured.',
    );
  }

  @Post('password/reset')
  @ApiOperation({
    summary: 'Reset a password with a code (NOT IMPLEMENTED — refuses; use the reset LINK)',
    description:
      'Password reset exists since 0036, by link rather than by code: POST /v1/auth/password/reset/request ' +
      'mails a single-use link (auth/account.controller.ts). A six-digit code would need an attempt cap ' +
      'to be safe, and the link needs none.',
  })
  reset(): never {
    throw new NotImplementedException(
      'Reset by code is not available. Ask for a reset link instead: POST /v1/auth/password/reset/request.',
    );
  }
}
