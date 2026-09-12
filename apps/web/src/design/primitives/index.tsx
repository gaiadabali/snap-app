/**
 * The primitive set.
 *
 * Every surface in this app is built from these. The rule is not decoration —
 * it is that several people working in parallel produce one product instead of
 * several. If a screen needs something these do not cover, add it HERE and use
 * it there, rather than growing a bespoke variant inside a page.
 *
 * No component here hard-codes a colour. They all reference the tokens in
 * globals.css, which is what makes light and dark work without a second
 * implementation.
 */
import Link from 'next/link';
import type { ComponentProps, ReactNode } from 'react';

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

// ── Layout ────────────────────────────────────────────────────────────────

export function Container({
  children,
  width = 'wide',
  className,
}: {
  children: ReactNode;
  /** "prose" for reading, "wide" for marketing, "full" for dashboards. */
  width?: 'prose' | 'wide' | 'full';
  className?: string;
}) {
  const w =
    width === 'prose' ? 'max-w-[68ch]' : width === 'wide' ? 'max-w-[1200px]' : 'max-w-none';
  return <div className={cx('mx-auto w-full px-6', w, className)}>{children}</div>;
}

// ── Card ──────────────────────────────────────────────────────────────────

export function Card({
  children,
  className,
  tone = 'surface',
  interactive = false,
}: {
  children: ReactNode;
  className?: string;
  tone?: 'surface' | 'ground' | 'accent';
  interactive?: boolean;
}) {
  const tones = {
    surface: 'bg-[var(--color-surface)] border-[var(--color-rule)]',
    ground: 'bg-[var(--color-ground)] border-[var(--color-rule)]',
    accent: 'bg-[var(--color-accent-soft)] border-[var(--color-rule-strong)]',
  } as const;
  return (
    <div
      className={cx(
        'rounded-[var(--radius-lg)] border p-5 shadow-[var(--shadow-card)]',
        tones[tone],
        interactive &&
          'transition duration-200 hover:-translate-y-0.5 hover:shadow-[var(--shadow-lift)]',
        className,
      )}
    >
      {children}
    </div>
  );
}

// ── Button ────────────────────────────────────────────────────────────────

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-[var(--color-accent)] text-[var(--color-accent-ink)] hover:bg-[var(--color-accent-deep)]',
  secondary:
    'bg-transparent text-[var(--color-ink)] border border-[var(--color-rule-strong)] hover:bg-[var(--color-surface-alt)]',
  ghost: 'bg-transparent text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]',
  danger: 'bg-[var(--color-risk)] text-white hover:brightness-110',
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-[13px]',
  md: 'h-10 px-4 text-[15px]',
  lg: 'h-12 px-6 text-[16px]',
};

/** Shared by `Button` and `ButtonLink` so a link that must look like a button never drifts from one. */
export function buttonClasses(
  variant: ButtonVariant = 'primary',
  size: ButtonSize = 'md',
  className?: string,
): string {
  return cx(
    'inline-flex items-center justify-center gap-2 rounded-[var(--radius-md)] font-semibold',
    'transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50',
    BUTTON_VARIANTS[variant],
    BUTTON_SIZES[size],
    className,
  );
}

type ButtonProps = ComponentProps<'button'> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
};

export function Button({ variant = 'primary', size = 'md', className, ...rest }: ButtonProps) {
  return <button {...rest} className={buttonClasses(variant, size, className)} />;
}

type ButtonLinkProps = ComponentProps<typeof Link> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
};

/**
 * A navigation that must look like a `Button`. A `<button>` inside an `<a>`
 * (or vice versa) is invalid HTML and breaks middle-click / open-in-new-tab —
 * so a CTA that navigates renders an anchor styled identically, never a real
 * button with an onClick that pushes a route.
 */
export function ButtonLink({ variant = 'primary', size = 'md', className, ...rest }: ButtonLinkProps) {
  return <Link {...rest} className={buttonClasses(variant, size, className)} />;
}

