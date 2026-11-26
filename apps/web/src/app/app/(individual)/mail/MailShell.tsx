'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createContext, useContext, useState, type FormEvent, type ReactNode } from 'react';

import { Input, buttonClasses } from '@/design/primitives';
import type { MailSettings } from '@/lib/panels/mail-types';
import { composeHref, searchHref } from '@/lib/panels/mail-routes';
import { CopyButton } from './CopyButton';
import { FolderRail } from './FolderRail';
import { MailIcon } from './MailIcon';
import { useMailBase } from './MailRoot';

/** What the server layout knows about this mailbox, shared with the screens under it. */
export interface MailAccount {
  address: string;
  quota?: { limitBytes: number; usedBytes: number };
  settings: MailSettings;
  /** Workspaces the person owns or administers: the places statements may be imported into. */
  statementWorkspaces: { id: string; name: string }[];
}

const AccountContext = createContext<MailAccount | null>(null);

export function useMailAccount(): MailAccount {
  const account = useContext(AccountContext);
  if (!account) throw new Error('useMailAccount must be used inside <MailShell>');
  return account;
}

export function SearchForm({ initial = '' }: { initial?: string }) {
  const router = useRouter();
  const base = useMailBase();
  const [q, setQ] = useState(initial);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const text = q.trim();
    if (text) router.push(searchHref(base, text));
  };
  return (
    <form role="search" onSubmit={submit} className="relative w-full sm:w-72">
      <label htmlFor="mail-search" className="sr-only">
        Search mail
      </label>
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-ink-faint)]">
        <MailIcon name="search" size={17} />
      </span>
      <Input
        id="mail-search"
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search mail"
        maxLength={200}
        autoComplete="off"
        className="w-full pl-9"
      />
    </form>
  );
}

/** The frame of every mail screen: title and address, search, Compose, the folder rail. */
export function MailShell({ account, children }: { account: MailAccount; children: ReactNode }) {
  const base = useMailBase();
  return (
    <AccountContext.Provider value={account}>
      <div className="flex flex-col gap-5">
        <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
          <div className="min-w-0">
            <div className="t-label text-[var(--color-accent-strong)]">Spambank</div>
            <h1 className="mt-2 text-[26px] font-normal leading-tight tracking-[-0.02em] text-[var(--color-ink)]">Mail</h1>
            <p className="mt-1 flex min-w-0 items-center gap-1 text-[14px] text-[var(--color-ink-muted)]">
              <span className="truncate font-mono text-[13px]" data-testid="mail-address">
                {account.address}
              </span>
              <CopyButton text={account.address} label="Copy your address" />
            </p>
          </div>
          <div className="flex w-full flex-wrap items-center gap-3 sm:w-auto">
            <SearchForm />
            <Link href={composeHref(base)} className={buttonClasses('primary', 'md', 'w-full sm:w-auto')}>
              <MailIcon name="edit" size={17} />
              Compose
            </Link>
          </div>
        </header>
        <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-5 md:grid-cols-[188px_minmax(0,1fr)] md:gap-7">
          <FolderRail />
          <div className="min-w-0">{children}</div>
        </div>
      </div>
    </AccountContext.Provider>
  );
}
