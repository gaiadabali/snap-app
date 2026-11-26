'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';

import { Badge, Button, Input } from '@/design/primitives';
import { MailApiFailure, mailApi } from '@/lib/panels/mail-api';
import { dayDate } from '@/lib/panels/mail-format';
import { APP_PASSWORD_NAME_MAX, MAX_APP_PASSWORDS, type AppPasswordItem, type NewAppPassword } from '@/lib/panels/mail-types';
import { CopyButton } from './CopyButton';
import { ErrorBlock, ListSkeleton, Notice } from './MailUi';

function Detail({ label, value, mono = true, copy }: { label: string; value: string; mono?: boolean; copy?: string }) {
  return (
    <div className="flex items-center gap-3 py-1.5">
      <dt className="w-24 shrink-0 text-[13px] text-[var(--color-ink-muted)]">{label}</dt>
      <dd className={`min-w-0 flex-1 break-all text-[14px] text-[var(--color-ink)] ${mono ? 'font-mono' : ''}`}>{value}</dd>
      {copy ? <CopyButton text={copy} label={`Copy ${label.toLowerCase()}`} /> : null}
    </div>
  );
}

const security = (s: string) => (s === 'ssl' ? 'SSL/TLS' : s === 'starttls' ? 'STARTTLS' : s);

/** What a phone mail app needs, shown once when the password is created. */
export function AppPasswordSecret({ created, onDone }: { created: NewAppPassword; onDone: () => void }) {
  return (
    <section aria-label="Your new app password" className="rounded-[var(--radius-md)] border border-[var(--color-rule-strong)] bg-[var(--color-accent-soft)] p-4">
      <h3 className="text-[15px] font-semibold text-[var(--color-ink)]">App password for “{created.name}”</h3>
      <p className="mt-1 text-[14px] text-[var(--color-ink)]">
        Copy it now. <strong className="font-semibold">This is the only time you will see this password.</strong> If you lose it, revoke it and make a new one.
      </p>
      <dl className="mt-3 divide-y divide-[var(--color-rule-strong)] rounded-[var(--radius-sm)] bg-[var(--color-ground)] px-3">
        <Detail label="Password" value={created.secret} copy={created.secret} />
        <Detail label="Username" value={created.username} copy={created.username} />
        <Detail label="Incoming" value={`${created.imap.host}  ·  port ${created.imap.port}  ·  ${security(created.imap.security)}`} mono={false} copy={created.imap.host} />
        <Detail label="Outgoing" value={`${created.smtp.host}  ·  port ${created.smtp.port}  ·  ${security(created.smtp.security)}`} mono={false} copy={created.smtp.host} />
      </dl>
      <p className="mt-2 text-[13px] text-[var(--color-ink-muted)]">Incoming is IMAP. Outgoing is SMTP. Use your full address as the username in both.</p>
      <div className="mt-3">
        <Button size="sm" onClick={onDone}>
          I have copied it
        </Button>
      </div>
    </section>
  );
}

export function AppPasswords() {
  const [items, setItems] = useState<AppPasswordItem[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [created, setCreated] = useState<NewAppPassword | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      setItems(await mailApi.listAppPasswords());
    } catch (e) {
      setLoadError(e instanceof MailApiFailure ? e.message : 'Could not load your app passwords.');
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function create(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (trimmed === '') return setProblem('Give it a name, such as “Pixel mail”.');
    setCreating(true);
    setProblem(null);
    try {
      const made = await mailApi.createAppPassword(trimmed);
      setCreated(made);
      setName('');
      setItems((cur) => [...(cur ?? []), { id: made.id, name: made.name, createdAt: made.createdAt }]);
    } catch (err) {
      setProblem(err instanceof MailApiFailure ? err.message : 'Could not create it. Try again in a moment.');
    } finally {
      setCreating(false);
    }
  }

  async function revoke(id: string) {
    setRevoking(id);
    setProblem(null);
    try {
      await mailApi.revokeAppPassword(id);
      setItems((cur) => (cur ?? []).filter((i) => i.id !== id));
      setConfirm(null);
    } catch (err) {
      setProblem(err instanceof MailApiFailure ? err.message : 'Could not revoke it. Try again in a moment.');
    } finally {
      setRevoking(null);
    }
  }

  const full = (items?.length ?? 0) >= MAX_APP_PASSWORDS;

  return (
    <div className="space-y-4">
      {created ? <AppPasswordSecret created={created} onDone={() => setCreated(null)} /> : null}

      {loadError ? (
        <ErrorBlock message={loadError} onRetry={() => void load()} />
      ) : items === null ? (
        <ListSkeleton rows={2} />
      ) : items.length === 0 ? (
        <p className="text-[14px] text-[var(--color-ink-muted)]">No app passwords yet.</p>
      ) : (
        <ul className="divide-y divide-[var(--color-rule)] border-y border-[var(--color-rule)]" data-testid="app-password-list">
          {items.map((i) => (
            <li key={i.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3">
              <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-[var(--color-ink)]">{i.name}</span>
              <span className="text-[13px] text-[var(--color-ink-muted)]">Created {dayDate(i.createdAt)}</span>
              {confirm === i.id ? (
                <span className="flex items-center gap-2" role="group" aria-label={`Confirm revoking ${i.name}`}>
                  <span className="text-[13px] text-[var(--color-ink)]">The phone using it will stop receiving mail.</span>
                  <Button size="sm" variant="danger" disabled={revoking === i.id} onClick={() => void revoke(i.id)}>
                    {revoking === i.id ? 'Revoking…' : 'Revoke'}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setConfirm(null)}>
                    Cancel
                  </Button>
                </span>
              ) : (
                <Button size="sm" variant="secondary" onClick={() => setConfirm(i.id)} aria-label={`Revoke ${i.name}`}>
                  Revoke
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      {problem ? <Notice tone="error">{problem}</Notice> : null}

      {full ? (
        <p className="text-[14px] text-[var(--color-ink-muted)]">
          <Badge tone="warn">Limit reached</Badge> You can have up to {MAX_APP_PASSWORDS} app passwords. Revoke one to make another.
        </p>
      ) : (
        <form onSubmit={create} className="flex flex-wrap items-end gap-3">
          <label className="flex min-w-[220px] flex-1 flex-col gap-1.5">
            <span className="text-[13px] font-semibold text-[var(--color-ink)]">Name</span>
            <Input
              type="text"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setProblem(null);
              }}
              maxLength={APP_PASSWORD_NAME_MAX}
              placeholder="Pixel mail"
              autoComplete="off"
            />
          </label>
          <Button type="submit" variant="secondary" disabled={creating || name.trim() === ''}>
            {creating ? 'Creating…' : 'Create app password'}
          </Button>
        </form>
      )}
    </div>
  );
}
