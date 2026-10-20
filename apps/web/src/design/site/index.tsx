import Link from 'next/link';
import type { CSSProperties, ReactNode } from 'react';

import { cx } from '@/design/primitives/cx';

import { Icon } from './icons';

export { Icon, SnapMark } from './icons';
export type { IconName } from './icons';

/**
 * The marketing kit. Server components only — the client islands live in
 * `./client`. Styles are in `./site.css`, which the marketing and auth layouts
 * import. Read the header of that file before adding motion.
 */

/** The block-level tags the kit renders as. A closed list, so `as` stays typed. */
type Tag =
  | 'div'
  | 'section'
  | 'article'
  | 'header'
  | 'figure'
  | 'ul'
  | 'ol'
  | 'li'
  | 'p'
  | 'span'
  | 'h1'
  | 'h2'
  | 'h3';

/* ── Money ──────────────────────────────────────────────────────────────── */

/**
 * "1762.4" / "1762.40" → "1,762.40". A decimal string in, a display string
 * out, with no float anywhere in between — the same rule as the product
 * (docs/WEB.md §3.2). `cents: false` drops the fraction only when it is zero.
 */
export function aud(amount: string, opts: { cents?: boolean; sign?: boolean } = {}): string {
  const { cents = true, sign = true } = opts;
  const negative = amount.startsWith('-');
  const [whole = '0', frac = ''] = (negative ? amount.slice(1) : amount).split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const fraction = (frac + '00').slice(0, 2);
  const body = cents || fraction !== '00' ? `${grouped}.${fraction}` : grouped;
  return `${negative ? '−' : ''}${sign ? '$' : ''}${body}`;
}

/* ── Layout ─────────────────────────────────────────────────────────────── */

export function Shell({
  children,
  className,
  narrow = false,
  as: As = 'div',
}: {
  children: ReactNode;
  className?: string;
  narrow?: boolean;
  as?: Tag;
}) {
  return <As className={cx(narrow ? 'shell-narrow' : 'shell', className)}>{children}</As>;
}

/**
 * Reveal on first sight. Renders its own element so it can carry the
 * attributes the inline observer looks for. `delay` is in 80ms steps.
 *
 * `suppressHydrationWarning`: the observer may add `data-in` before React
 * hydrates. React never renders that attribute, so it is never removed — the
 * warning is the only thing to silence.
 */
export function Reveal({
  children,
  as: As = 'div',
  variant = 'up',
  delay = 0,
  stagger = false,
  className,
  style,
  id,
}: {
  children: ReactNode;
  as?: Tag;
  variant?: 'up' | 'fade' | 'scale' | 'left' | 'right' | 'blur';
  delay?: number;
  /** Reveal the direct children one after another instead of the whole block. */
  stagger?: boolean;
  className?: string;
  style?: CSSProperties;
  id?: string;
}) {
  const attrs = stagger ? { 'data-stagger': '' } : { 'data-reveal': variant === 'up' ? '' : variant };
  return (
    <As
      id={id}
      {...attrs}
      suppressHydrationWarning
      className={className}
      style={delay ? { ...style, ['--d' as string]: delay } : style}
    >
      {children}
    </As>
  );
}

/**
 * The heading block that opens a section. Two layouts and nothing else:
 * `center` for a statement, `split` for a heading with its lede beside it.
 * The kicker is optional and should be absent more often than present.
 */
export function SectionHead({
  kicker,
  title,
  lede,
  align = 'center',
  as: As = 'h2',
  size = 'hd-2',
  className,
  children,
}: {
  kicker?: ReactNode;
  title: ReactNode;
  lede?: ReactNode;
  align?: 'center' | 'left' | 'split';
  as?: Tag;
  size?: 'hd-1' | 'hd-2';
  className?: string;
  children?: ReactNode;
}) {
  if (align === 'split') {
    return (
      <div
        className={cx('grid gap-6 lg:grid-cols-[1.15fr_0.85fr] lg:items-end lg:gap-16', className)}
      >
        <Reveal>
          {kicker ? <div className="kicker mb-4">{kicker}</div> : null}
          <As className={size}>{title}</As>
        </Reveal>
        {lede || children ? (
          <Reveal delay={1}>
            {lede ? <p className="lede max-w-[46ch]">{lede}</p> : null}
            {children}
          </Reveal>
        ) : null}
      </div>
    );
  }
  const centered = align === 'center';
  return (
    <div className={cx(centered && 'mx-auto text-center', 'max-w-[52rem]', className)}>
      <Reveal>
        {kicker ? <div className="kicker mb-4">{kicker}</div> : null}
        <As className={size}>{title}</As>
      </Reveal>
      {lede ? (
        <Reveal delay={1}>
          <p className={cx('lede mt-6 max-w-[44ch]', centered && 'mx-auto')}>{lede}</p>
        </Reveal>
      ) : null}
      {children ? <Reveal delay={2}>{children}</Reveal> : null}
    </div>
  );
}

