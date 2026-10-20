/**
 * The live mascot: one small WebGL renderer, a studio light set, the rig and
 * the motion state machine, and a render loop that only runs while the canvas
 * is active, on screen and in a visible tab.
 *
 * Loaded by index.ts with a dynamic import, so three.js never reaches a chunk
 * that does not ask for the mascot.
 */
import {
  ACESFilmicToneMapping,
  DirectionalLight,
  HemisphereLight,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
  type WebGLRenderTarget,
} from 'three';
import { bakeEnvironment, startEnvironment } from './env';
import type { Mascot, MascotMood, MascotOptions } from './index';
import { Motion } from './motion';
import { BRACKETS, buildRig, HOVER, SHUTTER_SPOT } from './rig';
import { BODY_H, castFromCentre, EYE, frontZ, sideX, topY, type Vec3 } from './shape';

/** The square frame, in body units: centre height and half-extent (at the body's depth). */
export const FRAME = { cy: 0.47, half: 0.84 };
const FOV = 22;
const ELEVATION = (6 * Math.PI) / 180;
const EXPOSURE = 0.96;
const ENV_INTENSITY = 0.78;

export interface Layout {
  /** Between the eyes (where the gaze is measured from), as canvas fractions. */
  eyes: [number, number];
  /** Top of the shutter cap. */
  top: number;
  /** The cushion's silhouette box (no arms, brackets or shutter) and its centre height. */
  bodyLeft: number;
  bodyRight: number;
  bodyTop: number;
  bodyBottom: number;
  bodyCentre: number;
  /** The brackets' outer edges at rest. */
  bracketLeft: number;
  bracketRight: number;
  bracketTop: number;
  bracketBottom: number;
  /** The arms' outer edges at rest. */
  armLeft: number;
  armRight: number;
  /** Centre of the contact shadow. */
  ground: number;
}

export interface Stage {
  readonly renderer: WebGLRenderer;
  readonly motion: Motion;
  readonly scene: Scene;
  readonly camera: PerspectiveCamera;
  readonly rig: ReturnType<typeof buildRig>;
  readonly envRT: { current: WebGLRenderTarget };
  /** Projected fractions of the canvas (0..1 from the top-left). */
  readonly layout: Layout;
  /** Renders the current pose now. */
  draw(): void;
  triangles(): number;
  dispose(): void;
}

function makeCamera(): PerspectiveCamera {
  const cam = new PerspectiveCamera(FOV, 1, 0.5, 30);
  const dist = FRAME.half / Math.tan((FOV * Math.PI) / 360);
  cam.position.set(0, FRAME.cy + Math.sin(ELEVATION) * dist, Math.cos(ELEVATION) * dist);
  cam.lookAt(0, FRAME.cy, 0);
  cam.updateMatrixWorld();
  return cam;
}

function makeLights(scene: Scene): void {
  // A clean white key from the upper left, a soft front fill so the docket
  // stays paper-white, two cool rims from behind so the silhouette holds on a
  // dark page, and a sky/ground hemisphere that keeps the shadow side blue.
  const key = new DirectionalLight(0xfffaf2, 2.2);
  key.position.set(-2.4, 3.4, 3.2);
  const fill = new DirectionalLight(0xf2f8ff, 0.55);
  fill.position.set(2.2, 0.6, 3.4);
  const rimCool = new DirectionalLight(0xcfeaff, 2.2);
  rimCool.position.set(2.8, 2.2, -3.0);
  const rimCyan = new DirectionalLight(0x8fdcff, 1.1);
  rimCyan.position.set(-3.0, 0.9, -2.4);
  const hemi = new HemisphereLight(0xf2f8ff, 0x16335c, 0.7);
  scene.add(key, fill, rimCool, rimCyan, hemi);
}

const yieldToMain = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

let layoutCache: Layout | null = null;

/**
 * Where the stage's points land in the canvas, as fractions from the top-left.
 * The camera never changes, so this is measured once per page.
 */
export function measureLayout(camera: PerspectiveCamera): Layout {
  layoutCache ??= measure(camera);
  return layoutCache;
}

