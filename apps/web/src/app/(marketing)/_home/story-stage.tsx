'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * The state holder for the "how it works" story: which of the three step
 * panels is crossing the centre line of the viewport.
 *
 * Everything else stays a Server Component. The children (the sticky phone,
 * the three panels, the progress rail) are rendered on the server and passed
 * in; this island only publishes the active step as `--step` (read by
 * story.css for the screen cross-fade, the rail and the step numbers) and as
 * `data-step` (for tests and DevTools). Server render and no-JS: step 1.
 *
 * `IntersectionObserver` with a centre-line root margin, never a scroll
 * listener. The observer only reports state; the motion itself lives in CSS
 * and is switched off there under `prefers-reduced-motion`.
 */
export function StoryStage({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState(1);

  useEffect(() => {
    const root = ref.current;
    if (!root || !('IntersectionObserver' in window)) return;

    const panels = root.querySelectorAll<HTMLElement>('[data-story-panel]');
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const n = Number((entry.target as HTMLElement).dataset.n);
          if (n >= 1 && n <= panels.length) setStep(n);
        }
      },
      // A zero-height root at the vertical centre of the viewport: the panel
      // under that line is the active one.
      { rootMargin: '-50% 0px -50% 0px', threshold: 0 },
    );
    panels.forEach((panel) => io.observe(panel));
    return () => io.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={className}
      data-step={step}
      style={{ ['--step' as string]: step }}
    >
      {children}
    </div>
  );
}
