import type { ReactNode } from 'react';

import { Card } from '@/design/primitives';

/**
 * What this surface renders instead of a fixture, wherever the real admin
 * plane has no backing endpoint (yet).
 *
 * Per the brief: never invent or estimate a value. A made-up queue depth or
 * a fabricated spend figure is how someone makes a bad operational decision
 * on a production platform — so where the server cannot answer, this says so
 * visibly, in place of the removed panel, rather than silently disappearing
 * (which would look like "nothing to see" instead of "not built yet").
 */
export function NotWired({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card tone="ground" className="border-dashed">
      <div className="flex items-start gap-3">
        <span aria-hidden className="text-[18px] leading-none text-[var(--color-ink-faint)]">
          ⚠
        </span>
        <div>
          <h3 className="text-[15px] font-bold text-[var(--color-ink-muted)]">{title} — not wired yet</h3>
          <div className="mt-1.5 text-[13px] leading-relaxed text-[var(--color-ink-muted)]">{children}</div>
        </div>
      </div>
    </Card>
  );
}