function measure(camera: PerspectiveCamera): Layout {
  const project = (x: number, y: number, z: number): [number, number] => {
    const v = new Vector3(x, y, z).project(camera);
    return [(v.x + 1) / 2, (1 - v.y) / 2];
  };
  // The cushion's silhouette: project points all over its surface and keep the extremes.
  const body = { l: 1, r: 0, t: 1, b: 0 };
  const pt: Vec3 = { x: 0, y: 0, z: 0 };
  for (let i = 0; i <= 48; i++) {
    for (let j = 0; j <= 24; j++) {
      const lon = (i / 48) * Math.PI * 2;
      const lat = (j / 24) * Math.PI - Math.PI / 2;
      castFromCentre(Math.cos(lat) * Math.sin(lon), Math.sin(lat), Math.cos(lat) * Math.cos(lon), pt);
      const [u, v] = project(pt.x, pt.y, pt.z);
      body.l = Math.min(body.l, u);
      body.r = Math.max(body.r, u);
      body.t = Math.min(body.t, v);
      body.b = Math.max(body.b, v);
    }
  }
  const reach = BRACKETS.reach + BRACKETS.radius;
  const capTop = topY(SHUTTER_SPOT.x, SHUTTER_SPOT.z) - 0.006 + SHUTTER_SPOT.lift + SHUTTER_SPOT.capH;
  // Arms at rest hang ~0.5 rad out from the side at y ≈ 0.37; their outer edge is ~0.1 beyond the side.
  const armOut = sideX(0.37) + 0.1;
  return {
    eyes: project(0, EYE.y, frontZ(EYE.x, EYE.y)),
    top: project(SHUTTER_SPOT.x, capTop, SHUTTER_SPOT.z)[1],
    bodyLeft: body.l,
    bodyRight: body.r,
    bodyTop: body.t,
    bodyBottom: body.b,
    bodyCentre: (body.t + body.b) / 2,
    bracketLeft: project(-reach, BODY_H / 2, BRACKETS.z)[0],
    bracketRight: project(reach, BODY_H / 2, BRACKETS.z)[0],
    bracketTop: project(0, BODY_H / 2 + reach, BRACKETS.z)[1],
    bracketBottom: project(0, BODY_H / 2 - reach, BRACKETS.z)[1],
    armLeft: project(-armOut, 0.3, 0)[0],
    armRight: project(armOut, 0.3, 0)[0],
    ground: project(0, -HOVER, 0)[1],
  };
}

