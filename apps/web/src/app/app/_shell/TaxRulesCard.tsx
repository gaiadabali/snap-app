'use client';

import { useActionState, useState } from 'react';
import type { InstalledTaxRules } from '@snap/api-contract';

import { Badge, Button, Card, Field, SectionTitle, Select } from '@/design/primitives';
import type { ActionResult } from '@/lib/panels/actions';

/**
 * The installed tax engine, and the one control that changes it.
 *
 * Three things this screen must not do, each of which would be a factual claim
 * the software is not entitled to make:
 *
 *  1. **Imply a default.** When no engine is installed, the state is "no engine"
 *     and every tax figure refuses. It does not quietly mean Australia. The
 *     card says so rather than rendering an empty form that looks ready.
 *  2. **Imply recoverability.** A personal Indonesian taxpayer cannot recover
 *     PPN. `recoverable: false` is rendered as a plain statement, because a
 *     screen that stays silent about it reads as "you can claim this".
 *  3. **Imply a filing.** `filingPeriod: 'none'` means there is no return for
 *     this tax. No period selector, no "lodge", no due date.
 *
 * Changing the country is destructive in the sense that matters: it replaces
 * the rules every figure is computed under. So it asks first.
 */
export function TaxRulesCard({
  installed,
  canEdit,
  onInstall,
}: {
  installed: InstalledTaxRules;
  canEdit: boolean;
  onInstall: (prev: ActionResult | null, formData: FormData) => Promise<ActionResult>;
}) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    onInstall,
    null,
  );
  const [choice, setChoice] = useState(installed.rulesId ?? '');

  const isInstalled = installed.rulesId !== null && installed.problem === null;
  const changing = isInstalled && choice !== '' && choice !== installed.rulesId;

  return (
    <div className="flex flex-col gap-4">
      <SectionTitle
        as="h2"
        title="Tax engine"
        lede="The rules every tax figure in this workspace is computed under. One country at a time — installing another replaces it."
      />

      <Card className="max-w-[560px]">
        <div className="flex flex-col gap-5">
          {/* ── What is running ─────────────────────────────────────── */}
          {isInstalled ? (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[15px] font-semibold text-[var(--color-ink)]">
                  {installed.countryName}
                </span>
                <Badge>{installed.taxYear}</Badge>
                <span className="text-[12px] text-[var(--color-ink-muted)]">
                  {installed.rulesId} · {installed.rulesVersion}
                </span>
              </div>

              <dl className="flex flex-col gap-2 text-[13px]">
                <Row
                  label="Consumption tax"
                  value={installed.consumptionTaxName ?? '—'}
                />
                <Row label="Currency" value={installed.currency} />
                <Row label="Annual return" value={installed.annualReturnName ?? '—'} />
                <Row
                  label={`${installed.consumptionTaxName ?? 'Tax'} recoverable`}
                  // Stated, not omitted. Silence here reads as "yes".
                  value={
                    installed.recoverable
                      ? 'Yes, with valid evidence'
                      : 'No — it is a cost, not a credit'
                  }
                />
                <Row
                  label="Filing period"
                  value={
                    installed.filingPeriod === 'none'
                      ? 'None for this tax'
                      : (installed.filingPeriod ?? '—')
                  }
                />
              </dl>

              {installed.filingPeriod === 'none' && installed.recoverable === false ? (
                <p className="rounded-[var(--radius-md)] bg-[var(--color-surface-alt)] px-3 py-2 text-[12px] leading-relaxed text-[var(--color-ink-muted)]">
                  You are not registered to recover {installed.consumptionTaxName}, so there
                  is no return to file for it. Your receipts are still worth capturing — they
                  are your record of what you spent, and the tax you paid is shown as part of
                  that spending.
                </p>
              ) : null}
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <Badge tone="risk">No engine installed</Badge>
              </div>
              <p className="text-[13px] leading-relaxed text-[var(--color-ink-muted)]">
                Every tax figure in this workspace refuses until a country is chosen. There
                is deliberately no default: applying one country&rsquo;s rules to another
                produces numbers that look perfectly ordinary and are wrong.
              </p>
              {installed.problem ? (
                <p className="text-[12px] text-[var(--color-ink-muted)]">{installed.problem}</p>
              ) : null}
            </div>
          )}

          {/* ── Changing it ─────────────────────────────────────────── */}
          <form action={formAction} className="flex flex-col gap-3 border-t border-[var(--color-rule)] pt-4">
            <Field
              label={isInstalled ? 'Change country' : 'Choose a country'}
              hint="Your country, base currency and financial year move with the engine."
            >
              <Select
                name="rulesId"
                value={choice}
                onChange={(e) => setChoice(e.target.value)}
                disabled={!canEdit || pending}
              >
                <option value="">Select…</option>
                {installed.available.map((r) => (
                  <option key={r.rulesId} value={r.rulesId}>
                    {r.countryName} — {r.taxYear} ({r.consumptionTaxName}, {r.currency})
                  </option>
                ))}
              </Select>
            </Field>

            {changing ? (
              <p className="rounded-[var(--radius-md)] border border-[var(--color-risk)] bg-[var(--color-risk-soft)] px-3 py-2 text-[12px] leading-relaxed text-[var(--color-risk)]">
                This replaces {installed.countryName}&rsquo;s rules. Figures already recorded
                keep the version they were computed under; everything from here uses the new
                engine.
              </p>
            ) : null}

            {state && !state.ok ? (
              <p className="text-[12px] text-[var(--color-risk)]">{state.message}</p>
            ) : null}
            {state?.ok ? (
              <p className="text-[12px] text-[var(--color-ink-muted)]">Tax engine installed.</p>
            ) : null}

            <div>
              <Button
                type="submit"
                disabled={!canEdit || pending || choice === '' || choice === installed.rulesId}
              >
                {pending ? 'Installing…' : isInstalled ? 'Replace engine' : 'Install engine'}
              </Button>
            </div>
          </form>
        </div>
      </Card>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-[var(--color-ink-muted)]">{label}</dt>
      <dd className="text-right font-medium text-[var(--color-ink)]">{value}</dd>
    </div>
  );
}
