import type { CSSProperties, ReactNode } from 'react';

import { Reveal, aud } from '@/design/site';
import { CatIcon } from '@/design/site/app-ui';
import { BUDGET, CHECKS, DOCKET, FINDINGS, RECEIPTS } from '@/design/site/demo';
import { Icon, type IconName } from '@/design/site/icons';

/**
 * The small pictures that sit beside each station of the journey, and the
 * four diagrams in the principles band. Drawn in code from `demo.ts`, so every
 * figure agrees with the phone screens elsewhere on the site.
 *
 * Every visual is `aria-hidden`: the station's own copy says everything the
 * picture shows.
 */

const MONO = 'font-mono text-[0.6875rem] tracking-[0.01em] text-[var(--s-ink-4)]';

type Tone = 'green' | 'amber' | 'blue' | 'ink';

const PILL: Record<Tone, string> = {
  green: 'bg-[var(--s-green-soft)] text-[var(--s-green)]',
  amber: 'bg-[var(--s-amber-soft)] text-[var(--s-amber)]',
  blue: 'bg-[var(--s-blue-soft)] text-[var(--s-blue-text)]',
  ink: 'bg-[var(--s-mist-2)] text-[var(--s-ink-2)]',
};

function Pill({ tone, icon, children }: { tone: Tone; icon?: IconName; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[0.75rem] font-semibold ${PILL[tone]}`}
    >
      {icon ? <Icon name={icon} size={13} strokeWidth={2.2} /> : null}
      {children}
    </span>
  );
}

function VCard({ caption, children }: { caption: ReactNode; children: ReactNode }) {
  return (
    <div className="card p-5 sm:p-7" aria-hidden>
      {children}
      <div className={`mt-5 flex items-center gap-2 border-t border-[var(--s-edge)] pt-3.5 ${MONO}`}>
        {caption}
      </div>
    </div>
  );
}

/** Two states in one place: `a` first, then `b`. Without motion only `b` shows. */
function Swap({ a, b, i = 0, start = false }: { a: ReactNode; b: ReactNode; i?: number; start?: boolean }) {
  return (
    <span
      className={`hiw-swap${start ? ' hiw-swap-start' : ''}`}
      style={{ ['--i' as string]: i }}
    >
      <span className="hiw-swap-a">{a}</span>
      <span className="hiw-swap-b">{b}</span>
    </span>
  );
}

/* ── 1 · Capture ────────────────────────────────────────────────────────── */

const SKELETON = [62, 88, 74, 84, 68, 44] as const;

function DocTile({ label, note, original = false }: { label: string; note: string; original?: boolean }) {
  return (
    <div className="flex flex-col items-center gap-3.5">
      <div
        className={
          original
            ? 'relative w-[108px] rounded-[10px] bg-[#fffdf8] px-3 pb-5 pt-3 shadow-[var(--s-shadow-2)] sm:w-[128px]'
            : 'relative w-[108px] rounded-[10px] border border-dashed border-[var(--s-edge-2)] bg-[var(--s-mist)] px-3 pb-5 pt-3 sm:w-[128px]'
        }
      >
        <div className="mx-auto mb-3 h-[6px] w-[46%] rounded-full" style={{ background: original ? 'rgb(0 0 0 / 0.28)' : 'var(--s-ink-4)' }} />
        <div className="flex flex-col gap-[7px]">
          {SKELETON.map((w, i) => (
            <div
              key={i}
              className="h-[5px] rounded-full"
              style={{ width: `${w}%`, background: original ? 'rgb(0 0 0 / 0.13)' : 'color-mix(in srgb, var(--s-ink) 14%, transparent)' }}
            />
          ))}
        </div>
        {original ? (
          <span className="absolute -right-2.5 -top-2.5 grid size-7 place-items-center rounded-full bg-[var(--s-blue)] text-white shadow-[var(--s-shadow-blue)]">
            <Icon name="lock" size={14} strokeWidth={2.2} />
          </span>
        ) : null}
      </div>
      <div className="text-center">
        <div className="text-[0.8125rem] font-semibold tracking-[-0.01em]">{label}</div>
        <div className="text-[0.75rem] text-[var(--s-ink-3)]">{note}</div>
      </div>
    </div>
  );
}

export function CaptureVisual() {
  return (
    <VCard
      caption={
        <>
          <Icon name="lock" size={13} /> original · byte for byte, never edited
        </>
      }
    >
      <div className="flex items-start justify-center gap-3 py-2 sm:gap-6">
        <DocTile original label="Original" note="As the camera took it" />
        <div className="mt-12 flex flex-col items-center gap-1 text-[var(--s-ink-4)]">
          <span className={MONO}>copy</span>
          <Icon name="arrow-right" size={18} />
        </div>
        <DocTile label="Working copy" note="What gets read" />
      </div>
    </VCard>
  );
}

/* ── 2 · Upload, even offline ───────────────────────────────────────────── */

const KEYS = ['7f3a…c1', 'b204…9e', 'e91d…40'] as const;

export function UploadVisual() {
  const queue = RECEIPTS.slice(0, 3);
  return (
    <VCard
      caption={
        <>
          <Icon name="repeat" size={13} /> a retry carries the same key · counted once
        </>
      }
    >
      <div className="flex items-center justify-between gap-3">
        <Swap
          start
          a={
            <Pill tone="amber" icon="cloud-off">
              No signal
            </Pill>
          }
          b={
            <Pill tone="green" icon="check-circle">
              Back in range
            </Pill>
          }
        />
        <span className={MONO}>queue on this phone</span>
      </div>

      <ul className="mt-4 divide-y divide-[var(--s-edge)]">
        {queue.map((r, i) => (
          <li key={r.merchant} className="flex items-center gap-3 py-3">
            <CatIcon category={r.category} hue={r.hue} size={36} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[0.9375rem] font-semibold tracking-[-0.012em]">{r.merchant}</div>
              <div className={MONO}>key {KEYS[i] ?? ''}</div>
            </div>
            <Swap
              i={i + 1}
              a={<Pill tone="amber">Queued</Pill>}
              b={
                <Pill tone="green" icon="check">
                  Sent
                </Pill>
              }
            />
          </li>
        ))}
      </ul>

      <div className="mt-2 flex items-start gap-2.5 rounded-[14px] bg-[var(--s-mist)] px-3.5 py-3 text-[0.8125rem] leading-snug text-[var(--s-ink-2)]">
        <Icon name="repeat" size={16} className="mt-0.5 shrink-0 text-[var(--s-blue-text)]" />
        Dropped mid-send? It tries again with the same key and the server counts the docket once.
      </div>
    </VCard>
  );
}

/* ── 3 · Read ───────────────────────────────────────────────────────────── */

export function ReadVisual() {
  return (
    <VCard
      caption={
        <>
          <Icon name="layers" size={13} /> reading · a numbered version of this photo
        </>
      }
    >
      <div className="flex items-center justify-between">
        <span className="text-[0.9375rem] font-semibold tracking-[-0.015em]">{DOCKET.merchant}</span>
        <Pill tone="ink">Reading #1</Pill>
      </div>

      <Reveal stagger className="mt-3 divide-y divide-[var(--s-edge)]">
        {DOCKET.lines.map((l) => (
          <div key={l.label} className="flex items-center gap-3 py-2.5">
            <span className="min-w-0 flex-1 truncate text-[0.9375rem]">{l.label}</span>
            <Pill tone={l.taxable ? 'blue' : 'green'}>{l.taxable ? 'Taxable' : 'GST-free'}</Pill>
            <span className="w-[3.25rem] text-right text-[0.9375rem] font-semibold tabular-nums">{aud(l.amount)}</span>
          </div>
        ))}
      </Reveal>

      <div className="mt-4 grid grid-cols-3 gap-2 text-center">
        {[
          ['GST-free', aud(DOCKET.gstFree)],
          ['Taxable', aud(DOCKET.taxable)],
          ['GST in it', aud(DOCKET.gst)],
        ].map(([k, v]) => (
          <div key={k} className="rounded-[12px] bg-[var(--s-mist)] px-2 py-2.5">
            <div className="text-[0.6875rem] text-[var(--s-ink-3)]">{k}</div>
            <div className="text-[1rem] font-[650] tracking-[-0.03em] tabular-nums">{v}</div>
          </div>
        ))}
      </div>

      <div className="mt-4 rounded-[14px] border border-dashed border-[color-mix(in_srgb,var(--s-amber)_45%,transparent)] bg-[var(--s-amber-soft)] px-3.5 py-3">
        <div className="flex items-center gap-2 text-[0.75rem] font-semibold text-[var(--s-amber)]">
          <Icon name="alert" size={14} /> If a figure is too smudged to trust
        </div>
        <div className="mt-1.5 flex items-center justify-between gap-3 text-[0.9375rem]">
          <span className="text-[var(--s-ink-2)]">Left blank, not guessed</span>
          <span className="rounded-full bg-[var(--s-card)] px-2.5 py-1 text-[0.75rem] font-semibold text-[var(--s-ink)]">
            Asks you
          </span>
        </div>
      </div>
    </VCard>
  );
}

/* ── 4 · Check ──────────────────────────────────────────────────────────── */

export function CheckVisual() {
  const fail = FINDINGS[2];
  return (
    <VCard
      caption={
        <>
          <Icon name="shield" size={13} /> checks · the ATO’s tax invoice rules
        </>
      }
    >
      <Reveal stagger className="flex flex-col gap-2.5">
        {CHECKS.map((c) => (
          <div key={c.label} className="flex items-center gap-3 text-[0.9375rem]">
            <span className="grid size-6 shrink-0 place-items-center rounded-full bg-[var(--s-green-soft)] text-[var(--s-green)]">
              <Icon name="check" size={13} strokeWidth={2.8} />
            </span>
            {c.label}
          </div>
        ))}
      </Reveal>

      <div className="mt-5 grid gap-2.5 sm:grid-cols-2">
        <div className="rounded-[14px] bg-[var(--s-mist)] px-3.5 py-3">
          <div className="text-[0.6875rem] text-[var(--s-ink-3)]">Seller ABN</div>
          <div className="mt-1 flex items-center gap-2 font-mono text-[0.9375rem] font-semibold tracking-[0.02em]">
            {DOCKET.abn}
            <Icon name="check-circle" size={16} className="text-[var(--s-green)]" />
          </div>
        </div>
        <div className="rounded-[14px] bg-[var(--s-mist)] px-3.5 py-3">
          <div className="text-[0.6875rem] text-[var(--s-ink-3)]">GST is one eleventh</div>
          <div className="mt-1 font-mono text-[0.9375rem] font-semibold tracking-[0.01em] tabular-nums">
            {aud(DOCKET.taxable)} ÷ 11 = {aud(DOCKET.gst)}
          </div>
        </div>
      </div>

      <div className="mt-4 rounded-[16px] border border-[color-mix(in_srgb,var(--s-amber)_38%,transparent)] bg-[var(--s-amber-soft)] px-4 py-3.5">
        <div className="flex items-center gap-2 text-[0.75rem] font-semibold text-[var(--s-amber)]">
          <Icon name="alert" size={14} /> When a rule fails
        </div>
        <div className="mt-1.5 text-[0.9375rem] font-semibold tracking-[-0.012em]">
          {fail.title} · {fail.merchant}
        </div>
        <div className="mt-1 text-[0.8125rem] leading-snug text-[var(--s-ink-2)]">
          <span className="font-semibold">Fix: </span>
          ask the supplier to reissue it with their ABN on it.
        </div>
      </div>
    </VCard>
  );
}

/* ── 5 · Record ─────────────────────────────────────────────────────────── */

export function RecordVisual() {
  const filed = RECEIPTS.find((r) => r.merchant === DOCKET.merchant);
  return (
    <VCard
      caption={
        <>
          <Icon name="bank" size={13} /> ledger · every entry adds to zero
        </>
      }
    >
      <div className="flex items-center gap-3">
        <CatIcon category={filed?.category ?? 'Groceries'} hue={filed?.hue ?? 'var(--s-green-2)'} size={46} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[1rem] font-semibold tracking-[-0.018em]">{DOCKET.merchant}</div>
          <div className="text-[0.8125rem] text-[var(--s-ink-3)]">
            Filed under {filed?.category ?? 'Groceries'} · {DOCKET.date.replace(' 2026', '')}
          </div>
        </div>
        <span className="text-[1.25rem] font-[650] tracking-[-0.04em] tabular-nums">{aud(DOCKET.total)}</span>
      </div>

      <div className="mt-5 flex flex-col gap-3">
        {[
          { label: 'Spent on Groceries', sign: '+', tone: 'var(--s-blue)' },
          { label: 'Paid out', sign: '−', tone: 'var(--s-ink-4)' },
        ].map((row) => (
          <div key={row.label}>
            <div className="mb-1.5 flex items-baseline justify-between text-[0.8125rem]">
              <span className="text-[var(--s-ink-2)]">{row.label}</span>
              <span className="font-mono font-semibold tabular-nums">
                {row.sign}
                {DOCKET.total}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-[var(--s-mist-2)]">
              <div className="grow-x h-full w-full rounded-full" style={{ background: row.tone }} />
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 flex items-center justify-between rounded-[14px] bg-[var(--s-green-soft)] px-3.5 py-3 text-[var(--s-green)]">
        <span className="flex items-center gap-2 text-[0.875rem] font-semibold">
          <Icon name="check-circle" size={16} /> Balanced
        </span>
        <span className="font-mono text-[0.9375rem] font-semibold tabular-nums">0.00</span>
      </div>
    </VCard>
  );
}

/* ── Principle diagrams (night register) ────────────────────────────────── */

const DGM_LABEL = 'font-mono text-[0.6875rem] tracking-[0.01em] text-[var(--s-ink-3)]';

/** 01 — the original, kept; everything else is derived from it. */
export function OriginalDiagram() {
  return (
    <div aria-hidden className="flex flex-col gap-3">
      <div className="relative flex h-11 items-center gap-3 rounded-[14px] border border-[rgb(127_180_238/0.4)] bg-[rgb(24_120_216/0.16)] px-4 text-[0.8125rem] font-semibold text-[var(--s-ink)]">
        <Icon name="lock" size={16} className="text-[var(--s-blue-text)]" />
        Original · byte for byte
      </div>
      <div className="flex items-center justify-between px-1">
        <span className={DGM_LABEL}>day 1</span>
        <span className="h-px flex-1 bg-[var(--s-edge-2)] mx-3" />
        <span className={DGM_LABEL}>year 5</span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {['Working copy', 'Anything else made from it'].map((t) => (
          <div
            key={t}
            className="flex h-10 items-center gap-2 rounded-[12px] border border-dashed border-[var(--s-edge-2)] px-3 text-[0.75rem] text-[var(--s-ink-3)]"
          >
            <Icon name="arrow-up-right" size={13} /> {t}
          </div>
        ))}
      </div>
    </div>
  );
}

/** 02 — one photo, many numbered readings. */
export function VersionsDiagram() {
  const runs = [
    { n: 1, w: 52, latest: false },
    { n: 2, w: 74, latest: false },
    { n: 3, w: 100, latest: true },
  ];
  return (
    <div aria-hidden className="flex items-stretch gap-4">
      <div className="grid w-[64px] shrink-0 place-items-center rounded-[14px] border border-[var(--s-edge-2)] bg-[var(--s-night-3)] text-[var(--s-ink-3)]">
        <Icon name="camera" size={22} />
      </div>
      <div className="flex flex-1 flex-col gap-2.5">
        {runs.map((r) => (
          <div key={r.n} className="flex items-center gap-3">
            <span className={`${DGM_LABEL} w-[4.5rem] shrink-0`}>Reading {r.n}</span>
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--s-edge)]">
              <div
                className="grow-x h-full rounded-full"
                style={{ width: `${r.w}%`, background: r.latest ? 'var(--s-blue)' : 'var(--s-ink-4)' }}
              />
            </div>
            <span className="w-[3.1rem] text-right text-[0.6875rem] font-semibold text-[var(--s-blue-text)]">
              {r.latest ? 'latest' : ''}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** 03 — in equals out. */
export function BalanceDiagram() {
  return (
    <div aria-hidden className="flex flex-col gap-3.5">
      {[
        { label: 'In', value: `+${DOCKET.total}`, color: 'var(--s-blue)' },
        { label: 'Out', value: `−${DOCKET.total}`, color: 'var(--s-cyan)' },
      ].map((r) => (
        <div key={r.label} className="flex items-center gap-3">
          <span className={`${DGM_LABEL} w-7`}>{r.label}</span>
          <div className="h-3 flex-1 overflow-hidden rounded-full bg-[var(--s-edge)]">
            <div className="grow-x h-full w-full rounded-full" style={{ background: r.color }} />
          </div>
          <span className="w-[4.25rem] text-right font-mono text-[0.8125rem] font-semibold tabular-nums">{r.value}</span>
        </div>
      ))}
      <div className="flex items-center justify-between rounded-[12px] border border-[var(--s-edge-2)] px-3.5 py-2.5">
        <span className={DGM_LABEL}>Together</span>
        <span className="font-mono text-[0.9375rem] font-semibold tabular-nums text-[var(--s-green)]">0.00</span>
      </div>
    </div>
  );
}

/** 04 — a figure is characters, not a float. */
export function DecimalDiagram() {
  const chars = ['"', ...BUDGET.left.split(''), '"'];
  return (
    <div aria-hidden className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-1.5">
        {chars.map((c, i) => {
          const edge = c === '"';
          const dot = c === '.';
          const style: CSSProperties = dot
            ? { background: 'var(--s-blue)', color: '#fff', borderColor: 'var(--s-blue)' }
            : {};
          return (
            <span
              key={i}
              style={style}
              className={`grid h-11 place-items-center rounded-[10px] border font-mono text-[1.125rem] font-semibold ${
                edge
                  ? 'w-5 border-transparent text-[var(--s-ink-4)]'
                  : 'w-9 border-[var(--s-edge-2)] bg-[var(--s-night-3)] text-[var(--s-ink)]'
              }`}
            >
              {c}
            </span>
          );
        })}
      </div>
      <div className="flex items-center gap-2.5 text-[0.75rem] text-[var(--s-ink-3)]">
        <span className="rounded-full bg-[var(--s-blue-soft)] px-2.5 py-1 font-mono font-semibold text-[var(--s-blue-text)]">
          decimal string
        </span>
        kept as text from the camera to the screen
      </div>
    </div>
  );
}
