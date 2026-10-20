import type { CSSProperties, ReactNode } from 'react';

import { cx } from '@/design/primitives/cx';
import { CREDIT_PACKS } from '@/app/(marketing)/pricing/credit-packs';

import {
  BUDGET,
  CATEGORIES,
  CHECKS,
  CREDITS_LEFT,
  DEMO_MONTH,
  DEMO_PERSON,
  DOCKET,
  FINDINGS,
  GOALS,
  GOALS_TOTAL,
  HOUSEHOLD_SCANS,
  RECEIPTS,
  RECURRING,
  SPENDING,
} from './demo';
import { Icon, type IconName } from './icons';
import { aud } from './index';

/**
 * The phone app, drawn in code.
 *
 * These are faithful redraws of `apps/mobile` after its 2026-10-19 premium
 * pass — Geist, white raised cards on a cool ground, the blue gradient hero
 * card, the floating bar with Scan raised in the middle — filled with the demo
 * workspace in `./demo.ts` instead of whatever the staging database holds.
 *
 * WHY CODE AND NOT SCREENSHOTS. The live review build signs in to the real
 * staging API, whose demo account carries test data ("$37,700 at ENZO Cafe").
 * The old `public/screens/*.png` predate the redesign. Drawn screens are sharp
 * at any size, follow the site's light/dark theme, can animate, and every
 * figure in them reconciles with every other figure on the site because they
 * share one source. They show only what the shipped (personal) release does.
 *
 * Every screen renders at 390 × 876 app points inside `<Phone>`, which zooms
 * it to fit. Author in the app's own units: a 15pt body is `text-[15px]`.
 */

/* ── Category vocabulary ────────────────────────────────────────────────── */

const CATEGORY_ICON: Record<string, IconName> = {
  Fuel: 'fuel',
  Groceries: 'cart',
  'Eating out': 'coffee',
  'Tools & gear': 'tool',
  'Phone & internet': 'phone',
  Other: 'tag',
};

function tint(hue: string, pct = 16): CSSProperties {
  return { background: `color-mix(in srgb, ${hue} ${pct}%, transparent)`, color: hue };
}

export function CatIcon({ category, hue, size = 44 }: { category: string; hue: string; size?: number }) {
  return (
    <span className="grid shrink-0 place-items-center rounded-full" style={{ width: size, height: size, ...tint(hue) }}>
      <Icon name={CATEGORY_ICON[category] ?? 'tag'} size={Math.round(size * 0.46)} />
    </span>
  );
}

/* ── Chrome ─────────────────────────────────────────────────────────────── */

export function AppStatusBar({ light = false }: { light?: boolean }) {
  return (
    <div
      className={cx(
        'absolute inset-x-0 top-0 z-30 flex h-[54px] items-center justify-between px-[34px] pt-[6px] text-[16px] font-semibold tracking-[-0.02em]',
        light ? 'text-white' : 'text-[var(--a-ink)]',
      )}
    >
      <span>9:41</span>
      <span className="flex items-center gap-[6px]">
        <svg width="18" height="12" viewBox="0 0 18 12" aria-hidden>
          <rect x="0" y="8" width="3" height="4" rx="1" fill="currentColor" />
          <rect x="5" y="5.5" width="3" height="6.5" rx="1" fill="currentColor" />
          <rect x="10" y="3" width="3" height="9" rx="1" fill="currentColor" />
          <rect x="15" y="0" width="3" height="12" rx="1" fill="currentColor" />
        </svg>
        <svg width="16" height="12" viewBox="0 0 16 12" aria-hidden>
          <path
            d="M8 2.2c2.3 0 4.4.9 6 2.4l1.2-1.3A10.4 10.4 0 0 0 8 .4C5.2.4 2.7 1.5.8 3.3L2 4.6a8.6 8.6 0 0 1 6-2.4zm0 3.6c1.3 0 2.5.5 3.4 1.3l1.2-1.3A6.7 6.7 0 0 0 8 4c-1.8 0-3.4.7-4.6 1.8l1.2 1.3c.9-.8 2.1-1.3 3.4-1.3zM8 9.4l2.2-2.3a3.3 3.3 0 0 0-4.4 0z"
            fill="currentColor"
          />
        </svg>
        <svg width="27" height="13" viewBox="0 0 27 13" aria-hidden>
          <rect x="0.5" y="0.5" width="23" height="12" rx="3.8" fill="none" stroke="currentColor" opacity="0.4" />
          <rect x="2" y="2" width="18" height="9" rx="2.4" fill="currentColor" />
          <path d="M25 4.5v4a2 2 0 0 0 0-4z" fill="currentColor" opacity="0.45" />
        </svg>
      </span>
    </div>
  );
}

type Tab = 'home' | 'budgets' | 'scan' | 'profile' | 'menu';

