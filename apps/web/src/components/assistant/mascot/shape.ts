/**
 * Snapper's body: the app icon as a soft cushion. A superquadric, square from
 * the front with generous rounded corners (≈ the icon's 15/64 radius), a
 * pillowy front, a touch fuller at the bottom. No three.js here: plain maths
 * that the rig (geometry) and the runtime (framing) both read.
 *
 * Units: the body stands on y = 0 and is BODY_H tall; +z faces the viewer.
 *
 * The surface is the zero set of
 *
 *   F(x, y, z) = (|x / w(t)|^P + |z / d(t)|^P)^(Q / P) + |t|^Q - 1,
 *   t = (y - 0.5) / 0.5 (-1 bottom … 1 top),
 *
 * so the front silhouette is the superellipse |x|^Q + |t|^Q = 1 (the icon's
 * rounded square), the top view is a fatter |x|^P + |z|^P (the cushion), and
 * w(t), d(t) widen the bottom and puff out the middle of the face.
 *
 * GLSL note for anyone porting this to a shader: pow(x, y) is undefined for
 * x < 0 there; everything below takes |x| first.
 */

export const BODY_H = 1;
const HALF_W = 0.5;
const HALF_D = 0.29;
/** Front/side squareness (the icon's corners) and top-view squareness (the cushion). */
const Q = 4.6;
const P = 3;
/** > 0: wider at the bottom. */
const EGG = 0.035;
const EGG_Z = 0.05;
/** The face puffs out this much at mid-height. */
const PILLOW = 0.08;

const halfW = (t: number): number => HALF_W * (1 - EGG * t);
const halfD = (t: number): number => HALF_D * (1 - EGG_Z * t) * (1 + PILLOW * (1 - t * t));

