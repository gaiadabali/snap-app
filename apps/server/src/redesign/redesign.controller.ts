import {
  Body,
  Controller,
  NotImplementedException,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type {
  AddSavedCardRequest,
  AlertItem,
  NotificationPrefs,
  PrivacySettings,
  Reward,
  RewardRedemption,
  SavedCard,
  UsageKind,
  UsagePeriod,
} from '@snap/api-contract';

import { CurrentUser, SessionGuard, type AuthUser } from '../common/auth.guard.js';

/**
 * ⚠ STUBS. Everything in this file is in-process state, not a database.
 *
 * These endpoints exist so the 2026-09-19 mobile redesign has something real
 * to talk to while the surfaces it introduced — a wallet, an alert feed,
 * per-user notification and privacy choices — get their migrations written.
 * They answer with the right shapes and they mutate consistently within one
 * process, which is enough to develop and demo against.
 *
 * What they are NOT:
 *   - durable. A restart resets every one of them.
 *   - correct across replicas. Two pods disagree, immediately and silently.
 *   - safe for real card data. `POST /v1/wallet/cards` here throws away
 *     everything but the last four digits, which is the right behaviour, but
 *     there is no processor behind it and nothing is tokenised.
 *
 * Before any of this ships to a user:
 *   1. add tables — `saved_cards`, `alerts`, `notification_prefs`,
 *      `privacy_settings` — all USER-scoped, none tenant-scoped;
 *   2. wire `POST /v1/wallet/cards` to a real processor and store its token,
 *      never a PAN;
 *   3. delete this file's `Map`s and point the controllers at repos.
 *
 * `GET /v1/usage` and the rewards pair are the exceptions worth reading
 * closely — see their own comments.
 */

/* ── In-process state, keyed by user ──────────────────────────────────────── */

const cards = new Map<string, SavedCard[]>();
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

/** Points traded for scan credits — see the warning on `Reward`. */
const REWARDS: Reward[] = [
  { id: 'rw-10', name: '10 scan credits', description: 'Ten more receipts, on the house.', cost: 200, credits: 10, imageUrl: null, available: true },
  { id: 'rw-25', name: '25 scan credits', description: 'A month of ordinary shopping for most households.', cost: 450, credits: 25, imageUrl: null, available: true },
  { id: 'rw-60', name: '60 scan credits', description: 'The best rate — worth saving up for.', cost: 1000, credits: 60, imageUrl: null, available: true },
  { id: 'rw-150', name: '150 scan credits', description: 'A full tax year of receipts for a busy household.', cost: 2200, credits: 150, imageUrl: null, available: true },
];

function brandOf(digits: string): SavedCard['brand'] {
  if (/^4/.test(digits)) return 'visa';
  if (/^(5[1-5]|2[2-7])/.test(digits)) return 'mastercard';
  if (/^3[47]/.test(digits)) return 'amex';
  return 'other';
}

/* ── Wallet ───────────────────────────────────────────────────────────────── */

@ApiTags('wallet')
@Controller('v1/wallet/cards')
@UseGuards(SessionGuard)
export class WalletController {
  @Get()
  @ApiOperation({ summary: 'Saved payment methods (STUB — in-process)' })
  list(@CurrentUser() user: AuthUser): SavedCard[] {
    return [...(cards.get(user.userId) ?? [])].sort(
      (a, b) => Number(b.isDefault) - Number(a.isDefault),
    );
  }

  @Post()
  @ApiOperation({
    summary: 'Save a payment method (STUB — no processor)',
    description:
      'The PAN and CVC are read, used to derive the brand and last four, and discarded. Nothing is tokenised because there is no processor wired yet.',
  })
  add(@CurrentUser() user: AuthUser, @Body() body: AddSavedCardRequest): SavedCard {
    const digits = (body.number ?? '').replace(/\D/g, '');
    const mine = cards.get(user.userId) ?? [];
    const card: SavedCard = {
      id: `card_${Date.now().toString(36)}`,
      provider: body.provider,
      brand: brandOf(digits),
      // The ONLY part of the number that survives this function.
      last4: digits.slice(-4) || '0000',
      expiryMonth: body.expiryMonth,
      expiryYear: body.expiryYear,
      label:
        body.provider === 'card'
          ? `${brandOf(digits).replace(/^./, (c) => c.toUpperCase())} ending ${digits.slice(-4)}`
          : body.nameOnCard,
      isDefault: body.makeDefault ?? mine.length === 0,
      createdAt: new Date().toISOString(),
    };
    cards.set(
      user.userId,
      card.isDefault ? [...mine.map((c) => ({ ...c, isDefault: false })), card] : [...mine, card],
    );
    return card;
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Forget a payment method (STUB)' })
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string): void {
    const mine = cards.get(user.userId) ?? [];
    const gone = mine.find((c) => c.id === id);
    let left = mine.filter((c) => c.id !== id);
    // Removing the default promotes the next one rather than leaving none.
    if (gone?.isDefault && left.length > 0) {
      left = left.map((c, i) => ({ ...c, isDefault: i === 0 }));
    }
    cards.set(user.userId, left);
  }

  @Post(':id/default')
  @ApiOperation({ summary: 'Make this the default method (STUB)' })
  setDefault(@CurrentUser() user: AuthUser, @Param('id') id: string): SavedCard | null {
    const mine = (cards.get(user.userId) ?? []).map((c) => ({ ...c, isDefault: c.id === id }));
    cards.set(user.userId, mine);
    return mine.find((c) => c.id === id) ?? null;
  }
}

/* ── Usage ────────────────────────────────────────────────────────────────── */

@ApiTags('usage')
@Controller('v1/usage')
@UseGuards(SessionGuard)
export class UsageController {
  /**
   * ⚠ Returns an EMPTY period, always.
   *
   * This is deliberate and is the honest answer until the projection exists.
   * A real implementation reads `usage_grants` consumption for credits and
   * `point_ledger` for points, grouped by month. Inventing rows here would
   * put fabricated spend in front of someone reconciling a balance, which is
   * worse than an empty month.
   */
  @Get()
  @ApiOperation({ summary: 'Itemised usage for a month (STUB — returns empty)' })
  period(@Query('kind') kind: UsageKind, @Query('month') month: string): UsagePeriod {
    return { month, kind: kind === 'points' ? 'points' : 'credits', total: 0, items: [] };
  }

  @Get('months')
  @ApiOperation({ summary: 'Months with usage to show (STUB — returns none)' })
  months(): string[] {
    return [];
  }
}

/* ── Rewards ──────────────────────────────────────────────────────────────── */

@ApiTags('rewards')
@Controller('v1/rewards')
@UseGuards(SessionGuard)
export class RewardsController {
  @Get()
  @ApiOperation({ summary: 'Points-for-credits catalogue (STUB)' })
  list(): Reward[] {
    return REWARDS;
  }

  /**
   * ⚠ NOT IMPLEMENTED, and refuses rather than pretending.
   *
   * A redemption has to write a negative `point_ledger` row and grant credits
   * in ONE transaction, or a crash between the two either loses points or
   * mints credits. `point_ledger` permits a negative delta — the column is
   * `CHECK (delta <> 0)`, not `> 0` — so the schema is ready, but the
   * atomic pair is not written and must not be faked.
   *
   * It also contradicts `PointsController`'s standing comment that nothing in
   * this product writes a negative entry. That conflict is documented on
   * `Reward` in `@snap/api-contract` and needs a product decision before this
   * becomes real.
   */
  @Post(':id/redeem')
  @ApiOperation({ summary: 'Trade points for credits (NOT IMPLEMENTED — refuses)' })
  redeem(@Param('id') _id: string): RewardRedemption {
    throw new Error(
      'Redeeming points is not implemented on the server yet. See the note on Reward in @snap/api-contract.',
    );
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
    @Body() patch: Partial<NotificationPrefs>,
  ): NotificationPrefs {
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
    @Body() patch: Partial<PrivacySettings>,
  ): PrivacySettings {
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
  @ApiOperation({ summary: 'Reset a password with a code (NOT IMPLEMENTED — refuses)' })
  reset(): never {
    throw new NotImplementedException(
      'Password reset is not available: it needs an email code, and no mail provider is configured.',
    );
  }
}
