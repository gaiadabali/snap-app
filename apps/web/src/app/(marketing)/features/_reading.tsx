'use client';

import { useId, useState, type ReactNode } from 'react';

/**
 * "Same docket, read two ways". A two-state switch between what a reader sees
 * if it only has the total and what Snap Apps sees line by line. Both panels
 * are rendered on the server and passed in, so the figures (all from demo.ts)
 * are never typed here; this file only decides which one shows.
 */
export function ReadingToggle({ lines, total }: { lines: ReactNode; total: ReactNode }) {
  const [mode, setMode] = useState<'lines' | 'total'>('lines');
  const panelId = useId();

  return (
    <div>
      <div role="group" aria-label="How the docket is read" className="feat-seg">
        <button type="button" aria-pressed={mode === 'total'} aria-controls={panelId} onClick={() => setMode('total')}>
          Total only
        </button>
        <button type="button" aria-pressed={mode === 'lines'} aria-controls={panelId} onClick={() => setMode('lines')}>
          Every line
        </button>
      </div>
      <div id={panelId} aria-live="polite" className="mt-5">
        <div key={mode} className="feat-swap">
          {mode === 'lines' ? lines : total}
        </div>
      </div>
    </div>
  );
}
