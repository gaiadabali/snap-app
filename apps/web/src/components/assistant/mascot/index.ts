/**
 * Snapper, the Snap Apps assistant's 3D mascot (docs/ASSISTANT.md §11).
 *
 * This file is the contract the widget is built against, and it is tiny on
 * purpose: it imports nothing from three.js. `createMascot` loads the renderer
 * (runtime.ts → rig.ts, motion.ts, three) with a dynamic import, so three.js
 * lands in its own chunk however this module is imported, and a browser
 * without WebGL2 never downloads it.
 *
 * Behaviour notes for the widget:
 * - The canvas comes back with its first frame already drawn: the idle pose,
 *   looking at the viewer, identical to /assistant/snapper-poster.webp (same
 *   framing), so swapping the poster for the canvas is invisible. The canvas
 *   keeps its last frame while paused or moved between docks.
 * - It starts active; it renders only while active, on screen and in a
 *   visible tab: 60 fps while anything is happening, 30 fps after 8 s of idle.
 * - `happy` and `sorry` are one-shots: they fall back to `idle` by themselves
 *   (~2.8 s, ~2.5 s). Every other mood holds until the next `setMood`.
 * - `snap()` (~0.6 s) and `dizzy()` (~3 s) play over whatever mood is set and
 *   do not change it. A `dizzy()` during the first ~2.3 s of one is ignored.
 * - `dispose()` frees the GPU context but does not detach the canvas.
 */

export type MascotMood = 'idle' | 'attentive' | 'listening' | 'thinking' | 'talking' | 'happy' | 'sorry';

export interface Mascot {
  /** Made by the mascot; the widget places it. */
  readonly canvas: HTMLCanvasElement;
  setMood(m: MascotMood): void;
  /** Viewport px; null = look at the viewer. */
  lookAt(x: number | null, y: number | null): void;
  /** A keystroke. */
  nod(): void;
  /** Opening the panel. */
  hop(): void;
  /** Greeting, the teaser. */
  wave(): void;
  /** Shutter click + flash + a small hop (a click on the mascot). */
  snap(): void;
  /** The three-poke reaction: a spin with spiral eyes, a wobble, a grin. */
  dizzy(): void;
  /** 0..1, once per streamed chunk; the mouth decays by itself. */
  speak(level: number): void;
  /** false = stop rendering (hidden, tab in the background). */
  setActive(on: boolean): void;
  resize(cssPx: number): void;
  dispose(): void;
}

export interface MascotOptions {
  /** CSS px of the square canvas. */
  size: number;
  reducedMotion: boolean;
}

/**
 * Where Snapper sits in its square canvas at rest, as fractions of the canvas
 * from the top-left (identical in the posters; measured by projecting the
 * stage's own points through its camera, `measureLayout` in runtime.ts).
 * Animation stays inside the canvas: hops, the flash, sparkles and the
 * thinking dots use the headroom around it.
 *
 * Fitting the 64 px launcher orb (body.centreY on the orb's centre, canvas
 * centred horizontally):
 * - 64 px canvas, left 0, top = 32 - 0.487 * 64 ≈ +1 px: the body is ~39 px
 *   wide and the bracket corners sit right on the orb's rim (everything inside).
 * - 80 px canvas, left -8 px, top = 32 - 0.487 * 80 ≈ -7 px: the body is ~49 px
 *   wide, the shutter top lands ~4 px inside the orb, the shadow ~60 px down,
 *   and the bracket corners break the rim like a viewfinder around the orb.
 *
 * Panel header: for an avatar box of height H showing the brackets edge to
 * edge, use a canvas of H / (brackets.bottom - brackets.top) ≈ 1.38 H px.
 */
export const MASCOT_FRAME = {
  /** The cushion's silhouette box (without arms, brackets and shutter) and its centre. */
  body: { left: 0.197, right: 0.803, top: 0.182, bottom: 0.792, centreY: 0.487 },
  /** Between the eyes (where the gaze is measured from). */
  eyes: { x: 0.5, y: 0.438 },
  /** Top of the shutter button at rest. */
  top: 0.14,
  /** The viewfinder brackets' outer edges at rest. */
  brackets: { left: 0.136, right: 0.864, top: 0.119, bottom: 0.842 },
  /** The arms' outer edges at rest. */
  arms: { left: 0.142, right: 0.858 },
  /** Centre of the contact shadow. */
  ground: 0.844,
} as const;

function webglLikely(): boolean {
  return typeof window !== 'undefined' && typeof WebGL2RenderingContext !== 'undefined';
}

/** Resolves to null when WebGL2 is unavailable or the renderer cannot start. */
export async function createMascot(opts: MascotOptions): Promise<Mascot | null> {
  if (!webglLikely()) return null;
  try {
    const { mountSnapper } = await import('./runtime');
    return await mountSnapper(opts);
  } catch {
    return null;
  }
}