/* ── Controls ───────────────────────────────────────────────────────────── */

type BtnVariant = 'primary' | 'secondary' | 'ghost' | 'light' | 'glass';

export function Btn({
  href,
  children,
  variant = 'primary',
  size = 'md',
  arrow = false,
  className,
  external = false,
}: {
  href: string;
  children: ReactNode;
  variant?: BtnVariant;
  size?: 'sm' | 'md' | 'lg';
  arrow?: boolean;
  className?: string;
  external?: boolean;
}) {
  const cls = cx(
    'btn',
    `btn-${variant}`,
    size === 'lg' && 'btn-lg',
    size === 'sm' && 'btn-sm',
    className,
  );
  const inner = (
    <>
      {children}
      {arrow ? <Icon name="arrow-right" size={17} className="btn-arrow" /> : null}
    </>
  );
  if (external || href.startsWith('http') || href.startsWith('mailto:')) {
    return (
      <a href={href} className={cls}>
        {inner}
      </a>
    );
  }
  return (
    <Link href={href} className={cls}>
      {inner}
    </Link>
  );
}

/**
 * The get-the-app pair.
 *
 * Android is real: a direct APK from /download. iPhone is not installable,
 * and says so — present, focusable and announced as unavailable, never a
 * `<button disabled>` (dropped from the accessibility tree) and never an `<a>`
 * without an href (docs/WEB.md §7). Never the stores' own badge artwork:
 * there is no store listing for it to point at.
 *
 * Takes no release data on purpose. Reading the manifest would make every
 * page that carries the pair dynamic; the live version, size and checksum
 * belong on /download.
 */
export function StoreButtons({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <div className={cx('flex flex-wrap items-center gap-3', className)}>
      <Link href="/download" className="store">
        <AndroidGlyph />
        <span>
          <span className="store-meta">{compact ? 'Android 7.0+' : 'Get it for Android'}</span>
          <span className="store-name">Download the app</span>
        </span>
      </Link>
      <span
        role="button"
        tabIndex={0}
        aria-disabled="true"
        aria-label="iPhone app: in development, not yet installable"
        className="store"
      >
        <Icon name="phone" size={24} strokeWidth={1.6} />
        <span>
          <span className="store-meta">iPhone · in development</span>
          <span className="store-name">Not yet on iOS</span>
        </span>
      </span>
    </div>
  );
}

/** A plain droid-ish head — generic, not the Android trademark. */
function AndroidGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden focusable="false">
      <path
        fill="currentColor"
        d="M6.2 9.2h11.6a1 1 0 0 1 1 1v6.3a1.6 1.6 0 0 1-1.6 1.6h-.8v2.4a1.2 1.2 0 0 1-2.4 0v-2.4h-4v2.4a1.2 1.2 0 0 1-2.4 0v-2.4h-.8a1.6 1.6 0 0 1-1.6-1.6v-6.3a1 1 0 0 1 1-1zM6.4 8.2a5.7 5.7 0 0 1 2.7-3.9l-.9-1.5a.4.4 0 0 1 .7-.4l.9 1.6a6 6 0 0 1 4.4 0l.9-1.6a.4.4 0 0 1 .7.4l-.9 1.5a5.7 5.7 0 0 1 2.7 3.9zM9.6 6.6a.7.7 0 1 0 0-1.4.7.7 0 0 0 0 1.4zm4.8 0a.7.7 0 1 0 0-1.4.7.7 0 0 0 0 1.4zM3.6 9.6a1.1 1.1 0 0 1 1.1 1.1v4.4a1.1 1.1 0 0 1-2.2 0v-4.4a1.1 1.1 0 0 1 1.1-1.1zm16.8 0a1.1 1.1 0 0 1 1.1 1.1v4.4a1.1 1.1 0 0 1-2.2 0v-4.4a1.1 1.1 0 0 1 1.1-1.1z"
      />
    </svg>
  );
}

