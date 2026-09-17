'use client';

import dynamic from 'next/dynamic';
import { type ReactNode, useEffect, useRef, useState } from 'react';

import { useSceneCapability } from './capability';

/**
 * The island boundary: where a server-rendered 2D card gets a canvas laid over
 * it, or doesn't.
 *
 * The shape to keep across every scene on this site — the twin is the content,
 * the canvas is a picture of the content:
 *
 *   <CaptureScene>          server component passes its child straight through
 *     <ReceiptScanCard />   rendered on the server, in the DOM, always
 *   </CaptureScene>
 *
 * So the page is complete before a byte of WebGL is fetched. No-JS, old
 * browsers, reduced motion, save-data, a failed context, a crawler, a reader
 * who scrolls past in half a second — every one of them gets the ledger card
 * that docs/WEB.md already signed off, and none of them pays for three.js.
 *
 * `ssr: false` is load-bearing rather than incidental: three touches `window`
 * at module scope, and `next build` produces a standalone server
 * (next.config.ts) that would have to execute it.
 */
const CaptureChamber = dynamic(() => import('./capture-chamber'), { ssr: false });

/**
 * How early the chunk is allowed to start downloading.
 *
 * Roughly one screen ahead. Earlier and it competes with the hero for
 * bandwidth on the connection that can least afford it; later and the canvas
 * arrives after the reader does, which is the stutter this is trying to avoid.
 */
const PREFETCH_MARGIN = '600px 0px';

export function CaptureScene({
  children,
  className,
  /**
   * The host-level kill switch, read on the server from `SCENES_3D_ENABLED`
   * and handed down. Off means this component is a passthrough: the twin is
   * the page, and the lazy chunk is never even requested.
   */
  enabled = true,
  /** Set while developing to keep the flat twin visible beside the canvas. */
  keepTwinVisible = false,
}: {
  children: ReactNode;
  className?: string;
  enabled?: boolean;
  keepTwinVisible?: boolean;
}) {
  const host = useRef<HTMLDivElement | null>(null);
  const capability = useSceneCapability();
  const [near, setNear] = useState(false);
  const [painted, setPainted] = useState(false);

  useEffect(() => {
    if (!enabled || !capability.ok) return;
    const el = host.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setNear(true);
          observer.disconnect();
        }
      },
      { rootMargin: PREFETCH_MARGIN },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [enabled, capability.ok]);

  const mount = enabled && capability.ok && near;
  const twinHidden = mount && painted && !keepTwinVisible;

  return (
    <div ref={host} className={`relative ${className ?? ''}`}>
      {/**
       * The twin keeps its place in the layout even once the canvas is up.
       *
       * It is faded, not unmounted, and not `display: none`. Two reasons, and
       * both have bitten this pattern before: it is still the accessible copy
       * of every figure in the scene — the canvas is `aria-hidden`, so pulling
       * the twin would leave a screen reader with an empty box where the
       * worked example used to be — and it is what gives the absolutely
       * positioned canvas its height. Remove it and the scene collapses to
       * nothing.
       */}
      <div
        className={`transition-opacity duration-500 ${twinHidden ? 'opacity-0' : 'opacity-100'}`}
      >
        {children}
      </div>

      {mount ? (
        <CaptureChamber
          className="pointer-events-none absolute inset-0"
          onFirstFrame={() => setPainted(true)}
        />
      ) : null}
    </div>
  );
}