export function AppTabBar({ active = 'home' }: { active?: Tab }) {
  const items: { id: Tab; label: string; icon: IconName }[] = [
    { id: 'home', label: 'Home', icon: 'home' },
    { id: 'budgets', label: 'Budgets', icon: 'wallet' },
    { id: 'scan', label: 'Scan', icon: 'scan' },
    { id: 'profile', label: 'Profile', icon: 'user' },
    { id: 'menu', label: 'Menu', icon: 'menu' },
  ];
  return (
    <div className="app-tabbar">
      <div className="grid h-full grid-cols-5 items-center px-[6px]">
        {items.map((t) =>
          t.id === 'scan' ? (
            <div key={t.id} className="relative flex h-full flex-col items-center justify-end pb-[9px]">
              <span className="app-fab">
                <Icon name="scan" size={28} strokeWidth={2} />
              </span>
              <span className="text-[11px] font-semibold text-[var(--a-ink-3)]">Scan</span>
            </div>
          ) : (
            <div key={t.id} className="flex flex-col items-center gap-[3px]">
              <span
                className={cx(
                  'grid h-[30px] w-[52px] place-items-center rounded-full',
                  active === t.id ? 'bg-[var(--a-accent-soft)] text-[var(--a-accent-text)]' : 'text-[var(--a-ink-3)]',
                )}
              >
                <Icon name={t.icon} size={22} />
              </span>
              <span
                className={cx(
                  'text-[11px] font-semibold',
                  active === t.id ? 'text-[var(--a-accent-text)]' : 'text-[var(--a-ink-3)]',
                )}
              >
                {t.label}
              </span>
            </div>
          ),
        )}
      </div>
    </div>
  );
}

/**
 * One app screen: the canvas, the camera island, the status bar, an optional
 * floating tab bar. `scheme` forces the app's dark palette regardless of the
 * site theme — the camera is always dark, like the real one.
 */
export function AppScreen({
  children,
  tab,
  scheme,
  statusLight = false,
  className,
  style,
}: {
  children: ReactNode;
  tab?: Tab | false;
  scheme?: 'dark';
  statusLight?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div className={cx('app', className)} data-scheme={scheme} style={style}>
      <div className="app-island" />
      <AppStatusBar light={statusLight || scheme === 'dark'} />
      {children}
      {tab === false || tab === undefined ? null : <AppTabBar active={tab} />}
    </div>
  );
}

export function AppBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('absolute inset-x-0 top-[54px] bottom-0 px-[20px]', className)}>{children}</div>;
}

export function AppTitleBar({ title, back = true, action }: { title: string; back?: boolean; action?: ReactNode }) {
  return (
    <div className="flex items-center gap-[12px] pt-[10px] pb-[16px]">
      {back ? (
        <span className="-ml-[4px] grid size-[36px] place-items-center text-[var(--a-ink)]">
          <Icon name="chevron-left" size={24} strokeWidth={2.2} />
        </span>
      ) : null}
      <div className="flex-1 text-[30px] leading-[36px] font-bold tracking-[-0.9px]">{title}</div>
      {action}
    </div>
  );
}

export function AppSectionTitle({ title, action }: { title: string; action?: string }) {
  return (
    <div className="flex items-baseline justify-between pt-[22px] pb-[12px]">
      <span className="text-[19px] leading-[24px] font-bold tracking-[-0.4px]">{title}</span>
      {action ? <span className="text-[15px] font-semibold text-[var(--a-accent-text)]">{action}</span> : null}
    </div>
  );
}

export function AppBar({ pct, color = 'var(--a-accent)', track = 'var(--a-surface)', h = 8 }: { pct: number; color?: string; track?: string; h?: number }) {
  return (
    <div className="w-full overflow-hidden rounded-full" style={{ height: h, background: track }}>
      <div className="grow-x h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}

/* ── Home ───────────────────────────────────────────────────────────────── */

export function AppDonut({ size = 150, stroke = 22 }: { size?: number; stroke?: number }) {
  const r = (size - stroke) / 2;
  let offset = 0;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden className="-rotate-90">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--a-surface)" strokeWidth={stroke} />
      {CATEGORIES.map((c) => {
        const seg = (
          <circle
            key={c.name}
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={c.hue}
            strokeWidth={stroke}
            pathLength={100}
            strokeDasharray={`${Math.max(c.share - 1.2, 0.5)} ${100 - Math.max(c.share - 1.2, 0.5)}`}
            strokeDashoffset={-offset}
          />
        );
        offset += c.share;
        return seg;
      })}
    </svg>
  );
}

