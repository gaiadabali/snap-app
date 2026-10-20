import { aud } from '@/design/site';
import { AppBar, AppRing, CatIcon } from '@/design/site/app-ui';
import {
  BUDGET,
  CATEGORIES,
  DEMO_MONTH,
  DEMO_PERSON,
  DOCKET,
  FINDINGS,
  GOALS,
  RECEIPTS,
  RECURRING,
  SPENDING,
} from '@/design/site/demo';
import { Icon } from '@/design/site/icons';

/**
 * The picture inside each bento tile. Every one is built from the app's own
 * pieces (`.app-card`, `AppBar`, `AppRing`, `CatIcon`) or plain markup on the
 * site tokens, and every figure comes from `demo.ts`. The wrapper in
 * `bento.tsx` marks them `aria-hidden`: the tile's own title and line say what
 * the picture shows.
 *
 * Charts grow (`.grow-x`, `.grow-y`, `.ring-draw`) because each tile sits in its own
 * <Reveal>; the kit releases them when the tile is first seen.
 */

const PANEL = 'rounded-[22px] bg-[var(--s-mist)]';

/* ── Spending & analytics ───────────────────────────────────────────────── */

export function SpendingVisual() {
  return (
    <div
      className={`${PANEL} grid h-full gap-7 p-5 sm:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] sm:items-center sm:gap-9 sm:p-6`}
    >
      <div>
        <div className="text-[0.8125rem] text-[var(--s-ink-3)]">
          {DEMO_MONTH.short} · {SPENDING.receipts} receipts
        </div>
        <div className="figure mt-1 text-[2.4rem] leading-[1.05] font-bold">{aud(SPENDING.total)}</div>

        <div className="mt-7 flex items-end gap-3">
          {SPENDING.weeks.map((w, i) => (
            <div key={w.label} className="flex min-w-0 flex-1 flex-col gap-2">
              <div className="flex h-[104px] items-end">
                <div
                  className="grow-y w-full rounded-[10px]"
                  style={{
                    height: `${w.pct}%`,
                    ['--i' as string]: i,
                    background:
                      i === 1 ? 'var(--a-accent)' : 'color-mix(in srgb, var(--a-accent) 32%, transparent)',
                  }}
                />
              </div>
              <div className="text-center">
                <div className="text-[0.8125rem] font-semibold">{aud(w.amount)}</div>
                <div className="text-[0.6875rem] text-[var(--s-ink-3)]">{w.label} Oct</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <ul className="flex flex-col gap-3.5">
        {CATEGORIES.slice(0, 5).map((c) => (
          <li key={c.name} className="flex items-center gap-3">
            <CatIcon category={c.name} hue={c.hue} size={34} />
            <div className="min-w-0 flex-1">
              <div className="flex justify-between gap-3 text-[0.875rem]">
                <span className="truncate font-semibold">{c.name}</span>
                <span className="font-semibold">{aud(c.spent)}</span>
              </div>
              <div className="mt-1.5">
                <AppBar pct={c.share * 2} color={c.hue} h={6} track="var(--s-mist-2)" />
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ── Budgets (the figure sits at the foot of the filled tile) ───────────── */

export function BudgetVisual() {
  const spentPct = 45; // 1437.60 of 3200.00 — drawing only
  const todayPct = 58; // day 18 of 31 — drawing only
  return (
    <div className="flex h-full flex-col justify-end pt-6">
      <div className="text-[0.8125rem] font-semibold text-white/80">Left to spend in {DEMO_MONTH.short}</div>
      <div className="figure mt-1.5 text-[clamp(2.6rem,4.6vw,3.5rem)] leading-none font-bold">{aud(BUDGET.left)}</div>
      <div className="mt-2.5 text-[0.9375rem] text-white/85">
        {DEMO_MONTH.daysLeft} days left · {aud(BUDGET.perDay)} a day
      </div>

      <div className="relative mt-7 h-2 rounded-full bg-white/22">
        <div className="grow-x h-full rounded-full bg-white" style={{ width: `${spentPct}%` }} />
        <span
          className="absolute top-[-3px] h-[14px] w-[3px] rounded-full bg-white/90"
          style={{ left: `${todayPct}%` }}
        />
        <span
          className="absolute top-[-24px] -translate-x-1/2 text-[0.6875rem] font-semibold text-white/80"
          style={{ left: `${todayPct}%` }}
        >
          Today
        </span>
      </div>
      <div className="mt-3 flex justify-between text-[0.8125rem] text-white/80">
        <span>{aud(BUDGET.spent)} spent</span>
        <span>of {aud(BUDGET.total, { cents: false })}</span>
      </div>
    </div>
  );
}

/* ── Savings goals ──────────────────────────────────────────────────────── */

export function GoalsVisual() {
  return (
    <ul className="grid grid-cols-3 content-center gap-3">
      {GOALS.map((g) => (
        <li key={g.name} className="flex flex-col items-center text-center">
          <div className="relative">
            <AppRing pct={g.pct} size={70} stroke={7} />
            <span className="absolute inset-0 grid place-items-center text-[0.8125rem] font-bold">{g.pct}%</span>
          </div>
          <div className="mt-3 text-[0.8125rem] leading-[1.25] font-semibold">{g.name}</div>
          <div className="mt-1 text-[0.75rem] text-[var(--s-ink-3)]">
            {aud(g.saved, { cents: false })} of {aud(g.target, { cents: false })}
          </div>
        </li>
      ))}
    </ul>
  );
}

/* ── Tax-invoice checks ─────────────────────────────────────────────────── */

export function TaxVisual() {
  const f = FINDINGS[2];
  return (
    <div
      className="flex flex-col rounded-[22px] border bg-[var(--a-risk-soft)] p-4 sm:p-5"
      style={{ borderColor: 'color-mix(in srgb, var(--a-risk) 28%, transparent)' }}
    >
      <div className="flex items-center gap-3">
        <CatIcon category="Tools & gear" hue="#1CA8DB" size={38} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[0.9375rem] font-semibold">{f.merchant}</div>
          <div className="text-[0.75rem] text-[var(--s-ink-3)]">Orange NSW</div>
        </div>
        <div className="text-[0.9375rem] font-bold">{aud(f.amount)}</div>
      </div>

      <div className="mt-4 flex items-center gap-2 text-[var(--a-risk)]">
        <Icon name="alert" size={18} strokeWidth={2} />
        <span className="text-[0.9375rem] font-bold">{f.title}</span>
      </div>
      <p className="mt-1.5 mb-3.5 text-[0.8125rem] leading-[1.45] text-[var(--s-ink-2)]">{f.body}</p>

      <div className="mt-auto rounded-[14px] bg-[var(--s-card)] px-3.5 py-2.5 text-[0.8125rem] leading-[1.45]">
        <span className="font-semibold">Fix: </span>
        Add the ABN from the docket, or ask for a compliant tax invoice.
      </div>
    </div>
  );
}

/* ── Recurring ──────────────────────────────────────────────────────────── */

export function RecurringVisual() {
  return (
    <ul className={`${PANEL} flex flex-col justify-center gap-2 p-3`}>
      {RECURRING.map((r) => (
        <li key={r.name} className="app-card flex items-center gap-3 px-3 py-2.5">
          <span className="grid size-[36px] shrink-0 place-items-center rounded-full bg-[var(--a-accent-soft)] text-[var(--a-accent-text)]">
            <Icon name="repeat" size={17} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[0.875rem] font-semibold">{r.name}</div>
            <div className="truncate text-[0.75rem] text-[var(--s-ink-3)]">
              {r.cadence} · next {r.next}
            </div>
          </div>
          <span className="text-[0.875rem] font-bold">{aud(r.amount)}</span>
        </li>
      ))}
    </ul>
  );
}

/* ── Household ──────────────────────────────────────────────────────────── */

export function HouseholdVisual() {
  return (
    <div className={`${PANEL} flex h-full flex-col justify-center gap-5 p-5 md:flex-row md:items-center md:gap-8 lg:flex-col lg:items-start lg:gap-5`}>
      <div className="flex shrink-0 items-center pr-3">
        <span className="bento-av grid size-[60px] place-items-center rounded-full bg-[var(--s-blue-soft)] text-[1.0625rem] font-bold text-[var(--s-blue-text)] ring-4 ring-[var(--s-mist)]">
          {DEMO_PERSON.initials}
        </span>
        <span className="bento-av bento-av-b -ml-3 grid size-[60px] place-items-center rounded-full bg-[image:var(--s-grad)] text-[1.0625rem] font-bold text-white ring-4 ring-[var(--s-mist)]">
          {DEMO_PERSON.partnerInitials}
        </span>
      </div>

      <ul className="flex flex-col gap-2.5 text-[0.875rem]">
        <li>
          <span className="font-semibold">{DEMO_PERSON.name}</span>
          <span className="text-[var(--s-ink-3)]"> · Owner</span>
        </li>
        <li>
          <span className="font-semibold">{DEMO_PERSON.partner}</span>
          <span className="text-[var(--s-ink-3)]"> · Member</span>
        </li>
      </ul>

      <span className="inline-flex h-9 items-center rounded-full border-[1.5px] border-dashed border-[var(--s-edge-2)] px-4 text-[0.8125rem] font-semibold text-[var(--s-blue-text)]">
        + Invite someone
      </span>
    </div>
  );
}

/* ── Export ─────────────────────────────────────────────────────────────── */

/**
 * The line export, with the column names `exportLinesCsv` really writes
 * (apps/mobile/src/lib/share.ts): Supplier, Description, GST-free (yes/no),
 * Amount — four of its nine columns, so the tile stays legible.
 */
export function ExportVisual() {
  const cols = 'grid-cols-[1.5fr_0.95fr_0.75fr] sm:grid-cols-[1.45fr_1.4fr_0.95fr_0.75fr]';
  return (
    <div className={`${PANEL} bento-csv p-4 sm:p-5`}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <span className="chip">
          <Icon name="file" size={15} />
          CSV
        </span>
        <span className="truncate font-sans text-[0.75rem] text-[var(--s-ink-3)]">
          {DOCKET.merchant} · {DOCKET.date}
        </span>
      </div>

      <div className="mask-fade-b">
        <div
          className={`grid ${cols} gap-3 border-b border-[var(--s-edge-2)] px-1 pb-2 text-[0.6875rem] tracking-[0.04em] text-[var(--s-ink-4)] uppercase`}
        >
          <span className="max-sm:hidden">Supplier</span>
          <span>Description</span>
          <span>GST-free</span>
          <span className="text-right">Amount</span>
        </div>
        {DOCKET.lines.map((l, i) => (
          <div
            key={l.label}
            className={`bento-csv-row grid ${cols} gap-3 border-b border-[var(--s-edge)] px-1 py-2 text-[0.75rem] sm:text-[0.8125rem]`}
            style={{ ['--i' as string]: i }}
          >
            <span className="truncate text-[var(--s-ink-3)] max-sm:hidden">{DOCKET.merchant}</span>
            <span className="truncate">{l.label}</span>
            <span className={l.taxable ? 'text-[var(--s-blue-text)]' : 'text-[var(--s-green)]'}>
              {l.taxable ? 'no' : 'yes'}
            </span>
            <span className="text-right font-semibold">{l.amount}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Offline ────────────────────────────────────────────────────────────── */

const PILL = 'col-start-1 row-start-1 inline-flex items-center gap-1.5 justify-self-end rounded-full px-2.5 py-1 text-[0.75rem] font-semibold';

export function OfflineVisual() {
  const queue = RECEIPTS.slice(1, 4);
  return (
    <div className={`${PANEL} p-3 sm:p-4`}>
      <div className="mb-3 grid px-1 text-[0.8125rem] font-semibold">
        <span
          className="bento-wait col-start-1 row-start-1 inline-flex items-center gap-2 text-[var(--s-amber)]"
          style={{ ['--i' as string]: -1 }}
        >
          <Icon name="cloud-off" size={16} />
          No signal · {queue.length} waiting
        </span>
        <span
          className="bento-done col-start-1 row-start-1 inline-flex items-center gap-2 text-[var(--s-green)]"
          style={{ ['--i' as string]: -1 }}
        >
          <Icon name="check" size={16} strokeWidth={2.4} />
          Signal back · {queue.length} uploaded
        </span>
      </div>

      <ul className="flex flex-col gap-2">
        {queue.map((r, i) => (
          <li key={r.merchant} className="app-card flex items-center gap-3 px-3 py-2.5">
            <CatIcon category={r.category} hue={r.hue} size={34} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[0.875rem] font-semibold">{r.merchant}</div>
              <div className="text-[0.75rem] text-[var(--s-ink-3)]">{aud(r.amount)}</div>
            </div>
            <span className="grid">
              <span
                className={`bento-wait ${PILL} bg-[var(--s-amber-soft)] text-[var(--s-amber)]`}
                style={{ ['--i' as string]: i }}
              >
                <Icon name="cloud-off" size={13} />
                Waiting
              </span>
              <span
                className={`bento-done ${PILL} bg-[var(--s-green-soft)] text-[var(--s-green)]`}
                style={{ ['--i' as string]: i }}
              >
                <Icon name="check" size={13} strokeWidth={2.6} />
                Uploaded
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
