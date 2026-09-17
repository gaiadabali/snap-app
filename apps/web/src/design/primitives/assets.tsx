/**
 * The asset set — reusable motion that carries the subject.
 *
 * Separate from `index.tsx` because these are a different KIND of thing. The
 * primitives there are layout and typography: a section, a rule, a ledger row.
 * These five are the product's own vocabulary made visible — a recogniser
 * locking onto a field, a string resolving, a total in proportion, a docket's
 * cut line, the join between two screens.
 *
 * Why they exist at all: every page other than the home page had nothing to
 * reach for beyond `Reveal`, so they were type on a ground and read as bland
 * next to a home page carrying WebGL. A shared asset layer is how the rest of
 * the site gets the same register without each page inventing its own.
 *
 * All five are Server Components. There is no `'use client'` in this file and
 * there must not be: every one of them is scroll-driven CSS, which runs on the
 * compositor and ships no JavaScript at all. The styles live in `globals.css`
 * under "The asset layer", including the rule that the finished state is
 * defined outside `@supports` so a browser without scroll timelines — or a
 * reader who has asked for reduced motion — gets the completed thing rather
 * than a hidden one.
 */
import type { CSSProperties, ReactNode } from 'react';

import { cx } from './cx';

/** Tones an asset may take. Named roles, never a colour. */
export type AssetTone = 'accent' | 'good' | 'warn' | 'risk' | 'muted';

const TONE_VAR: Record<AssetTone, string> = {
  accent: 'var(--color-accent)',
  good: 'var(--color-good)',
  warn: 'var(--color-warn)',
  risk: 'var(--color-risk)',
  muted: 'var(--color-ink-faint)',
};

/**
 * The OCR lock-on: four corner brackets that converge on whatever they wrap,
 * with the field's name hanging above the top-left corner.
 *
 * `code` should be the label the product would actually use for that field —
 * TOTAL, ABN, G11, GST — because the annotation is the point. An invented
 * marker would make this decoration, which §12.2 rules out.
 *
 * The frame is drawn OUTSIDE the content box via negative inset, so it never
 * changes the text's metrics and can be added to a figure mid-sentence without
 * moving the line. Give it room in a tight layout with `--fb-pad-x` /
 * `--fb-pad-y`.
 *
 * Do not put one where a visible label already names the field — the tag then
 * says the same word twice, a few pixels apart. It is an annotation on a
 * value, not a second heading.
 */
export function FieldBox({
  children,
  code,
  tone = 'accent',
  className,
  style,
}: {
  children: ReactNode;
  /** The field's real name — TOTAL, ABN, G11. Omit for an unlabelled frame. */
  code?: string;
  tone?: AssetTone;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <span
      className={cx('fieldbox', className)}
      style={{ ['--fb-tone' as string]: TONE_VAR[tone], ...style }}
    >
      {children}
      {/* Both the frame and the tag are furniture: the value inside is the
          content, and a screen reader should get it without the annotation
          being read as part of the sentence. */}
      <span className="fieldbox__frame" aria-hidden />
      {code ? (
        <span className="fieldbox__code" aria-hidden>
          {code}
        </span>
      ) : null}
    </span>
  );
}

/**
 * Text that resolves glyph by glyph, the way a recogniser commits to a string.
 *
 * Short strings only — a figure, two or three words. This costs one span per
 * character, and a paragraph of it would be both unreadable and wasteful.
 *
 * Accessibility is the reason this takes a `text` string rather than children:
 * the plain string is rendered once for assistive technology and the animated
 * characters are hidden from it, so nothing is announced letter by letter.
 *
 * NOT FOR HEADINGS, and that is a hard limit rather than taste. The screen
 * reader copy means the string appears TWICE in `textContent` — fine for a
 * kicker or a figure, wrong in an `h1`, where a crawler would read the page's
 * one most important line as "Right to the cent...Right to the cent...". Use
 * it on labels and figures; leave headings to `Reveal`.
 */
