import { Money } from '@/design/primitives';
import type { WeeklySpendPoint } from '../../../../_data/governance';

import { usd } from '../../../_components/format';

/**
 * A plain bar list, not a charting library — the app has no chart dependency
 * and eight bars do not need one. Height is relative to the series max so the
 * shape reads correctly regardless of scale.
 */
export function SpendTrend({ points }: { points: WeeklySpendPoint[] }) {
  const max = Math.max(...points.map((p) => p.costUsd), 1);
  return (
    <div className="flex items-end gap-2" role="img" aria-label="Weekly AI spend, last 8 weeks, trending up">
      {points.map((p) => (
        <div key={p.weekStart} className="flex flex-1 flex-col items-center gap-1.5">
          <div className="text-[11px] tabular text-[var(--color-ink-faint)]">
            <Money amount={usd(p.costUsd)} />
          </div>
          <div
            className="w-full rounded-t-[var(--radius-sm)] bg-[var(--color-accent)]"
            style={{ height: `${Math.max(6, (p.costUsd / max) * 96)}px` }}
          />
          <div className="text-[10px] text-[var(--color-ink-faint)]">
            {new Date(p.weekStart).toLocaleDateString('en-AU', { day: '2-digit', month: 'short' })}
          </div>
        </div>
      ))}
    </div>
  );
}