export function HomeScreen() {
  const spentPct = 45; // 1437.60 of 3200.00
  return (
    <AppScreen tab="home">
      <AppBody>
        <div className="flex items-center gap-[12px] pt-[8px]">
          <span className="grid size-[52px] place-items-center rounded-full bg-[var(--a-accent-soft)] text-[17px] font-bold text-[var(--a-accent-text)]">
            {DEMO_PERSON.initials}
          </span>
          <div className="flex-1">
            <div className="text-[14px] text-[var(--a-ink-3)]">Good morning</div>
            <div className="text-[19px] leading-[24px] font-bold tracking-[-0.4px]">{DEMO_PERSON.name}</div>
          </div>
          <Icon name="moon" size={24} className="text-[var(--a-ink-2)]" />
        </div>

        <div className="app-hero mt-[22px] px-[24px] pt-[22px] pb-[20px]">
          <div className="text-[14px] font-semibold text-white/80">Left to spend in {DEMO_MONTH.short}</div>
          <div className="mt-[6px] text-[44px] leading-[48px] font-bold tracking-[-1.6px]">{aud(BUDGET.left)}</div>
          <div className="mt-[6px] text-[15px] text-white/85">
            {DEMO_MONTH.daysLeft} days left · {aud(BUDGET.perDay)} a day
          </div>
          <div className="relative mt-[16px] h-[8px] rounded-full bg-white/22">
            <div className="grow-x h-full rounded-full bg-white" style={{ width: `${spentPct}%` }} />
            <span className="absolute top-[-3px] h-[14px] w-[3px] rounded-full bg-white/90" style={{ left: '58%' }} />
          </div>
          <div className="mt-[14px] flex items-center gap-[6px] text-[15px] font-semibold">
            Details <Icon name="chevron-right" size={16} strokeWidth={2.4} />
          </div>
        </div>

        <div className="app-card mt-[16px] flex items-center gap-[14px] px-[18px] py-[14px]">
          <span className="grid size-[42px] place-items-center rounded-[12px] bg-[var(--a-accent-soft)] text-[var(--a-accent-text)]">
            <Icon name="wallet" size={21} />
          </span>
          <span className="flex-1 text-[16px] font-semibold">Credits left</span>
          <span className="text-[16px] font-bold">{CREDITS_LEFT} scans</span>
          <Icon name="chevron-right" size={18} className="text-[var(--a-ink-4)]" />
        </div>

        <div className="mt-[18px] grid grid-cols-4 gap-[10px]">
          {(
            [
              ['receipt', 'Spending'],
              ['chart', 'Analytics'],
              ['target', 'Budgets'],
              ['repeat', 'Recurring'],
            ] as [IconName, string][]
          ).map(([icon, label]) => (
            <div key={label} className="flex flex-col items-center gap-[8px]">
              <span className="app-card grid size-[62px] place-items-center rounded-[20px] text-[var(--a-accent-text)]">
                <Icon name={icon} size={25} />
              </span>
              <span className="text-[13px] font-semibold">{label}</span>
            </div>
          ))}
        </div>

        <AppSectionTitle title="Spending by category" action="Analytics" />
        <div className="app-card flex items-center gap-[16px] p-[16px]">
          <div className="relative">
            <AppDonut size={128} stroke={20} />
            <div className="absolute inset-0 grid place-items-center text-center">
              <div>
                <div className="text-[11px] text-[var(--a-ink-3)]">{DEMO_MONTH.short}</div>
                <div className="text-[16px] font-bold tracking-[-0.5px]">{aud(SPENDING.total)}</div>
              </div>
            </div>
          </div>
          <div className="flex flex-1 flex-col gap-[7px]">
            {CATEGORIES.slice(0, 4).map((c) => (
              <div key={c.name} className="flex items-center gap-[8px] text-[13px]">
                <span className="size-[9px] rounded-full" style={{ background: c.hue }} />
                <span className="flex-1 truncate">{c.name}</span>
                <span className="font-semibold text-[var(--a-ink-3)]">{c.share}%</span>
              </div>
            ))}
          </div>
        </div>
      </AppBody>
    </AppScreen>
  );
}

/* ── The docket, as paper ───────────────────────────────────────────────── */

/**
 * The receipt itself. Used in the camera view and on its own on the page.
 * `locks` draws the recogniser's brackets on each line (hero sequence).
 */
export function DocketPaper({
  className,
  locks = false,
  style,
  compact = false,
}: {
  className?: string;
  locks?: boolean;
  style?: CSSProperties;
  compact?: boolean;
}) {
  return (
    <div className={cx('paper px-[22px] pt-[22px] pb-[34px] text-[12.5px] leading-[19px]', className)} style={style}>
      <div className="text-center">
        <div className="text-[15px] font-semibold tracking-[0.04em] uppercase">{DOCKET.merchant}</div>
        <div className="text-[11.5px] opacity-70">{DOCKET.place}</div>
        <div className="text-[11.5px] opacity-70">ABN {DOCKET.abn}</div>
        <div className="mt-[6px] text-[12px] font-semibold tracking-[0.12em]">TAX INVOICE</div>
      </div>
      <div className="my-[10px] border-t border-dashed border-black/25" />
      <div className="flex justify-between text-[11.5px] opacity-70">
        <span>{DOCKET.date}</span>
        <span>{DOCKET.time}</span>
      </div>
      <div className="my-[10px] border-t border-dashed border-black/25" />
      <div className="flex flex-col gap-[3px]">
        {DOCKET.lines.map((l, i) => (
          <div key={l.label} className="relative flex justify-between gap-[10px]">
            <span className="truncate">
              {l.label}
              {l.taxable ? ' *' : ''}
            </span>
            <span>{l.amount}</span>
            {locks ? (
              <span
                aria-hidden
                className="seq-lock pointer-events-none absolute -inset-x-[7px] -inset-y-[2px] rounded-[4px] border-[1.5px]"
                style={{
                  ['--i' as string]: i,
                  borderColor: l.taxable ? 'rgb(24 120 216 / 0.85)' : 'rgb(44 155 108 / 0.85)',
                  background: l.taxable ? 'rgb(24 120 216 / 0.08)' : 'rgb(44 155 108 / 0.08)',
                }}
              />
            ) : null}
          </div>
        ))}
      </div>
      <div className="my-[10px] border-t border-dashed border-black/25" />
      <div className="flex justify-between text-[15px] font-semibold">
        <span>TOTAL</span>
        <span>${DOCKET.total}</span>
      </div>
      {compact ? null : (
        <>
          <div className="flex justify-between text-[11.5px] opacity-75">
            <span>GST included</span>
            <span>${DOCKET.gst}</span>
          </div>
          <div className="mt-[8px] text-[10.5px] opacity-60">* Taxable item. Thank you, drive safe.</div>
        </>
      )}
    </div>
  );
}

