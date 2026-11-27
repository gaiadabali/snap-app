'use client';

import { useUnreadCount } from '@snap/mail-engine/react';

import { countLabel } from '@/lib/panels/mail-format';
import { useMailRoot } from '../(individual)/mail/MailRoot';

function UnreadCount() {
  const unread = useUnreadCount('inbox');
  if (unread <= 0) return null;
  return (
    <span
      data-testid="mail-unread-badge"
      className="rounded-full bg-[var(--color-accent)] px-1.5 py-px font-mono text-[11px] font-semibold text-[var(--color-accent-ink)] tabular"
    >
      <span aria-hidden>{countLabel(unread)}</span>
      <span className="sr-only">{` unread ${unread === 1 ? 'message' : 'messages'}`}</span>
    </span>
  );
}

/**
 * The unread count beside "Mail" in the sidebar, kept live by the shared mail client.
 * It draws nothing where there is no mail client above it (no mailbox yet, or the
 * person has not moved to YourTal), and nothing while the count is loading or zero, so
 * a mail outage never puts a warning in the navigation.
 */
export function MailNavBadge() {
  return useMailRoot() ? <UnreadCount /> : null;
}