export function Settle({
  text,
  className,
  start = 0,
}: {
  text: string;
  className?: string;
  /** Stagger offset, for a second Settle that should follow the first. */
  start?: number;
}) {
  return (
    <span className={cx('settle', className)}>
      <span className="sr-only">{text}</span>
      <span aria-hidden>
        {Array.from(text).map((ch, i) => (
          <span
            // Index is the right key here: this list is a fixed string, never
            // reordered, and two identical characters must stay distinct.
            key={i}
            className="settle__ch"
            style={{ ['--i' as string]: start + i }}
          >
            {ch}
          </span>
        ))}
      </span>
    </span>
  );
}

export type SplitPart = {
  /** Relative size. Pass the real figures — these are drawn to scale. */
  weight: number;
  tone?: AssetTone;
  label?: string;
};

/**
 * A composition bar: how one real total divides.
 *
 * This is NOT a confidence or accuracy meter, and must not become one. The
 * accuracy number is the one figure this site does not publish until it has
 * been measured against Hubdoc and Dext on the same documents — see the top of
 * `_components/proof-data.ts`. A bar filling to an invented percentage is the
 * fabricated proof that file exists to prevent.
 *
 * What it is for is arithmetic the reader can check on the page: a $40.00
 * docket that is $18.40 GST-free and $21.60 taxable, drawn to scale.
 */
export function SplitBar({
  parts,
  className,
  legend = true,
}: {
  parts: readonly SplitPart[];
  className?: string;
  /** Set false where the figures are already beside the bar. */
  legend?: boolean;
}) {
  const total = parts.reduce((sum, p) => sum + p.weight, 0);
  return (
    <div className={className}>
      <div className="splitbar" aria-hidden>
        {parts.map((p, i) => (
          <span
            key={i}
            className="splitbar__seg"
            style={{
              ['--w' as string]: p.weight,
              ['--seg' as string]: TONE_VAR[p.tone ?? 'accent'],
            }}
          />
        ))}
      </div>
      {legend ? (
        <div className="mt-2.5 flex flex-wrap gap-x-5 gap-y-1">
          {parts.map((p, i) =>
            p.label ? (
              <span key={i} className="flex items-center gap-1.5">
                <span
                  aria-hidden
                  className="h-1.5 w-1.5 rounded-[1px]"
                  style={{ background: TONE_VAR[p.tone ?? 'accent'] }}
                />
                <span className="t-label text-[var(--color-ink-muted)]">{p.label}</span>
                <span className="font-mono text-[11px] tabular text-[var(--color-ink-faint)]">
                  {total > 0 ? Math.round((p.weight / total) * 100) : 0}%
                </span>
              </span>
            ) : null,
          )}
        </div>
      ) : null}
    </div>
  );
}

/**
 * The dashed line a docket is torn along, drawing itself across the measure.
 *
 * `Rule` says "a document". This says "a receipt", which is the more specific
 * and more useful thing to say on most of these pages.
 */
export function Tear({
  className,
  tone = 'default',
}: {
  className?: string;
  /** `void` on the inverted band, where the ordinary rule colour vanishes. */
  tone?: 'default' | 'void';
}) {
  return (
    <div
      aria-hidden
      className={cx('tear', className)}
      style={
        tone === 'void'
          ? ({ ['--color-rule-strong' as string]: 'var(--color-void-rule)' } as CSSProperties)
          : undefined
      }
    />
  );
}

/**
 * The join between two sections: a short VERTICAL hairline with a node riding
 * down it as the boundary crosses the viewport.
 *
 * Between two PINNED screens the eye gets no travel at all — one section
 * releases its lock and the next is simply there. This is what gives that
 * moment something that moves through it, and it is why it belongs between
 * `.pin-track` blocks rather than inside them.
 *
 * Named `Join`, not `Seam`, because `.seam` was already taken: it is the
 * HORIZONTAL hairline that opens a section, three of which are on the home
 * page. Reusing the name silently restyled all three into 72px vertical
 * sticks — the new rule simply came later in the file and won. A collision
 * like that produces no error anywhere; it is only visible on the page.
 */
export function Join({ className }: { className?: string }) {
  return (
    <div aria-hidden className={cx('join', className)}>
      <span className="join__fill" />
      <span className="join__node" />
    </div>
  );
}