/* ── Capture ────────────────────────────────────────────────────────────── */

/** The camera, framing the docket. Always dark, like the real one. */
export function CaptureScreen({ animated = false }: { animated?: boolean }) {
  return (
    <AppScreen scheme="dark" className="!bg-[#07090c]">
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(120% 70% at 50% 45%, #3b3226 0%, #1d1913 45%, #07090c 100%)',
        }}
      />
      {/* top controls */}
      <div className="absolute inset-x-0 top-[62px] z-10 flex items-center justify-between px-[22px] text-white">
        <span className="grid size-[40px] place-items-center rounded-full bg-white/12">
          <Icon name="x" size={20} strokeWidth={2.2} />
        </span>
        <span className="rounded-full bg-black/45 px-[14px] py-[7px] text-[13px] font-semibold">
          Hold steady — reading
        </span>
        <span className="grid size-[40px] place-items-center rounded-full bg-white/12">
          <Icon name="bolt" size={18} />
        </span>
      </div>

      {/* the docket under the lens */}
      <div className="absolute left-1/2 top-[132px] w-[270px] -translate-x-1/2 rotate-[-2.5deg]">
        <DocketPaper locks={animated} />
      </div>

      {/* framing brackets */}
      <div className="pointer-events-none absolute left-[40px] right-[40px] top-[118px] h-[520px]">
        {[
          'left-0 top-0 border-l-[4px] border-t-[4px] rounded-tl-[18px]',
          'right-0 top-0 border-r-[4px] border-t-[4px] rounded-tr-[18px]',
          'left-0 bottom-0 border-l-[4px] border-b-[4px] rounded-bl-[18px]',
          'right-0 bottom-0 border-r-[4px] border-b-[4px] rounded-br-[18px]',
        ].map((c) => (
          <span key={c} className={cx('absolute size-[44px] border-white', c)} />
        ))}
        {animated ? <span className="beam seq-beam" /> : null}
      </div>

      {animated ? <div className="seq-flash pointer-events-none absolute inset-0 z-20 bg-white opacity-0" /> : null}

      {/* shutter row */}
      <div className="absolute inset-x-0 bottom-[44px] z-10 flex items-center justify-between px-[44px] text-white">
        <span className="grid size-[48px] place-items-center rounded-[12px] bg-white/14">
          <Icon name="file" size={22} />
        </span>
        <span className="grid size-[82px] place-items-center rounded-full border-[4px] border-white/90">
          <span className="size-[66px] rounded-full bg-white" />
        </span>
        <span className="grid size-[48px] place-items-center rounded-full bg-white/14">
          <Icon name="repeat" size={20} />
        </span>
      </div>
      <div className="absolute inset-x-0 bottom-[12px] z-10 text-center text-[12px] font-semibold text-white/70">
        Auto-capture on · works offline
      </div>
    </AppScreen>
  );
}

/* ── The read receipt ───────────────────────────────────────────────────── */

