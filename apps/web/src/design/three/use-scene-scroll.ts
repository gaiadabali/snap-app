'use client';

import { type RefObject, useEffect, useRef } from 'react';

/**
 * How far an element has travelled through the viewport, as 0 → 1.
 *
 * 0 the moment its top edge reaches the bottom of the viewport, 1 once its
 * bottom edge has reached the top. That is deliberately the same window CSS
 * scroll timelines describe as `entry 0%` → `cover 100%`, so a scene and the
 * `.anim-*` utilities either side of it move against the SAME clock. Two
 * scroll-driven systems on one page that disagree about when a section starts
 * is a tell you cannot un-see once you have seen it.
 *
 * Returns a ref rather than state on purpose: this updates every frame of a
 * scroll, and a `setState` per frame would re-render the React tree sixty
 * times a second to move a number that only the render loop reads.
 */
export function useSceneScroll(host: RefObject<HTMLElement | null>) {
  const progress = useRef(0);

  useEffect(() => {
    const el = host.current;
    if (!el) return;

    /**
     * Measure the PIN TRACK, not the canvas.
     *
     * Once a section is pinned, its contents stop moving through the viewport
     * — that is the entire point of a pin. So the canvas host's rect is very
     * nearly constant for the whole time the section is on screen, and a
     * progress computed from it barely advances: the hero's sweep froze about
     * a third of the way down the docket and stayed there, which is exactly
     * what the owner saw.
     *
     * The thing that IS still moving is the track the sticky section lives in.
     * Reading its rect gives a progress that runs 0 -> 1 across the whole pin,
     * so the scan can be scrubbed to completion before the section releases.
     * Falls back to the host itself wherever there is no track — the handset,
     * reduced motion, and any page that is not pinned.
     */
    const driver = el.closest('.pin-track') ?? el;

    const measure = () => {
      const rect = driver.getBoundingClientRect();
      const span = window.innerHeight + rect.height;
      if (span <= 0) return;
      const travelled = window.innerHeight - rect.top;
      progress.current = Math.min(1, Math.max(0, travelled / span));
    };

    measure();
    window.addEventListener('scroll', measure, { passive: true });
    window.addEventListener('resize', measure, { passive: true });
    return () => {
      window.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
    };
  }, [host]);

  return progress;
}

/**
 * Damped pointer position in −1 → 1, for camera parallax.
 *
 * Parallax is the whole difference between "a 3D render on a page" and "a
 * thing sitting on the desk in front of you", and it costs one listener. It
 * stays SMALL — the camera offset this drives is a couple of degrees, not a
 * funhouse — and it never runs on touch, where there is no hover to track and
 * the only thing a pointer event means is that the reader is trying to scroll.
 */
export function usePointerParallax() {
  const pointer = useRef({ x: 0, y: 0 });

  useEffect(() => {
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;

    const onMove = (event: PointerEvent) => {
      pointer.current.x = (event.clientX / window.innerWidth) * 2 - 1;
      pointer.current.y = (event.clientY / window.innerHeight) * 2 - 1;
    };

    window.addEventListener('pointermove', onMove, { passive: true });
    return () => window.removeEventListener('pointermove', onMove);
  }, []);

  return pointer;
}
