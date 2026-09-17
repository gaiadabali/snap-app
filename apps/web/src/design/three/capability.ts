'use client';

import { useEffect, useState } from 'react';

/**
 * Whether this visitor gets WebGL at all.
 *
 * Every 3D scene on this site is an ENHANCEMENT over a 2D component that the
 * server already rendered. Nothing here decides whether the page works — it
 * decides whether the page gets a canvas laid over the top of the part that
 * already works. So this gate is allowed to be conservative, and is.
 *
 * The buyer is the reason it is conservative. docs/DESIGN-HANDOFF.md §12.3:
 * a tradie reading on a phone, outdoors, and an accountant reading all day.
 * Neither of them asked for a GPU-bound hero, and on a cheap Android a
 * 60fps canvas is a battery bill. When in doubt, this returns false and the
 * reader gets the flat ledger, which is the design we actually shipped.
 */

export type SceneCapability =
  | { ok: true }
  | { ok: false; reason: 'reduced-motion' | 'no-webgl2' | 'save-data' | 'low-memory' | 'pending' };

/**
 * `deviceMemory` is Chromium-only and reports a coarse, capped GiB figure.
 * Undefined on Safari and Firefox, which must PASS — treating "unknown" as
 * "too small" would switch WebGL off for every iPhone, i.e. for a large part
 * of the audience this is being built for.
 */
const MIN_DEVICE_MEMORY_GIB = 4;

type NavigatorWithHints = Navigator & {
  deviceMemory?: number;
  connection?: { saveData?: boolean };
};

/**
 * Probes WebGL2 by actually creating a context, then throws it away.
 *
 * Checking `'WebGL2RenderingContext' in window` is not the same question: the
 * constructor exists on machines where context creation still fails — a
 * blocklisted driver, a headless browser, or simply too many live contexts on
 * the page already. The only honest test is to ask for one.
 */
function canCreateWebgl2(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2');
    if (!gl) return false;
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch {
    return false;
  }
}

function probe(): SceneCapability {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    return { ok: false, reason: 'reduced-motion' };
  }

  const nav = navigator as NavigatorWithHints;

  // Someone on a metered connection did not opt into a few hundred KB of
  // WebGL to watch a receipt rotate.
  if (nav.connection?.saveData === true) return { ok: false, reason: 'save-data' };

  if (typeof nav.deviceMemory === 'number' && nav.deviceMemory < MIN_DEVICE_MEMORY_GIB) {
    return { ok: false, reason: 'low-memory' };
  }

  if (!canCreateWebgl2()) return { ok: false, reason: 'no-webgl2' };

  return { ok: true };
}

/**
 * Resolves AFTER mount, never during render.
 *
 * The first client render has to match the server's, and the server cannot
 * know any of this. So the first paint is always the 2D twin, for everyone,
 * and the canvas is a second-pass decision. That ordering is also what keeps
 * LCP on the headline rather than on a canvas.
 */
export function useSceneCapability(): SceneCapability {
  const [capability, setCapability] = useState<SceneCapability>({ ok: false, reason: 'pending' });

  useEffect(() => {
    setCapability(probe());

    // A reader can turn reduced-motion on while the page is open — on macOS
    // and Windows it is a system toggle, not a page-load constant.
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setCapability(probe());
    motion.addEventListener('change', onChange);
    return () => motion.removeEventListener('change', onChange);
  }, []);

  return capability;
}
