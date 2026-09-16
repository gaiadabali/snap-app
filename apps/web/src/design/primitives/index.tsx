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
 *
 * ── The ledger language (2026-09-14) ──────────────────────────────────────
 * The marketing surface used to be a stack of bordered, rounded, shadowed
 * cards in alternating bands. That reads as a template regardless of how good
 * the copy inside it is. It is also the wrong metaphor: accountancy's native
 * visual form is ruled paper and aligned columns, not a deck of cards.
 *
 * So `Section`, `Rule`, `LedgerRow` and `Reveal` below are the marketing
 * vocabulary — hairlines spanning the full measure, figures locked to a right
 * column, and a left gutter carrying the real ATO label for the row. `Card`
 * survives for the panels, where a bounded box genuinely helps.
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
    width === 'prose' ? 'max-w-[68ch]' : width === 'wide' ? 'max-w-[1280px]' : 'max-w-none';
  return <div className={cx('mx-auto w-full px-6 md:px-10', w, className)}>{children}</div>;
}

// ── Motion ────────────────────────────────────────────────────────────────

/**
 * Scroll-driven reveal.
 *
 * Deliberately NOT a client component. The animation is pure CSS
 * (`animation-timeline: view()`), so this stays a server component and the
 * marketing pages ship no animation JavaScript at all — no IntersectionObserver,
 * no library, nothing to hydrate.
 *
 * `delay` staggers siblings by feeding `--i` to the keyframe range rather than
 * to `animation-delay`, because a scroll-linked animation has no wall clock to
 * delay against — the stagger has to live in the scroll range itself.
 */
export function Reveal({
  children,
  as: As = 'div',
  variant = 'rise',
  delay = 0,
  className,
}: {
  children: ReactNode;
  as?: 'div' | 'section' | 'li' | 'tr' | 'span' | 'p';
  variant?: 'rise' | 'fade' | 'deal' | 'drift' | 'wipe' | 'expand';
  /** Stagger index for `deal`; ignored by the others. */
  delay?: number;
  className?: string;
}) {
  const variants = {
    rise: 'anim-rise',
    fade: 'anim-fade',
    deal: 'anim-deal',
    drift: 'anim-drift',
    wipe: 'anim-wipe',
    expand: 'anim-expand',
  } as const;
  return (
    <As
      className={cx(variants[variant], className)}
      style={delay ? ({ ['--i' as string]: delay } as React.CSSProperties) : undefined}
    >
      {children}
    </As>
  );
}

/** A hairline that draws itself across the measure as it enters view. */
export function Rule({
  className,
  tone = 'default',
  animate = true,
}: {
  className?: string;
  tone?: 'default' | 'strong' | 'void';
  animate?: boolean;
}) {
  const tones = {
    default: 'bg-[var(--color-rule)]',
    strong: 'bg-[var(--color-rule-strong)]',
    void: 'bg-[var(--color-void-rule)]',
  } as const;
  return <div aria-hidden className={cx('h-px w-full', tones[tone], animate && 'anim-rule', className)} />;
}

// ── Section shell ─────────────────────────────────────────────────────────

/**
 * A marketing section with a left label gutter.
 *
 * The gutter carries a real account code — G11, 1B, D5 — not an invented
 * "01 / 02 / 03". Those codes are the product's entire point, so using them as
 * the page's structural markers means the navigation furniture is teaching
 * something rather than decorating.
 *
 * `tone="void"` is the single inverted band. Used once per page, on the
 * sharpest content; a second one would spend the effect.
 */
