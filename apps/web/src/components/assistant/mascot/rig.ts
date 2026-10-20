/**
 * Snapper's body, face, brackets, shutter and arms: procedural geometry,
 * glossy materials, and `apply(pose)`, which places everything for one frame.
 *
 * Hierarchy (pivots matter for squash and stretch):
 *   stage ─ contact shadow, sparkles
 *         └ float (bob, hop) ─ thinking dots ring, viewfinder brackets
 *             └ tilt (bottom pivot: rock, lean, wobble)
 *                 └ squash (bottom pivot: scale)
 *                     └ turn (centre pivot: yaw, nod, the dizzy spin)
 *                         └ body: cushion, docket plate, face, arms, shutter, flash
 *
 * The brackets hang in `float`, not in `turn`: they are the viewfinder Snapper
 * stands in, so they bob and hop with it but do not turn when it looks around.
 */
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CapsuleGeometry,
  Color,
  CylinderGeometry,
  DynamicDrawUsage,
  Group,
  LatheGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Sprite,
  SpriteMaterial,
  Vector2,
  type Material,
  type Texture,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import type { Pose } from './motion';
import { BLUE, BRACKET, DOT_COLOURS, INK, SCAN, SHUTTER, SPARK_TINTS } from './palette';
import {
  BODY_H,
  castFromCentre,
  CHEEK,
  discTopology,
  EYE,
  GAZE_SLIDE,
  gridTopology,
  layPatch,
  MOUTH_SPOT,
  normalAt,
  PLATE,
  sideX,
  topY,
  type PatchSpec,
  type Vec3,
} from './shape';
import {
  blushTexture,
  flashTexture,
  MouthPainter,
  orbTexture,
  plateShadowTexture,
  plateTexture,
  scanTexture,
  shadowTexture,
  sparkleTexture,
} from './textures';

/** The gap between the body and its contact shadow while it hovers (the bottom brackets fit in it). */
export const HOVER = 0.12;
/** Viewfinder brackets: corner distance from the body's centre (x and y), arm length, tube radius, depth. */
export const BRACKETS = { reach: 0.575, arm: 0.15, radius: 0.027, z: 0.06 };
/** The shutter button on top, right of centre like a camera's. */
export const SHUTTER_SPOT = { x: 0.2, z: -0.02, capH: 0.064, lift: 0.014 };
/** Arms sit on the flat sides, a little below the middle. */
const ARM = { y: 0.37, rest: 0.5, radius: 0.066, length: 0.085, inset: 0.022 };
const DOT_RING = { y: 0.5, radius: 0.7, tiltX: 0.36, tiltZ: -0.14, size: 0.13 };
/** Lifts off the surface, in drawing order: plate shadow, plate, cheeks, mouth, eyes, scan. */
const LIFT = { shadow: 0.0012, plate: 0.0025, cheek: 0.0035, mouth: 0.0042, eye: 0.0055, scan: 0.034 };

export interface Rig {
  readonly stage: Group;
  apply(p: Pose): void;
  burst(): void;
  /** Advances particles; returns true while any are alive. */
  tick(dt: number): boolean;
  /** Shows the normally hidden dots, sparkles, scan line and flash so they compile up front. */
  revealAll(on: boolean): void;
  readonly materials: Material[];
  dispose(): void;
}

type Uniform<T> = { value: T };

