/**
 * The YourTal link page's words and small decisions, with nothing React or
 * server-only in them so they run under plain Node (`yourtal-link.test.ts`).
 * The phone app has its own copy (`apps/mobile/src/lib/yourtal-link.ts`): the
 * two apps share only `@snap/api-contract`, so the sentences are kept in step by hand.
 *
 * Why this exists: YourTal points are the only points with value
 * (`docs/ECOSYSTEM.md` D33). A user links their YourTal account with a
 * one-time code, and each receipt they scan afterwards can earn points there.
 * The server's answers are `YourtalLinkStatus` and, on failure,
 * `{ error, message }` — this maps each `error` to a plain sentence.
 */

/** The error codes `POST` / `DELETE /v1/yourtal/link` can answer with. */
export const LINK_ERROR_CODES = [
  'invalid_link_code',
  'teen_consent_not_allowed',
  'email_unverified',
  'already_linked',
  'linked_to_another_account',
  'rate_limited',
  'yourtal_not_configured',
  'yourtal_unavailable',
  'yourtal_rejected',
] as const;

export type LinkErrorCode = (typeof LINK_ERROR_CODES)[number];

/** What the person was doing when it failed: the same code reads differently. */
export type LinkContext = 'link' | 'unlink';

export interface LinkErrorMessage {
  text: string;
  /** `verify-email` adds a "Confirm your email" link under the message. */
  action: 'verify-email' | null;
}

const LINK_MESSAGES: Record<LinkErrorCode, string> = {
  invalid_link_code:
    'That code is not valid. Codes last 10 minutes and work once. Get a new one in YourTal under Me → Linked apps.',
  teen_consent_not_allowed: "YourTal accounts for 13 to 17 year olds can't earn points from receipts.",
  email_unverified: 'Confirm your email address first, then link YourTal.',
  already_linked: 'This account is already linked to YourTal.',
  linked_to_another_account:
    'That YourTal account is already linked to another Snap Apps account. Unlink it there first.',
  rate_limited: 'Too many tries. Wait a few minutes and try again.',
  yourtal_not_configured: "Linking YourTal isn't available right now. Try again later.",
  yourtal_unavailable: "YourTal isn't answering right now. Try again in a minute.",
  yourtal_rejected: 'Something went wrong linking YourTal. Try again later.',
};

/** Only the codes whose meaning changes when the person was unlinking. */
const UNLINK_OVERRIDES: Partial<Record<LinkErrorCode, string>> = {
  yourtal_not_configured: "Unlinking isn't available right now. You are still linked. Try again later.",
  yourtal_unavailable: "YourTal isn't answering, so you are still linked. Try again in a minute.",
  yourtal_rejected: 'Something went wrong unlinking YourTal. You are still linked. Try again later.',
};

const FALLBACK: Record<LinkContext, string> = {
  link: 'Could not link YourTal. Check your connection and try again.',
  unlink: 'Could not unlink YourTal. Check your connection and try again.',
};

export function isLinkErrorCode(code: string | null | undefined): code is LinkErrorCode {
  return (LINK_ERROR_CODES as readonly string[]).includes(code ?? '');
}

/** The sentence for an error code. An unknown code, or none, gets a safe fallback. */
export function linkErrorMessage(
  code: string | null | undefined,
  context: LinkContext = 'link',
): LinkErrorMessage {
  if (!isLinkErrorCode(code)) return { text: FALLBACK[context], action: null };
  const text = (context === 'unlink' ? UNLINK_OVERRIDES[code] : undefined) ?? LINK_MESSAGES[code];
  return { text, action: code === 'email_unverified' ? 'verify-email' : null };
}

/** Where the person goes in YourTal. `origin` has no trailing slash. */
export function yourtalLinks(origin: string): { getCode: string; wallet: string } {
  const base = origin.replace(/\/+$/, '');
  return { getCode: `${base}/me`, wallet: `${base}/wallet` };
}

/** The code as typed: pasted codes arrive with spaces and line breaks around them. */
export function cleanLinkCode(raw: string): string {
  return raw.trim();
}

/** "20 Oct 2026" from an ISO timestamp, or null when there is none to show. */
export function linkedOn(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** "1 receipt" / "3 receipts". */
export function receiptCount(n: number): string {
  return `${n.toLocaleString('en-AU')} ${n === 1 ? 'receipt' : 'receipts'}`;
}

/** The copy that does not depend on a server answer. */
export const LINK_COPY = {
  title: 'YourTal points',
  intro:
    'Link your YourTal account and receipts you scan from now on can earn YourTal points: 1 point for each receipt in Australia. Only adult accounts can earn.',
  getCode: 'Get a code in YourTal',
  getCodeHint: 'In YourTal, open Me → Linked apps to get a one-time code, then paste it here.',
  codeLabel: 'Link code',
  codePlaceholder: 'Paste the code',
  linkButton: 'Link YourTal',
  linkAgainButton: 'Link again',
  linkedTitle: 'Linked to YourTal',
  linkedHint: 'Points reported is what YourTal said it paid. Your balance is in your YourTal wallet.',
  openWallet: 'Open my YourTal wallet',
  unlinkButton: 'Unlink',
  unlinkConfirmTitle: 'Unlink YourTal?',
  unlinkConfirmBody:
    'New receipts will stop earning points. Points you already have stay in your YourTal wallet.',
  unlinkConfirmButton: 'Unlink',
  unlinkCancelButton: 'Keep linked',
  brokenTitle: 'Your YourTal link ended',
  brokenBody: 'New receipts are not earning points. Link again to start earning.',
  loadError: 'Could not load your YourTal link.',
  retry: 'Try again',
  confirmEmail: 'Confirm your email',
  rowRewarded: 'Receipts rewarded',
  rowPending: 'Waiting for YourTal',
  rowDuplicate: 'Skipped as duplicates',
  rowFree: 'Scanned on free credits',
  rowRefused: 'Not paid by YourTal',
  rowPoints: 'Points reported',
  duplicateHint: 'A second photo of a receipt already reported earns nothing.',
  freeHint: "Scans on free credits don't earn YourTal points.",
  pausedTitle: 'Receipt points are paused.',
  pausedBody: "Receipts you scan now won't earn YourTal points. They start again once Snap Apps tops up.",
  rowPaused: 'Paused while points were topped up',
  pausedHint: "These were scanned while receipt points were paused. They won't earn later.",
  refusedHint: "YourTal's daily limit or funding stopped these.",
} as const;

/** What a balance-style row (home, profile) shows for the link. */
export type PointsSummary = { value: string; hint: string };

/**
 * The one line the home screen and profile show for YourTal points, or null
 * when nothing should show: the status has not loaded, or the server has the
 * feature off (`available: false`). The value is only what YourTal said it
 * paid; the balance itself is in the YourTal wallet.
 */
export function pointsSummary(
  status: { available: boolean; state: 'unlinked' | 'linked' | 'broken'; pointsReported: number } | null,
): PointsSummary | null {
  if (!status || !status.available) return null;
  if (status.state === 'linked') {
    return { value: status.pointsReported.toLocaleString('en-AU'), hint: 'Reported by YourTal' };
  }
  if (status.state === 'broken') return { value: 'Ended', hint: 'Link again to keep earning' };
  return { value: 'Link', hint: 'Earn YourTal points from receipts' };
}

/**
 * Refusals other than the paused ones: the server's `refused` counts the
 * paused receipts too, and they have their own row.
 */
export function otherRefused(receipts: { refused: number; pausedRefused?: number }): number {
  return Math.max(0, receipts.refused - (receipts.pausedRefused ?? 0));
}