export function Section({
  code,
  children,
  tone = 'ground',
  size = 'md',
  form = 'gutter',
  className,
  id,
}: {
  /** The ATO label this section is about, e.g. "G11" or "D5". */
  code?: string;
  children: ReactNode;
  tone?: 'ground' | 'surface' | 'void';
  size?: 'sm' | 'md' | 'lg';
  /**
   * The section's SHAPE — see `docs/DESIGN-HANDOFF.md` §12.1.
   *
   * **No two adjacent sections may share a form.** Alternating `tone` is not
   * variation; it is the same shape in a different colour, and a page built
   * that way is what got three design directions rejected as
   * generated-looking. The metronome was fixed once inside `SectionHead` and
   * simply moved up a level — eight sections, seven identical.
   *
   * - `gutter`  — the spine: `120px | 1fr` with the account code in the margin.
   * - `wide`    — full measure, no gutter. One idea at display size.
   * - `measure` — a single 68ch column, aligned to the content edge. Prose.
   *
   * `wide` and `measure` drop the gutter deliberately. That absence is what
   * makes the gutter read as a choice rather than a frame.
   */
  form?: 'gutter' | 'wide' | 'measure';
  className?: string;
  id?: string;
}) {
  const tones = {
    ground: 'bg-[var(--color-ground)] text-[var(--color-ink)]',
    surface: 'bg-[var(--color-surface)] text-[var(--color-ink)]',
    void: 'bg-[var(--color-void)] text-[var(--color-void-ink)]',
  } as const;
  /**
   * Measured, not guessed. At `md:py-24` the eight sections on the home page
   * spent ~1,500px on padding alone and the document ran to 9,300px — about
   * ten full screens, which is more scrolling than a marketing page gets.
   * These keep the page breathing without making the reader work for it.
   */
  const sizes = {
    sm: 'py-12 md:py-14',
    md: 'py-14 md:py-20',
    lg: 'py-16 md:py-24',
  } as const;
  const shell = cx(tones[tone], sizes[size], id && 'scroll-mt-24', className);

  // No gutter: the content runs to the full measure, or to a reading column
  // held at the same left edge the gutter forms establish (7.5rem + 3rem gap).
  if (form !== 'gutter') {
    return (
      <section id={id} className={shell}>
        <Container width="wide">
          <div className={cx('min-w-0', form === 'measure' && 'max-w-[68ch] lg:ml-[10.5rem]')}>
            {children}
          </div>
        </Container>
      </section>
    );
  }

  return (
    <section id={id} className={shell}>
      <Container width="wide">
        <div className="grid gap-y-8 lg:grid-cols-[7.5rem_1fr] lg:gap-x-12">
          <div aria-hidden className="hidden lg:block">
            {code ? (
              <div
                className={cx(
                  't-label sticky top-28',
                  tone === 'void' ? 'text-[var(--color-void-muted)]' : 'text-[var(--color-ink-faint)]',
                )}
              >
                {code}
              </div>
            ) : null}
          </div>
          <div className="min-w-0">{children}</div>
        </div>
      </Container>
    </section>
  );
}

/**
 * A deliberately unequal two-up.
 *
 * 7/5, never 6/6. An even split reads as a template; the asymmetry is what
 * stops a comparison section looking like the feature grid above it. The
 * narrow side is the one carrying figures — a right-locked column of money
 * wants less room than the prose explaining it, not the same.
 */
export function Split({
  lead,
  aside,
  children,
  className,
}: {
  lead: ReactNode;
  aside: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <div className="grid gap-x-12 gap-y-10 lg:grid-cols-[7fr_5fr]">
        <div className="min-w-0">{lead}</div>
        <div className="min-w-0">{aside}</div>
      </div>
      {children}
    </div>
  );
}

/**
 * A section heading in the ledger language: a struck rule, a mono kicker, then
 * a large light display line. Replaces the eyebrow/title/lede stack that ran
 * identically seven times down the old home page.
 */
export function SectionHead({
  kicker,
  title,
  lede,
  tone = 'ground',
  as = 'h2',
  className,
}: {
  kicker?: string;
  title: ReactNode;
  lede?: ReactNode;
  tone?: 'ground' | 'void';
  as?: 'h1' | 'h2';
  className?: string;
}) {
  const Heading = as;
  const muted = tone === 'void' ? 'text-[var(--color-void-muted)]' : 'text-[var(--color-ink-muted)]';
  return (
    <div className={className}>
      <Rule tone={tone === 'void' ? 'void' : 'default'} />
      {kicker ? (
        <Reveal variant="fade">
          <div className={cx('t-label mt-5', muted)}>{kicker}</div>
        </Reveal>
      ) : null}
      <Reveal>
        <Heading className={cx('t-head mt-4 max-w-[22ch]', tone === 'void' && 'text-[var(--color-void-ink)]')}>
          {title}
        </Heading>
      </Reveal>
      {lede ? (
        <Reveal>
          <p className={cx('t-lede mt-6 max-w-[58ch]', muted)}>{lede}</p>
        </Reveal>
      ) : null}
    </div>
  );
}

// ── Ledger rows ───────────────────────────────────────────────────────────

/**
 * One ruled row: description on the left, figure locked to the right column.
 *
 * This is the marketing counterpart to `Tr`/`Td` — same alignment discipline,
 * no table semantics, because these are illustrative figures in prose rather
 * than tabular data a screen reader should navigate as a grid.
 */