/** A cyan fresnel glow at the silhouette, so the cushion holds its edge on a dark page. */
function addRim(mat: MeshPhysicalMaterial, colour: Color, power: number): void {
  const uRim: Uniform<Color> = { value: colour };
  const uRimPow: Uniform<number> = { value: power };
  mat.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    shader.uniforms.uRim = uRim;
    shader.uniforms.uRimPow = uRimPow;
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', 'uniform vec3 uRim;\nuniform float uRimPow;\nvoid main() {')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        float rimNV = clamp( dot( normal, normalize( vViewPosition ) ), 0.0, 1.0 );
        totalEmissiveRadiance += uRim * pow( 1.0 - rimNV, uRimPow );`,
      );
  };
  mat.customProgramCacheKey = () => 'snapper-rim';
}

/**
 * White parts (brackets, shutter cap) tint toward pale blue at grazing angles,
 * so their outline still reads on a white page.
 */
function addEdgeTint(mat: MeshPhysicalMaterial, tint: Color): void {
  const uEdge: Uniform<Color> = { value: tint };
  mat.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    shader.uniforms.uEdge = uEdge;
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', 'uniform vec3 uEdge;\nvoid main() {')
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        float edgeNV = clamp( dot( normal, normalize( vViewPosition ) ), 0.0, 1.0 );
        float edgeK = 1.0 - edgeNV;
        diffuseColor.rgb *= mix( vec3( 1.0 ), uEdge, edgeK * edgeK );`,
      );
  };
  mat.customProgramCacheKey = () => 'snapper-edge';
}

interface EyeUniforms {
  uOpen: Uniform<number>;
  uHappy: Uniform<number>;
  uSad: Uniform<number>;
  uSide: Uniform<number>;
  uGlint: Uniform<number>;
  uSwirl: Uniform<number>;
  uSwirlSpin: Uniform<number>;
}

/**
 * The eye: a glossy ink lens whose lids, smile, spiral and catch-lights are
 * drawn in its own shader, so blinking, ^ ^, sad and dizzy eyes morph continuously.
 */
function eyeMaterial(side: number): [MeshPhysicalMaterial, EyeUniforms] {
  const u: EyeUniforms = {
    uOpen: { value: 1 },
    uHappy: { value: 0 },
    uSad: { value: 0 },
    uSide: { value: side },
    uGlint: { value: 1 },
    uSwirl: { value: 0 },
    uSwirlSpin: { value: 0 },
  };
  const mat = new MeshPhysicalMaterial({
    color: INK,
    roughness: 0.2,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.04,
    transparent: true,
  });
  mat.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', 'varying vec2 vFace;\nvoid main() {')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\n\tvFace = uv;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        'void main() {',
        'varying vec2 vFace;\nuniform float uOpen;\nuniform float uHappy;\nuniform float uSad;\nuniform float uSide;\nuniform float uGlint;\nuniform float uSwirl;\nuniform float uSwirlSpin;\nvoid main() {',
      )
      .replace(
        '#include <dithering_fragment>',
        `#include <dithering_fragment>
        vec2 p = ( vFace - 0.5 ) * 2.0;
        float fw = max( fwidth( p.x ), fwidth( p.y ) ) * 0.85;
        float rr = length( p );
        float inside = 1.0 - smoothstep( 1.0 - fw, 1.0 + fw, rr );
        float xo = p.x * uSide;
        float shut = 1.0 - uOpen;
        float meetY = -0.2 - 0.14 * ( 1.0 - p.x * p.x );
        float topOpen = 1.3 - uSad * ( 0.5 + 0.38 * xo );
        float botOpen = mix( -1.3, 0.6 - 0.66 * p.x * p.x, uHappy );
        float lidTop = mix( topOpen, meetY, shut );
        float lidBot = mix( botOpen, meetY, shut );
        float vis = smoothstep( lidBot - fw, lidBot + fw, p.y ) * ( 1.0 - smoothstep( lidTop - fw, lidTop + fw, p.y ) );
        float lash = ( 1.0 - smoothstep( 0.08 - fw, 0.08 + fw, abs( p.y - meetY ) ) )
          * smoothstep( 0.7, 1.0, shut ) * ( 1.0 - smoothstep( 0.9 - fw, 0.9 + fw, abs( p.x ) ) );
        // A blue sheen low in the eye, as if the paper and the cushion were reflected in it.
        gl_FragColor.rgb = mix( gl_FragColor.rgb, vec3( 0.09, 0.27, 0.55 ), 0.5 * smoothstep( 0.1, -1.0, p.y ) * ( 1.0 - uHappy ) * ( 1.0 - uSwirl ) );
        // Dizzy: an ink spiral, mirrored left to right, turning.
        float ang = atan( p.y, xo );
        float ph = rr * 2.4 - ( ang + uSwirlSpin ) * 0.1591549;
        float sd = abs( fract( ph ) - 0.5 );
        float sw = fw * 2.4;
        float spiral = 1.0 - smoothstep( 0.2 - sw, 0.2 + sw, sd );
        spiral = max( spiral, 1.0 - smoothstep( 0.17 - fw, 0.17 + fw, rr ) );
        vec2 c1 = ( p - vec2( -0.3 * uSide, 0.38 ) ) * vec2( 1.0, 0.88 );
        vec2 c2 = p - vec2( 0.34 * uSide, -0.36 );
        float glint = max( 1.0 - smoothstep( 0.25 - fw, 0.25 + fw, length( c1 ) ),
                           1.0 - smoothstep( 0.115 - fw, 0.115 + fw, length( c2 ) ) );
        gl_FragColor.rgb = mix( gl_FragColor.rgb, vec3( 1.0 ), glint * uGlint * vis * ( 1.0 - uSwirl ) );
        gl_FragColor.a = inside * mix( max( vis, lash ), spiral, uSwirl );`,
      );
  };
  mat.customProgramCacheKey = () => 'snapper-eye';
  return [mat, u];
}

