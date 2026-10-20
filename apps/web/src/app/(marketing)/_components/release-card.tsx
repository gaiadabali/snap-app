import type { ReactNode } from 'react';

import { cx } from '@/design/primitives/cx';

/**
 * A platform's release as a raised card in the marketing kit's language:
 * platform and status on one line, the title, a lede, then the action and the
 * facts. Both platforms render through this so they can be compared.
 */
export function ReleaseCard({
  platform,
  title,
  status,
  statusTone = 'good',
  lede,
  action,
  children,
  className,
}: {
  /** "Android" or "iPhone" — the small label above the title. */
  platform: string;
  title: string;
  status: string;
  statusTone?: 'good' | 'warn' | 'neutral';
  lede: ReactNode;
  /** The download control — live or inert. */
  action: ReactNode;
  /** Spec rows, checksum, anything else below the action. */
  children?: ReactNode;
  className?: string;
}) {
  const tone =
    statusTone === 'good'
      ? 'bg-[var(--s-green-soft)] text-[var(--s-green)]'
      : statusTone === 'warn'
        ? 'bg-[var(--s-amber-soft)] text-[var(--s-amber)]'
        : 'bg-[var(--s-mist-2)] text-[var(--s-ink-2)]';
  return (
    <div className={cx('card flex h-full min-w-0 flex-col p-7 sm:p-9', className)}>
      <div className="flex items-center justify-between gap-3">
        <span className="kicker">{platform}</span>
        <span
          className={cx(
            'rounded-full px-3 py-1 text-[0.75rem] font-semibold tracking-[-0.005em]',
            tone,
          )}
        >
          {status}
        </span>
      </div>

      <h2 className="hd-3 mt-4">{title}</h2>
      <div className="body mt-3">{lede}</div>

      <div className="mt-7">{action}</div>

      {children ? <div className="mt-8 flex flex-1 flex-col">{children}</div> : null}
    </div>
  );
}

/** One line of a release manifest: label left, figure right. */
export function SpecRow({
  label,
  value,
  mono = true,
}: {
  label: string;
  value: ReactNode;
  /** Off for prose values like "Android 8.0 (API 26)" that are not figures. */
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-[var(--s-edge)] py-3 last:border-b-0">
      <span className="text-[0.875rem] text-[var(--s-ink-3)]">{label}</span>
      <span
        className={cx(
          'shrink-0 text-[0.9375rem] font-medium text-[var(--s-ink)]',
          mono && 'font-mono tabular-nums',
        )}
      >
        {value}
      </span>
    </div>
  );
}

/** A titled block inside a release card. */
export function ReleaseBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mt-7 first:mt-0">
      <h3 className="text-[0.8125rem] font-semibold uppercase tracking-[0.06em] text-[var(--s-ink-4)]">
        {title}
      </h3>
      <div className="mt-3">{children}</div>
    </div>
  );
}
