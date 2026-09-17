'use client';

import { useEffect, useState } from 'react';

/**
 * The bridge from CSS custom properties into WebGL.
 *
 * docs/DESIGN-HANDOFF.md §3.1: the identity colours are MEASURED — #1878D8,
 * #0060C0 and the #1CA8DB scan cyan are sampled from the launch film and
 * shared byte-for-byte with apps/mobile. A scene that hard-codes `0x1878d8`
 * is a fourth copy of a number that already exists in two places and is
 * already documented as drifting (§12.5, the mobile neutrals). So nothing in
 * `src/design/three` may contain a hex literal: every colour is read back out
 * of the same `globals.css` tokens the DOM is painted with.
 *
 * It also buys the theme toggle for free. The tokens are re-read whenever the
 * theme changes, so a scene tweens between the two measured palettes instead
 * of being built for one of them.
 */

/** The tokens a scene is allowed to ask for. Add sparingly. */
const TOKENS = [
  'ground',
  'surface',
  'surface-alt',
  'ink',
  'ink-muted',
  'ink-faint',
  'accent',
  'accent-deep',
  'scan',
  'risk',
  'good',
  'rule',
  'rule-strong',
  // The darkest token, and the only one that stays dark in BOTH themes — which
  // is what a cast shadow needs. `ink` inverts to near-white in dark and turns
  // a shadow into a glow.
  'void',
] as const;

export type PaletteToken = (typeof TOKENS)[number];
export type ScenePalette = Record<PaletteToken, string>;

/**
 * Light-theme values, used only for the very first render.
 *
 * These are not a second source of truth — `read()` overwrites every one of
 * them from the live stylesheet on mount, before a single frame is drawn.
 * They exist so the hook has a fully-typed object to hand back during the
 * server/first-client render, where `getComputedStyle` is unavailable.
 */
const BOOTSTRAP: ScenePalette = {
  ground: '#FAF9F7',
  surface: '#F2F0EC',
  'surface-alt': '#E7E4DE',
  ink: '#14181D',
  'ink-muted': '#5A6068',
  'ink-faint': '#8D9299',
  accent: '#1878D8',
  'accent-deep': '#0060C0',
  scan: '#1CA8DB',
  risk: '#C4322A',
  good: '#1B6E4F',
  rule: '#E2DFD8',
  'rule-strong': '#C9C5BC',
  void: '#101319',
};

function read(): ScenePalette {
  const style = getComputedStyle(document.documentElement);
  const out = {} as ScenePalette;
  for (const token of TOKENS) {
    const value = style.getPropertyValue(`--color-${token}`).trim();
    out[token] = value || BOOTSTRAP[token];
  }
  return out;
}

/**
 * The live palette, re-read on every theme change.
 *
 * Two sources have to be watched, because `globals.css` defines dark twice on
 * purpose: `:root[data-theme="dark"]` for the explicit toggle, and a
 * `prefers-color-scheme` block for readers who never touched it. Watching only
 * the attribute would miss the OS following sunset; watching only the media
 * query would miss the toggle in the header.
 */
export function useScenePalette(): ScenePalette {
  const [palette, setPalette] = useState<ScenePalette>(BOOTSTRAP);

  useEffect(() => {
    const sync = () => setPalette(read());
    sync();

    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });

    const scheme = window.matchMedia('(prefers-color-scheme: dark)');
    scheme.addEventListener('change', sync);

    return () => {
      observer.disconnect();
      scheme.removeEventListener('change', sync);
    };
  }, []);

  return palette;
}
