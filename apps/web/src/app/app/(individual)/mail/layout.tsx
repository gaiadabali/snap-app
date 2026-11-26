import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

import { ButtonLink, Empty } from '@/design/primitives';
import { getMailGate } from '@/lib/panels/mail-status';
import { requireSession } from '@/lib/panels/session';
import { loadWorkspace } from '@/lib/panels/workspace';
import { MailShell, type MailAccount } from './MailShell';
import { MailUnlinked } from './MailUnlinked';
import { SwitchOn } from './SwitchOn';

/**
 * The gate for every mail screen, in the order a person meets it:
 *
 *  1. Not offered (mail switched off, a teen's space, or staff impersonating someone):
 *     404. Mail is adults-only and private; there is nothing to explain.
 *  2. Not signed in with YourTal: the existing "Sign in with YourTal" prompt, not Mail.
 *  3. A failed read: an explanation with a retry, never a blank page.
 *  4. No mailbox yet: the switch-on screen. Suspended or not allowed: a plain message.
 *  5. A mailbox: the mail screens, inside the shell.
 *
 * This is a convenience for the person, never the security boundary: the mail proxy
 * only serves a mail token the server minted for this person.
 */
export default async function MailLayout({ children }: { children: ReactNode }) {
  const { impersonation, workspaces } = await requireSession();
  if (impersonation) notFound();
  // A teen's own space belongs to the teen; mail is for adults (BUILD.md §5.1).
  const { workspace } = await loadWorkspace('personal');
  if (workspace?.teenSpace === 'teen') notFound();

  const gate = await getMailGate();
  if (gate.kind === 'unavailable') notFound();
  if (gate.kind === 'unlinked') return <MailUnlinked />;
  if (gate.kind === 'error') {
    return (
      <Empty
        title="Mail is not available right now"
        body="We could not reach your mailbox. Nothing has been lost. Try again in a moment."
        action={<ButtonLink href="/app/mail" variant="secondary">Try again</ButtonLink>}
      />
    );
  }

  const { mailbox, settings } = gate.status;
  const state = mailbox?.state ?? 'off';
  if (state === 'not_allowed') {
    return <Empty title="Mail is not available for this account" body="Spambank mail is for adult accounts." />;
  }
  if (state === 'suspended') {
    return (
      <Empty
        title="Your mailbox is paused"
        body="Mail is switched off for this account for now. Your messages are safe. Contact support if you think this is a mistake."
      />
    );
  }
  if (state === 'off' || !mailbox?.address) return <SwitchOn />;

  const account: MailAccount = {
    address: mailbox.address,
    ...(mailbox.quota ? { quota: mailbox.quota } : {}),
    settings,
    // Statements may only go to a workspace the person owns or administers (BUILD.md §5.6).
    statementWorkspaces: workspaces
      .filter((w) => w.teenSpace !== 'teen' && (w.role === 'owner' || w.role === 'admin'))
      .map((w) => ({ id: w.id, name: w.name })),
  };
  return <MailShell account={account}>{children}</MailShell>;
}