export function LedgerRow({
  label,
  note,
  value,
  code,
  emphasis = false,
  tone = 'ground',
  index = 0,
}: {
  label: ReactNode;
  note?: ReactNode;
  value: ReactNode;
  /** Account or BAS code shown in the row's own small gutter. */
  code?: string;
  emphasis?: boolean;
  tone?: 'ground' | 'void';
  index?: number;
}) {
  const muted = tone === 'void' ? 'text-[var(--color-void-muted)]' : 'text-[var(--color-ink-muted)]';
  const rule = tone === 'void' ? 'border-[var(--color-void-rule)]' : 'border-[var(--color-rule)]';
  return (
    <Reveal variant="deal" delay={index}>
      <div className={cx('flex items-baseline gap-4 border-b py-4 last:border-b-0', rule)}>
        {code ? (
          <span className={cx('t-label w-14 shrink-0 pt-0.5', muted)}>{code}</span>
        ) : null}
        <span className="min-w-0 flex-1">
          <span
            className={cx(
              'block text-[15px] leading-snug',
              emphasis
                ? tone === 'void'
                  ? 'font-medium text-[var(--color-void-ink)]'
                  : 'font-medium text-[var(--color-ink)]'
                : muted,
            )}
          >
            {label}
          </span>
          {note ? <span className={cx('mt-0.5 block text-[13px]', muted)}>{note}</span> : null}
        </span>
        <span className={cx('shrink-0 font-mono text-[15px] tabular', emphasis && 'font-medium')}>
          {value}
        </span>
      </div>
    </Reveal>
  );
}

// ── Card ──────────────────────────────────────────────────────────────────

/**
 * Retained for the panels. Flatter than it was — a 4px radius and a hairline
 * rather than a 14px radius with a drop shadow, so a dense review queue reads
 * as a document instead of a pinboard.
 */
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
        'rounded-[var(--radius-md)] border p-5',
        tones[tone],
        interactive &&
          'transition duration-200 hover:border-[var(--color-rule-strong)] hover:shadow-[var(--shadow-card)]',
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
    'bg-transparent text-[var(--color-ink)] border border-[var(--color-rule-strong)] hover:border-[var(--color-ink)]',
  ghost: 'bg-transparent text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]',
  danger: 'bg-[var(--color-risk)] text-white hover:brightness-110',
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: 'h-9 px-4 text-[13px]',
  md: 'h-11 px-5 text-[14px]',
  lg: 'h-14 px-8 text-[15px]',
};

/** Shared by `Button` and `ButtonLink` so a link that must look like a button never drifts from one. */
export function buttonClasses(
  variant: ButtonVariant = 'primary',
  size: ButtonSize = 'md',
  className?: string,
): string {
  return cx(
    'inline-flex items-center justify-center gap-2 rounded-[var(--radius-sm)]',
    'font-medium tracking-[0.01em]',
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

/**
 * A text link that reads as forward motion: a rule under it that extends on
 * hover. Used instead of a ghost button wherever the action is "read more",
 * because a second button next to a real CTA dilutes the real one.
 */
export function ArrowLink({
  href,
  children,
  tone = 'ground',
  className,
}: {
  href: string;
  children: ReactNode;
  tone?: 'ground' | 'void';
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={cx(
        'group inline-flex items-center gap-3 text-[15px] font-medium',
        tone === 'void'
          ? 'text-[var(--color-void-ink)]'
          : 'text-[var(--color-ink)] hover:text-[var(--color-accent)]',
        'transition-colors',
        className,
      )}
    >
      <span className="relative">
        {children}
        <span
          aria-hidden
          className={cx(
            'absolute -bottom-1 left-0 h-px w-full origin-left scale-x-100 transition-transform duration-300',
            'group-hover:scale-x-0',
            tone === 'void' ? 'bg-[var(--color-void-rule)]' : 'bg-[var(--color-rule-strong)]',
          )}
        />
      </span>
      <span aria-hidden className="transition-transform duration-300 group-hover:translate-x-1">
        &rarr;
      </span>
    </Link>
  );
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
    <span className={cx('t-label inline-flex items-center rounded-[var(--radius-sm)] px-2 py-1', tones[tone])}>
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
      <div className="t-label text-[var(--color-ink-faint)]">{label}</div>
      <div className={cx('mt-2 font-mono text-[28px] font-normal tabular', tones[tone])}>{value}</div>
      {hint ? <div className="mt-1.5 text-[13px] text-[var(--color-ink-muted)]">{hint}</div> : null}
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
        'h-11 rounded-[var(--radius-sm)] border border-[var(--color-rule-strong)]',
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
        'h-11 rounded-[var(--radius-sm)] border border-[var(--color-rule-strong)]',
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
        'rounded-[var(--radius-sm)] border border-[var(--color-rule-strong)]',
        'bg-[var(--color-ground)] px-3 py-2 text-[15px] text-[var(--color-ink)]',
        'placeholder:text-[var(--color-ink-faint)]',
        className,
      )}
    />
  );
}

// ── Section heading ───────────────────────────────────────────────────────

/**
 * The panel-side heading. Kept at its original API because ~60 routes call it;
 * `SectionHead` above is the marketing counterpart with the struck rule and the
 * large light display line.
 */
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
      {eyebrow ? <div className="t-label text-[var(--color-accent)]">{eyebrow}</div> : null}
      <Heading className="mt-3 text-[26px] font-normal leading-tight tracking-[-0.02em] text-[var(--color-ink)]">
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
    <div className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-rule-strong)] p-10 text-center">
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