/** A patch that hugs the front of the body (see shape.ts); re-laid only when it moves. */
class Patch {
  readonly geometry = new BufferGeometry();
  private readonly pos: Float32Array;
  private readonly nrm: Float32Array | null;
  private readonly uv: Float32Array;
  private last: [number, number, number, number] = [NaN, NaN, NaN, NaN];
  constructor(
    topo: { uv: Float32Array; index: number[] },
    readonly spec: PatchSpec,
    /** 'surface': the body's normals (flat paper); 'computed': from the patch (a domed lens); 'none': unlit. */
    private readonly normals: 'surface' | 'computed' | 'none',
  ) {
    this.uv = topo.uv;
    const n = topo.uv.length / 2;
    this.pos = new Float32Array(n * 3);
    this.nrm = normals === 'surface' ? new Float32Array(n * 3) : null;
    const pa = new BufferAttribute(this.pos, 3);
    pa.setUsage(DynamicDrawUsage);
    this.geometry.setAttribute('position', pa);
    if (this.nrm) this.geometry.setAttribute('normal', new BufferAttribute(this.nrm, 3));
    this.geometry.setAttribute('uv', new BufferAttribute(this.uv, 2));
    this.geometry.setIndex(topo.index);
    this.lay();
  }
  lay(): void {
    const s = this.spec;
    const l = this.last;
    if (s.x === l[0] && s.y === l[1] && s.a === l[2] && s.b === l[3]) return;
    this.last = [s.x, s.y, s.a, s.b];
    layPatch(s, this.uv, this.pos, this.nrm ?? undefined);
    (this.geometry.getAttribute('position') as BufferAttribute).needsUpdate = true;
    if (this.nrm) (this.geometry.getAttribute('normal') as BufferAttribute).needsUpdate = true;
    if (this.normals === 'computed') this.geometry.computeVertexNormals();
    this.geometry.computeBoundingSphere();
  }
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/** The cushion: a finely divided box pushed out onto the superquadric, with exact normals. */
function cushionGeometry(): BufferGeometry {
  const geo = new BoxGeometry(1, 1, 0.58, 30, 30, 18);
  geo.deleteAttribute('uv');
  const pos = geo.getAttribute('position');
  const nrm = geo.getAttribute('normal');
  const col = new Float32Array(pos.count * 3);
  const under = new Color(BLUE.under);
  const lower = new Color(BLUE.lower);
  const upper = new Color(BLUE.upper);
  const crown = new Color(BLUE.crown);
  const c = new Color();
  const p: Vec3 = { x: 0, y: 0, z: 0 };
  const n: Vec3 = { x: 0, y: 0, z: 0 };
  for (let i = 0; i < pos.count; i++) {
    castFromCentre(pos.getX(i), pos.getY(i), pos.getZ(i), p);
    normalAt(p.x, p.y, p.z, n);
    pos.setXYZ(i, p.x, p.y, p.z);
    nrm.setXYZ(i, n.x, n.y, n.z);
    // Crown to underside, a touch brighter toward the top-left like the icon.
    const t = clamp01(p.y / BODY_H - p.x * 0.1);
    if (t < 0.3) c.lerpColors(under, lower, t / 0.3);
    else if (t < 0.62) c.lerpColors(lower, upper, (t - 0.3) / 0.32);
    else c.lerpColors(upper, crown, (t - 0.62) / 0.38);
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new BufferAttribute(col, 3));
  geo.computeBoundingSphere();
  return geo;
}

function solidColour(geo: BufferGeometry, hex: number): void {
  const n = geo.getAttribute('position').count;
  const c = new Color(hex);
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new BufferAttribute(col, 3));
}

