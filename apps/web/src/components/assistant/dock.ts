/**
 * The mascot dock: ONE canvas that lives in a fixed element above everything
 * else in the widget and travels between two seats, the launcher's anchor
 * (small, Snapper's top breaking above the orb's rim) and the panel header's
 * stage (large on the welcome screen, small once the conversation starts).
 *
 * The dock never lives inside the panel or the launcher, so it is never clipped
 * and never re-parented (which would lose the WebGL context). Its position is
 * always derived from a seat's live bounding box, so it follows the panel's own
 * open/close scale, the header's height transition and a resized window
 * without a second source of truth. `fly()` is the FLIP: it interpolates from
 * one seat's live box to another's, on an ease-out curve, with a slight arc.
 *
 * Before the 3D mascot exists (or when it never does: no WebGL, reduced motion,
 * data saver, a missing chunk) the dock carries the launcher's own poster art
 * with CSS-only life, so the seat is never empty. If even the poster is
 * missing, a CSS-drawn Snapper in the brand gradient (the "seed") shows.
 *
 * Only `createMascot` is imported dynamically: three.js stays out of every
 * chunk that loads before the mascot does (docs/ASSISTANT.md §10).
 */
import { MASCOT_FRAME, type Mascot, type MascotMood } from './mascot';

const SIZE = 160;
const html = document.documentElement;

const POSTER_SMALL = '/assistant/snapper-poster-160.webp';
const POSTER_BIG = '/assistant/snapper-poster.webp';
const POSTER_HAPPY = '/assistant/snapper-happy.webp';

let el: HTMLElement | null = null;
let bob: HTMLElement | null = null;
let art: HTMLElement | null = null;
let poster: HTMLImageElement | null = null;
let rootEl: HTMLElement | null = null;
let homeAnchor: HTMLElement | null = null;
let anchor: HTMLElement | null = null;
let mascot: Mascot | null = null;
let flying = false;
let tracking = 0;
let inView = true;
let reduced = false;
let booted: Promise<void> | undefined;
let disposed = false;
let curMood: MascotMood = 'idle';
let happyTimer = 0;
const offs: (() => void)[] = [];

/** An ease-out curve as a function (the CSS token cannot be sampled). */
function bezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  return (t) => {
    let s = t;
    for (let i = 0; i < 8; i++) {
      const x = ((ax * s + bx) * s + cx) * s - t;
      const d = (3 * ax * s + 2 * bx) * s + cx;
      if (Math.abs(x) < 1e-5 || Math.abs(d) < 1e-6) break;
      s -= x / d;
    }
    s = Math.min(1, Math.max(0, s));
    return ((ay * s + by) * s + cy) * s;
  };
}
const ease = bezier(0.22, 0.61, 0.36, 1);

interface Box {
  cx: number;
  cy: number;
  k: number;
}

function boxOf(a: HTMLElement): Box {
  const r = a.getBoundingClientRect();
  return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, k: r.width / SIZE };
}

function place(b: Box): void {
  if (!el) return;
  el.style.transform = `translate3d(${(b.cx - SIZE / 2).toFixed(2)}px, ${(b.cy - SIZE / 2).toFixed(2)}px, 0) scale(${b.k.toFixed(4)})`;
}

/* ---- the mascot's frame ---- */

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});

/**
 * Where Snapper sits in its square canvas, as fractions from the top: the
 * body's centre (which lands on the orb's centre), the highest point of the
 * viewfinder brackets (which breaks above the rim; the shutter's tip when there
 * are no brackets) and the body's width (which must stay inside the orb). Read
 * defensively: the frame is the mascot's to define (docs/ASSISTANT.md §11).
 */
function frame(): { fy: number; top: number; bodyW: number | undefined } {
  const f = rec(MASCOT_FRAME);
  const body = rec(f.body);
  const bt = num(body.top);
  const bb = num(body.bottom);
  const bl = num(body.left);
  const br = num(body.right);
  const fy = num(body.centreY) ?? num(body.centerY) ?? (bt !== undefined && bb !== undefined ? (bt + bb) / 2 : 0.52);
  const tip = num(f.top) ?? num(rec(f.top).y) ?? num(f.shutterTop) ?? num(f.sproutTop);
  const rim = num(rec(f.brackets).top) ?? tip ?? fy - 0.36;
  return { fy, top: Math.min(rim, fy - 0.1), bodyW: bl !== undefined && br !== undefined ? br - bl : undefined };
}

/**
 * Fit the mascot to its seats: the body's centre sits on the orb's centre, the
 * brackets clear the rim by about 6% of the orb, and the body never grows past
 * 92% of it. The header's stage reads the same variables in CSS.
 */
function fit(): void {
  const orb = rootEl?.querySelector<HTMLElement>('.sa-orb');
  if (!rootEl || !orb) return;
  const { fy, top, bodyW } = frame();
  const d = orb.offsetWidth;
  let side = (d * 0.56) / (fy - top);
  if (bodyW) side = Math.min(side, (d * 0.92) / bodyW);
  rootEl.style.setProperty('--sa-fy', fy.toFixed(3));
  rootEl.style.setProperty('--sa-top', top.toFixed(3));
  rootEl.style.setProperty('--sa-k', (side / SIZE).toFixed(3));
}