/** "10 free scans · No card · No subscription" — the facts under a CTA. */
export function Assurances({ items, className }: { items: string[]; className?: string }) {
  return (
    <ul className={cx('flex flex-wrap items-center gap-x-5 gap-y-2', className)}>
      {items.map((t) => (
        <li key={t} className="flex items-center gap-2 text-[0.875rem] text-[var(--s-ink-3)]">
          <span className="grid size-[18px] place-items-center rounded-full bg-[var(--s-green-soft)] text-[var(--s-green-2)]">
            <Icon name="check" size={12} strokeWidth={2.6} />
          </span>
          {t}
        </li>
      ))}
    </ul>
  );
}

/* ── The phone ──────────────────────────────────────────────────────────── */

/**
 * A device frame. Children are drawn at the app's own 390-point width and
 * zoomed to fit (see `.phone` in site.css), so pass app-ui screens straight in.
 *
 * `width` is in CSS pixels. The frame is `aria-hidden` unless `label` is
 * given: a phone mockup is a picture of the app, and every figure it shows
 * that matters is also stated in the page around it.
 */
export function Phone({
  children,
  width,
  label,
  className,
  style,
}: {
  children: ReactNode;
  /** CSS pixels. Omit it to size the frame from a class instead, e.g.
   *  `[--pw:280] lg:[--pw:340]` — an inline width would beat the class. */
  width?: number;
  label?: string;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div
      className={cx('phone', className)}
      style={width ? { ...style, ['--pw' as string]: width } : style}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <div className="phone-screen">{children}</div>
    </div>
  );
}

/* ── Small pieces ───────────────────────────────────────────────────────── */

export function Chip({ children, dot = false, className }: { children: ReactNode; dot?: boolean; className?: string }) {
  return (
    <span className={cx('chip', className)}>
      {dot ? <span className="chip-dot" aria-hidden /> : null}
      {children}
    </span>
  );
}

/** A round tinted icon tile, the app's own row-icon shape. */
export function IconTile({
  name,
  tone = 'blue',
  size = 44,
  className,
}: {
  name: Parameters<typeof Icon>[0]['name'];
  tone?: 'blue' | 'green' | 'red' | 'amber' | 'ink' | 'white';
  size?: number;
  className?: string;
}) {
  const tones: Record<string, string> = {
    blue: 'bg-[var(--s-blue-soft)] text-[var(--s-blue-text)]',
    green: 'bg-[var(--s-green-soft)] text-[var(--s-green)]',
    red: 'bg-[var(--s-red-soft)] text-[var(--s-red)]',
    amber: 'bg-[var(--s-amber-soft)] text-[var(--s-amber)]',
    ink: 'bg-[var(--s-mist-2)] text-[var(--s-ink)]',
    white: 'bg-white/15 text-white',
  };
  return (
    <span
      className={cx('grid shrink-0 place-items-center rounded-[14px]', tones[tone], className)}
      style={{ width: size, height: size }}
      aria-hidden
    >
      <Icon name={name} size={Math.round(size * 0.48)} />
    </span>
  );
}

/** An arrow text link. */
export function TextLink({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  return (
    <Link
      href={href}
      className={cx(
        'group inline-flex items-center gap-1.5 text-[0.9375rem] font-semibold tracking-[-0.01em] text-[var(--s-blue-text)]',
        className,
      )}
    >
      {children}
      <Icon name="arrow-right" size={16} className="transition-transform duration-300 group-hover:translate-x-0.5" />
    </Link>
  );
}

/** The plain statement every figure on the site rests on. */
export const ILLUSTRATIVE_NOTE =
  'Screens show the demo workspace. Every figure is illustrative and adds up.';
