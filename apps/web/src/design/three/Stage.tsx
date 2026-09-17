'use client';

import { Canvas } from '@react-three/fiber';
import { type ReactNode, useEffect, useRef, useState } from 'react';

/**
 * The canvas shell every scene mounts inside.
 *
 * One place to make the decisions that must not be re-argued per scene:
 * pixel-ratio ceiling, when the render loop is allowed to run, what the camera
 * is, and — the one that matters most — that the canvas is decorative and the
 * DOM underneath it is the content.
 */

/**
 * Pixel-ratio ceiling.
 *
 * A phone reporting devicePixelRatio 3 asks for NINE times the fragments of a
 * 1x screen to draw the same receipt. Capped at 1.5 on handsets the paper is
 * still clean — it is a flat-lit document, not a chrome sphere — and the
 * fragment cost drops by a factor of four. Desktop gets 2 because a laptop
 * plugged into power can afford it and the mono type on the docket texture is
 * where the sharpness actually shows.
 */
const DPR_MOBILE: [number, number] = [1, 1.5];
const DPR_DESKTOP: [number, number] = [1, 2];

export function Stage({
  children,
  className,
  /** Fires once the first frame is on screen, so the 2D twin can step back. */
  onFirstFrame,
}: {
  children: ReactNode;
  className?: string;
  onFirstFrame?: () => void;
}) {
  const host = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);
  const [coarse, setCoarse] = useState(false);

  useEffect(() => {
    setCoarse(window.matchMedia('(pointer: coarse)').matches);
  }, []);

  /**
   * The render loop stops the moment the scene leaves the viewport.
   *
   * Without this a reader who scrolls to the pricing table and reads it for a
   * minute is still paying for sixty frames a second of a receipt nobody can
   * see — on a phone, that is the battery complaint that gets a site
   * remembered for the wrong reason. `rootMargin` starts it slightly early so
   * the first visible frame is already warm rather than a stutter.
   */
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(entry?.isIntersecting ?? false),
      { rootMargin: '200px 0px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    /**
     * `aria-hidden` on the HOST, not on `<Canvas>`.
     *
     * It is not a formality, and it does not go where you would first put it.
     * Every figure in this scene is drawn into a texture, so to the
     * accessibility tree it is a picture of a number; the real docket — the
     * one a screen reader reads, the one that is in the DOM whether or not
     * WebGL ever starts — is the 2D twin underneath. Hiding this subtree is
     * what stops the same worked example being announced twice, once as
     * content and once as an unlabelled graphic.
     *
     * Passing `aria-hidden` to `<Canvas>` silently does nothing: R3F consumes
     * its own props and never forwards it to the element it creates. That is
     * exactly the kind of accessibility fix that looks applied in review and
     * is absent in the DOM, so the attribute is set here, on an element we
     * own, and asserted in the verification pass rather than assumed.
     */
    <div ref={host} className={className} aria-hidden>
      <Canvas
        frameloop={visible ? 'always' : 'never'}
        dpr={coarse ? DPR_MOBILE : DPR_DESKTOP}
        /**
         * A long lens. 30° is roughly an 85mm on full-frame — the focal length
         * a product photographer reaches for, because it renders a flat object
         * at an angle with almost no perspective stretch. The wide default
         * (75°) is exactly what makes a WebGL hero look like a video game
         * instead of a photograph, which is the failure docs/DESIGN-HANDOFF.md
         * §12.2 is actually describing.
         */
        camera={{ position: [0, 0, 3.2], fov: 30, near: 0.1, far: 20 }}
        gl={{
          antialias: true,
          alpha: true,
          powerPreference: 'low-power',
          /** Nothing here reads pixels back; letting the driver discard the
              buffer after compositing saves a copy every frame. */
          preserveDrawingBuffer: false,
        }}
        onCreated={({ gl }) => {
          // Transparent: the page's own `--color-ground` shows through, so the
          // scene inherits the theme's background instead of declaring one.
          gl.setClearAlpha(0);
          // Belt and braces on the element R3F actually made, since the host
          // div is not the thing a stray `aria-*` audit will look at.
          gl.domElement.setAttribute('aria-hidden', 'true');
          onFirstFrame?.();
        }}
        style={{ touchAction: 'pan-y' }}
      >
        {children}
      </Canvas>
    </div>
  );
}