export function ReceiptScreen({ popIn = false }: { popIn?: boolean }) {
  const pop = (i: number) => (popIn ? { className: 'seq-pop', style: { ['--i' as string]: i } as CSSProperties } : {});
  return (
    <AppScreen tab={false}>
      <AppBody>
        <AppTitleBar title="Receipt" action={<span className="text-[15px] font-semibold text-[var(--a-accent-text)]">Edit</span>} />

        <div className="app-card px-[18px] pt-[16px] pb-[18px]" {...pop(0)}>
          <div className="flex items-center gap-[12px]">
            <CatIcon category="Groceries" hue="#3BA55C" size={46} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[17px] font-bold tracking-[-0.3px]">{DOCKET.merchant}</div>
              <div className="text-[13px] text-[var(--a-ink-3)]">
                {DOCKET.place} · {DOCKET.date.replace(' 2026', '')}
              </div>
            </div>
          </div>
          <div className="mt-[14px] flex items-end justify-between">
            <div>
              <div className="text-[13px] text-[var(--a-ink-3)]">Total</div>
              <div className="text-[38px] leading-[42px] font-bold tracking-[-1.2px]">{aud(DOCKET.total)}</div>
            </div>
            <span className="mb-[4px] inline-flex items-center gap-[6px] rounded-full bg-[var(--a-good-soft)] px-[10px] py-[5px] text-[12.5px] font-semibold text-[var(--a-good)]">
              <Icon name="check" size={13} strokeWidth={2.8} /> Valid tax invoice
            </span>
          </div>
        </div>

        <div className="mt-[12px] grid grid-cols-2 gap-[10px]">
          <div className="app-card px-[16px] py-[14px]" {...pop(1)}>
            <div className="text-[12.5px] font-semibold text-[var(--a-good)]">GST-free</div>
            <div className="mt-[2px] text-[24px] leading-[30px] font-bold tracking-[-0.6px]">{aud(DOCKET.gstFree)}</div>
            <div className="text-[12px] text-[var(--a-ink-3)]">No GST to claim</div>
          </div>
          <div className="app-card px-[16px] py-[14px]" {...pop(2)}>
            <div className="text-[12.5px] font-semibold text-[var(--a-accent-text)]">Taxable</div>
            <div className="mt-[2px] text-[24px] leading-[30px] font-bold tracking-[-0.6px]">{aud(DOCKET.taxable)}</div>
            <div className="text-[12px] text-[var(--a-ink-3)]">GST {aud(DOCKET.gst)}</div>
          </div>
        </div>

        <AppSectionTitle title="6 lines read" />
        <div className="app-card px-[16px] py-[6px]" {...pop(3)}>
          {DOCKET.lines.map((l, i) => (
            <div
              key={l.label}
              className={cx('flex items-center gap-[10px] py-[9px]', i > 0 && 'border-t border-[var(--a-rule)]')}
            >
              <span className="flex-1 truncate text-[14.5px]">{l.label}</span>
              <span
                className={cx(
                  'rounded-full px-[8px] py-[2px] text-[11px] font-semibold',
                  l.taxable
                    ? 'bg-[var(--a-accent-soft)] text-[var(--a-accent-text)]'
                    : 'bg-[var(--a-good-soft)] text-[var(--a-good)]',
                )}
              >
                {l.taxable ? 'Taxable' : 'GST-free'}
              </span>
              <span className="w-[52px] text-right text-[14.5px] font-semibold">{l.amount}</span>
            </div>
          ))}
        </div>

        <AppSectionTitle title="Checks" />
        <div className="app-card flex flex-col gap-[10px] px-[16px] py-[14px]" {...pop(4)}>
          {CHECKS.map((c) => (
            <div key={c.label} className="flex items-center gap-[10px] text-[14px]">
              <span className="grid size-[22px] place-items-center rounded-full bg-[var(--a-good-soft)] text-[var(--a-good)]">
                <Icon name="check" size={13} strokeWidth={2.8} />
              </span>
              {c.label}
            </div>
          ))}
        </div>
      </AppBody>
    </AppScreen>
  );
}

/* ── A receipt that needs a human ───────────────────────────────────────── */

export function FindingScreen() {
  const f = FINDINGS[2];
  return (
    <AppScreen tab={false}>
      <AppBody>
        <AppTitleBar title="Receipt" />
        <div className="app-card px-[18px] py-[16px]">
          <div className="flex items-center gap-[12px]">
            <CatIcon category="Tools & gear" hue="#1CA8DB" size={46} />
            <div className="flex-1">
              <div className="text-[17px] font-bold tracking-[-0.3px]">{f.merchant}</div>
              <div className="text-[13px] text-[var(--a-ink-3)]">Orange NSW · Fri 9 Oct</div>
            </div>
          </div>
          <div className="mt-[12px] text-[38px] leading-[42px] font-bold tracking-[-1.2px]">{aud(f.amount)}</div>
        </div>

        <div className="mt-[12px] rounded-[20px] border border-[color-mix(in_srgb,var(--a-risk)_30%,transparent)] bg-[var(--a-risk-soft)] px-[18px] py-[16px]">
          <div className="flex items-center gap-[10px] text-[var(--a-risk)]">
            <Icon name="alert" size={20} strokeWidth={2} />
            <span className="text-[16px] font-bold">{f.title}</span>
          </div>
          <p className="mt-[8px] text-[14px] leading-[20px] text-[var(--a-ink-2)]">
            A tax invoice must show the seller’s ABN. Without it the GST credit cannot be claimed.
          </p>
          <div className="mt-[12px] rounded-[14px] bg-[var(--a-card)] px-[14px] py-[11px] text-[13.5px] leading-[19px]">
            <span className="font-semibold">Fix: </span>
            Add the ABN from the docket, or ask the supplier for a compliant tax invoice.
          </div>
          <div className="mt-[12px] flex gap-[8px]">
            <span className="flex-1 rounded-[14px] bg-[var(--a-accent)] py-[12px] text-center text-[14.5px] font-semibold text-white">
              Add the ABN
            </span>
            <span className="flex-1 rounded-[14px] bg-[var(--a-card)] py-[12px] text-center text-[14.5px] font-semibold">
              Remind me
            </span>
          </div>
        </div>

        <AppSectionTitle title="Also flagged this month" />
        <div className="app-card px-[16px] py-[4px]">
          {FINDINGS.slice(0, 2).map((x, i) => (
            <div key={x.merchant} className={cx('flex items-center gap-[10px] py-[11px]', i > 0 && 'border-t border-[var(--a-rule)]')}>
              <span className="grid size-[30px] place-items-center rounded-full bg-[var(--a-warn-soft)] text-[var(--a-warn)]">
                <Icon name="alert" size={15} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[14.5px] font-semibold">{x.merchant}</div>
                <div className="truncate text-[12.5px] text-[var(--a-ink-3)]">{x.title}</div>
              </div>
              <span className="text-[14.5px] font-semibold">{aud(x.amount)}</span>
            </div>
          ))}
        </div>
      </AppBody>
    </AppScreen>
  );
}

