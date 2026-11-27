import type { MailMailbox, MailSettingsView, MailStatus } from '@snap/api-contract';

/**
 * What the Mail screens show, decided from `GET /v1/mail/status` and the workspace the
 * person is in. The website's layout makes the same decision in the same order
 * (`apps/web/src/lib/panels/mail-status.ts` and the mail layout), so the two clients
 * cannot disagree about who gets Mail.
 *
 * This is a convenience for the person, never the security boundary: the mail proxy only
 * serves a mail token the server minted for this person, and the server refuses a teen
 * and a suspended account on its own.
 */
export type MailGateState =
  /** Mail is switched off here, or this server has no mail routes: show nothing. */
  | { kind: 'unavailable' }
  /** Not signed in with YourTal: mail lives in the YourTal account. */
  | { kind: 'unlinked' }
  /** A teen's space, or an account YourTal says may not have mail. */
  | { kind: 'notAllowed' }
  /** The mailbox is paused. */
  | { kind: 'suspended' }
  /** No mailbox yet: offer to switch it on. */
  | { kind: 'off' }
  | { kind: 'on'; address: string; quota?: MailMailbox['quota']; settings: MailSettingsView };

export function gateFor(status: MailStatus, teenSpace: 'teen' | 'parent' | null | undefined): MailGateState {
  if (!status.available) return { kind: 'unavailable' };
  // Mail is for adults: a teen's own space never shows it (the server refuses them too).
  if (teenSpace === 'teen') return { kind: 'notAllowed' };
  if (!status.linked) return { kind: 'unlinked' };
  const mailbox = status.mailbox;
  const state = mailbox?.state ?? 'off';
  if (state === 'not_allowed') return { kind: 'notAllowed' };
  if (state === 'suspended') return { kind: 'suspended' };
  if (state === 'off' || !mailbox?.address) return { kind: 'off' };
  return {
    kind: 'on',
    address: mailbox.address,
    ...(mailbox.quota ? { quota: mailbox.quota } : {}),
    settings: status.settings,
  };
}

/**
 * Whether the menu lists Mail. An unlinked account still sees the entry, because that
 * screen explains how to move to YourTal; a teen, a refused account and a server with mail
 * off do not.
 */
export function mailEntryListed(
  status: MailStatus | null,
  teenSpace: 'teen' | 'parent' | null | undefined,
): boolean {
  if (!status) return false;
  const gate = gateFor(status, teenSpace);
  return gate.kind !== 'unavailable' && gate.kind !== 'notAllowed';
}
