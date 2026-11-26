'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { Folder, FolderKey } from '@snap/mail-engine';
import { useFolders } from '@snap/mail-engine/react';

import { cx } from '@/design/primitives';
import { FOLDER_LABEL, countLabel } from '@/lib/panels/mail-format';
import { FOLDER_ORDER, folderHref, settingsHref } from '@/lib/panels/mail-routes';
import { MailIcon, type MailIconName } from './MailIcon';
import { useMailBase } from './MailRoot';

const FOLDER_ICON: Record<FolderKey, MailIconName> = {
  inbox: 'inbox',
  spam: 'ban',
  junk: 'folder',
  sent: 'send',
  drafts: 'edit',
  trash: 'trash',
};

/** Unread for the folders you read; the total for Drafts; nothing for Sent and Trash. */
export function folderCount(folder: Folder | undefined): number {
  if (!folder) return 0;
  if (folder.key === 'inbox' || folder.key === 'spam' || folder.key === 'junk') return folder.unread;
  if (folder.key === 'drafts') return folder.total;
  return 0;
}

export function FolderRailView({
  base,
  folders,
  active,
  settingsActive = false,
}: {
  base: string;
  folders: Folder[];
  active: FolderKey | null;
  settingsActive?: boolean;
}) {
  const item = (current: boolean) =>
    cx(
      'flex shrink-0 items-center gap-2.5 rounded-[var(--radius-md)] px-3 py-2 text-[14px] transition-colors',
      current
        ? 'bg-[var(--color-accent-soft)] font-semibold text-[var(--color-ink)]'
        : 'font-medium text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-alt)] hover:text-[var(--color-ink)]',
    );
  return (
    <nav aria-label="Mail folders" className="relative -mx-1 flex gap-0.5 overflow-x-auto px-1 pb-1 md:mx-0 md:flex-col md:overflow-visible md:px-0 md:pb-0">
      {FOLDER_ORDER.map((key) => {
        const count = folderCount(folders.find((f) => f.key === key));
        const current = active === key;
        return (
          <Link key={key} href={folderHref(base, key)} aria-current={current ? 'page' : undefined} className={item(current)}>
            <MailIcon name={FOLDER_ICON[key]} size={18} />
            <span>{FOLDER_LABEL[key]}</span>
            {count > 0 ? (
              <span
                className={cx(
                  'ml-auto rounded-full px-1.5 py-px font-mono text-[11px] tabular',
                  key === 'drafts' ? 'text-[var(--color-ink-muted)]' : 'bg-[var(--color-accent-strong)] text-[var(--color-accent-ink)]',
                )}
              >
                <span aria-hidden>{countLabel(count)}</span>
                <span className="sr-only">{key === 'drafts' ? ` draft${count === 1 ? '' : 's'}` : ' unread'}</span>
              </span>
            ) : null}
          </Link>
        );
      })}
      <span aria-hidden className="mx-2 my-1 hidden h-px bg-[var(--color-rule)] md:block" />
      <Link href={settingsHref(base)} aria-current={settingsActive ? 'page' : undefined} className={item(settingsActive)}>
        <MailIcon name="key" size={18} />
        <span>Mail settings</span>
      </Link>
    </nav>
  );
}

/** Which folder the URL is in; `null` on a message, compose, search or settings page. */
export function activeFolder(pathname: string, base: string): FolderKey | null {
  if (pathname === base || pathname === `${base}/`) return 'inbox';
  const rest = pathname.startsWith(`${base}/`) ? pathname.slice(base.length + 1) : '';
  return (FOLDER_ORDER as readonly string[]).includes(rest) ? (rest as FolderKey) : null;
}

export function FolderRail() {
  const base = useMailBase();
  const pathname = usePathname();
  const { folders } = useFolders();
  return (
    <FolderRailView
      base={base}
      folders={folders}
      active={activeFolder(pathname, base)}
      settingsActive={pathname === settingsHref(base)}
    />
  );
}