// ── Badge ─────────────────────────────────────────────────────────────────

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'good' | 'warn' | 'risk' | 'accent';
}) {
  const tones = {
    neutral: 'bg-[var(--color-surface-alt)] text-[var(--color-ink-muted)]',
    good: 'bg-[var(--color-good-soft)] text-[var(--color-good)]',
    warn: 'bg-[var(--color-warn-soft)] text-[var(--color-warn)]',
    risk: 'bg-[var(--color-risk-soft)] text-[var(--color-risk)]',
    accent: 'bg-[var(--color-accent-soft)] text-[var(--color-accent)]',
  } as const;
  return (
    <span
      className={cx(
        'inline-flex items-center rounded-full px-2.5 py-0.5',
        'text-[11px] font-semibold uppercase tracking-[0.06em]',
        tones[tone],
      )}
    >
      {children}
    </span>
  );
}

// ── Money & figures ───────────────────────────────────────────────────────

const THOUSANDS = /\B(?=(\d{3})+(?!\d))/g;

/**
 * Renders a decimal money STRING.
 *
 * It never accepts a number and never parses one. `@snap/api-contract` is
 * explicit that a JSON float cannot hold 110.10 exactly and a BAS out by a cent
 * is wrong, so formatting here is string surgery only — group the integer part,
 * take two decimal places, done. The moment this calls parseFloat, the contract
 * that keeps the books right has been broken on the client.
 */
export function Money({
  amount,
  currency = 'AUD',
  className,
}: {
  amount: string;
  currency?: string;
  className?: string;
}) {
  const trimmed = amount.trim();
  const negative = trimmed.startsWith('-');
  const digits = negative ? trimmed.slice(1) : trimmed;
  const parts = digits.split('.');
  const whole = parts[0] ?? '0';
  const frac = parts[1] ?? '00';
  const grouped = whole.replace(THOUSANDS, ',');
  const cents = frac.slice(0, 2).padEnd(2, '0');
  return (
    <span className={cx('tabular', className)} title={currency + ' ' + amount}>
      {negative ? '−' : ''}${grouped}.{cents}
    </span>
  );
}

export function Stat({
  label,
  value,
  hint,
  tone = 'neutral',
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: 'neutral' | 'good' | 'warn' | 'risk';
}) {
  const tones = {
    neutral: 'text-[var(--color-ink)]',
    good: 'text-[var(--color-good)]',
    warn: 'text-[var(--color-warn)]',
    risk: 'text-[var(--color-risk)]',
  } as const;
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-ink-faint)]">
        {label}
      </div>
      <div className={cx('mt-1 text-3xl font-bold tabular', tones[tone])}>{value}</div>
      {hint ? <div className="mt-1 text-[13px] text-[var(--color-ink-muted)]">{hint}</div> : null}
    </div>
  );
}

// ── Form field ────────────────────────────────────────────────────────────

export function Field({
  label,
  hint,
  error,
  children,
  htmlFor,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
  htmlFor?: string;
}) {
  return (
    <label className="flex flex-col gap-1.5" htmlFor={htmlFor}>
      <span className="text-[13px] font-semibold text-[var(--color-ink)]">{label}</span>
      {children}
      {error ? (
        <span className="text-[13px] text-[var(--color-risk)]">{error}</span>
      ) : hint ? (
        <span className="text-[13px] text-[var(--color-ink-muted)]">{hint}</span>
      ) : null}
    </label>
  );
}

export function Input({ className, ...rest }: ComponentProps<'input'>) {
  return (
    <input
      {...rest}
      className={cx(
        'h-10 rounded-[var(--radius-md)] border border-[var(--color-rule-strong)]',
        'bg-[var(--color-ground)] px-3 text-[15px] text-[var(--color-ink)]',
        'placeholder:text-[var(--color-ink-faint)]',
        className,
      )}
    />
  );
}

export function Select({ className, ...rest }: ComponentProps<'select'>) {
  return (
    <select
      {...rest}
      className={cx(
        'h-10 rounded-[var(--radius-md)] border border-[var(--color-rule-strong)]',
        'bg-[var(--color-ground)] px-3 text-[15px] text-[var(--color-ink)]',
        className,
      )}
    />
  );
}

