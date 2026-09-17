import type { ConsumptionTaxReport } from '@snap/api-contract';

import { Badge, Card, Money, cx } from '@/design/primitives';

/**
 * Consumption tax over a period — a spending analytic, and labelled as one.
 *
 * The whole reason this component is careful: for a personal Indonesian
 * taxpayer, PPN is **not recoverable**. There is no input credit, no SPT Masa
 * PPN, and nothing to lodge (`docs/INDONESIA.md` §4.3). A card that showed
 * "PPN: Rp 110.000" next to the words "claim" or "refund", or beside a period
 * selector, would be making a factual claim about the user's tax position that
 * is simply false.
 *
 * So three rules hold here:
 *
 *  - **The disclosure comes from the engine and is printed verbatim.** This
 *    component does not compose that sentence, because the law decides it, not
 *    the layout.
 *  - **PB1 is shown apart and never added in.** Indonesia's regional tax on
 *    restaurant and hotel consumption prints like PPN, at a rate close enough
 *    to pass a careless glance, and is never recoverable. Folding it into the
 *    headline would overstate a figure the user cannot recover either way.
 *  - **No filing affordance when `filingPeriod` is `none`.** Not greyed out —
 *    absent. A disabled "lodge" button still tells the user a return exists.
 */
export function ConsumptionTaxCard({ report }: { report: ConsumptionTaxReport }) {
  const hasOtherTax = Number(report.otherTaxPaid) > 0;
  const hasExempt = Number(report.exemptSpend) > 0;

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[15px] font-semibold text-[var(--color-ink)]">
          {report.taxName} you paid
        </h3>
        {report.recoverable ? (
          <Badge tone="accent">Recoverable</Badge>
        ) : (
          <Badge>Not recoverable</Badge>
        )}
      </div>

      <div className="mt-3 text-3xl font-bold tabular text-[var(--color-ink)]">
        <Money amount={report.taxPaid} currency={report.currency} />
      </div>

      {/* Printed verbatim, from the tax engine. */}
      <p className="mt-2 text-[13px] leading-relaxed text-[var(--color-ink-muted)]">
        {report.disclosure}
      </p>

      <dl className="mt-4 flex flex-col gap-2 border-t border-[var(--color-rule)] pt-3 text-[13px]">
        <Line
          label="Total spend"
          amount={report.grossSpend}
          currency={report.currency}
        />
        {hasExempt ? (
          <Line
            label="Exempt from tax"
            hint="Basic necessities — rice, eggs, meat, milk, fruit and vegetables."
            amount={report.exemptSpend}
            currency={report.currency}
          />
        ) : null}
        {hasOtherTax ? (
          <Line
            label="Regional tax (PB1)"
            // The one sentence that stops this being read as more of the above.
            hint={`A local tax on restaurant, hotel and entertainment bills. It is not ${report.taxName}, and it is not included in the figure above.`}
            amount={report.otherTaxPaid}
            currency={report.currency}
            muted
          />
        ) : null}
      </dl>

      {report.lines.length > 0 ? (
        <div className="mt-4 border-t border-[var(--color-rule)] pt-3">
          <ul className="flex flex-col gap-1.5">
            {report.lines.map((l) => (
              <li key={l.code} className="flex items-baseline justify-between gap-3 text-[12px]">
                <span className="text-[var(--color-ink-muted)]">
                  {l.name}
                  <span className="ml-1.5 text-[var(--color-ink-faint)]">
                    × {l.transactionCount}
                  </span>
                </span>
                <Money
                  amount={l.grossAmount}
                  currency={report.currency}
                  className={cx(
                    l.treatment === 'other_tax'
                      ? 'text-[var(--color-ink-faint)]'
                      : 'text-[var(--color-ink-muted)]',
                  )}
                />
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <p className="mt-4 text-[11px] text-[var(--color-ink-faint)]">
        {report.rulesId} · {report.rulesVersion}
      </p>
    </Card>
  );
}

function Line({
  label,
  hint,
  amount,
  currency,
  muted,
}: {
  label: string;
  hint?: string;
  amount: string;
  currency: string;
  muted?: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-baseline justify-between gap-4">
        <dt className="text-[var(--color-ink-muted)]">{label}</dt>
        <dd>
          <Money
            amount={amount}
            currency={currency}
            className={muted ? 'text-[var(--color-ink-faint)]' : 'text-[var(--color-ink)]'}
          />
        </dd>
      </div>
      {hint ? (
        <p className="max-w-[46ch] text-[11px] leading-relaxed text-[var(--color-ink-faint)]">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
