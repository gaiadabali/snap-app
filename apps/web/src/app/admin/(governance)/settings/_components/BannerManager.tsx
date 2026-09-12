'use client';

import { useState, useTransition } from 'react';

import { Badge, Button, Field, Input } from '@/design/primitives';
import type { AnnouncementBanner, ClientTarget } from '../../../_data/governance';

import { ToggleControl } from '../../_components/ToggleControl';
import { removeAnnouncementBannerAction, upsertAnnouncementBannerAction } from '../actions';

const TONE_BADGE = { info: 'accent', warn: 'warn', risk: 'risk' } as const;
const ALL_CLIENTS: ClientTarget[] = ['mobile', 'website', 'server'];

export function BannerManager({ banners }: { banners: AnnouncementBanner[] }) {
  return (
    <div className="flex flex-col gap-4">
      {banners.map((b) => (
        <BannerRow key={b.id} banner={b} />
      ))}
      <NewBannerForm />
    </div>
  );
}

function BannerRow({ banner }: { banner: AnnouncementBanner }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--color-rule)] bg-[var(--color-ground)] p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <Badge tone={TONE_BADGE[banner.tone]}>{banner.tone}</Badge>
          <p className="text-[13px]">{banner.message}</p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <ToggleControl
            key={`${banner.id}-${banner.active}`}
            checked={banner.active}
            label={`${banner.id} active`}
            onToggle={(next) => upsertAnnouncementBannerAction({ ...banner, active: next })}
          />
          <Button
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                setError(null);
                try {
                  await removeAnnouncementBannerAction(banner.id);
                } catch (e) {
                  setError(e instanceof Error ? e.message : 'Could not remove.');
                }
              })
            }
          >
            Remove
          </Button>
        </div>
      </div>
      <p className="mt-1.5 text-[12px] text-[var(--color-ink-faint)]">
        Shown on: {banner.clients.join(', ')}
      </p>
      {error ? <p className="mt-1 text-[12px] font-semibold text-[var(--color-risk)]">{error}</p> : null}
    </div>
  );
}

function NewBannerForm() {
  const [message, setMessage] = useState('');
  const [tone, setTone] = useState<AnnouncementBanner['tone']>('info');
  const [clients, setClients] = useState<ClientTarget[]>(['website']);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function toggleClient(c: ClientTarget) {
    setClients((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (message.trim() === '') return setError('A banner needs a message.');
    if (clients.length === 0) return setError('Select at least one client.');
    startTransition(async () => {
      try {
        await upsertAnnouncementBannerAction({
          id: `ban_${Date.now()}`,
          message: message.trim(),
          tone,
          active: true,
          clients,
          startsAt: new Date().toISOString(),
          endsAt: null,
        });
        setMessage('');
      } catch (e2) {
        setError(e2 instanceof Error ? e2.message : 'Could not create the banner.');
      }
    });
  }

  return (
    <form onSubmit={submit} className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-rule-strong)] p-3">
      <div className="text-[13px] font-semibold">New announcement banner</div>
      <div className="mt-2 flex flex-col gap-2">
        <Field label="Message" htmlFor="new-banner-msg">
          <Input id="new-banner-msg" value={message} onChange={(e) => setMessage(e.target.value)} placeholder="What should people see?" />
        </Field>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-1.5 text-[13px]">
            Tone
            <select
              value={tone}
              onChange={(e) => setTone(e.target.value as AnnouncementBanner['tone'])}
              className="h-8 rounded-[var(--radius-sm)] border border-[var(--color-rule-strong)] bg-[var(--color-ground)] px-2"
            >
              <option value="info">info</option>
              <option value="warn">warn</option>
              <option value="risk">risk</option>
            </select>
          </label>
          <div className="flex gap-2 text-[13px]">
            {ALL_CLIENTS.map((c) => (
              <label key={c} className="flex items-center gap-1">
                <input type="checkbox" checked={clients.includes(c)} onChange={() => toggleClient(c)} />
                {c}
              </label>
            ))}
          </div>
        </div>
        <div>
          <Button size="sm" type="submit" disabled={pending}>
            {pending ? 'Creating…' : 'Create banner'}
          </Button>
        </div>
        {error ? <p className="text-[12px] font-semibold text-[var(--color-risk)]">{error}</p> : null}
      </div>
    </form>
  );
}
