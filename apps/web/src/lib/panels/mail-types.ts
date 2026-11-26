/**
 * Wire types for SnapApp's `/v1/mail/*` endpoints (spambank/BUILD.md §5.6), as the
 * website sees them through its own `/api/mail/*` same-origin door.
 *
 * Kept here, not in `@snap/api-contract`, because the bridge ticket (T11) owns the
 * contract file. Once T11 has merged its mail types, swap these for them: the shapes
 * below are copied from §5.1 and §5.6 and nothing else should differ.
 */

export type MailboxState = 'off' | 'on' | 'suspended' | 'not_allowed';

export interface MailboxStatus {
  state: MailboxState;
  address?: string;
  quota?: { limitBytes: number; usedBytes: number };
  createdAt?: string;
}

export interface MailSettings {
  /** Import statements that arrive in the inbox into the chosen workspace. */
  statements: boolean;
  workspaceId: string | null;
  /** New-mail alerts on the person's phone. */
  alerts: boolean;
}

export interface MailStatus {
  available: boolean;
  linked: boolean;
  mailbox: MailboxStatus | null;
  settings: MailSettings;
}

export interface AppPasswordItem {
  id: string;
  name: string;
  createdAt: string;
}

export interface ServerEndpoint {
  host: string;
  port: number;
  security: string;
}

/** Returned once, at creation. The secret is never readable again. */
export interface NewAppPassword extends AppPasswordItem {
  secret: string;
  username: string;
  imap: ServerEndpoint;
  smtp: ServerEndpoint;
}

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
