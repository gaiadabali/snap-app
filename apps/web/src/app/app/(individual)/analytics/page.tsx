import Link from 'next/link';
import type { AnalyticsRange } from '@snap/api-contract';

import { Card, Empty, Money, SectionTitle, cx } from '@/design/primitives';
import { formatPercent } from '@/lib/panels/format';
import { getAnalytics } from '@/lib/panels/data';
import { loadWorkspace } from '@/lib/panels/workspace';

export const metadata = { title: 'Analytics' };

const RANGES: Array<{ value: AnalyticsRange; label: string }> = [
  { value: 'month', label: 'Month' },
  { value: 'quarter', label: 'Quarter' },
  { value: 'year', label: 'Year' },
];

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const { workspace } = await loadWorkspace('personal');
  if (!workspace) return <Empty title="No personal workspace yet" />;

  const { range: rangeParam } = await searchParams;
  const range: AnalyticsRange = RANGES.some((r) => r.value === rangeParam) ? (rangeParam as AnalyticsRange) : 'quarter';
  const analytics = await getAnalytics(workspace.id, range);

  const maxSeries = Math.max(1, ...analytics.series.map((p) => Number(p.value) || 0));

  return (
    <div className="flex flex-col gap-6">
      <SectionTitle as="h1" title="Analytics" lede={analytics.rangeLabel} />

      <div className="flex gap-2">
        {RANGES.map((r) => (
          <Link
            key={r.value}
            href={`/app/analytics?range=${r.value}`}
            className={cx(
              'rounded-full px-3 py-1.5 text-[13px] font-semibold',
              r.value === range
                ? 'bg-[var(--color-accent)] text-[var(--color-accent-ink)]'
                : 'bg-[var(--color-surface-alt)] text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]',
            )}
          >
            {r.label}
          </Link>
        ))}
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-ink-faint)]">Total</div>
          <div className="mt-1 text-3xl font-bold tabular text-[var(--color-ink)]">
            <Money amount={analytics.total} />
          </div>
          <div className="mt-1 text-[13px] text-[var(--color-ink-muted)]">
            {analytics.changePct === null ? (
              'No prior period to compare'
            ) : (
              <>
                {analytics.changePct >= 0 ? '↑' : '↓'} {formatPercent(Math.abs(analytics.changePct))} vs previous
              </>
            )}
          </div>
        </Card>
        <Card>
          <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-ink-faint)]">Average per period</div>
          <div className="mt-1 text-3xl font-bold tabular text-[var(--color-ink)]">
            <Money amount={analytics.average} />
          </div>
        </Card>
        <Card>
          <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-ink-faint)]">Largest</div>
          {analytics.largest ? (
            <>
              <div className="mt-1 text-3xl font-bold tabular text-[var(--color-ink)]">
                <Money amount={analytics.largest.amount} />
              </div>
              <div className="mt-1 text-[13px] text-[var(--color-ink-muted)]">
                {analytics.largest.name} · {analytics.largest.date}
              </div>
            </>
          ) : (
            <div className="mt-1 text-[13px] text-[var(--color-ink-faint)]">No receipts yet</div>
          )}
        </Card>
      </div>

      <Card>
        <h3 className="mb-4 text-[15px] font-semibold text-[var(--color-ink)]">Spend over time</h3>
        {analytics.series.length === 0 ? (
          <Empty title="Nothing to chart yet" />
        ) : (
          <div className="flex h-[180px] items-end gap-2">
            {analytics.series.map((p) => (
              <div key={p.label} className="flex flex-1 flex-col items-center gap-1.5" title={`${p.label}: $${p.value}`}>
                <div
                  className={cx('w-full rounded-t-[4px]', p.partial ? 'bg-[var(--color-accent-soft)]' : 'bg-[var(--color-accent)]')}
                  style={{ height: `${Math.max(4, (Number(p.value) / maxSeries) * 140)}px` }}
                />
                <span className="text-[10px] text-[var(--color-ink-faint)]">{p.label}</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <h3 className="mb-3 text-[15px] font-semibold text-[var(--color-ink)]">By category</h3>
          {analytics.byCategory.length === 0 ? (
            <Empty title="No spending yet" />
          ) : (
            <ul className="flex flex-col gap-2">
              {analytics.byCategory.map((c) => (
                <li key={c.category} className="flex items-center justify-between text-[13px]">
                  <span className="text-[var(--color-ink)]">{c.category}</span>
                  <Money amount={c.spent} className="text-[var(--color-ink-muted)]" />
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <h3 className="mb-3 text-[15px] font-semibold text-[var(--color-ink)]">Top merchants</h3>
          {analytics.topMerchants.length === 0 ? (
            <Empty title="No spending yet" />
          ) : (
            <ul className="flex flex-col gap-2">
              {analytics.topMerchants.map((m) => (
                <li key={m.name} className="flex items-center justify-between text-[13px]">
                  <span className="text-[var(--color-ink)]">
                    {m.name} <span className="text-[var(--color-ink-faint)]">× {m.count}</span>
                  </span>
                  <Money amount={m.total} className="text-[var(--color-ink-muted)]" />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
