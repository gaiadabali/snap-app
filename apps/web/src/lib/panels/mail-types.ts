import type {
  MailAppPassword,
  MailAppPasswordCreated,
  MailErrorCode as MailBridgeErrorCode,
  MailMailbox,
  MailSettingsView,
  MailStatus,
} from '@snap/api-contract';

/**
 * Wire types for SnapApp's `/v1/mail/*` (spambank/BUILD.md §5.6) come from
 * `@snap/api-contract` (added by the bridge, T11). The names below are the ones the
 * screens already use; only the gate and the limits are defined here.
 */
export type { MailStatus, MailBridgeErrorCode };
export type MailboxStatus = MailMailbox;
export type MailboxState = MailMailbox['state'];
export type MailSettings = MailSettingsView;
export type AppPasswordItem = MailAppPassword;
export type NewAppPassword = MailAppPasswordCreated;

/** The error body of every `/api/mail/*` answer that is not a success. */
export interface MailApiError {
  code: string;
  message: string;
}

/** What the layout learns about mail for this person. */
export type MailGate =
  | { kind: 'unavailable' }
  | { kind: 'unlinked' }
  | { kind: 'error' }
  | { kind: 'ready'; status: MailStatus };

/** At most this many app passwords per mailbox (BUILD.md §4.10). */
export const MAX_APP_PASSWORDS = 5;
export const APP_PASSWORD_NAME_MAX = 40;