/* ── Spending list ──────────────────────────────────────────────────────── */

export function ReceiptsScreen() {
  return (
    <AppScreen tab="home">
      <AppBody>
        <AppTitleBar title="Spending" />
        <div className="flex h-[48px] items-center gap-[10px] rounded-[16px] bg-[var(--a-surface)] px-[14px] text-[15px] text-[var(--a-ink-4)]">
          <Icon name="search" size={19} /> Search merchant, category or amount
        </div>
        <div className="mt-[12px] flex gap-[8px] overflow-hidden">
          {['This month', 'Last month', 'Quarter', '12 months'].map((c, i) => (
            <span
              key={c}
              className={cx(
                'shrink-0 rounded-full px-[14px] py-[7px] text-[13.5px] font-semibold',
                i === 0 ? 'bg-[var(--a-accent)] text-white' : 'border border-[var(--a-rule)] bg-[var(--a-card)]',
              )}
            >
              {c}
            </span>
          ))}
        </div>
        <div className="mt-[16px] flex items-baseline justify-between">
          <span className="text-[14px] text-[var(--a-ink-3)]">{SPENDING.receipts} receipts</span>
          <span className="text-[26px] font-bold tracking-[-0.8px]">{aud(SPENDING.total)}</span>
        </div>
        <div className="mt-[10px] flex flex-col gap-[10px]">
          {RECEIPTS.map((r) => (
            <div key={r.merchant} className="app-card flex items-center gap-[12px] px-[14px] py-[12px]">
              <CatIcon category={r.category} hue={r.hue} size={44} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[15.5px] font-semibold">{r.merchant}</div>
                <div className="text-[13px] text-[var(--a-ink-3)]">
                  {r.category} · {r.date}
                </div>
              </div>
              <span className="text-[16px] font-bold">{aud(r.amount)}</span>
            </div>
          ))}
        </div>
      </AppBody>
    </AppScreen>
  );
}

/* ── Analytics ──────────────────────────────────────────────────────────── */

export function AnalyticsScreen() {
  return (
    <AppScreen tab="home">
      <AppBody>
        <AppTitleBar title="Analytics" />
        <div className="grid grid-cols-3 rounded-[14px] bg-[var(--a-surface)] p-[4px] text-center text-[14px] font-semibold">
          <span className="rounded-[11px] bg-[var(--a-card)] py-[8px] shadow-sm">Month</span>
          <span className="py-[8px] text-[var(--a-ink-3)]">3 months</span>
          <span className="py-[8px] text-[var(--a-ink-3)]">Year</span>
        </div>
        <div className="app-card mt-[14px] px-[18px] pt-[16px] pb-[14px]">
          <div className="text-[13px] text-[var(--a-ink-3)]">This month</div>
          <div className="text-[34px] leading-[40px] font-bold tracking-[-1px]">{aud(SPENDING.total)}</div>
          <div className="mt-[16px] flex h-[120px] items-end gap-[16px]">
            {SPENDING.weeks.map((w, i) => (
              <div key={w.label} className="flex flex-1 flex-col items-center gap-[6px]">
                <div className="flex h-[96px] w-full items-end">
                  <div
                    className="grow-y w-full rounded-[10px]"
                    style={{
                      height: `${w.pct}%`,
                      ['--i' as string]: i,
                      background: i === 1 ? 'var(--a-accent)' : 'color-mix(in srgb, var(--a-accent) 35%, transparent)',
                    }}
                  />
                </div>
                <span className="text-[11.5px] text-[var(--a-ink-3)]">{w.label} Oct</span>
              </div>
            ))}
          </div>
        </div>
        <AppSectionTitle title="By category" />
        <div className="app-card flex flex-col gap-[12px] px-[16px] py-[14px]">
          {CATEGORIES.slice(0, 5).map((c) => (
            <div key={c.name} className="flex items-center gap-[12px]">
              <CatIcon category={c.name} hue={c.hue} size={36} />
              <div className="flex-1">
                <div className="flex justify-between text-[14px]">
                  <span className="font-semibold">{c.name}</span>
                  <span className="font-semibold">{aud(c.spent)}</span>
                </div>
                <div className="mt-[5px]">
                  <AppBar pct={c.share * 2} color={c.hue} h={6} />
                </div>
              </div>
            </div>
          ))}
        </div>
      </AppBody>
    </AppScreen>
  );
}

