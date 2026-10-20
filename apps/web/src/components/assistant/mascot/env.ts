/**
 * Reflections for the glossy cushion, baked once to a small PMREM: a
 * product-shot light box drawn with unlit panels. One large soft octabox
 * up-left (the clean window highlight on the clearcoat, like the gloss on an
 * app icon), a cool strip behind-right (the rim), a cyan kicker behind-left,
 * a soft overhead, a pale-blue bounce from below and a dim cool room.
 * Unlit materials compile in a blink, so it never stalls the first frame.
 *
 * Ported from Tunas (gaiada-web-revamp, src/scripts/chat/mascot/env.ts), which
 * found that the PMREM filter shaders froze the main thread for ~0.6 s on a
 * cold GPU cache when three compiled them on first use; here they compile in
 * parallel first (KHR_parallel_shader_compile).
 */
import {
  BackSide,
  BufferGeometry,
  CircleGeometry,
  Color,
  CubeUVReflectionMapping,
  DoubleSide,
  Float32BufferAttribute,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  Scene,
  SphereGeometry,
  WebGLRenderTarget,
  type Material,
  type Texture,
  type WebGLRenderer,
} from 'three';

function studioScene(): { scene: Scene; dispose(): void } {
  const scene = new Scene();
  const geos: BufferGeometry[] = [];
  const mats: Material[] = [];
  // Round lights (an octabox, a dot) give soft round reflections; only the rims are strips.
  const panel = (w: number, h: number, colour: number, power: number, x: number, y: number, z: number, round = true) => {
    const g = round ? new CircleGeometry(0.5, 40).scale(w, h, 1) : new PlaneGeometry(w, h);
    const m = new MeshBasicMaterial({ color: new Color(colour).multiplyScalar(power), side: DoubleSide });
    geos.push(g);
    mats.push(m);
    const mesh = new Mesh(g, m);
    mesh.position.set(x, y, z);
    mesh.lookAt(0, 0, 0);
    scene.add(mesh);
  };

  // The room: cool light grey above, a deeper blue-grey toward the floor.
  const room = new SphereGeometry(20, 24, 12);
  const pos = room.getAttribute('position');
  const col: number[] = [];
  const top = new Color(0xc4d2e2).multiplyScalar(0.55);
  const mid = new Color(0x8a9ab0).multiplyScalar(0.4);
  const low = new Color(0x1c3a66).multiplyScalar(0.4);
  const c = new Color();
  for (let i = 0; i < pos.count; i++) {
    const t = pos.getY(i) / 20; // -1..1
    if (t > 0) c.lerpColors(mid, top, t);
    else c.lerpColors(mid, low, Math.min(1, -t * 1.6));
    col.push(c.r, c.g, c.b);
  }
  room.setAttribute('color', new Float32BufferAttribute(col, 3));
  const roomMat = new MeshBasicMaterial({ vertexColors: true, side: BackSide });
  geos.push(room);
  mats.push(roomMat);
  scene.add(new Mesh(room, roomMat));

  panel(7, 6, 0xfff8f0, 14, -6, 7, 8); // key octabox, up-left-front
  panel(3, 9, 0xd8efff, 8, 9, 3, -6, false); // cool rim strip, behind-right
  panel(3, 7, 0x9fe4ff, 3.5, -9, 2, -5, false); // cyan kicker, behind-left
  panel(10, 10, 0xf4f9ff, 1.6, 0, 10, 0); // overhead fill
  panel(14, 14, 0x6fb4ff, 0.45, 0, -6, 2); // pale-blue bounce from below
  panel(1.6, 1.6, 0xffffff, 12, 6, 6, 7); // a small bright accent up-right: a second glint

  return {
    scene,
    dispose: () => {
      geos.forEach((g) => g.dispose());
      mats.forEach((m) => m.dispose());
    },
  };
}

/** Cube size of the baked reflections: soft studio light needs little resolution. */
const ENV_SIZE = 64;

interface PmremInternals {
  _setSize(size: number): void;
  _allocateTargets(): WebGLRenderTarget;
  _pingPongRenderTarget: WebGLRenderTarget | null;
  _blurMaterial: Material | null;
  _ggxMaterial: Material | null;
}

export interface EnvironmentJob {
  /**
   * A stand-in with the baked map's exact shape (cube-UV, same size), so the
   * scene's materials can compile against it while the bake's own shaders
   * compile: three keys programs on that shape, not on the pixels.
   */
  readonly placeholder: Texture;
  /** Resolves when the bake's shaders are compiled (off the main thread). */
  readonly ready: Promise<void>;
  /** Bakes now (GPU work only) and frees the job. */
  bake(): WebGLRenderTarget;
}

/**
 * Starts the reflections bake, compiling the PMREM filter shaders in parallel
 * first with the filter's render target bound so their program keys match the
 * bake. Falls back to a plain bake if three's internals move (checked against
 * three 0.186: `_setSize`, `_allocateTargets`, `_pingPongRenderTarget`,
 * `_blurMaterial`, `_ggxMaterial`).
 */
export function startEnvironment(renderer: WebGLRenderer): EnvironmentJob {
  const pmrem = new PMREMGenerator(renderer);
  const source = studioScene();
  let placeholder: WebGLRenderTarget | null = null;
  let ready: Promise<void> = Promise.resolve();
  try {
    const p = pmrem as unknown as PmremInternals;
    p._setSize(ENV_SIZE);
    placeholder = p._allocateTargets();
    const target = p._pingPongRenderTarget;
    if (target && p._blurMaterial && p._ggxMaterial) {
      const warm = new Scene();
      const geo = new BufferGeometry();
      warm.add(new Mesh(geo, p._blurMaterial), new Mesh(geo, p._ggxMaterial));
      const cam = new PerspectiveCamera();
      const before = renderer.getRenderTarget();
      renderer.setRenderTarget(target);
      // compileAsync reads the render state synchronously, then waits off-thread.
      const a = renderer.compileAsync(warm, cam);
      const b = renderer.compileAsync(source.scene, cam);
      renderer.setRenderTarget(before);
      ready = Promise.all([a, b]).then(() => geo.dispose());
    }
  } catch {
    /* three's internals changed: the bake compiles as it goes */
  }
  const stand = placeholder ?? new WebGLRenderTarget(3 * ENV_SIZE, 4 * ENV_SIZE);
  stand.texture.mapping = CubeUVReflectionMapping;
  return {
    placeholder: stand.texture,
    ready,
    bake: () => {
      const rt = pmrem.fromScene(source.scene, 0.02, 0.1, 100, { size: ENV_SIZE });
      source.dispose();
      pmrem.dispose();
      stand.dispose();
      return rt;
    },
  };
}

export async function bakeEnvironment(renderer: WebGLRenderer): Promise<WebGLRenderTarget> {
  const job = startEnvironment(renderer);
  await job.ready;
  return job.bake();
}
