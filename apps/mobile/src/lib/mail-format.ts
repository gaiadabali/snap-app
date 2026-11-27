import { MailError } from '@snap/mail-engine';
import type { Addr, FolderKey } from '@snap/mail-engine';

/** What a folder is called on screen. The UI labels folders itself, never from server names. Same words as the website (apps/web/src/lib/panels/mail-format.ts). */
export const FOLDER_LABEL: Record<FolderKey, string> = {
  inbox: 'Inbox',
  spam: 'Spam',
  junk: 'Junk',
  sent: 'Sent',
  drafts: 'Drafts',
  trash: 'Trash',
};

/** One line under the folder title, for the two that people confuse. */
export const FOLDER_HINT: Partial<Record<FolderKey, string>> = {
  spam: 'Mail the spam filter is confident about. Nothing here can reach your Inbox.',
  junk: 'Newsletters and marketing mail, filed here so your Inbox stays for people and bills.',
};

export const FOLDER_EMPTY: Record<FolderKey, string> = {
  inbox: 'No mail in your Inbox yet.',
  spam: 'No spam. The filter will file anything suspicious here.',
  junk: 'No bulk mail has been filed here yet.',
  sent: 'You have not sent anything yet.',
  drafts: 'No drafts.',
  trash: 'Trash is empty.',
};

export function senderLabel(addr: Addr | null | undefined): string {
  if (!addr) return 'Unknown sender';
  return addr.name?.trim() || addr.email;
}

/** "Maria Santos" for the list, "Maria Santos <maria@example.com>" for the reader. */
export function fullAddress(addr: Addr): string {
  return addr.name?.trim() ? `${addr.name.trim()} <${addr.email}>` : addr.email;
}

export function recipientsLabel(list: Addr[]): string {
  if (list.length === 0) return 'No recipients';
  const first = senderLabel(list[0]);
  return list.length === 1 ? first : `${first} and ${list.length - 1} more`;
}

export function initialsOf(addr: Addr | null | undefined): string {
  const source = addr?.name?.trim() || addr?.email || '?';
  const words = source.split(/[\s@._-]+/).filter(Boolean);
  const letters = (words.length > 1 ? [words[0], words[1]] : [words[0] ?? '?'])
    .map((w) => (w ?? '').charAt(0))
    .join('');
  return letters.toUpperCase().slice(0, 2) || '?';
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Today: "3:15 pm". This year: "20 Nov". Earlier: "20 Nov 2025". en-AU, the viewer's
 * own time zone. Only ever called from client-rendered lists, so there is no
 * server/browser mismatch to hydrate.
 */
export function listDate(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', hour12: true });
  }
  if (d.getFullYear() === now.getFullYear() && Math.abs(now.getTime() - d.getTime()) < 300 * DAY_MS) {
    return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
  }
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** "Fri, 20 Nov 2026, 3:15 pm" */
export function fullDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-AU', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

/** "20 Nov 2026" */
export function dayDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function fileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${Math.round(bytes / 1000)} KB`;
  if (bytes < 1_000_000_000) return `${(bytes / 1_000_000).toFixed(bytes < 10_000_000 ? 1 : 0)} MB`;
  return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
}

/** Plain words for an engine error. Never a stack, a status code or a server's own wording. */
export function mailErrorMessage(error: unknown): string {
  if (!(error instanceof MailError)) return 'Something went wrong. Try again in a moment.';
  switch (error.code) {
    case 'unauthorized':
      return 'Your mail session has ended. Close Mail and open it again to carry on.';
    case 'not_enabled':
      return 'Mail is not switched on for this account yet.';
    case 'unavailable':
      return 'Mail is not available right now. Try again in a moment.';
    case 'rate_limited':
      return 'That was too many requests at once. Wait a minute and try again.';
    case 'network':
      return 'Could not reach the mail server. Check your connection and try again.';
    case 'too_many_recipients':
      return 'You can send to at most 10 people in one message.';
    case 'daily_send_cap':
      return 'You have reached today’s sending limit. It resets each day, so try again tomorrow.';
    case 'rejected':
      // The engine words its own pre-send checks; a server message is cut short and kept plain.
      return error.message && error.message !== 'rejected'
        ? error.message.slice(0, 160)
        : 'The mail server could not do that.';
    default:
      return 'Something went wrong. Try again in a moment.';
  }
}

export function countLabel(n: number): string {
  return n > 99 ? '99+' : String(n);
}

/**
 * A sentence for a failed call to SnapApp's own `/v1/mail/*` (switch on, settings, app
 * passwords), from the bridge's error code (`MailErrorCode` in `@snap/api-contract`) and the
 * HTTP status. The server's own wording is never passed through. Duck-typed on `status` and
 * `code` so this file stays free of the API client (and its native modules).
 */
export function bridgeErrorMessage(error: unknown): string {
  const rec = typeof error === 'object' && error !== null ? (error as { status?: unknown; code?: unknown }) : {};
  const status = typeof rec.status === 'number' ? rec.status : null;
  const code = typeof rec.code === 'string' ? rec.code : null;
  switch (code) {
    case 'mail_unavailable':
      return 'Mail is not available here.';
    case 'yourtal_not_linked':
      return 'Sign in with YourTal to use mail.';
    case 'not_allowed':
      return 'Mail is not available for this account.';
    case 'not_enabled':
      return 'Mail is not switched on yet.';
    case 'not_workspace_admin':
      return 'Choose a workspace you own or administer.';
    case 'rate_limited':
      return 'Too many requests. Wait a minute and try again.';
    case 'yourtal_unavailable':
    case 'spambank_unavailable':
    case 'yourtal_rejected':
      return 'Mail is not available right now. Try again in a moment.';
    default:
      break;
  }
  if (status === 0) return 'No connection. Check your signal and try again.';
  if (status === 429) return 'Too many requests. Wait a minute and try again.';
  if (status !== null && status >= 500) return 'Mail is not available right now. Try again in a moment.';
  return 'Something went wrong. Try again in a moment.';
}

/** What Mail settings says under the alerts switch (`AlertsOutcome` in push.ts, as a plain string). */
export function alertsStatusLine(outcome: 'on' | 'denied' | 'unavailable' | 'unsupported' | 'failed' | null): string | null {
  switch (outcome) {
    case 'on':
      return 'This phone will be told when new mail arrives.';
    case 'denied':
      return 'Notifications are turned off for SnapApp on this phone. Turn them on in the phone’s settings to get alerts.';
    case 'unavailable':
      return 'Alerts are not available in this version of the app yet. Your mail still arrives as usual.';
    case 'unsupported':
      return 'Alerts are for the SnapApp Android app.';
    case 'failed':
      return 'Could not set up alerts on this phone just now. Check your connection and try again.';
    case null:
      return null;
  }
}
