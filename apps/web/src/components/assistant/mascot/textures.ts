/**
 * The few small textures Snapper needs, drawn on canvases at start-up (no
 * downloads): the docket plate and its shadow, the cheeks, the contact shadow,
 * the thinking dots, the sparkle, the flash, the scan line, and the mouth,
 * which is redrawn as it moves.
 */
import { CanvasTexture, LinearMipmapLinearFilter, SRGBColorSpace } from 'three';
import { BLUSH, MOUTH, PAPER } from './palette';

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  if (!g) throw new Error('2d canvas unavailable');
  return [c, g];
}

function texture(c: HTMLCanvasElement, srgb = true): CanvasTexture {
  const t = new CanvasTexture(c);
  if (srgb) t.colorSpace = SRGBColorSpace;
  t.minFilter = LinearMipmapLinearFilter;
  t.anisotropy = 4;
  return t;
}

/** A tiny seeded random, so the torn edge is the same in every render and the posters. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Plate canvas size; its aspect matches the plate's (0.63 × 0.69 body units). */
export const PLATE_PX = { w: 256, h: 280 };

/**
 * The docket's outline: rounded top corners, straight sides, a torn zig-zag
 * bottom. `inset` shrinks it (px) and `dy` moves it down, for the shadow.
 */
function docketPath(g: CanvasRenderingContext2D, inset: number, dy: number): void {
  const { w, h } = PLATE_PX;
  const l = inset;
  const r = w - inset;
  const top = inset + dy;
  const rad = 34;
  const tooth = 15; // depth of the torn teeth
  const base = h - inset - tooth + dy;
  const teeth = 9;
  const rand = rng(7);
  g.beginPath();
  g.moveTo(l, base);
  g.lineTo(l, top + rad);
  g.quadraticCurveTo(l, top, l + rad, top);
  g.lineTo(r - rad, top);
  g.quadraticCurveTo(r, top, r, top + rad);
  g.lineTo(r, base);
  // Torn edge, right to left: uneven teeth, slightly ragged peaks.
  const step = (r - l) / teeth;
  for (let i = teeth - 1; i >= 0; i--) {
    const x0 = l + i * step;
    const jitter = (rand() - 0.5) * step * 0.22;
    const deep = tooth * (0.7 + rand() * 0.3);
    g.lineTo(x0 + step / 2 + jitter, base + deep);
    g.lineTo(x0, base + (rand() - 0.5) * 3);
  }
  g.closePath();
}

/** The paper: off-white, faint printed rules, a few printed lines, a torn bottom. */
export function plateTexture(): CanvasTexture {
  const { w, h } = PLATE_PX;
  const [c, g] = canvas(w, h);
  docketPath(g, 2, 0);
  g.save();
  g.clip();
  const sheet = g.createLinearGradient(0, 0, 0, h);
  sheet.addColorStop(0, PAPER.sheet);
  sheet.addColorStop(0.75, PAPER.sheet);
  sheet.addColorStop(1, PAPER.shade);
  g.fillStyle = sheet;
  g.fillRect(0, 0, w, h);

  // A perforation row near the top, like the head of a till roll.
  g.fillStyle = PAPER.ruleStrong;
  for (let x = 26; x < w - 20; x += 12) {
    g.beginPath();
    g.arc(x, 22, 2.1, 0, Math.PI * 2);
    g.fill();
  }
  // Faint printed rules across the sheet.
  g.strokeStyle = PAPER.rule;
  g.lineWidth = 2;
  for (let y = 48; y < 200; y += 25) {
    g.beginPath();
    g.moveTo(14, y);
    g.lineTo(w - 14, y);
    g.stroke();
  }
  // Printed lines at the foot of the docket: items left, a total right.
  g.fillStyle = PAPER.print;
  const bar = (x: number, y: number, bw: number) => {
    g.beginPath();
    g.roundRect(x, y, bw, 7, 3.5);
    g.fill();
  };
  bar(26, 218, 66);
  bar(w - 26 - 38, 218, 38);
  bar(26, 232, 44);
  g.fillStyle = 'rgba(11, 17, 26, 0.15)';
  bar(w - 26 - 52, 232, 52);
  g.strokeStyle = PAPER.ruleStrong;
  g.setLineDash([5, 5]);
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(22, 209);
  g.lineTo(w - 22, 209);
  g.stroke();
  g.setLineDash([]);

  // The paper's edge catches a little shade, so it reads as a sheet, not a decal.
  g.restore();
  docketPath(g, 2, 0);
  g.strokeStyle = 'rgba(120, 110, 90, 0.22)';
  g.lineWidth = 2.5;
  g.stroke();
  return texture(c);
}

