import { ArrowLink, ButtonLink, LedgerRow, Reveal, Rule, cx } from '@/design/primitives';

import {
  HAS_PLACEHOLDERS,
  MEASUREMENT,
  TESTIMONIALS,
  assertNoPlaceholdersInProduction,
  type Testimonial,
} from './proof-data';

export { PROOF_HEAD } from './proof-data';

/**
 * The proof slot — presentation only. Content, and the guard that keeps sample
 * copy off production, live in `proof-data.ts` so they can be tested without a
 * JSX transform.
 */
assertNoPlaceholdersInProduction();

function Quote({ t, i }: { t: Testimonial; i: number }) {
  return (
    <Reveal variant="deal" delay={i}>
      <figure className="m-0">
        <Rule />
        <blockquote
          className={cx(
            'mt-6 text-[17px] leading-relaxed',
            t.placeholder ? 'text-[var(--color-ink-muted)]' : 'text-[var(--color-ink)]',
          )}
        >
          {t.quote}
        </blockquote>
        <figcaption className="mt-5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13.5px] text-[var(--color-ink-muted)]">
          {t.placeholder ? (
            <span className="t-label rounded-[var(--radius-sm)] bg-[var(--color-warn-soft)] px-2 py-1 text-[var(--color-warn)]">
              Sample
            </span>
          ) : null}
          <span className={t.placeholder ? undefined : 'text-[var(--color-ink)]'}>{t.name}</span>
          <span aria-hidden className="text-[var(--color-rule-strong)]">
            ·
          </span>
          <span>{t.role}</span>
          <span aria-hidden className="text-[var(--color-rule-strong)]">
            ·
          </span>
          <span>{t.location}</span>
        </figcaption>
      </figure>
    </Reveal>
  );
}

/** What a reader can check today, and one thing they can hold us to. */
function Standing() {
  return (
    <div className="grid gap-14 lg:grid-cols-[1fr_1fr] lg:gap-20">
      <div>
        <Reveal>
          <div className="t-label text-[var(--color-ink-faint)]">Check it yourself</div>
          <p className="mt-5 max-w-[46ch] text-[17px] leading-relaxed text-[var(--color-ink)]">
            Photograph the messiest docket in your ute — the one that is half fuel and half servo
            food. You will know inside three scans whether it reads your paperwork properly, which
            is more than anyone&apos;s quote would have told you.
          </p>
          <div className="mt-7 flex flex-wrap items-center gap-6">
            <ButtonLink href="/register" size="lg">
              Scan 20 free, no card
            </ButtonLink>
            <ArrowLink href="/pricing#practice">Bring a practice</ArrowLink>
          </div>
        </Reveal>
      </div>

      <div>
        <div className="t-label text-[var(--color-ink-faint)]">
          The number we have not published yet
        </div>
        <div className="mt-5">
          <Rule tone="strong" />
          {MEASUREMENT.map((m, i) => (
            <LedgerRow
              key={m.code}
              index={i}
              code={m.code}
              label={m.label}
              note={m.note}
              value={<span className="text-[var(--color-ink-faint)]">pending</span>}
            />
          ))}
        </div>
        <Reveal>
          <p className="mt-6 max-w-[46ch] text-[13.5px] leading-relaxed text-[var(--color-ink-muted)]">
            Every capture tool claims high accuracy and none of them shows its working. This is the
            standard we set ourselves and have not met yet — when it is measured, the number goes
            here whether it flatters us or not.
          </p>
        </Reveal>
      </div>
    </div>
  );
}

export function Proof() {
  return (
    <>
      {TESTIMONIALS.length > 0 ? (
        <div className="grid gap-10 md:grid-cols-2 lg:gap-14">
          {TESTIMONIALS.map((t, i) => (
            <Quote key={t.role + t.quote.slice(0, 24)} t={t} i={i} />
          ))}
        </div>
      ) : null}

      {HAS_PLACEHOLDERS ? (
        <p className="mt-7 max-w-[64ch] text-[12.5px] leading-relaxed text-[var(--color-warn)]">
          Sample copy, shown for layout review — these are not real customers, and this page will
          not build for production until they are replaced with consented quotes.
        </p>
      ) : null}

      <div className={TESTIMONIALS.length > 0 ? 'mt-12 border-t border-[var(--color-rule)] pt-12' : ''}>
        <Standing />
      </div>
    </>
  );
}
