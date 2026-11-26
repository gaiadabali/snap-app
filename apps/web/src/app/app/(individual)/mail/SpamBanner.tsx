'use client';

import type { MailSummary } from '@snap/mail-engine';
import { useMailSummary } from '@snap/mail-engine/react';

import { buttonClasses } from '@/design/primitives';
import { safeHttpsUrl } from '@/lib/panels/mail-text';
import { MailIcon } from './MailIcon';

const nf = new Intl.NumberFormat('en-AU');

/**
 * The YourTal ad and the three counters, shown at the top of Spam (BUILD.md §4.13).
 *
 * The title, body and button label come from the server and are shown as plain text.
 * The button is drawn only when its address is plain https. A missing banner (`null`)
 * still shows the counters, and a missing summary shows nothing: this is an extra, not
 * something the folder should wait for.
 */
export function SpamBannerView({ summary }: { summary: MailSummary | null }) {
  if (!summary) return null;
  const { banner, counters } = summary;
  const href = safeHttpsUrl(banner?.ctaUrl);
  return (
    <section aria-label="About this folder" className="mb-4 overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-rule-strong)] bg-[var(--color-accent-soft)]">
      {banner ? (
        <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
          <div className="min-w-0">
            <div className="t-label text-[var(--color-accent-strong)]">From YourTal</div>
            <h2 className="mt-1.5 text-[16px] font-semibold leading-snug text-[var(--color-ink)]">{banner.title}</h2>
            <p className="mt-1 max-w-[62ch] text-[14px] leading-relaxed text-[var(--color-ink-muted)]">{banner.body}</p>
          </div>
          {href ? (
            <a href={href} target="_blank" rel="noopener noreferrer" className={buttonClasses('primary', 'md', 'shrink-0 self-start sm:self-center')}>
              {banner.ctaLabel}
              <MailIcon name="arrow-up-right" size={16} />
            </a>
          ) : null}
        </div>
      ) : null}
      <dl className="grid grid-cols-3 gap-px border-t border-[var(--color-rule-strong)] bg-[var(--color-rule-strong)] text-center">
        {(
          [
            ['Bulk mail filed, last 30 days', counters.bulkFiled30d],
            ['Senders you have unsubscribed from', counters.marketersUnsubscribed],
            ['Replies sent to marketers, last 30 days', counters.autoRepliesSent30d],
          ] as const
        ).map(([label, value]) => (
          <div key={label} className="bg-[var(--color-ground)] px-2 py-3">
            <dd className="font-mono text-[20px] tabular text-[var(--color-ink)]">{nf.format(value)}</dd>
            <dt className="mt-0.5 text-[12px] leading-snug text-[var(--color-ink-muted)]">{label}</dt>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function SpamBanner() {
  const { summary } = useMailSummary('en-AU');
  return <SpamBannerView summary={summary} />;
}