/** Builds the scene into `canvas` and draws nothing yet. Throws if WebGL cannot start. */
export async function buildStage(canvas: HTMLCanvasElement, cssPx: number, reduced: boolean): Promise<Stage> {
  const renderer = new WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    premultipliedAlpha: true,
    // Keeps the last frame when the canvas is moved between docks, paused, or
    // attached after its first frame was drawn: the poster swap is seamless.
    preserveDrawingBuffer: true,
    powerPreference: 'low-power',
    stencil: false,
  });
  if (!renderer.getContext()) throw new Error('no WebGL context');
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = EXPOSURE;
  renderer.debug.checkShaderErrors = false;
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(cssPx, cssPx);

  // Setup yields between its phases so no single task holds the main thread long.
  await yieldToMain();
  const scene = new Scene();
  const camera = makeCamera();
  makeLights(scene);
  const rig = buildRig();
  scene.add(rig.stage);
  const motion = new Motion(reduced);
  rig.apply(motion.pose);

  // Two shader sets compile side by side, off the main thread where
  // KHR_parallel_shader_compile exists: the reflections bake's filters, and
  // every program of the scene (dots, sparkles, scan line and flash too,
  // though they start hidden), compiled against a stand-in of the baked map's
  // exact shape.
  await yieldToMain();
  const env = startEnvironment(renderer);
  scene.environment = env.placeholder;
  scene.environmentIntensity = ENV_INTENSITY;
  rig.revealAll(true);
  const sceneReady = renderer.compileAsync(scene, camera); // traverses now, waits later
  rig.revealAll(false);
  await Promise.all([env.ready, sceneReady]);
  const envRT = { current: env.bake() };
  scene.environment = envRT.current.texture;

  return {
    renderer,
    motion,
    scene,
    camera,
    rig,
    envRT,
    layout: measureLayout(camera),
    draw: () => renderer.render(scene, camera),
    triangles: () => renderer.info.render.triangles,
    dispose: () => {
      rig.dispose();
      envRT.current.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}

export async function mountSnapper(opts: MascotOptions): Promise<Mascot | null> {
  const t0 = performance.now();
  const size = Math.max(16, Math.round(opts.size));
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.display = 'block';
  canvas.style.width = `${size}px`;
  canvas.style.height = `${size}px`;

  let st: Stage;
  try {
    st = await buildStage(canvas, size, opts.reducedMotion);
  } catch {
    return null;
  }
  const { renderer, motion, rig, scene, envRT } = st;

  let cssPx = size;
  let disposed = false;
  let active = true;
  let onScreen = false;
  let docVisible = !document.hidden;
  let lost = false;
  let raf = 0;
  let lastDraw = 0;
  let gaze: [number, number] | null = null;
  let sparks = false;
  let pendingDraw = false;

  const draw = (): void => {
    rig.apply(motion.pose);
    st.draw();
  };

  // First frame: the rest pose, exactly the poster.
  draw();
  canvas.dataset.snapperReadyMs = String(Math.round(performance.now() - t0));

  const updateGaze = (): void => {
    if (!gaze) {
      motion.look(null, null);
      return;
    }
    const r = canvas.getBoundingClientRect();
    if (r.width === 0) return;
    const cx = r.left + r.width * st.layout.eyes[0];
    const cy = r.top + r.height * st.layout.eyes[1];
    const dx = gaze[0] - cx;
    const dy = gaze[1] - cy;
    // Soft limits: a pointer 160 px away is half-way to the eye's full turn.
    motion.look(dx / (Math.abs(dx) + 160), dy / (Math.abs(dy) + 160));
  };

  const frame = (now: number): void => {
    raf = requestAnimationFrame(frame);
    // 60 fps at most; 30 once nothing has happened for a while.
    const gap = motion.quiet > 8 && motion.currentMood === 'idle' && !sparks ? 1000 / 30 : 1000 / 60;
    if (lastDraw && now - lastDraw < gap - 2) return;
    const dt = lastDraw ? (now - lastDraw) / 1000 : 1 / 60;
    lastDraw = now;
    updateGaze();
    motion.step(dt);
    if (motion.burst) {
      motion.burst = false;
      rig.burst();
    }
    sparks = rig.tick(dt);
    if (motion.busy || sparks || pendingDraw) {
      pendingDraw = false;
      draw();
    }
  };

  const running = (): boolean => active && onScreen && docVisible && !lost && !disposed;
  const sync = (): void => {
    if (running()) {
      if (!raf) {
        lastDraw = 0;
        raf = requestAnimationFrame(frame);
      }
    } else if (raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  };

  const io = new IntersectionObserver((entries) => {
    for (const e of entries) onScreen = e.isIntersecting;
    sync();
  });
  io.observe(canvas);
  const onVisibility = (): void => {
    docVisible = !document.hidden;
    sync();
  };
  document.addEventListener('visibilitychange', onVisibility);
  const onLost = (e: Event): void => {
    e.preventDefault();
    lost = true;
    sync();
  };
  const onRestored = (): void => {
    if (disposed) return;
    // three re-creates its GL state; the environment map was GPU-made, so redo it.
    void bakeEnvironment(renderer).then((rt) => {
      if (disposed) {
        rt.dispose();
        return;
      }
      envRT.current.dispose();
      envRT.current = rt;
      scene.environment = rt.texture;
      lost = false;
      pendingDraw = true;
      draw();
      sync();
    });
  };
  canvas.addEventListener('webglcontextlost', onLost);
  canvas.addEventListener('webglcontextrestored', onRestored);

  const mascot: Mascot = {
    canvas,
    setMood(m: MascotMood) {
      if (disposed) return;
      motion.setMood(m);
      pendingDraw = true;
    },
    lookAt(x, y) {
      if (disposed) return;
      gaze = x === null || y === null || !Number.isFinite(x) || !Number.isFinite(y) ? null : [x, y];
    },
    nod() {
      if (!disposed) motion.nod();
    },
    hop() {
      if (!disposed) motion.hop();
    },
    wave() {
      if (!disposed) motion.wave();
    },
    snap() {
      if (!disposed) motion.snap();
    },
    dizzy() {
      if (!disposed) motion.dizzy();
    },
    speak(level) {
      if (!disposed) motion.speak(level);
    },
    setActive(on) {
      active = on;
      sync();
    },
    resize(px) {
      if (disposed) return;
      const next = Math.max(16, Math.round(px));
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      if (next !== cssPx || canvas.width !== Math.round(next * renderer.getPixelRatio())) {
        cssPx = next;
        renderer.setSize(next, next);
      }
      // Resizing clears the buffer: redraw in the same task so no blank frame shows.
      if (!lost) draw();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      sync();
      io.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
      st.dispose();
    },
  };
  return mascot;
}
