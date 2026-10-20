'use client';

import { useEffect, useRef } from 'react';

/**
 * A figure that counts up to itself the first time it is seen.
 *
 * The server renders the FINAL string, so the DOM, a crawler, a reader with
 * JS off and a screen reader all get the real figure. The count only rewrites
 * the visible digits, in integer hundredths — a decimal string is split, never
 * parsed to a float (docs/WEB.md §3.2) — and it always lands on exactly the
 * string it was given. Skipped under reduced motion.
 *
 * `value` is a decimal string ("1762.40") or an integer string ("48").
 */
export function CountUp({
  value,
  prefix = '',
  suffix = '',
  cents,
  duration = 1400,
  className,
}: {
  value: string;
  prefix?: string;
  suffix?: string;
  /** Defaults to whether `value` has a fraction. */
  cents?: boolean;
  duration?: number;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const showCents = cents ?? value.includes('.');
  const final = `${prefix}${format(toHundredths(value), showCents)}${suffix}`;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (!('IntersectionObserver' in window)) return;

    const target = toHundredths(value);
    let raf = 0;
    let started = false;

    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting) || started) return;
        started = true;
        io.disconnect();
        const t0 = performance.now();
        const tick = (now: number) => {
          const t = Math.min(1, (now - t0) / duration);
          // easeOutExpo, integer steps only.
          const eased = t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
          const current = Math.round(target * eased);
          el.textContent = `${prefix}${format(current, showCents)}${suffix}`;
          if (t < 1) raf = requestAnimationFrame(tick);
          else el.textContent = final;
        };
        el.textContent = `${prefix}${format(0, showCents)}${suffix}`;
        raf = requestAnimationFrame(tick);
      },
      { threshold: 0.6 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [value, prefix, suffix, showCents, duration, final]);

  return (
    <span className={className}>
      <span ref={ref} aria-hidden suppressHydrationWarning>
        {final}
      </span>
      <span className="sr-only">{final}</span>
    </span>
  );
}

/** "1762.40" → 176240. Integer hundredths, from the string's own digits. */
function toHundredths(value: string): number {
  const [whole, frac = ''] = value.replace(/,/g, '').split('.');
  return Number.parseInt(whole || '0', 10) * 100 + Number.parseInt((frac + '00').slice(0, 2), 10);
}

function format(hundredths: number, cents: boolean): string {
  const whole = Math.floor(hundredths / 100);
  const frac = String(hundredths % 100).padStart(2, '0');
  const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return cents ? `${grouped}.${frac}` : grouped;
}
