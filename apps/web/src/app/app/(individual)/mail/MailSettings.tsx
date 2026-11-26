'use client';

import { useState, type ReactNode } from 'react';

import { Select, Switch } from '@/design/primitives';
import { MailApiFailure, mailApi } from '@/lib/panels/mail-api';
import { fileSize } from '@/lib/panels/mail-format';
import type { MailSettings as Settings } from '@/lib/panels/mail-types';
import { AppPasswords } from './AppPasswords';
import { CopyButton } from './CopyButton';
import { Notice } from './MailUi';
import { useMailAccount } from './MailShell';

function Section({ id, title, lede, children }: { id: string; title: string; lede?: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="border-t border-[var(--color-rule)] py-6 first-of-type:border-t-0 first-of-type:pt-0">
      <h2 id={id} className="text-[17px] font-semibold text-[var(--color-ink)]">
        {title}
      </h2>
      {lede ? <p className="mt-1 max-w-[62ch] text-[14px] leading-relaxed text-[var(--color-ink-muted)]">{lede}</p> : null}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function SwitchRow({
  label,
  hint,
  checked,
  pending,
  disabled,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  pending: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <div className="text-[15px] font-medium text-[var(--color-ink)]">{label}</div>
        <p className="mt-0.5 max-w-[60ch] text-[13px] leading-relaxed text-[var(--color-ink-muted)]">{hint}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} label={label} pending={pending} disabled={disabled} />
    </div>
  );
}

export function MailSettingsView() {
  const account = useMailAccount();
  const [settings, setSettings] = useState<Settings>(account.settings);
  const [pending, setPending] = useState<'statements' | 'workspace' | 'alerts' | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const workspaces = account.statementWorkspaces;

  async function save(patch: Partial<Settings>, which: 'statements' | 'workspace' | 'alerts') {
    const before = settings;
    setSettings({ ...settings, ...patch });
    setPending(which);
    setProblem(null);
    try {
      setSettings(await mailApi.saveSettings(patch));
    } catch (e) {
      setSettings(before);
      setProblem(e instanceof MailApiFailure ? e.message : 'Could not save that. Try again in a moment.');
    } finally {
      setPending(null);
    }
  }

  const chosen = workspaces.find((w) => w.id === settings.workspaceId) ?? null;
  const usedPct = account.quota ? Math.min(100, Math.round((account.quota.usedBytes / account.quota.limitBytes) * 100)) : 0;

  return (
    <div className="max-w-[720px]">
      <h2 className="sr-only">Mail settings</h2>

      {problem ? (
        <div className="mb-4">
          <Notice tone="error" onDismiss={() => setProblem(null)}>
            {problem}
          </Notice>
        </div>
      ) : null}

      <Section id="settings-address" title="Your address" lede="Generated for you when you switched mail on. It is the same address in SnapApp, YourTal and Free Tax Returns.">
        <div className="flex items-center gap-1">
          <span className="min-w-0 break-all font-mono text-[15px] text-[var(--color-ink)]">{account.address}</span>
          <CopyButton text={account.address} label="Copy your address" />
        </div>
        {account.quota ? (
          <div className="mt-4 max-w-sm">
            <div
              role="progressbar"
              aria-label="Storage used"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={usedPct}
              className="h-1.5 overflow-hidden rounded-full bg-[var(--color-surface-alt)]"
            >
              <div className="h-full rounded-full bg-[var(--color-accent)]" style={{ width: `${Math.max(usedPct, account.quota.usedBytes > 0 ? 2 : 0)}%` }} />
            </div>
            <p className="mt-1.5 text-[13px] text-[var(--color-ink-muted)] tabular">
              {fileSize(account.quota.usedBytes)} of {fileSize(account.quota.limitBytes)} used
            </p>
          </div>
        ) : null}
      </Section>

      <Section id="settings-statements" title="Statements">
        <SwitchRow
          label="Import statements from this inbox"
          hint="When a bank or card statement (PDF or CSV) arrives here, SnapApp adds it to the workspace below. Only mail that passes the sender’s own authenticity checks is used, and it costs the same as an upload: CSV is free, a PDF uses one credit."
          checked={settings.statements}
          pending={pending === 'statements'}
          disabled={workspaces.length === 0}
          onChange={(next) => {
            const workspaceId = settings.workspaceId ?? workspaces[0]?.id ?? null;
            void save(next ? { statements: true, workspaceId } : { statements: false }, 'statements');
          }}
        />
        {workspaces.length === 0 ? (
          <p className="mt-3 text-[13px] text-[var(--color-ink-muted)]">
            You need a workspace you own or administer to import statements into.
          </p>
        ) : (
          <label className="mt-4 flex max-w-sm flex-col gap-1.5">
            <span className="text-[13px] font-semibold text-[var(--color-ink)]">Import into</span>
            <Select
              value={chosen?.id ?? ''}
              disabled={pending === 'workspace'}
              onChange={(e) => void save({ workspaceId: e.target.value }, 'workspace')}
            >
              {chosen ? null : <option value="">Choose a workspace</option>}
              {workspaces.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </Select>
            <span className="text-[13px] text-[var(--color-ink-muted)]">Only workspaces you own or administer are listed.</span>
          </label>
        )}
      </Section>

      <Section id="settings-alerts" title="Alerts">
        <SwitchRow
          label="Phone alerts for new mail"
          hint="SnapApp on Android tells you when new mail arrives. The alert says how many, never who from or what about."
          checked={settings.alerts}
          pending={pending === 'alerts'}
          onChange={(next) => void save({ alerts: next }, 'alerts')}
        />
      </Section>

      <Section
        id="settings-apps"
        title="Phone mail apps"
        lede="To read this inbox in an app such as Gmail, Apple Mail or Outlook, give the app its own password. It is separate from how you sign in, and revoking it cuts that app off at once."
      >
        <AppPasswords />
      </Section>
    </div>
  );
}