export function buildRig(): Rig {
  const materials: Material[] = [];
  const textures: Texture[] = [];
  const geometries: BufferGeometry[] = [];
  const track = <T extends BufferGeometry>(g: T): T => (geometries.push(g), g);
  const keep = <T extends Material>(m: T): T => (materials.push(m), m);
  const tex = <T extends Texture>(t: T): T => (textures.push(t), t);

  const stage = new Group();
  const float = new Group();
  const tilt = new Group();
  const squash = new Group();
  const turn = new Group();
  const body = new Group();
  turn.position.y = BODY_H / 2;
  turn.rotation.order = 'YXZ';
  body.position.y = -BODY_H / 2;
  stage.add(float);
  float.add(tilt);
  tilt.add(squash);
  squash.add(turn);
  turn.add(body);

  // ── The cushion ───────────────────────────────────────────────────────
  const blue = keep(
    new MeshPhysicalMaterial({
      color: 0xffffff,
      vertexColors: true,
      roughness: 0.3,
      metalness: 0,
      clearcoat: 1,
      clearcoatRoughness: 0.06,
      emissive: new Color(BLUE.emissive),
      emissiveIntensity: 0.26,
    }),
  );
  const baseEmissive = new Color(BLUE.emissive);
  const flashEmissive = new Color(0x9fdcff);
  addRim(blue, new Color(BLUE.rim).multiplyScalar(0.5), 2.6);
  body.add(new Mesh(track(cushionGeometry()), blue));

  // ── Arms: little blue capsules on the flat sides ──────────────────────
  const armGeo = track(new CapsuleGeometry(ARM.radius, ARM.length, 4, 12));
  armGeo.translate(0, -ARM.length / 2 - ARM.radius * 0.35, 0);
  solidColour(armGeo, BLUE.arm);
  const arms: Group[] = [];
  const armX = (y: number) => sideX(y) - ARM.inset;
  for (const side of [-1, 1]) {
    const pivot = new Group();
    pivot.position.set(side * armX(ARM.y), ARM.y, 0.02);
    pivot.rotation.y = -side * 0.12; // a hint forward; the raise stays in the screen plane
    pivot.add(new Mesh(armGeo, blue));
    body.add(pivot);
    arms.push(pivot);
  }

  // ── The docket plate ──────────────────────────────────────────────────
  const plateSpec = (scale: number, dy: number, lift: number): PatchSpec => ({
    x: 0,
    y: (PLATE.top + PLATE.bottom) / 2 + dy,
    a: PLATE.halfW * scale,
    b: ((PLATE.top - PLATE.bottom) / 2) * scale,
    lift,
    bulge: 0,
  });
  const plateTopo = gridTopology(20, 22);
  const plateShadow = new Patch(plateTopo, plateSpec(1.12, -0.014, LIFT.shadow), 'none');
  track(plateShadow.geometry);
  const plateShadowMat = keep(new MeshBasicMaterial({ map: tex(plateShadowTexture()), transparent: true, depthWrite: false, opacity: 0.5 }));
  const plateShadowMesh = new Mesh(plateShadow.geometry, plateShadowMat);
  plateShadowMesh.renderOrder = 1;
  body.add(plateShadowMesh);

  const paperTex = tex(plateTexture());
  const paper = keep(
    new MeshStandardMaterial({
      map: paperTex,
      emissive: new Color(0xffffff),
      emissiveMap: paperTex,
      emissiveIntensity: 0.46,
      roughness: 0.78,
      metalness: 0,
      transparent: true,
      depthWrite: false,
    }),
  );
  const plate = new Patch(plateTopo, plateSpec(1, 0, LIFT.plate), 'surface');
  track(plate.geometry);
  const plateMesh = new Mesh(plate.geometry, paper);
  plateMesh.renderOrder = 2;
  body.add(plateMesh);

  // ── Face ──────────────────────────────────────────────────────────────
  const eyeTopo = discTopology(7, 28, EYE.reach);
  const eyes: Array<{ patch: Patch; u: EyeUniforms; side: number }> = [];
  for (const side of [-1, 1]) {
    const patch = new Patch(eyeTopo, { x: side * EYE.x, y: EYE.y, a: EYE.a, b: EYE.b, lift: LIFT.eye, bulge: EYE.bulge }, 'computed');
    track(patch.geometry);
    const [mat, u] = eyeMaterial(side);
    keep(mat);
    const mesh = new Mesh(patch.geometry, mat);
    mesh.renderOrder = 4;
    body.add(mesh);
    eyes.push({ patch, u, side });
  }

  const mouthPainter = new MouthPainter();
  tex(mouthPainter.texture);
  const mouth = new Patch(gridTopology(10, 6), { x: MOUTH_SPOT.x, y: MOUTH_SPOT.y, a: MOUTH_SPOT.a, b: MOUTH_SPOT.b, lift: LIFT.mouth, bulge: 0 }, 'none');
  track(mouth.geometry);
  const mouthMat = keep(new MeshBasicMaterial({ map: mouthPainter.texture, transparent: true, depthWrite: false }));
  const mouthMesh = new Mesh(mouth.geometry, mouthMat);
  mouthMesh.renderOrder = 3;
  body.add(mouthMesh);

  const blushMat = keep(new MeshBasicMaterial({ map: tex(blushTexture()), transparent: true, depthWrite: false, opacity: 0.55 }));
  const cheeks: Patch[] = [];
  for (const side of [-1, 1]) {
    const patch = new Patch(gridTopology(6, 4), { x: side * CHEEK.x, y: CHEEK.y, a: CHEEK.a, b: CHEEK.b, lift: LIFT.cheek, bulge: 0 }, 'none');
    track(patch.geometry);
    const m = new Mesh(patch.geometry, blushMat);
    m.renderOrder = 3;
    body.add(m);
    cheeks.push(patch);
  }

  // ── The scan line (thinking) ──────────────────────────────────────────
  const scanSpec: PatchSpec = { x: 0, y: PLATE.top, a: PLATE.halfW + 0.04, b: 0.055, lift: LIFT.scan, bulge: 0 };
  const scanPatch = new Patch(gridTopology(16, 1), scanSpec, 'none');
  track(scanPatch.geometry);
  const scanMat = keep(
    new MeshBasicMaterial({ map: tex(scanTexture()), color: new Color(SCAN), transparent: true, depthWrite: false, opacity: 0, toneMapped: false }),
  );
  const scanMesh = new Mesh(scanPatch.geometry, scanMat);
  scanMesh.renderOrder = 6;
  scanMesh.visible = false;
  body.add(scanMesh);

  // ── White parts: brackets and the shutter cap ─────────────────────────
  const white = keep(
    new MeshPhysicalMaterial({
      color: BRACKET,
      roughness: 0.28,
      metalness: 0,
      clearcoat: 1,
      clearcoatRoughness: 0.08,
      emissive: new Color(0xffffff),
      emissiveIntensity: 0.12,
    }),
  );
  addEdgeTint(white, new Color(0x8fb8e6));

  // ── Shutter button ────────────────────────────────────────────────────
  const shutter = new Group();
  shutter.position.set(SHUTTER_SPOT.x, topY(SHUTTER_SPOT.x, SHUTTER_SPOT.z) - 0.006, SHUTTER_SPOT.z);
  const silver = keep(new MeshPhysicalMaterial({ color: SHUTTER.ring, metalness: 1, roughness: 0.24, clearcoat: 0.6, clearcoatRoughness: 0.1 }));
  const collarGeo = track(new CylinderGeometry(0.096, 0.102, 0.03, 36, 1));
  const collar = new Mesh(collarGeo, silver);
  collar.position.y = 0.015;
  shutter.add(collar);
  const capH = SHUTTER_SPOT.capH;
  const capProfile = [
    new Vector2(0, capH),
    new Vector2(0.04, capH),
    new Vector2(0.06, capH - 0.005),
    new Vector2(0.071, capH - 0.014),
    new Vector2(0.075, capH - 0.028),
    new Vector2(0.075, 0),
  ];
  const capGeo = track(new LatheGeometry(capProfile, 32));
  const cap = new Mesh(capGeo, white);
  const capRest = SHUTTER_SPOT.lift;
  cap.position.y = capRest;
  shutter.add(cap);
  body.add(shutter);

  const flashMat = keep(new SpriteMaterial({ map: tex(flashTexture()), transparent: true, depthWrite: false, depthTest: false, opacity: 0, toneMapped: false }));
  const flash = new Sprite(flashMat);
  flash.position.set(SHUTTER_SPOT.x, topY(SHUTTER_SPOT.x, SHUTTER_SPOT.z) + capRest + capH + 0.03, SHUTTER_SPOT.z + 0.04);
  flash.renderOrder = 10;
  flash.visible = false;
  body.add(flash);

  // ── Viewfinder brackets ───────────────────────────────────────────────
  const frameRoot = new Group();
  frameRoot.position.set(0, BODY_H / 2, BRACKETS.z);
  float.add(frameRoot);
  const armLen = BRACKETS.arm;
  const tube = track(new CapsuleGeometry(BRACKETS.radius, armLen, 4, 10));
  const corners: Array<{ g: Group; sx: number; sy: number }> = [];
  for (const sy of [1, -1]) {
    for (const sx of [-1, 1]) {
      const g = new Group();
      // Two capsules whose end caps share the corner: a rounded L, like the icon's.
      const vert = new Mesh(tube, white);
      vert.position.set(0, -sy * (armLen / 2), 0);
      const horiz = new Mesh(tube, white);
      horiz.rotation.z = Math.PI / 2;
      horiz.position.set(-sx * (armLen / 2), 0, 0);
      g.add(vert, horiz);
      frameRoot.add(g);
      corners.push({ g, sx, sy });
    }
  }

  // ── Contact shadow ────────────────────────────────────────────────────
  const shadowMat = keep(new MeshBasicMaterial({ map: tex(shadowTexture()), transparent: true, depthWrite: false, opacity: 1 }));
  const shadowGeo = track(new PlaneGeometry(1, 1));
  shadowGeo.rotateX(-Math.PI / 2);
  const shadow = new Mesh(shadowGeo, shadowMat);
  shadow.position.y = -HOVER;
  shadow.renderOrder = -1;
  stage.add(shadow);

  // ── Thinking dots on a tilted ring ────────────────────────────────────
  const ring = new Group();
  ring.position.y = DOT_RING.y;
  ring.rotation.set(DOT_RING.tiltX, 0, DOT_RING.tiltZ);
  float.add(ring);
  const orbTextures = new Map<string, Texture>();
  const dots = DOT_COLOURS.map((colour) => {
    let t = orbTextures.get(colour);
    if (!t) {
      t = tex(orbTexture(colour));
      orbTextures.set(colour, t);
    }
    const mat = keep(new SpriteMaterial({ map: t, transparent: true, depthWrite: false, opacity: 0 }));
    const sprite = new Sprite(mat);
    sprite.visible = false;
    sprite.renderOrder = 8;
    ring.add(sprite);
    return { sprite, mat };
  });

  // ── Sparkles (happy) ──────────────────────────────────────────────────
  const sparkTex = tex(sparkleTexture());
  const sparks = SPARK_TINTS.map((tint) => {
    const mat = keep(new SpriteMaterial({ map: sparkTex, color: tint, transparent: true, depthWrite: false, opacity: 0 }));
    const sprite = new Sprite(mat);
    sprite.visible = false;
    sprite.renderOrder = 9;
    stage.add(sprite);
    return { sprite, mat, vx: 0, vy: 0, life: -1, size: 0.1 };
  });

  let revealed = false;

  const apply = (p: Pose): void => {
    float.position.y = p.y;
    tilt.rotation.set(p.lean, 0, p.roll);
    squash.scale.set(p.sx, p.sy, p.sx);
    turn.rotation.set(p.pitch, p.yaw, 0);

    // The face slides across the paper toward the gaze (eyes lead, the rest follows).
    const fx = p.lookX * GAZE_SLIDE.x;
    const fy = -p.lookY * GAZE_SLIDE.y;
    for (const e of eyes) {
      const s = e.patch.spec;
      s.x = e.side * EYE.x + fx;
      s.y = EYE.y + fy;
      s.a = EYE.a * p.eyeScale;
      s.b = EYE.b * p.eyeScale;
      e.patch.lay();
      e.u.uOpen.value = p.eyeOpen;
      e.u.uHappy.value = p.eyeHappy;
      e.u.uSad.value = p.eyeSad;
      e.u.uGlint.value = 1 - p.eyeHappy * 0.85;
      e.u.uSwirl.value = p.swirl;
      e.u.uSwirlSpin.value = p.swirlSpin * e.side;
    }
    mouth.spec.x = MOUTH_SPOT.x + fx * 0.85;
    mouth.spec.y = MOUTH_SPOT.y + fy * 0.85;
    mouth.lay();
    mouthPainter.draw(p.smile, p.mouthOpen, p.mouthO);
    cheeks.forEach((c, i) => {
      c.spec.x = (i === 0 ? -1 : 1) * CHEEK.x + fx * 0.85;
      c.spec.y = CHEEK.y + fy * 0.85;
      c.lay();
    });
    blushMat.opacity = 0.25 + 0.5 * p.blush;

    // Scan line: sweeps down the docket, fading in at the top and out at the foot.
    const sv = p.scan * smooth(0, 0.1, p.scanPos) * (1 - smooth(0.86, 1, p.scanPos));
    scanMesh.visible = revealed || sv > 0.003;
    if (scanMesh.visible) {
      scanSpec.y = PLATE.top - 0.05 - p.scanPos * (PLATE.top - PLATE.bottom - 0.11);
      scanPatch.lay();
      scanMat.opacity = sv;
    }

    // Shutter and flash.
    cap.position.y = capRest - 0.022 * p.press;
    flash.visible = revealed || p.flash > 0.003;
    flashMat.opacity = p.flash;
    flash.scale.setScalar(0.2 + 0.26 * p.flash);
    flashMat.rotation = p.flash * 0.6;
    blue.emissive.copy(baseEmissive).lerp(flashEmissive, p.flash * 0.35);
    paper.emissiveIntensity = 0.46 + 0.3 * p.flash;

    // Arms. Waving: the shoulder slides up the side so the hand waves at head height.
    arms[0]!.rotation.z = -(ARM.rest + p.armL);
    arms[1]!.rotation.z = ARM.rest + p.armR;
    const wy = ARM.y + 0.1 * p.wave;
    arms[0]!.position.set(-armX(wy), wy, 0.02);
    arms[0]!.scale.set(1 + 0.1 * p.wave, p.armLStretch, 1 + 0.1 * p.wave);
    arms[0]!.rotation.x = p.wave * 0.4;

    // Brackets: spread, droop, turn and lag.
    frameRoot.rotation.z = p.frameSpin;
    frameRoot.position.y = BODY_H / 2 + p.frameY;
    const reach = BRACKETS.reach * p.frame;
    for (const c of corners) {
      const top = c.sy > 0;
      const drop = p.frameDroop * (top ? 0.06 : 0.025);
      c.g.position.set(c.sx * reach, c.sy * reach - drop, 0);
      // Top brackets sag at their inner ends; bottom ones lean out.
      c.g.rotation.z = p.frameDroop * 0.22 * (top ? c.sx : -0.5 * c.sx);
    }

    const sh = p.shadow;
    shadow.scale.set(1.12 * sh, 1, 0.42 * sh);
    shadowMat.opacity = 0.35 + 0.65 * sh;

    const n = dots.length;
    dots.forEach((o, i) => {
      // Each dot fades in a beat after the one before it.
      const v = clamp01(p.orbs * 1.6 - (i / n) * 0.6);
      o.sprite.visible = revealed || v > 0.002;
      if (!o.sprite.visible) return;
      const a = p.orbSpin + (i / n) * Math.PI * 2;
      const r = DOT_RING.radius * (0.86 + 0.14 * v);
      o.sprite.position.set(Math.cos(a) * r, Math.sin(p.time * 2.1 + i * 1.7) * 0.025, Math.sin(a) * r);
      o.sprite.scale.setScalar(DOT_RING.size * (0.4 + 0.6 * v));
      o.mat.opacity = v;
    });
  };

  const burst = (): void => {
    // An arc of sparkles around the head, flying outward a short way (they stay in frame).
    const cy = float.position.y + BODY_H * 0.62;
    sparks.forEach((s, i) => {
      const a = Math.PI * (0.08 + (0.84 * i) / (sparks.length - 1)) + (Math.random() - 0.5) * 0.2;
      const speed = 0.6 + Math.random() * 0.3;
      s.vx = Math.cos(a) * speed;
      s.vy = Math.sin(a) * speed;
      s.sprite.position.set(Math.cos(a) * 0.52, cy + Math.sin(a) * 0.46, 0.3);
      s.life = 0;
      s.size = 0.08 + Math.random() * 0.07;
      s.sprite.visible = true;
    });
  };

  const tick = (dt: number): boolean => {
    let alive = false;
    for (const s of sparks) {
      if (s.life < 0) continue;
      s.life += dt;
      const L = 0.85;
      if (s.life > L) {
        s.life = -1;
        s.sprite.visible = false;
        s.mat.opacity = 0;
        continue;
      }
      alive = true;
      const k = Math.exp(-dt * 3.2);
      s.vx *= k;
      s.vy = s.vy * k - 0.4 * dt;
      s.sprite.position.x += s.vx * dt;
      s.sprite.position.y += s.vy * dt;
      const q = s.life / L;
      const pop = q < 0.18 ? q / 0.18 : 1 - (q - 0.18) / 0.82;
      s.sprite.scale.setScalar(s.size * (0.4 + 0.9 * Math.sin(Math.min(1, q * 2.2) * Math.PI * 0.5)));
      s.mat.opacity = Math.max(0, pop);
      s.mat.rotation += dt * 2.5;
    }
    return alive;
  };

  const revealAll = (on: boolean): void => {
    revealed = on;
    for (const o of dots) o.sprite.visible = on;
    for (const s of sparks) s.sprite.visible = on || s.life >= 0;
    scanMesh.visible = on;
    flash.visible = on;
  };

  const dispose = (): void => {
    for (const g of geometries) g.dispose();
    for (const m of materials) m.dispose();
    for (const t of textures) t.dispose();
  };

  return { stage, apply, burst, tick, revealAll, materials, dispose };
}