/** A soft shadow of the docket, cast down onto the cushion. */
export function plateShadowTexture(): CanvasTexture {
  const { w, h } = PLATE_PX;
  const [c, g] = canvas(w, h);
  // Blurred with shadowBlur (canvas `filter` is not everywhere): the shape is
  // drawn off-canvas and only its shadow is offset back into view.
  const off = w * 2;
  g.save();
  g.translate(-off, 0);
  g.shadowColor = 'rgba(2, 22, 60, 0.85)';
  g.shadowBlur = 14;
  g.shadowOffsetX = off;
  docketPath(g, 14, 6);
  g.fillStyle = '#000';
  g.fill();
  g.restore();
  return texture(c);
}

export function blushTexture(): CanvasTexture {
  const [c, g] = canvas(64, 64);
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, BLUSH);
  r.addColorStop(0.45, BLUSH.replace(', 1)', ', 0.5)'));
  r.addColorStop(1, BLUSH.replace(', 1)', ', 0)'));
  g.fillStyle = r;
  g.fillRect(0, 0, 64, 64);
  return texture(c);
}

export function shadowTexture(): CanvasTexture {
  const [c, g] = canvas(128, 128);
  const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  r.addColorStop(0, 'rgba(6, 26, 64, 0.55)');
  r.addColorStop(0.35, 'rgba(6, 26, 64, 0.3)');
  r.addColorStop(0.65, 'rgba(6, 26, 64, 0.07)');
  r.addColorStop(0.9, 'rgba(6, 26, 64, 0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 128, 128);
  return texture(c);
}

/** A small glowing dot. White dots get a blue-grey underside so they read on white. */
export function orbTexture(colour: string): CanvasTexture {
  const S = 64;
  const [c, g] = canvas(S, S);
  const white = colour.toUpperCase() === '#FFFFFF';
  const glowColour = white ? '#7FD8FF' : colour;
  const glow = g.createRadialGradient(32, 32, 8, 32, 32, 32);
  glow.addColorStop(0, hexA(glowColour, 0.42));
  glow.addColorStop(1, hexA(glowColour, 0));
  g.fillStyle = glow;
  g.fillRect(0, 0, S, S);
  const ball = g.createRadialGradient(27, 26, 1, 32, 32, 13);
  ball.addColorStop(0, '#ffffff');
  ball.addColorStop(0.3, mix(colour, '#ffffff', 0.35));
  ball.addColorStop(0.8, colour);
  ball.addColorStop(1, white ? '#B9D3EA' : mix(colour, '#000000', 0.25));
  g.fillStyle = ball;
  g.beginPath();
  g.arc(32, 32, 12.5, 0, Math.PI * 2);
  g.fill();
  return texture(c);
}

export function sparkleTexture(): CanvasTexture {
  const S = 64;
  const [c, g] = canvas(S, S);
  const glow = g.createRadialGradient(32, 32, 0, 32, 32, 30);
  glow.addColorStop(0, 'rgba(225, 248, 255, 0.9)');
  glow.addColorStop(0.25, 'rgba(63, 198, 238, 0.35)');
  glow.addColorStop(1, 'rgba(63, 198, 238, 0)');
  g.fillStyle = glow;
  g.fillRect(0, 0, S, S);
  g.fillStyle = '#ffffff';
  // A four-point star with concave sides: each side bows through the centre.
  const tip = (i: number): [number, number] => {
    const a = (i * Math.PI) / 2 - Math.PI / 2;
    return [32 + Math.cos(a) * 29, 32 + Math.sin(a) * 29];
  };
  g.beginPath();
  g.moveTo(...tip(0));
  for (let i = 1; i <= 4; i++) g.quadraticCurveTo(32, 32, ...tip(i % 4));
  g.closePath();
  g.fill();
  return texture(c);
}

/** The camera flash: a hot white core, a soft halo and six thin rays. */
export function flashTexture(): CanvasTexture {
  const S = 128;
  const [c, g] = canvas(S, S);
  const halo = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  halo.addColorStop(0, 'rgba(255, 255, 255, 1)');
  halo.addColorStop(0.16, 'rgba(255, 255, 255, 0.95)');
  halo.addColorStop(0.4, 'rgba(127, 216, 255, 0.4)');
  halo.addColorStop(1, 'rgba(127, 216, 255, 0)');
  g.fillStyle = halo;
  g.fillRect(0, 0, S, S);
  // Rays fade from white to the scan cyan, so the flash still reads on a white page.
  const rays = g.createRadialGradient(64, 64, 6, 64, 64, 62);
  rays.addColorStop(0, 'rgba(255, 255, 255, 1)');
  rays.addColorStop(0.45, 'rgba(160, 228, 250, 0.95)');
  rays.addColorStop(1, 'rgba(63, 198, 238, 0.85)');
  g.fillStyle = rays;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.26;
    const len = i % 2 === 0 ? 62 : 44;
    g.beginPath();
    g.moveTo(64 + Math.cos(a) * len, 64 + Math.sin(a) * len);
    g.lineTo(64 + Math.cos(a + 1.5708) * 3.2, 64 + Math.sin(a + 1.5708) * 3.2);
    g.lineTo(64 + Math.cos(a - 1.5708) * 3.2, 64 + Math.sin(a - 1.5708) * 3.2);
    g.closePath();
    g.fill();
  }
  return texture(c);
}