/** Snap the dock onto its current seat (resize, a finished transition). */
export function sync(): void {
  if (disposed) return;
  fit();
  if (!anchor || flying) return;
  const b = boxOf(anchor);
  if (b.k > 0) place(b);
}

/** Keep following the seat for `ms` (its own layout is transitioning). */
export function track(ms: number): void {
  if (disposed) return;
  const until = performance.now() + ms;
  if (tracking > until) return;
  tracking = until;
  const step = (): void => {
    if (disposed) return;
    sync();
    if (performance.now() < tracking) requestAnimationFrame(step);
    else {
      tracking = 0;
      sync();
    }
  };
  requestAnimationFrame(step);
}

/** The poster for a seat: the 160 px one on the launcher, the full one up in the header. */
function basePoster(): string {
  return anchor === homeAnchor ? POSTER_SMALL : POSTER_BIG;
}

/** Swap the poster pose. The new image is fetched first, so a missing file never blanks the seat. */
function showPoster(src: string): void {
  if (!poster || poster.src.endsWith(src)) return;
  const next = new Image();
  next.onload = () => {
    if (poster) poster.src = src;
  };
  next.src = src;
}

function seat(a: HTMLElement | null): void {
  anchor = a;
  el?.classList.toggle('is-home', a === homeAnchor);
  rootEl?.classList.toggle('sa-away', a !== homeAnchor);
  if (poster && !mascot && !happyTimer) showPoster(basePoster());
}

/** Put the dock on `a` without travelling. */
export function attach(a: HTMLElement | null): void {
  if (!el || !a) return;
  seat(a);
  const b = boxOf(a);
  if (b.k > 0) place(b);
}

/**
 * Travel to `to`. With `from` the start follows that element's live box (the
 * panel closing around it); otherwise it starts where the dock is.
 */
export function fly(to: HTMLElement, o: { ms?: number; from?: HTMLElement | null; arc?: number } = {}): Promise<void> {
  if (!el) return Promise.resolve();
  if (reduced || !(o.ms ?? 1)) {
    attach(to);
    return Promise.resolve();
  }
  const ms = o.ms ?? 560;
  const arc = o.arc ?? 26;
  const start = o.from ?? anchor;
  const t0 = start ? boxOf(start) : boxOf(to);
  let last = t0;
  const t = performance.now();
  flying = true;
  el.classList.add('is-fly');
  seat(to);

  return new Promise((done) => {
    const frameFn = (now: number): void => {
      if (disposed) return done();
      const u = Math.min(1, (now - t) / ms);
      const p = ease(u);
      const a = o.from && u < 1 ? boxOf(o.from) : last;
      last = a;
      const b = boxOf(to);
      const lift = Math.sin(Math.PI * p);
      place({
        cx: a.cx + (b.cx - a.cx) * p,
        cy: a.cy + (b.cy - a.cy) * p - lift * arc,
        k: (a.k + (b.k - a.k) * p) * (1 + 0.05 * lift),
      });
      if (u < 1) requestAnimationFrame(frameFn);
      else {
        flying = false;
        el?.classList.remove('is-fly');
        sync();
        done();
      }
    };
    requestAnimationFrame(frameFn);
  });
}

/* ---- mood and motion: forwarded to the mascot, mirrored for the poster ---- */

let pulseTimer = 0;
const PULSES = ['is-hop', 'is-wave', 'is-snap', 'is-dizzy'];
function pulse(cls: string, ms: number): void {
  if (!el || reduced) return;
  el.classList.remove(...PULSES);
  void el.offsetWidth;
  el.classList.add(cls);
  clearTimeout(pulseTimer);
  pulseTimer = window.setTimeout(() => el?.classList.remove(cls), ms);
}

export const mood = (m: MascotMood): void => {
  curMood = m;
  if (el) el.dataset.mood = m;
  mascot?.setMood(m);
  // Without the 3D mascot the happy pose is a second poster, held for the length of the real one.
  if (!mascot && poster) {
    clearTimeout(happyTimer);
    happyTimer = 0;
    if (m === 'happy') {
      showPoster(POSTER_HAPPY);
      happyTimer = window.setTimeout(() => {
        happyTimer = 0;
        showPoster(basePoster());
      }, 2800);
    } else showPoster(basePoster());
  }
};
export const moodNow = (): MascotMood => curMood;
export const nod = (): void => mascot?.nod();
export const speak = (level: number): void => mascot?.speak(level);
export const hop = (): void => {
  mascot?.hop();
  pulse('is-hop', 700);
};
export const wave = (): void => {
  mascot?.wave();
  pulse('is-wave', 1100);
};
/** The shutter clicks and a white flash (CSS flash stands in when there is no canvas). */
export const snap = (): void => {
  mascot?.snap();
  pulse('is-snap', 600);
};
/** Three quick pokes. */
export const dizzy = (): void => {
  mascot?.dizzy();
  pulse('is-dizzy', 1300);
};
export const look = (x: number | null, y: number | null): void => mascot?.lookAt(x, y);

