import { Assurances, IconTile, Phone, Reveal, SectionHead, StoreButtons, aud } from '@/design/site';
import { AppRing, BudgetsScreen, HouseholdScreen, ReceiptsScreen } from '@/design/site/app-ui';
import { CountUp } from '@/design/site/client';
import {
  BUDGET,
  CATEGORIES,
  DEMO_MONTH,
  DEMO_PERSON,
  GOALS,
  GOALS_TOTAL,
  RECURRING,
  SPENDING,
} from '@/design/site/demo';
import { Icon } from '@/design/site/icons';

import { FREE_SCANS_AT_SIGNUP } from '../pricing/credit-packs';
import { RecordSearch } from './_search';

/* ═══════════════════════════════════════════════════════════════════════════
 * 4 — Money. A bento of four different cards: one big blue number with the
 * Budgets screen rising out of it, weekly bars, recurring, goals.
 * ═══════════════════════════════════════════════════════════════════════════ */

export function MoneyChapter() {
  return (
    <section id="money" aria-labelledby="money-h" className="section band-mist scroll-mt-[120px]">
      <div className="shell">
        <SectionHead
          align="split"
          title={<span id="money-h">Know what is safe to spend today.</span>}
          lede="Spending, analytics, budgets, recurring payments and savings goals, all worked out from the receipts you have already scanned."
        />

        <Reveal stagger className="mt-14 grid gap-4 lg:mt-20 lg:grid-cols-12">
          {/* Budgets — the big number */}
          <div
            className="card relative flex flex-col gap-8 p-7 text-white sm:flex-row sm:justify-between sm:p-10 lg:col-span-7"
            style={{ background: 'var(--s-grad)', borderColor: 'rgb(255 255 255 / 0.12)' }}
          >
            <div className="relative z-10 max-w-[22rem] sm:pb-10">
              <div className="text-[0.9375rem] font-[600] text-white/80">Safe to spend a day</div>
              <div className="figure mt-2 text-[clamp(3.5rem,7vw,5.5rem)] leading-none font-[680]">
                <CountUp value={BUDGET.perDay} prefix="$" />
              </div>
              <p className="mt-5 text-[1rem] leading-[1.55] text-white/85">
                That is {aud(BUDGET.left)} left across {DEMO_MONTH.daysLeft} days, from{' '}
                {aud(BUDGET.total, { cents: false })} budgeted for October.
              </p>
              <div className="mt-6 h-2 overflow-hidden rounded-full bg-white/22" aria-hidden>
                <div className="grow-x h-full rounded-full bg-white" style={{ width: '45%' }} />
              </div>
              <div className="mt-2 flex justify-between text-[0.8125rem] text-white/80">
                <span>{aud(BUDGET.spent)} spent</span>
                <span>{aud(BUDGET.total, { cents: false })}</span>
              </div>
            </div>
            <div className="relative mx-auto h-[300px] w-[250px] shrink-0 overflow-hidden sm:mx-0 sm:-mr-2 sm:-mb-10 sm:h-[330px]">
              <Phone className="absolute left-0 top-2 [--pw:250]">
                <BudgetsScreen />
              </Phone>
            </div>
          </div>

          {/* Analytics — weekly bars and where it went */}
          <div className="card p-7 sm:p-8 lg:col-span-5">
            <div className="flex items-center gap-3">
              <IconTile name="chart" size={40} />
              <h3 className="hd-4">Analytics</h3>
            </div>
            <div className="small mt-5">Spent in {DEMO_MONTH.short.replace(' 2026', '')}</div>
            <div className="figure text-[2.25rem] leading-[1.1] font-[680]">{aud(SPENDING.total)}</div>
            <div className="small">across {SPENDING.receipts} receipts</div>

            <Reveal variant="fade" className="mt-6 flex h-[132px] items-end gap-4">
              {SPENDING.weeks.map((w, i) => (
                <div key={w.label} className="flex h-full flex-1 flex-col justify-end gap-1.5">
                  <div className="figure text-[0.75rem] font-[600] text-[var(--s-ink-3)]">{aud(w.amount, { cents: false })}</div>
                  <div className="flex min-h-0 flex-1 items-end">
                    <div
                      className="grow-y w-full rounded-[10px]"
                      style={{
                        height: `${w.pct}%`,
                        ['--i' as string]: i,
                        background: w.pct === 100 ? 'var(--s-blue)' : 'color-mix(in srgb, var(--s-blue) 32%, transparent)',
                      }}
                    />
                  </div>
                  <div className="small text-center text-[0.75rem]">{w.label} Oct</div>
                </div>
              ))}
            </Reveal>

            <div className="mt-6 flex h-2.5 overflow-hidden rounded-full" aria-hidden>
              {CATEGORIES.map((c) => (
                <span key={c.name} style={{ width: `${c.share}%`, background: c.hue }} />
              ))}
            </div>
            <p className="small mt-3">
              By category: {CATEGORIES.slice(0, 3).map((c) => `${c.name} ${c.share}%`).join(', ')}.
            </p>
          </div>

          {/* Recurring */}
          <div className="card p-7 sm:p-8 lg:col-span-4">
            <div className="flex items-center gap-3">
              <IconTile name="repeat" size={40} />
              <h3 className="hd-4">Recurring</h3>
            </div>
            <p className="small mt-4">Subscriptions and standing bills, found in your receipts.</p>
            <ul className="mt-4 divide-y divide-[var(--s-edge)]">
              {RECURRING.map((r) => (
                <li key={r.name} className="flex items-center justify-between gap-3 py-3">
                  <span>
                    <span className="block text-[0.9375rem] font-[620] tracking-[-0.015em]">{r.name}</span>
                    <span className="small block">
                      {r.cadence} · next {r.next}
                    </span>
                  </span>
                  <span className="figure text-[1rem] font-[650]">{aud(r.amount)}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Goals */}
          <div className="card p-7 sm:p-8 lg:col-span-8">
            <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
              <div className="flex items-center gap-3">
                <IconTile name="target" size={40} />
                <h3 className="hd-4">Savings goals</h3>
              </div>
              <p className="small">
                <span className="figure font-[650] text-[var(--s-ink)]">{aud(GOALS_TOTAL.saved, { cents: false })}</span>{' '}
                saved of {aud(GOALS_TOTAL.target, { cents: false })} across {GOALS.length} goals
              </p>
            </div>
            <Reveal variant="fade" className="mt-7 grid gap-6 sm:grid-cols-3">
              {GOALS.map((g) => (
                <div key={g.name} className="flex items-center gap-4 sm:flex-col sm:items-start sm:gap-3">
                  <div className="relative shrink-0">
                    <AppRing pct={g.pct} size={72} stroke={8} />
                    <span className="figure absolute inset-0 grid place-items-center text-[0.875rem] font-[680]">{g.pct}%</span>
                  </div>
                  <div>
                    <div className="text-[0.9375rem] font-[620] tracking-[-0.015em]">{g.name}</div>
                    <div className="small figure">
                      {aud(g.saved, { cents: false })} of {aud(g.target, { cents: false })}
                    </div>
                  </div>
                </div>
              ))}
            </Reveal>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 5 — Household. Text and a "two phones, one number" pair on the left; the
 * People screen on the right, fading out at the bottom like it is rising.
 * ═══════════════════════════════════════════════════════════════════════════ */

function View({ initials, name }: { initials: string; name: string }) {
  return (
    <div className="app-hero px-6 py-5">
      <div className="flex items-center gap-2.5">
        <span className="grid size-8 place-items-center rounded-full bg-white/20 text-[0.75rem] font-[700]">{initials}</span>
        <span className="text-[0.875rem] font-[600] text-white/85">{name.split(' ')[0]}&rsquo;s phone</span>
      </div>
      <div className="mt-4 text-[0.8125rem] font-[600] text-white/75">Left to spend in {DEMO_MONTH.short}</div>
      <div className="figure text-[2rem] leading-[1.15] font-[680]">{aud(BUDGET.left)}</div>
    </div>
  );
}

export function HouseholdChapter() {
  return (
    <section id="household" aria-labelledby="household-h" className="section scroll-mt-[120px]">
      <div className="shell">
        <div className="grid items-center gap-14 lg:grid-cols-[1.15fr_0.85fr] lg:gap-16">
          <div>
            <Reveal>
              <div className="mb-8 flex -space-x-3" aria-hidden>
                <span className="grid size-16 place-items-center rounded-full bg-[var(--s-blue-soft)] text-[1.125rem] font-[700] text-[var(--s-blue-text)] ring-4 ring-[var(--s-bg)]">
                  {DEMO_PERSON.initials}
                </span>
                <span className="grid size-16 place-items-center rounded-full bg-[var(--s-green-soft)] text-[1.125rem] font-[700] text-[var(--s-green)] ring-4 ring-[var(--s-bg)]">
                  {DEMO_PERSON.partnerInitials}
                </span>
                <span className="grid size-16 place-items-center rounded-full border-[1.5px] border-dashed border-[var(--s-edge-2)] bg-[var(--s-bg)] text-[var(--s-ink-3)] ring-4 ring-[var(--s-bg)]">
                  <Icon name="plus" size={22} />
                </span>
              </div>
              <h2 id="household-h" className="hd-2 max-w-[16ch]">
                Everyone sees the same budgets.
              </h2>
            </Reveal>
            <Reveal delay={1}>
              <p className="lede mt-6 max-w-[42ch]">
                Share a workspace with your partner or the whole household. You are working from one set of
                budgets, so there are no screenshots and no &ldquo;what&rsquo;s left this month?&rdquo; texts.
              </p>
            </Reveal>

            <Reveal stagger className="relative mt-10 grid gap-3 sm:grid-cols-2">
              <View initials={DEMO_PERSON.initials} name={DEMO_PERSON.name} />
              <View initials={DEMO_PERSON.partnerInitials} name={DEMO_PERSON.partner} />
            </Reveal>
            <Reveal delay={2}>
              <p className="small mt-4 max-w-[52ch]">
                Same number on both phones. The person who sets the household up is its Owner; everyone they
                invite is a Member.
              </p>
            </Reveal>
          </div>

          <Reveal variant="up" delay={1} className="relative">
            <div
              className="horizon"
              aria-hidden
              style={{ width: '120%', height: '60%', left: '-10%', top: '10%' }}
            />
            <div className="mask-fade-b relative mx-auto h-[480px] w-full max-w-[340px] overflow-hidden">
              <Phone className="absolute left-1/2 top-0 -translate-x-1/2 [--pw:300]">
                <HouseholdScreen />
              </Phone>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 6 — Records. The phone on the left, a live search box on the right.
 * ═══════════════════════════════════════════════════════════════════════════ */

export function RecordsChapter() {
  return (
    <section id="records" aria-labelledby="records-h" className="section band-mist scroll-mt-[120px]">
      <div className="shell">
        <div className="grid items-center gap-14 lg:grid-cols-[0.8fr_1.2fr] lg:gap-20">
          <Reveal variant="scale" className="relative mx-auto max-lg:order-2">
            <div
              className="horizon"
              aria-hidden
              style={{ width: '120%', height: '70%', left: '-10%', top: '15%' }}
            />
            <div className="tilt relative">
              <Phone className="[--pw:280] sm:[--pw:316]">
                <ReceiptsScreen />
              </Phone>
            </div>
          </Reveal>

          <div className="max-lg:order-1">
            <Reveal>
              <h2 id="records-h" className="hd-2 max-w-[18ch]">
                Five years of dockets, one search box away.
              </h2>
            </Reveal>
            <Reveal delay={1}>
              <p className="lede mt-6 max-w-[44ch]">
                Records have to be kept for five years. Snap Apps keeps the original photo and what it read from
                it together, as a true copy.
              </p>
            </Reveal>

            <Reveal delay={2} className="mt-9">
              <RecordSearch />
            </Reveal>

            <Reveal as="ul" stagger className="mt-8 grid gap-5 sm:grid-cols-2">
              <li className="flex items-start gap-4">
                <IconTile name="lock" size={40} />
                <div>
                  <h3 className="hd-4">Kept for five years</h3>
                  <p className="small mt-1">The original is never edited, so the copy stays true.</p>
                </div>
              </li>
              <li className="flex items-start gap-4">
                <IconTile name="download" size={40} />
                <div>
                  <h3 className="hd-4">CSV, any time</h3>
                  <p className="small mt-1">Export your records when you or your accountant ask for them.</p>
                </div>
              </li>
            </Reveal>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
 * Close. The second and last night register on the page: one line, the
 * buttons, the facts under them. Left-aligned, unlike the home close.
 * ═══════════════════════════════════════════════════════════════════════════ */

export function FeaturesCta() {
  return (
    <section className="night grain section-tight">
      <div className="shell">
        <div className="grid items-center gap-10 lg:grid-cols-[1fr_auto] lg:gap-20">
          <div>
            <Reveal>
              <h2 className="hd-1 max-w-[16ch]">Start with the next docket you would have lost.</h2>
            </Reveal>
            <Reveal delay={1}>
              <Assurances
                className="mt-8"
                items={[`${FREE_SCANS_AT_SIGNUP} free scans`, 'No card', 'No subscription']}
              />
            </Reveal>
          </div>
          <Reveal delay={2}>
            <StoreButtons />
          </Reveal>
        </div>
      </div>
    </section>
  );
}