/**
 * The scan line: a bright core with a glow trailing above it (it sweeps down),
 * fading out at both ends. White on transparent; the material tints it cyan.
 */
export function scanTexture(): CanvasTexture {
  const W = 128;
  const H = 64;
  const [c, g] = canvas(W, H);
  const core = 40; // canvas row of the line (texture v ≈ 0.375 from the bottom)
  const v = g.createLinearGradient(0, 0, 0, H);
  v.addColorStop(0, 'rgba(255,255,255,0)');
  v.addColorStop(0.42, 'rgba(255,255,255,0.16)');
  v.addColorStop(core / H - 0.06, 'rgba(255,255,255,0.5)');
  v.addColorStop(core / H, 'rgba(255,255,255,1)');
  v.addColorStop(core / H + 0.07, 'rgba(255,255,255,0.32)');
  v.addColorStop(core / H + 0.18, 'rgba(255,255,255,0)');
  v.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = v;
  g.fillRect(0, 0, W, H);
  // Fade the ends.
  g.globalCompositeOperation = 'destination-in';
  const hz = g.createLinearGradient(0, 0, W, 0);
  hz.addColorStop(0, 'rgba(0,0,0,0)');
  hz.addColorStop(0.12, 'rgba(0,0,0,1)');
  hz.addColorStop(0.88, 'rgba(0,0,0,1)');
  hz.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = hz;
  g.fillRect(0, 0, W, H);
  g.globalCompositeOperation = 'source-over';
  return texture(c);
}

/**
 * The mouth, drawn as a curve that can smile, frown, open and round into an
 * "o". Redrawn only when its shape changes by a visible amount.
 */
export class MouthPainter {
  readonly texture: CanvasTexture;
  private readonly g: CanvasRenderingContext2D;
  private key = '';
  static readonly W = 128;
  static readonly H = 80;

  constructor() {
    const [c, g] = canvas(MouthPainter.W, MouthPainter.H);
    this.g = g;
    this.texture = texture(c);
  }

  draw(smile: number, open: number, o: number): void {
    const q = (v: number) => Math.round(v * 48);
    const key = `${q(smile)}|${q(open)}|${q(o)}`;
    if (key === this.key) return;
    this.key = key;
    const g = this.g;
    const W = MouthPainter.W;
    const H = MouthPainter.H;
    g.clearRect(0, 0, W, H);
    const cx = W / 2;
    const cy = H * 0.34;
    const half = (24 - 13 * o) * (1 + 0.12 * open);
    const curve = smile * 8 * (1 - o); // + : corners up
    const N = 28;
    const top: Array<[number, number]> = [];
    const bot: Array<[number, number]> = [];
    for (let i = 0; i <= N; i++) {
      const u = (i / N) * 2 - 1;
      const ex = Math.sqrt(Math.max(0, 1 - u * u));
      const base = cy + curve * (1 - u * u) - curve * 0.35;
      const x = cx + u * half;
      top.push([x, base - o * 9 * ex - open * 2.5 * ex]);
      bot.push([x, base + o * 9 * ex + open * (22 + 6 * Math.max(0, smile)) * Math.pow(ex, 0.8)]);
    }
    g.beginPath();
    g.moveTo(top[0]![0], top[0]![1]);
    for (const [x, y] of top) g.lineTo(x, y);
    for (let i = bot.length - 1; i >= 0; i--) g.lineTo(bot[i]![0], bot[i]![1]);
    g.closePath();
    if (open + o > 0.02) {
      g.fillStyle = MOUTH.inside;
      g.fill();
      if (open > 0.08) {
        g.save();
        g.clip();
        g.fillStyle = MOUTH.tongue;
        const ty = bot[N / 2]![1];
        g.beginPath();
        g.ellipse(cx, ty + 2, half * 0.62, 6 + open * 9, 0, 0, Math.PI * 2);
        g.fill();
        g.restore();
      }
    }
    g.lineJoin = 'round';
    g.lineCap = 'round';
    g.strokeStyle = MOUTH.line;
    g.lineWidth = 7;
    g.stroke();
    this.texture.needsUpdate = true;
  }
}

function hexA(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function mix(a: string, b: string, t: number): string {
  const x = parseInt(a.slice(1), 16);
  const y = parseInt(b.slice(1), 16);
  const ch = (s: number) => Math.round(((x >> s) & 255) * (1 - t) + ((y >> s) & 255) * t);
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
}
