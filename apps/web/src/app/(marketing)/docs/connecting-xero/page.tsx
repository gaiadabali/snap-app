import type { Metadata } from 'next';

import { Toc } from '../_components/Toc';

export const metadata: Metadata = { title: 'Connecting Xero' };

const sections = [
  { id: 'what-syncs', label: 'What syncs' },
  { id: 'how-the-connection-works', label: 'How the connection works' },
  { id: 'why-a-queue', label: "Why it's not instant" },
  { id: 'disconnecting', label: 'Disconnecting' },
];

export default function ConnectingXeroPage() {
  return (
    <div className="grid gap-10 xl:grid-cols-[1fr_200px]">
      <article className="max-w-[68ch]">
        <h1 className="text-[28px] font-bold text-[var(--color-ink)]">Connecting Xero</h1>
        <p className="mt-3 text-[16px] leading-relaxed text-[var(--color-ink-muted)]">
          Connecting Xero pushes your posted transactions across as bank transactions or bills, each
          one carrying its original receipt image as an attachment — so the evidence is sitting right
          there in Xero when your accountant opens the record.
        </p>

        <h2 id="what-syncs" className="mt-10 text-[20px] font-bold text-[var(--color-ink)]">
          What syncs
        </h2>
        <p className="mt-3 leading-relaxed text-[var(--color-ink-muted)]">
          Posted transactions push across with their tax codes mapped to the equivalent Xero tax rates,
          and the original document image attached to the Xero record. Drafts don&apos;t sync — only a
          confirmed, posted transaction does, which keeps Xero showing exactly what your books show.
        </p>

        <h2 id="how-the-connection-works" className="mt-10 text-[20px] font-bold text-[var(--color-ink)]">
          How the connection works
        </h2>
        <p className="mt-3 leading-relaxed text-[var(--color-ink-muted)]">
          You connect via Xero&apos;s own sign-in (OAuth) — Snap Apps never sees or stores your Xero
          password. The access token Xero issues is encrypted at rest, tied to your workspace only, and
          can be revoked from within Snap Apps at any time, which immediately stops any further sync.
        </p>

        <h2 id="why-a-queue" className="mt-10 text-[20px] font-bold text-[var(--color-ink)]">
          Why a push isn&apos;t always instant
        </h2>
        <p className="mt-3 leading-relaxed text-[var(--color-ink-muted)]">
          Xero enforces its own rate limits per connected organisation, so transactions are sent
          through a queue that respects those limits rather than firing every request the moment you
          confirm a document. If you post a large batch at once, expect the Xero side to catch up over
          a short window rather than appearing all at once.
        </p>

        <h2 id="disconnecting" className="mt-10 text-[20px] font-bold text-[var(--color-ink)]">
          Disconnecting
        </h2>
        <p className="mt-3 leading-relaxed text-[var(--color-ink-muted)]">
          Disconnecting revokes the stored token immediately and stops all future sync. It does not
          remove anything already pushed to Xero, and it does not affect your records inside Snap
          Apps.
        </p>
      </article>
      <Toc items={sections} />
    </div>
  );
}
