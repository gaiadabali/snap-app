import { ArrowLink, ButtonLink, LedgerRow, Reveal, Rule, cx } from '@/design/primitives';
import { BUSINESS_SURFACES_ENABLED } from '@/lib/features';

import { FREE_SCANS_AT_SIGNUP } from '../pricing/credit-packs';

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

/**
 * What a reader can check today, and the one number we have committed to
 * publishing and have not measured yet.
 *
 * REBUILT because the two-column version was cramped. The three measurements
 * were `LedgerRow`s — code gutter, label, note, right-locked value — stacked
 * inside a 410px column. That leaves about 250px for the label, so every title
 * wrapped ("Corrections per 100 / documents"), every note ran to four lines,
 * and the value sat marooned at the far right. Then it got squeezed further to
 * fit one screen, which made it dense as well as cramped.
 *
 * The fix is composition, not compression: the three run ACROSS the full
 * measure as a 3-up, so each gets its own column and its title fits on one
 * line. `LedgerRow` is the wrong primitive here — it is built for a figure
 * locked to a right-hand column, and "pending" is not a figure.
 */
function Standing() {
  return (
    <div className="proof-grid">
      <div className="t-label text-[var(--color-ink-faint)]">
        The number we have not published yet
      </div>

      <div className="mt-5">
        <Rule tone="strong" />
      </div>

      <div className="mt-8 grid gap-10 md:grid-cols-3 md:gap-12">
        {MEASUREMENT.map((m, i) => (
          <Reveal key={m.code} variant="deal" delay={i}>
            <div>
              <div className="flex items-baseline justify-between gap-4">
                <span className="t-label text-[var(--color-ink-faint)]">{m.code}</span>
                {/* "pending" is a STATE, not a figure — so it reads as a badge
                    beside its own metric rather than as a column of money. */}
                <span className="t-label text-[var(--color-warn)]">pending</span>
              </div>
              <div className="mt-3 text-[16px] leading-snug text-[var(--color-ink)]">
                {m.label}
              </div>
              <p className="mt-2 text-[13.5px] leading-relaxed text-[var(--color-ink-muted)]">
                {m.note}
              </p>
            </div>
          </Reveal>
        ))}
      </div>

      <Reveal>
        <p className="mt-9 max-w-[70ch] text-[13.5px] leading-relaxed text-[var(--color-ink-muted)]">
          Every capture tool claims high accuracy and none of them shows its working. This is the
          standard we set ourselves and have not met yet — when it is measured, the number goes
          here whether it flatters us or not.
        </p>
      </Reveal>

      {/* The invitation and the CTAs, on one band across the bottom. */}
      <Reveal>
        <div className="mt-10 flex flex-wrap items-end justify-between gap-x-12 gap-y-6 border-t border-[var(--color-rule)] pt-8">
          <p className="max-w-[46ch] text-[15px] leading-relaxed text-[var(--color-ink)]">
            Photograph the messiest docket in your ute — the one that is half fuel and half servo
            food. You will know inside three scans whether it reads your paperwork properly.
          </p>
          <div className="flex flex-wrap items-center gap-6">
            {/*
              Derived, not typed. This button said "Scan 20 free" while an
              account is granted TEN — `credits.repo.ts` inserts
              `('scans', 10, 10, 'signup_bonus')` and its own test asserts that
              amount. So the loudest call to action on the home page advertised
              twice the free allowance the product actually hands over.

              That is the same fault `credit-packs.test.ts` exists to prevent
              for prices, and the same law: overstating what a customer gets
              for free is a misleading representation under ACL s18, not a
              typo. Every other surface already said ten — the hero, the
              pricing section, /features, /how-it-works, /pricing — so this was
              one string that had been left behind, and the fix is to stop it
              being a string at all.
            */}
            <ButtonLink href="/register" size="lg">
              Scan {FREE_SCANS_AT_SIGNUP} free, no card
            </ButtonLink>
            {BUSINESS_SURFACES_ENABLED ? (
              <ArrowLink href="/pricing#practice">Bring a practice</ArrowLink>
            ) : (
              <ArrowLink href="/how-it-works">See how a receipt moves through it</ArrowLink>
            )}
          </div>
        </div>
      </Reveal>
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
