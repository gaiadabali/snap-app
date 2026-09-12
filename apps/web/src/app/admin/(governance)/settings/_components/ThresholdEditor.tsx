'use client';

import { useState, useTransition } from 'react';

import { Badge, Button } from '@/design/primitives';
import type { ExtractionThreshold } from '../../../_data/governance';

import { setExtractionThresholdAction } from '../actions';

export function ThresholdEditor({ threshold }: { threshold: ExtractionThreshold }) {
  const [value, setValue] = useState(String(threshold.value));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const dirty = Number(value) !== threshold.value;

  function save() {
    setError(null);
    setSaved(false);
    const n = Number(value);
    if (!Number.isFinite(n)) return setError('Not a number.');
    startTransition(async () => {
      try {
        await setExtractionThresholdAction(threshold.key, n);
        setSaved(true);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not save.');
        setValue(String(threshold.value));
      }
    });
  }

  return (
    <div className="border-b border-[var(--color-rule)] py-3 last:border-0">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="font-semibold">{threshold.label}</div>
          <p className="mt-0.5 text-[13px] text-[var(--color-ink-muted)]">{threshold.description}</p>
          <p className="mt-0.5 text-[12px] text-[var(--color-ink-faint)]">
            Range {threshold.min}–{threshold.max} · Takes effect: {threshold.takesEffect}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <input
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setSaved(false);
            }}
            inputMode="decimal"
            step={threshold.step}
            className="tabular h-9 w-20 rounded-[var(--radius-md)] border border-[var(--color-rule-strong)] bg-[var(--color-ground)] px-2 text-right text-[14px] font-semibold"
          />
          <Button size="sm" variant="secondary" disabled={!dirty || pending} onClick={save}>
            {pending ? 'Saving…' : 'Save'}
          </Button>
          {saved && !dirty ? <Badge tone="good">saved</Badge> : null}
        </div>
      </div>
      {error ? <p className="mt-1 text-[13px] font-semibold text-[var(--color-risk)]">{error}</p> : null}
    </div>
  );
}