/* ── Budgets ────────────────────────────────────────────────────────────── */

export function BudgetsScreen() {
  return (
    <AppScreen tab="budgets">
      <AppBody>
        <AppTitleBar title="Budgets" back={false} />
        <div className="app-hero px-[22px] py-[18px]">
          <div className="flex items-end justify-between">
            <div>
              <div className="text-[13px] font-semibold text-white/80">Spent in October</div>
              <div className="text-[34px] leading-[40px] font-bold tracking-[-1px]">{aud(BUDGET.spent)}</div>
            </div>
            <div className="text-right text-[13px] text-white/85">
              of {aud(BUDGET.total, { cents: false })}
              <br />
              budgeted
            </div>
          </div>
          <div className="mt-[12px] h-[8px] rounded-full bg-white/22">
            <div className="grow-x h-full rounded-full bg-white" style={{ width: '45%' }} />
          </div>
          <div className="mt-[12px] grid grid-cols-2 text-[13px]">
            <div>
              <div className="text-white/75">Days left</div>
              <div className="text-[17px] font-bold">{DEMO_MONTH.daysLeft}</div>
            </div>
            <div>
              <div className="text-white/75">Safe to spend a day</div>
              <div className="text-[17px] font-bold">{aud(BUDGET.perDay)}</div>
            </div>
          </div>
        </div>
        <AppSectionTitle title="Per category" />
        <div className="flex flex-col gap-[10px]">
          {CATEGORIES.slice(0, 4).map((c) => (
            <div key={c.name} className="app-card px-[16px] py-[13px]">
              <div className="flex items-center gap-[12px]">
                <CatIcon category={c.name} hue={c.hue} size={38} />
                <span className="flex-1 text-[15.5px] font-semibold">{c.name}</span>
                <span className="text-[15px] font-bold">{aud(c.budget, { cents: false })}</span>
              </div>
              <div className="mt-[10px]">
                <AppBar pct={c.used} color={c.used > 70 ? 'var(--a-warn)' : c.hue} />
              </div>
              <div className="mt-[6px] flex justify-between text-[12.5px] text-[var(--a-ink-3)]">
                <span>{aud(c.spent)} spent</span>
                <span>{aud(c.left)} left</span>
              </div>
            </div>
          ))}
        </div>
      </AppBody>
    </AppScreen>
  );
}

/* ── Goals ──────────────────────────────────────────────────────────────── */

export function AppRing({ pct, size = 54, stroke = 6, color = 'var(--a-accent)' }: { pct: number; size?: number; stroke?: number; color?: string }) {
  const r = (size - stroke) / 2;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--a-surface)" strokeWidth={stroke} />
      <circle
        className="ring-draw"
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={stroke}
        strokeLinecap="round"
        pathLength={100}
        style={{ ['--p' as string]: pct }}
      />
    </svg>
  );
}

export function GoalsScreen() {
  return (
    <AppScreen tab="home">
      <AppBody>
        <AppTitleBar title="Goals" />
        <div className="app-hero px-[22px] py-[18px]">
          <div className="text-[13px] font-semibold text-white/80">Saved so far</div>
          <div className="text-[38px] leading-[44px] font-bold tracking-[-1.2px]">{aud(GOALS_TOTAL.saved, { cents: false })}</div>
          <div className="text-[14px] text-white/85">
            of {aud(GOALS_TOTAL.target, { cents: false })} across {GOALS.length} goals
          </div>
        </div>
        <AppSectionTitle title="Your goals" action="Start a goal" />
        <div className="flex flex-col gap-[10px]">
          {GOALS.map((g) => (
            <div key={g.name} className="app-card flex items-center gap-[14px] px-[16px] py-[14px]">
              <div className="relative">
                <AppRing pct={g.pct} />
                <span className="absolute inset-0 grid place-items-center text-[12px] font-bold">{g.pct}%</span>
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[15.5px] font-semibold">{g.name}</div>
                <div className="text-[13px] text-[var(--a-ink-3)]">
                  {aud(g.saved, { cents: false })} of {aud(g.target, { cents: false })}
                </div>
              </div>
              <span className="rounded-full bg-[var(--a-accent-soft)] px-[12px] py-[6px] text-[13px] font-semibold text-[var(--a-accent-text)]">
                Add
              </span>
            </div>
          ))}
        </div>
      </AppBody>
    </AppScreen>
  );
}

/* ── Recurring ──────────────────────────────────────────────────────────── */

