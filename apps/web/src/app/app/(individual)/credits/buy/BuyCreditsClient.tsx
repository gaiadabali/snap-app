'use client';

import { useState, useTransition } from 'react';
import type { CheckoutSession, CreditPack } from '@snap/api-contract';

import { purchaseCredits } from '@/lib/panels/credit-actions';
import { Badge, Button, Card, Money, cx } from '@/design/primitives';

/**
 * Buying credits: choose a pack, see exactly what it costs, then pay.
 *
 * ── The part that is unusual, and deliberate ──────────────────────────────
 *
 * There is no payment processor. Which one — and which RAIL, since charging
 * through the phone means Apple's and Google's in-app purchase rules rather
 * than a card processor — has not been decided.
 *
 * The honest way to build that is not a disabled button and not a "coming
 * soon" badge (`docs/WEB.md` §3.5 rules both out). It is to run the real flow
 * as far as it genuinely goes: the order is priced, confirmed and RECORDED as
 * a pending purchase against the workspace, and then the server says in words
 * that there is nothing to charge with. Everything up to the money is real,
 * so when a processor is chosen the only thing that changes is the descriptor
 * coming back — `state: 'redirect'` with a URL — and this component already
 * branches on it.
 *
 * What it must never do is pretend. No optimistic "purchased!", no local
 * state that adds credits. Credits appear when a grant exists, and a grant
 * exists when money has moved.
 */
export function BuyCreditsClient({
  workspaceId,
  packs,
  creditsRemaining,
}: {
  workspaceId: string;
  packs: CreditPack[];
  creditsRemaining: number;
}) {
  const [selected, setSelected] = useState<CreditPack | null>(packs[1] ?? packs[0] ?? null);
  const [session, setSession] = useState<CheckoutSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function confirm() {
    if (!selected) return;
    setError(null);
    setSession(null);
    startTransition(async () => {
      const result = await purchaseCredits(workspaceId, '/app/credits/buy', selected.code);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      if (result.session.state === 'redirect' && result.session.url) {
        window.location.href = result.session.url;
        return;
      }
      setSession(result.session);
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <div className="t-label text-[var(--color-ink-faint)]">Credits on hand</div>
            <div className="mt-1 font-mono text-[28px] tabular text-[var(--color-ink)]">
              {creditsRemaining.toLocaleString('en-AU')}
            </div>
          </div>
          <p className="max-w-[46ch] text-[13px] leading-relaxed text-[var(--color-ink-muted)]">
            One scan costs one credit. Credits never expire and are shared across everyone in this
            workspace.
          </p>
        </div>
      </Card>

      <div>
        <div className="t-label text-[var(--color-ink-faint)]">Choose a pack</div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {packs.map((pack) => {
            const active = selected?.code === pack.code;
            return (
              <button
                key={pack.code}
                type="button"
                onClick={() => setSelected(pack)}
                aria-pressed={active}
                className={cx(
                  'flex flex-col items-start rounded-[var(--radius-md)] border p-4 text-left transition-colors duration-150',
                  active
                    ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)]'
                    : 'border-[var(--color-rule)] bg-[var(--color-surface)] hover:border-[var(--color-rule-strong)]',
                )}
              >
                <span className="font-mono text-[20px] tabular text-[var(--color-ink)]">
                  {pack.credits.toLocaleString('en-AU')}
                </span>
                <span className="t-label mt-0.5 text-[var(--color-ink-faint)]">scans</span>
                <span className="mt-3 font-mono text-[15px] tabular font-medium text-[var(--color-ink)]">
                  <Money amount={pack.priceAud} />
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {selected ? (
        <Card>
          <div className="t-label text-[var(--color-ink-faint)]">Order</div>
          <dl className="mt-3 flex flex-col">
            <Row label={`${selected.credits.toLocaleString('en-AU')} credits`} value={<Money amount={selected.priceAud} />} />
            <Row label="GST" value="included" mono={false} />
            <Row label="Recurring charge" value="none" mono={false} />
            <div className="flex items-baseline justify-between gap-4 border-t border-[var(--color-rule-strong)] pt-3">
              <dt className="text-[14px] font-medium text-[var(--color-ink)]">Total</dt>
              <dd className="font-mono text-[18px] tabular font-medium text-[var(--color-ink)]">
                <Money amount={selected.priceAud} />
              </dd>
            </div>
          </dl>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Button onClick={confirm} disabled={pending} size="lg">
              {pending ? 'Working…' : 'Confirm and continue to payment'}
            </Button>
            <span className="text-[12px] text-[var(--color-ink-muted)]">
              You will not be charged at this step.
            </span>
          </div>
        </Card>
      ) : null}

      {error ? (
        <Card className="border-[var(--color-risk)]">
          <div className="flex items-start gap-3">
            <Badge tone="risk">Problem</Badge>
            <p className="text-[14px] leading-relaxed text-[var(--color-ink)]">{error}</p>
          </div>
        </Card>
      ) : null}

      {session?.state === 'unavailable' ? (
        <Card>
          <div className="flex items-start gap-3">
            <Badge tone="warn">Order saved</Badge>
            <div>
              <p className="text-[14px] leading-relaxed text-[var(--color-ink)]">
                {session.message}
              </p>
              <p className="mt-2 text-[13px] leading-relaxed text-[var(--color-ink-muted)]">
                It is listed as <strong>pending</strong> in your purchase history. No credits have
                been added and nothing has been charged.
              </p>
            </div>
          </div>
        </Card>
      ) : null}
    </div>
  );
}

function Row({ label, value, mono = true }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-[var(--color-rule)] py-2.5">
      <dt className="text-[13px] text-[var(--color-ink-muted)]">{label}</dt>
      <dd className={cx('text-[13px] text-[var(--color-ink)]', mono && 'font-mono tabular')}>
        {value}
      </dd>
    </div>
  );
}