/** Render only while the dock is on screen, the tab is visible and the launcher has not stepped aside. */
function applyActive(): void {
  const aside = html.classList.contains('sa-yield') && !rootEl?.classList.contains('sa-open');
  mascot?.setActive(!document.hidden && inView && !aside);
}

function on<K extends keyof WindowEventMap>(t: K, fn: (e: WindowEventMap[K]) => void, o?: AddEventListenerOptions): void {
  window.addEventListener(t, fn, o);
  offs.push(() => window.removeEventListener(t, fn, o));
}

function wire(): void {
  if (!el) return;
  const io = new IntersectionObserver((e) => {
    inView = e[e.length - 1]?.isIntersecting ?? true;
    applyActive();
  });
  io.observe(el);
  document.addEventListener('visibilitychange', applyActive);
  const mo = new MutationObserver(applyActive);
  mo.observe(html, { attributes: true, attributeFilter: ['class'] });
  if (rootEl) mo.observe(rootEl, { attributes: true, attributeFilter: ['class'] });
  on('resize', sync, { passive: true });
  const vv = window.visualViewport;
  vv?.addEventListener('resize', sync, { passive: true });
  offs.push(() => {
    io.disconnect();
    mo.disconnect();
    document.removeEventListener('visibilitychange', applyActive);
    vv?.removeEventListener('resize', sync);
  });
}

/** The mascot follows the pointer (throttled to a frame), and goes back to the viewer when it leaves. */
function wireMascotInput(): void {
  let px: number | null = null;
  let py: number | null = null;
  let queued = false;
  const send = (): void => {
    queued = false;
    mascot?.lookAt(px, py);
  };
  on(
    'pointermove',
    (e) => {
      if (e.pointerType === 'touch') return;
      px = e.clientX;
      py = e.clientY;
      if (!queued) {
        queued = true;
        requestAnimationFrame(send);
      }
    },
    { passive: true },
  );
  const leave = (): void => {
    px = py = null;
    send();
  };
  html.addEventListener('pointerleave', leave);
  offs.push(() => html.removeEventListener('pointerleave', leave));
}

function mascotAllowed(): boolean {
  const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  if (reduced || conn?.saveData) return false;
  try {
    const c = document.createElement('canvas');
    const gl = (c.getContext('webgl2') ?? c.getContext('webgl')) as WebGLRenderingContext | null;
    if (!gl) return false;
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch {
    return false;
  }
}

/**
 * Create the dock on the launcher. Idempotent. The 3D mascot is skipped (the
 * poster stays) on data saver, reduced motion and when WebGL is missing.
 */
export function start(root: HTMLElement, home: HTMLElement): Promise<void> {
  booted ??= (async () => {
    disposed = false;
    reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    rootEl = root;
    homeAnchor = home;
    el = document.createElement('div');
    el.className = 'sa-dock is-home';
    el.setAttribute('aria-hidden', 'true');
    bob = document.createElement('div');
    bob.className = 'sa-bob';
    el.appendChild(bob);
    // The poster art the launcher shipped with moves in: one drawing, never two.
    art = root.querySelector<HTMLElement>('.sa-art');
    poster = art?.querySelector<HTMLImageElement>('.sa-poster') ?? null;
    if (art) bob.appendChild(art);
    root.appendChild(el);
    seat(home);
    fit();
    place(boxOf(home));
    wire();

    if (!mascotAllowed()) return;
    try {
      const { createMascot } = await import('./mascot');
      if (disposed) return;
      const m = await createMascot({ size: SIZE, reducedMotion: reduced });
      if (!m) return;
      if (disposed) {
        m.dispose();
        return;
      }
      mascot = m;
      const c = m.canvas;
      c.className = 'sa-canvas';
      c.setAttribute('aria-hidden', 'true');
      c.style.width = `${SIZE}px`;
      c.style.height = `${SIZE}px`;
      bob.appendChild(c);
      el.classList.add('has-3d');
      m.setMood(curMood);
      applyActive();
      wireMascotInput();
      // Hold the poster until the canvas has drawn its first frame, then cross-fade.
      const gone = art;
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          c.classList.add('is-ready');
          gone?.classList.add('is-gone');
          window.setTimeout(() => gone?.remove(), 420);
        }),
      );
      art = null;
      poster = null;
    } catch {
      /* the poster stays */
    }
  })();
  return booted;
}

/** Tear everything down: listeners, the GPU context, the element. Safe to call twice. */
export function dispose(): void {
  disposed = true;
  offs.splice(0).forEach((f) => f());
  clearTimeout(pulseTimer);
  clearTimeout(happyTimer);
  happyTimer = 0;
  mascot?.dispose();
  mascot = null;
  el?.remove();
  el = bob = art = anchor = homeAnchor = rootEl = null;
  poster = null;
  flying = false;
  tracking = 0;
  booted = undefined;
}

export const isStarted = (): boolean => el !== null;
export const element = (): HTMLElement | null => el;
