import type { ReactNode } from 'react';

import { Badge, Tear, cx } from '@/design/primitives';

/**
 * A platform's release, as a record rather than a panel.
 *
 * WHAT WAS WRONG WITH THE OLD ONES. Two `Card`s side by side, each a bordered
 * box holding a heading, a paragraph, a button and a `<dl>` in a 2×2 grid.
 * Three problems, and the third is the one that mattered:
 *
 *   1. The 2×2 `<dl>` put "Version" beside "Released" and "File size" beside
 *      "Requires", so four figures sat in four quadrants with nothing aligning
 *      to anything. This site's entire visual argument is that figures belong
 *      in a column (`docs/WEB.md` §4.1) — a release manifest is exactly the
 *      kind of thing that should be read down a ruled edge.
 *   2. The cards were different shapes inside, so the two platforms could not
 *      be compared: the eye had to re-learn the layout on the right.
 *   3. They ended ragged. The Android card ran out of content well before the
 *      iOS card did, leaving a tall empty box beside a full one — which reads
 *      as something failing to load rather than as a shorter list.
 *
 * So both platforms now render through THIS, in the same order, with the spec
 * rows ruled and right-aligned, and the whole thing built to sit flush at the
 * bottom of whatever row it is in.
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
  /** ANDROID · IPHONE — set in the mono face, above the title. */
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
  return (
    <div
      className={cx(
        'flex h-full min-w-0 flex-col rounded-[var(--radius-md)] border border-[var(--color-rule)] bg-[var(--color-surface)] p-6',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <span className="t-label text-[var(--color-accent)]">{platform}</span>
        <Badge tone={statusTone}>{status}</Badge>
      </div>

      <h2 className="mt-3 text-[21px] font-semibold leading-tight text-[var(--color-ink)]">
        {title}
      </h2>

      <div className="mt-3 text-[14px] leading-relaxed text-[var(--color-ink-muted)]">{lede}</div>

      {/* The action sits at a fixed distance from the top of the card on both
          sides, so the two download controls line up across the row however
          long the two paragraphs above them run. */}
      <div className="mt-6">{action}</div>

      {children ? <div className="mt-7 flex flex-1 flex-col">{children}</div> : null}
    </div>
  );
}

/**
 * One line of a release manifest: label left, figure locked to the right.
 *
 * The marketing counterpart of `LedgerRow`, minus the gutter code — a release
 * has no ATO label, and inventing one would be exactly the decorative
 * marker §8 rules out.
 */
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
    <div className="flex items-baseline justify-between gap-4 border-b border-[var(--color-rule)] py-2.5 last:border-b-0">
      <span className="text-[13px] text-[var(--color-ink-muted)]">{label}</span>
      <span
        className={cx(
          'shrink-0 text-[13px] font-medium text-[var(--color-ink)]',
          mono && 'font-mono tabular',
        )}
      >
        {value}
      </span>
    </div>
  );
}

/** A titled block inside a release card, separated by the docket's cut line. */
export function ReleaseBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mt-5 first:mt-0">
      <Tear className="mb-4" />
      <div className="t-label text-[var(--color-ink-faint)]">{title}</div>
      <div className="mt-3">{children}</div>
    </div>
  );
}