export function RecurringScreen() {
  return (
    <AppScreen tab="home">
      <AppBody>
        <AppTitleBar title="Recurring" />
        <p className="text-[14px] text-[var(--a-ink-3)]">Subscriptions and standing bills, found in your receipts.</p>
        <div className="mt-[14px] flex flex-col gap-[10px]">
          {RECURRING.map((r) => (
            <div key={r.name} className="app-card flex items-center gap-[12px] px-[16px] py-[13px]">
              <span className="grid size-[42px] place-items-center rounded-full bg-[var(--a-accent-soft)] text-[var(--a-accent-text)]">
                <Icon name="repeat" size={19} />
              </span>
              <div className="flex-1">
                <div className="text-[15.5px] font-semibold">{r.name}</div>
                <div className="text-[13px] text-[var(--a-ink-3)]">
                  {r.cadence} · next {r.next}
                </div>
              </div>
              <span className="text-[16px] font-bold">{aud(r.amount)}</span>
            </div>
          ))}
        </div>
      </AppBody>
    </AppScreen>
  );
}

/* ── Credits ────────────────────────────────────────────────────────────── */

export function CreditsScreen() {
  return (
    <AppScreen tab="profile">
      <AppBody>
        <AppTitleBar title="Credits" />
        <div className="app-hero px-[24px] py-[20px]">
          <div className="text-[14px] font-semibold text-white/85">Credits you own</div>
          <div className="text-[52px] leading-[58px] font-bold tracking-[-1.8px]">{CREDITS_LEFT}</div>
          <div className="text-[15px] text-white/85">Credits never expire and never reset.</div>
        </div>
        <AppSectionTitle title="Top up" action="Past purchases" />
        <div className="grid grid-cols-3 gap-[10px]">
          {CREDIT_PACKS.map((p, i) => (
            <div
              key={p.credits}
              className={cx(
                'app-card flex flex-col items-center py-[16px]',
                i === 1 && 'ring-2 ring-[var(--a-accent)]',
              )}
            >
              <span className="text-[24px] font-bold tracking-[-0.6px]">{p.credits}</span>
              <span className="text-[13px] text-[var(--a-ink-3)]">scans</span>
              <span className="mt-[6px] text-[15px] font-bold text-[var(--a-accent-text)]">{aud(p.priceAud)}</span>
            </div>
          ))}
        </div>
      </AppBody>
    </AppScreen>
  );
}

/* ── Household ──────────────────────────────────────────────────────────── */

export function HouseholdScreen() {
  const people = [
    { initials: DEMO_PERSON.initials, name: DEMO_PERSON.name, role: 'Owner', you: true },
    { initials: DEMO_PERSON.partnerInitials, name: DEMO_PERSON.partner, role: 'Member', you: false },
  ];
  return (
    <AppScreen tab="menu">
      <AppBody>
        <AppTitleBar title="People" />
        <p className="text-[14px] text-[var(--a-ink-3)]">Everyone in this household sees the same budgets.</p>
        <div className="app-card mt-[14px] px-[16px] py-[4px]">
          {people.map((p, i) => (
            <div key={p.name} className={cx('flex items-center gap-[12px] py-[12px]', i > 0 && 'border-t border-[var(--a-rule)]')}>
              <span className="grid size-[44px] place-items-center rounded-full bg-[var(--a-accent-soft)] text-[15px] font-bold text-[var(--a-accent-text)]">
                {p.initials}
              </span>
              <div className="flex-1">
                <div className="text-[15.5px] font-semibold">
                  {p.name}
                  {p.you ? <span className="font-normal text-[var(--a-ink-3)]"> (you)</span> : null}
                </div>
                <div className="text-[13px] text-[var(--a-ink-3)]">{p.role}</div>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-[12px] rounded-[16px] border-[1.5px] border-dashed border-[var(--a-rule)] py-[14px] text-center text-[15px] font-semibold text-[var(--a-accent-text)]">
          + Invite someone
        </div>

        <AppSectionTitle title="Shared budget" />
        <div className="app-hero px-[20px] py-[16px]">
          <div className="text-[13px] font-semibold text-white/80">Left to spend in {DEMO_MONTH.short}</div>
          <div className="text-[32px] leading-[38px] font-bold tracking-[-1px]">{aud(BUDGET.left)}</div>
          <div className="text-[13.5px] text-white/85">Same figure on every phone in the household</div>
        </div>

        <AppSectionTitle title={`Scanned in ${DEMO_MONTH.short}`} />
        <div className="app-card px-[16px] py-[6px]">
          {HOUSEHOLD_SCANS.map((p, i) => (
            <div key={p.name} className={cx('flex items-center gap-[12px] py-[11px]', i > 0 && 'border-t border-[var(--a-rule)]')}>
              <span className="grid size-[34px] place-items-center rounded-full bg-[var(--a-accent-soft)] text-[12.5px] font-bold text-[var(--a-accent-text)]">
                {p.initials}
              </span>
              <span className="flex-1 text-[15px] font-semibold">{p.name}</span>
              <span className="text-[15px] font-bold">{p.scans} receipts</span>
            </div>
          ))}
        </div>
      </AppBody>
    </AppScreen>
  );
}