export function Textarea({ className, ...rest }: ComponentProps<'textarea'>) {
  return (
    <textarea
      {...rest}
      className={cx(
        'rounded-[var(--radius-md)] border border-[var(--color-rule-strong)]',
        'bg-[var(--color-ground)] px-3 py-2 text-[15px] text-[var(--color-ink)]',
        'placeholder:text-[var(--color-ink-faint)]',
        className,
      )}
    />
  );
}

// ── Section heading ───────────────────────────────────────────────────────

export function SectionTitle({
  eyebrow,
  title,
  lede,
  as = 'h2',
}: {
  eyebrow?: string;
  title: string;
  lede?: string;
  /** Use "h1" for a page's single top-level heading; every other section stays "h2". */
  as?: 'h1' | 'h2';
}) {
  const Heading = as;
  return (
    <div className="max-w-[60ch]">
      {eyebrow ? (
        <div className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--color-accent)]">
          {eyebrow}
        </div>
      ) : null}
      <Heading className="mt-2 text-[28px] font-bold leading-tight text-[var(--color-ink)]">
        {title}
      </Heading>
      {lede ? (
        <p className="mt-3 text-[16px] leading-relaxed text-[var(--color-ink-muted)]">{lede}</p>
      ) : null}
    </div>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────

/**
 * Exists so no screen ships a blank panel. An empty table with no explanation
 * is indistinguishable from a broken one, and this product asks people to trust
 * its numbers.
 */
export function Empty({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="rounded-[var(--radius-lg)] border border-dashed border-[var(--color-rule-strong)] p-10 text-center">
      <div className="text-[15px] font-semibold text-[var(--color-ink)]">{title}</div>
      {body ? (
        <p className="mx-auto mt-2 max-w-[46ch] text-[14px] text-[var(--color-ink-muted)]">{body}</p>
      ) : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

// ── Switch ────────────────────────────────────────────────────────────────

/**
 * A toggle that looks like what it does. `pending` dims it during a server
 * action round trip so a click cannot be read as "nothing happened" and
 * repeated — useful on an operator console where a toggle is never merely
 * decorative.
 */
export function Switch({
  checked,
  onCheckedChange,
  label,
  pending = false,
  disabled = false,
}: {
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
  label: string;
  pending?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled || pending}
      onClick={() => onCheckedChange(!checked)}
      className={cx(
        'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-150',
        'disabled:cursor-not-allowed',
        checked ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-surface-alt)]',
        pending && 'opacity-60',
      )}
    >
      <span
        className={cx(
          'inline-block h-4.5 w-4.5 transform rounded-full bg-white shadow transition-transform duration-150',
          checked ? 'translate-x-6' : 'translate-x-1',
        )}
      />
    </button>
  );
}

// ── Table ─────────────────────────────────────────────────────────────────

/**
 * A dense, tabular-numeral table shell for panels — "density is a feature in
 * the panels" (docs/WEB.md §4). Wrap in a `div.overflow-x-auto` yourself when
 * a table may run wide; this stays a plain `<table>` so semantics (screen
 * readers, `Ctrl+F`) are never sacrificed for layout.
 */
export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <table className={cx('w-full border-collapse text-[13px]', className)}>{children}</table>
  );
}

export function Thead({ children }: { children: ReactNode }) {
  return (
    <thead>
      <tr className="border-b border-[var(--color-rule-strong)] text-left">{children}</tr>
    </thead>
  );
}

export function Th({ children, className, align = 'left' }: { children?: ReactNode; className?: string; align?: 'left' | 'right' }) {
  return (
    <th
      className={cx(
        'whitespace-nowrap px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--color-ink-faint)]',
        align === 'right' && 'text-right',
        className,
      )}
    >
      {children}
    </th>
  );
}

export function Tr({ children, className }: { children: ReactNode; className?: string }) {
  return <tr className={cx('border-b border-[var(--color-rule)] last:border-0', className)}>{children}</tr>;
}

export function Td({ children, className, align = 'left' }: { children?: ReactNode; className?: string; align?: 'left' | 'right' }) {
  return (
    <td className={cx('px-3 py-2.5 align-middle text-[var(--color-ink)]', align === 'right' && 'text-right', className)}>
      {children}
    </td>
  );
}
