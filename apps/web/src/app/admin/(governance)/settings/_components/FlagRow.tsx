'use client';

import { Badge } from '@/design/primitives';
import type { FeatureFlag } from '../../../_data/governance';

import { ToggleControl } from '../../_components/ToggleControl';
import { setFeatureFlagAction } from '../actions';

const CLIENT_TONE = { mobile: 'accent', server: 'neutral', website: 'good' } as const;

export function FlagRow({ flag }: { flag: FeatureFlag }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-[var(--color-rule)] py-3 last:border-0">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-semibold">{flag.label}</span>
          <div className="flex gap-1">
            {flag.clients.map((c) => (
              <Badge key={c} tone={CLIENT_TONE[c]}>
                {c}
              </Badge>
            ))}
          </div>
        </div>
        <p className="mt-0.5 text-[13px] text-[var(--color-ink-muted)]">{flag.description}</p>
        <p className="mt-0.5 text-[12px] text-[var(--color-ink-faint)]">Takes effect: {flag.takesEffect}</p>
      </div>
      <ToggleControl
        key={`${flag.key}-${flag.enabled}`}
        checked={flag.enabled}
        label={flag.label}
        onToggle={(next) => setFeatureFlagAction(flag.key, next)}
      />
    </div>
  );
}
