import { asUser, type Db } from '@snap/db';
import { sql } from 'drizzle-orm';

import { fcmSender, type FcmSender } from './fcm.js';

/**
 * The phone's new-mail alert (Spambank BUILD.md §4.9, F6): the worker's half of
 * a `spambank-mail` Security Event Token from YourTal,
 * `{"urn:yourtal:event:spambank-mail": {"unread_inbox": 3}}` for the person's
 * pairwise `sub`. The event has already been verified and stored as a
 * `yourtal_event` job (events.controller.ts), and the worker re-verified it
 * (events-job.ts) before calling this.
 *
 * What it does, in order:
 *   1. an alert older than 15 minutes is dropped (YourTal's own expiry): "3 new
 *      emails" an hour late is worse than none;
 *   2. no FCM sender configured: dropped (the Firebase project may not exist yet);
 *   3. the `sub` names a SnapApp user (`mail_push_user_for_sub`, worker-only), or
 *      the alert is dropped;
 *   4. the person's `mail_settings.alerts` is on (default on), and they have
 *      phones registered, or it is dropped;
 *   5. one FCM message per phone: title "Spambank", body "You have N new emails"
 *      (no sender, no subject: a lock screen is public), data `{type:
 *      "spambank-mail"}` so a tap opens Mail. A token FCM calls
 *      `UNREGISTERED`/`NOT_FOUND` is deleted.
 *
 * It throws only when NOTHING was delivered and a send failed in a way worth
 * retrying (FCM or the network down): the job runs again with backoff. If any
 * phone got it, a retry would notify it twice, so the rest is logged and left.
 *
 * Logs outcomes and counts. Never the `sub`, a token or the user id.
 */

type Log = Pick<Console, 'log' | 'warn' | 'error'>;

/** YourTal drops its own alerts after this (BUILD.md §5.5); so do we. */
export const MAIL_ALERT_MAX_AGE_S = 15 * 60;

export type MailAlertOutcome =
  | { state: 'sent'; sent: number; removed: number; failed: number }
  | { state: 'dropped'; reason: 'stale' | 'not_configured' | 'bad_payload' | 'no_user' | 'alerts_off' | 'no_devices' };

/** The unread count the event carries: a whole number from 1 to 9999. */
export function unreadCountOf(body: Record<string, unknown>): number | null {
  const n = body.unread_inbox;
  return typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 9999 ? n : null;
}

/** "You have 3 new emails", or "You have 1 new email". */
export function alertBody(unread: number): string {
  return `You have ${unread} new ${unread === 1 ? 'email' : 'emails'}`;
}

export async function sendNewMailAlert(
  db: Db,
  event: { sub: string; iat: number; body: Record<string, unknown> },
  log: Log = console,
  sender: FcmSender | null = fcmSender(),
  now: number = Date.now(),
): Promise<MailAlertOutcome> {
  const unread = unreadCountOf(event.body);
  if (unread === null) {
    log.warn('spambank-mail: unread_inbox is not a whole number from 1 to 9999; dropped');
    return { state: 'dropped', reason: 'bad_payload' };
  }
  if (now / 1000 - event.iat > MAIL_ALERT_MAX_AGE_S) {
    log.log('spambank-mail: older than 15 minutes; dropped');
    return { state: 'dropped', reason: 'stale' };
  }
  if (!sender) {
    log.log('spambank-mail: push notifications are not configured; dropped');
    return { state: 'dropped', reason: 'not_configured' };
  }

  const { rows } = await db.execute<{ id: string | null }>(sql`select mail_push_user_for_sub(${event.sub}) as id`);
  const userId = rows[0]?.id;
  if (!userId) {
    log.log('spambank-mail: no SnapApp account for this person; dropped');
    return { state: 'dropped', reason: 'no_user' };
  }

  const { alertsOn, tokens } = await asUser(db, userId, async (tx) => {
    const settings = await tx.execute<{ alerts: boolean }>(
      sql`select alerts from mail_settings where user_id = current_user_id()`,
    );
    const phones = await tx.execute<{ token: string }>(
      sql`select token from push_tokens where user_id = current_user_id() order by last_seen_at desc`,
    );
    // No settings row yet means the default, which is on.
    return { alertsOn: settings.rows[0]?.alerts ?? true, tokens: phones.rows.map((r) => r.token) };
  });
  if (!alertsOn) {
    log.log('spambank-mail: the person turned alerts off; dropped');
    return { state: 'dropped', reason: 'alerts_off' };
  }
  if (tokens.length === 0) {
    log.log('spambank-mail: no registered phone; dropped');
    return { state: 'dropped', reason: 'no_devices' };
  }

  let sent = 0;
  let failed = 0;
  let retryable = false;
  const dead: string[] = [];
  for (const token of tokens) {
    const result = await sender.send({
      token,
      title: 'Spambank',
      body: alertBody(unread),
      data: { type: 'spambank-mail' },
      channelId: 'mail',
    });
    if (result.state === 'sent') sent += 1;
    else if (result.state === 'unregistered') dead.push(token);
    else {
      failed += 1;
      retryable ||= result.retryable;
    }
  }

  if (dead.length > 0) {
    // The person's own tokens, through their own RLS.
    await asUser(db, userId, async (tx) => {
      for (const token of dead) await tx.execute(sql`delete from push_tokens where token = ${token}`);
    });
  }

  log.log(`spambank-mail: ${sent} sent, ${dead.length} dead token(s) removed, ${failed} failed`);
  if (sent === 0 && failed > 0 && retryable) throw new Error('spambank-mail: FCM did not accept it; will retry');
  return { state: 'sent', sent, removed: dead.length, failed };
}
