/**
 * The words and small decisions of "Use a YourTal voucher" (group plan 2.8,
 * yourtal docs/28 §5), with nothing React or server-only in them. This is the
 * phone copy of `apps/web/src/lib/yourtal-voucher.ts`; the two
 * share only `@snap/api-contract`, so the sentences are kept in step by hand.
 * A voucher adds scans, never money. The server decides what is valid: the
 * format check here only saves a round trip.
 */
import type { YourtalLinkStatus } from '@snap/api-contract';

import { linkedOn } from './yourtal-link';

export const VOUCHER_ERROR_CODES = [
  'invalid_voucher_code',
  'email_unverified',
  'owner_or_admin_only',
  'not_linked',
  'region_not_supported',
  'link_broken',
  'not_your_voucher',
  'already_redeemed',
  'voucher_used',
  'voucher_expired',
  'voucher_busy',
  'not_a_scans_voucher',
  'voucher_refused',
  'rate_limited',
  'yourtal_not_configured',
  'yourtal_unavailable',
] as const;

const MESSAGES: Record<(typeof VOUCHER_ERROR_CODES)[number], string> = {
  invalid_voucher_code: "That code isn't right. Check it and try again.",
  email_unverified: 'Confirm your email address first, then use a voucher.',
  owner_or_admin_only: 'Only an owner or admin of this workspace can add scans to it.',
  not_linked: 'Link YourTal to this account first.',
  region_not_supported: 'YourTal scans vouchers are for Australian YourTal accounts.',
  link_broken: 'YourTal ended the link to this account. Link it again to use your vouchers.',
  not_your_voucher: "That code isn't a scans voucher in the YourTal wallet linked to this account.",
  already_redeemed: 'This voucher was already used to add scans here.',
  voucher_used: 'This voucher has already been used.',
  voucher_expired: 'This voucher has expired.',
  voucher_busy: 'This voucher is being used right now. Try again in 15 minutes.',
  not_a_scans_voucher: "That voucher isn't a SnapApp scans voucher.",
  voucher_refused: "YourTal wouldn't accept this voucher. Nothing was taken.",
  rate_limited: 'Too many attempts. Try again in a few minutes.',
  yourtal_not_configured: "Vouchers aren't available right now. Try again later.",
  yourtal_unavailable: "YourTal isn't answering right now. Nothing was taken. Try again in a minute.",
};

const FALLBACK = 'Could not use this voucher. Nothing was taken. Check your connection and try again.';

/** The sentence for an error code; `redeemedAt` (ISO) dates `already_redeemed`. */
export function voucherErrorMessage(code: string | null | undefined, redeemedAt?: string | null): string {
  if (!code || !(code in MESSAGES)) return FALLBACK;
  const known = code as keyof typeof MESSAGES;
  const on = known === 'already_redeemed' ? linkedOn(redeemedAt ?? null) : null;
  return on ? `This voucher was already used: 50 scans were added on ${on}.` : MESSAGES[known];
}

/** What the last attempt came to. */
export type VoucherOutcome =
  | { kind: 'granted'; credits: number }
  | { kind: 'pending' }
  | { kind: 'error'; code: string | null; redeemedAt?: string | null };

/** Dashes and spaces are ignored, as the server does. 16 symbols and a check symbol. */
export function cleanVoucherCode(raw: string): string {
  return raw.replace(/[-\s]/g, '').toUpperCase();
}

export function looksLikeVoucherCode(raw: string): boolean {
  return cleanVoucherCode(raw).length === 17;
}

/** Why the card is not offered, or null when it is, or when it should simply not show. */
export function voucherUnavailableNote(v: YourtalLinkStatus['vouchers']): string | null {
  if (!v || v.available) return null;
  if (v.reason === 'region') return VOUCHER_COPY.regionNote;
  if (v.reason === 'role') return VOUCHER_COPY.roleNote;
  return null; // not_configured and not_linked: nothing useful to say here
}

export function hasPendingVoucher(v: YourtalLinkStatus['vouchers']): boolean {
  return !!v?.redemptions.some((r) => r.state === 'pending');
}

export function redemptionLabel(r: { state: 'pending' | 'granted' | 'failed'; credits: number; createdAt: string; grantedAt: string | null }): string {
  const when = linkedOn(r.grantedAt ?? r.createdAt) ?? '';
  if (r.state === 'granted') return `${r.credits} scans added on ${when}`;
  if (r.state === 'pending') return `Adding ${r.credits} scans (started ${when})`;
  return `Not used on ${when}: nothing was taken`;
}

export function grantedMessage(credits: number, workspace: string): string {
  return `${credits} scans added to ${workspace}.`;
}

export const VOUCHER_COPY = {
  title: 'Use a YourTal voucher',
  intro: 'Have a SnapApp scans voucher in your YourTal wallet? Use it to add scans.',
  codeLabel: 'Voucher code',
  codePlaceholder: 'XXXX-XXXX-XXXX-XXXX-X',
  button: 'Add scans',
  busy: 'Adding…',
  hint: "Only the YourTal account linked here can use its vouchers. Scans from a voucher don't earn YourTal points.",
  pending: 'Adding 50 scans. This can take a minute.',
  historyTitle: 'Vouchers used',
  regionNote: 'YourTal scans vouchers are for Australian YourTal accounts.',
  roleNote: 'Only an owner or admin of this workspace can use a YourTal voucher.',
} as const;
