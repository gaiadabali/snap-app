'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button, Card, SectionTitle } from '@/design/primitives';
import { MailApiFailure, mailApi } from '@/lib/panels/mail-api';
import { CopyButton } from './CopyButton';
import { MailIcon } from './MailIcon';

export type SwitchOnPhase =
  | { step: 'idle' }
  | { step: 'working' }
  | { step: 'done'; address: string }
  | { step: 'error'; message: string };

const POINTS: { icon: 'inbox' | 'ban' | 'file'; text: string }[] = [
  { icon: 'inbox', text: 'You get a friendly generated address, such as geewizduck@yourtal.gaiada.com. It is chosen for you and stays yours.' },
  { icon: 'ban', text: 'Marketing and bulk mail is filed into Spam and Junk, so your Inbox is left for people and bills.' },
  { icon: 'file', text: 'Statements sent to this address can be imported into SnapApps. That is off until you turn it on in Mail settings.' },
];

/** The words and buttons, with no state of their own (`SwitchOn.test.tsx`). */
export function SwitchOnView({
  phase,
  onSwitchOn,
  onContinue,
}: {
  phase: SwitchOnPhase;
  onSwitchOn: () => void;
  onContinue: () => void;
}) {
  if (phase.step === 'done') {
    return (
      <div className="max-w-[620px]">
        <SectionTitle as="h1" eyebrow="Spambank" title="Your inbox is ready" lede="This is your new address. It works in SnapApps, YourTal and Free Tax Returns." />
        <Card tone="accent" className="mt-6">
          <div className="t-label text-[var(--color-ink-muted)]">Your address</div>
          <div className="mt-2 flex items-center gap-1">
            <span className="min-w-0 break-all font-mono text-[18px] text-[var(--color-ink)]" data-testid="new-address">
              {phase.address}
            </span>
            <CopyButton text={phase.address} label="Copy your address" />
          </div>
          <p className="mt-3 text-[14px] text-[var(--color-ink-muted)]">
            Give this address to the shops and newsletters you would otherwise give your real one to.
          </p>
        </Card>
        <div className="mt-5">
          <Button onClick={onContinue}>Open your inbox</Button>
        </div>
      </div>
    );
  }
  const working = phase.step === 'working';
  return (
    <div className="max-w-[620px]">
      <SectionTitle
        as="h1"
        eyebrow="Spambank"
        title="Get your own Spambank inbox"
        lede="A real email address that keeps marketing mail out of your way. One inbox, shared by SnapApps, YourTal and Free Tax Returns."
      />
      <ul className="mt-6 space-y-4">
        {POINTS.map((p) => (
          <li key={p.icon} className="flex gap-3 text-[15px] leading-relaxed text-[var(--color-ink)]">
            <span className="mt-0.5 text-[var(--color-accent-strong)]">
              <MailIcon name={p.icon} size={20} />
            </span>
            <span>{p.text}</span>
          </li>
        ))}
      </ul>
      {phase.step === 'error' ? (
        <p role="alert" className="mt-5 rounded-[var(--radius-sm)] bg-[var(--color-risk-soft)] px-3 py-2 text-[14px] text-[var(--color-risk)]">
          {phase.message}
        </p>
      ) : null}
      <div className="mt-6 flex flex-wrap items-center gap-4">
        <Button size="lg" onClick={onSwitchOn} disabled={working}>
          {working ? 'Setting up your inbox…' : 'Switch on mail'}
        </Button>
        <span className="text-[13px] text-[var(--color-ink-muted)]">For adults. You can stop using it at any time.</span>
      </div>
    </div>
  );
}

export function SwitchOn() {
  const router = useRouter();
  const [phase, setPhase] = useState<SwitchOnPhase>({ step: 'idle' });

  async function switchOn() {
    setPhase({ step: 'working' });
    try {
      const { address } = await mailApi.enable();
      setPhase({ step: 'done', address });
    } catch (e) {
      const message =
        e instanceof MailApiFailure && e.code === 'not_allowed'
          ? 'Mail is for adult accounts, so it cannot be switched on here.'
          : e instanceof MailApiFailure
            ? e.message
            : 'Something went wrong. Try again in a moment.';
      setPhase({ step: 'error', message });
    }
  }

  // The layout was rendered before the mailbox existed; refreshing re-reads it.
  return <SwitchOnView phase={phase} onSwitchOn={switchOn} onContinue={() => router.refresh()} />;
}
