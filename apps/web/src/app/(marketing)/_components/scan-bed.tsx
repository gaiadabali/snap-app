'use client';

import { useEffect, useRef } from 'react';

/**
 * The bed — the surface the whole page is lying on.
 *
 * The home page had no background at all. Every section painted
 * `--color-ground` edge to edge, so nine screens of pinned, scroll-scrubbed
 * motion happened against a flat fill: the content moved and the world it
 * moved in did not. That is the thing that reads as unfinished, and it is not
 * fixed by putting a gradient behind it.
 *
 * WHAT THIS IS, LITERALLY. A document on a scanner bed. The product
 * photographs paper and reads it, so the page's ground is the platen: a ruled
 * feed that travels as the document scrolls, an irregular column field under
 * it, a measuring tape down the right edge, and one soft light moving across
 * the whole thing. Nothing here is a particle, a blob, a starfield or a mesh
 * gradient — `docs/DESIGN-HANDOFF.md` §12.1 rejected three directions for
 * looking generated, and the way out of that is not a prettier abstraction,
 * it is imagery that belongs to this product and no other.
 *
 * ── Why the markup is here and the motion is not ─────────────────────────
 *
 * Every scroll-driven value below is CSS (`animation-timeline: scroll(root
 * block)`, see `globals.css` → "The bed"). No listener, no rAF, no state, and
 * it runs on the compositor. This component exists as a client island for
 * exactly ONE reason: the pointer. `--fx` / `--fy` cannot come from a scroll
 * timeline, and the loupe is the part of this that answers "interactive".
 *
 * ── The loupe ────────────────────────────────────────────────────────────
 *
 * Under the cursor, the bed RESOLVES: a fine grid and a faint accent tint
 * appear inside a soft radius and fade out again when the pointer leaves. It
 * is the product's own idea — resolution arrives where the machine is looking
 * — rather than a glow chasing the mouse because glows chasing mice is a
 * thing websites do.
 *
 * It costs one passive listener and two custom properties, written at most
 * once per frame. Nothing re-renders: the values go straight onto the host
 * element's inline style, never into React state, because a `setState` per
 * pointermove would re-render the tree at the pointer's sample rate to move a
 * gradient.
 *
 * Touch gets none of it. There is no hover on a handset, so the listener is
 * never attached — a `pointermove` there means the reader is trying to scroll.
 */

/** Where the loupe parks before the pointer has ever been seen. */
const REST = { x: 50, y: 34 };

export function ScanBed() {
  const host = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = host.current;
    if (!el) return;

    // No hover, no loupe. Also skipped under reduced motion: a light that
    // tracks the cursor is motion the reader asked not to have.
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    let frame = 0;
    let pending: { x: number; y: number } | null = null;

    const flush = () => {
      frame = 0;
      if (!pending) return;
      el.style.setProperty('--fx', `${pending.x.toFixed(2)}%`);
      el.style.setProperty('--fy', `${pending.y.toFixed(2)}%`);
      pending = null;
    };

    const onMove = (event: PointerEvent) => {
      pending = {
        x: (event.clientX / window.innerWidth) * 100,
        y: (event.clientY / window.innerHeight) * 100,
      };
      // Coalesce to one write per frame. A high-polling-rate mouse fires
      // pointermove well above 60Hz and every one of those would otherwise
      // invalidate the same two gradients again.
      if (!frame) frame = requestAnimationFrame(flush);
      el.style.setProperty('--fi', '1');
    };

    const onLeave = () => el.style.setProperty('--fi', '0');

    window.addEventListener('pointermove', onMove, { passive: true });
    document.addEventListener('pointerleave', onLeave);
    window.addEventListener('blur', onLeave);

    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerleave', onLeave);
      window.removeEventListener('blur', onLeave);
    };
  }, []);

  return (
    /**
     * `z-index: -1` on the bed, not `0`.
     *
     * This is the one number in the file that has to be right. `.sect-3d`
     * transforms every section, and a transformed element paints with the
     * positioned group — so a bed at `z-index: 0` sits in the SAME group and,
     * being earlier in the DOM, ends up underneath the pinned sections but on
     * top of every element that is still in normal flow: the final CTA, the
     * whole page below 1024px, and every section on a handset. Negative-z puts
     * it in the one paint step that is above the body's background fill and
     * below all content, transformed or not.
     */
    <div
      ref={host}
      className="bed"
      aria-hidden
      style={{ ['--fx' as string]: `${REST.x}%`, ['--fy' as string]: `${REST.y}%` }}
    >
      {/* The light. One soft source travelling across the document — the only
          thing here that is not a line. */}
      <div className="bed__wash" />
      {/* The column field, three co-prime periods deep so the spacing never
          resolves into a visible repeat. */}
      <div className="bed__cols" />
      {/* The feed: ruled paper moving past, slower than the page. */}
      <div className="bed__feed" />
      {/* The scale down the right margin, running faster than the feed. */}
      <div className="bed__tape" />
      {/* The loupe. Everything above is scroll-driven; this one is the cursor. */}
      <div className="bed__loupe" />
    </div>
  );
}