/** The implicit body: < 0 inside, 0 on the surface, > 0 outside. */
export function field(x: number, y: number, z: number): number {
  const t = (y - BODY_H / 2) / (BODY_H / 2);
  const h = Math.pow(Math.abs(x) / halfW(t), P) + Math.pow(Math.abs(z) / halfD(t), P);
  return Math.pow(h, Q / P) + Math.pow(Math.abs(t), Q) - 1;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Outward unit normal at (x, y, z) (the field's gradient). */
export function normalAt(x: number, y: number, z: number, out: Vec3): Vec3 {
  const e = 1e-4;
  let nx = field(x + e, y, z) - field(x - e, y, z);
  let ny = field(x, y + e, z) - field(x, y - e, z);
  let nz = field(x, y, z + e) - field(x, y, z - e);
  const l = Math.hypot(nx, ny, nz) || 1;
  nx /= l;
  ny /= l;
  nz /= l;
  out.x = nx;
  out.y = ny;
  out.z = nz;
  return out;
}

/**
 * Where the ray from the body's centre along (dx, dy, dz) leaves the body.
 * The body is star-shaped about its centre, so a bisection always converges.
 */
export function castFromCentre(dx: number, dy: number, dz: number, out: Vec3): Vec3 {
  const l = Math.hypot(dx, dy, dz) || 1;
  const ux = dx / l;
  const uy = dy / l;
  const uz = dz / l;
  const cy = BODY_H / 2;
  let lo = 0;
  let hi = 1.2;
  for (let i = 0; i < 36; i++) {
    const m = (lo + hi) / 2;
    if (field(ux * m, cy + uy * m, uz * m) < 0) lo = m;
    else hi = m;
  }
  const s = (lo + hi) / 2;
  out.x = ux * s;
  out.y = cy + uy * s;
  out.z = uz * s;
  return out;
}

/** The front surface as a height field: z of the body at (x, y), 0 outside it. */
export function frontZ(x: number, y: number): number {
  const t = (y - BODY_H / 2) / (BODY_H / 2);
  const r = 1 - Math.pow(Math.abs(t), Q);
  if (r <= 0) return 0;
  const inner = Math.pow(r, P / Q) - Math.pow(Math.abs(x) / halfW(t), P);
  if (inner <= 0) return 0;
  return halfD(t) * Math.pow(inner, 1 / P);
}

/** Half-width of the body's silhouette at height y (on the z = 0 plane). */
export function sideX(y: number): number {
  const t = (y - BODY_H / 2) / (BODY_H / 2);
  const r = 1 - Math.pow(Math.abs(t), Q);
  return r <= 0 ? 0 : halfW(t) * Math.pow(r, 1 / Q);
}

/** Height of the body's top surface above (x, z). */
export function topY(x: number, z: number): number {
  let lo = BODY_H / 2;
  let hi = BODY_H;
  for (let i = 0; i < 30; i++) {
    const m = (lo + hi) / 2;
    if (field(x, m, z) < 0) lo = m;
    else hi = m;
  }
  return (lo + hi) / 2;
}

// ── The face: a docket plate on the front, and the features on it ─────────

/** The paper plate, in body units on the front (x half-width, y range). */
export const PLATE = { halfW: 0.315, top: 0.875, bottom: 0.185 };
/** Eyes (centres at ±x), mouth and cheeks, before the gaze slides them. */
export const EYE = { x: 0.138, y: 0.6, a: 0.079, b: 0.101, bulge: 0.022, reach: 1.14 };
export const MOUTH_SPOT = { x: 0, y: 0.432, a: 0.112, b: 0.07 };
export const CHEEK = { x: 0.215, y: 0.468, a: 0.064, b: 0.04 };
/** How far the face slides across the paper at full gaze (body units). */
export const GAZE_SLIDE = { x: 0.05, y: 0.034 };

/**
 * A patch laid on the front surface around (x, y): each vertex has a local
 * (u, v) in [-1, 1] (its `uv`), half-sizes (a, b), and is lifted off the
 * surface by `lift + bulge * dome(u, v)` so an eye can be a glossy lens.
 */
export interface PatchSpec {
  x: number;
  y: number;
  a: number;
  b: number;
  lift: number;
  bulge: number;
}

const tmpN: Vec3 = { x: 0, y: 0, z: 0 };

/** Writes positions (and, if given, surface normals) for a patch whose `uv` is set. */
export function layPatch(spec: PatchSpec, uv: ArrayLike<number>, pos: Float32Array, nrm?: Float32Array): void {
  const n = pos.length / 3;
  for (let i = 0; i < n; i++) {
    const u0 = uv[i * 2]! * 2 - 1;
    const v0 = uv[i * 2 + 1]! * 2 - 1;
    const x = spec.x + u0 * spec.a;
    const y = spec.y + v0 * spec.b;
    const z = frontZ(x, y);
    normalAt(x, y, z, tmpN);
    const rho2 = u0 * u0 + v0 * v0;
    const dome = rho2 < 1 ? Math.sqrt(1 - rho2) : 0;
    const off = spec.lift + spec.bulge * dome;
    pos[i * 3] = x + tmpN.x * off;
    pos[i * 3 + 1] = y + tmpN.y * off;
    pos[i * 3 + 2] = z + tmpN.z * off;
    if (nrm) {
      nrm[i * 3] = tmpN.x;
      nrm[i * 3 + 1] = tmpN.y;
      nrm[i * 3 + 2] = tmpN.z;
    }
  }
}

/** UVs (0..1) and indices for a polar disc patch reaching radius `reach` (> 1 for an AA margin). */
export function discTopology(rings: number, segs: number, reach: number): { uv: Float32Array; index: number[] } {
  const uv: number[] = [0.5, 0.5];
  for (let r = 1; r <= rings; r++) {
    // Rings bunch toward the rim, where the dome curves and the outline is drawn.
    const f = Math.sin(((r / rings) * Math.PI) / 2) * reach;
    for (let s = 0; s < segs; s++) {
      const a = (s / segs) * Math.PI * 2;
      uv.push(0.5 + 0.5 * f * Math.cos(a), 0.5 + 0.5 * f * Math.sin(a));
    }
  }
  const index: number[] = [];
  for (let s = 0; s < segs; s++) index.push(0, 1 + s, 1 + ((s + 1) % segs));
  for (let r = 1; r < rings; r++) {
    const a0 = 1 + (r - 1) * segs;
    const b0 = 1 + r * segs;
    for (let s = 0; s < segs; s++) {
      const s1 = (s + 1) % segs;
      index.push(a0 + s, b0 + s, b0 + s1, a0 + s, b0 + s1, a0 + s1);
    }
  }
  return { uv: new Float32Array(uv), index };
}

/** UVs and indices for a rectangular grid patch. */
export function gridTopology(nx: number, ny: number): { uv: Float32Array; index: number[] } {
  const uv: number[] = [];
  for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) uv.push(i / nx, j / ny);
  const index: number[] = [];
  const w = nx + 1;
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const a = j * w + i;
      index.push(a, a + 1, a + w + 1, a, a + w + 1, a + w);
    }
  }
  return { uv: new Float32Array(uv), index };
}
