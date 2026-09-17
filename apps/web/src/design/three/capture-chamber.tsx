'use client';

import { useFrame } from '@react-three/fiber';
import { type RefObject, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';

import { drawDocket, drawFieldOverlay } from './docket-texture';
import { type ScenePalette, useScenePalette } from './palette';
import { Stage } from './Stage';
import { usePointerParallax, useSceneScroll } from './use-scene-scroll';

/**
 * S1 — the capture chamber.
 *
 * One docket, lit like a photographed object, being read. The sweep travels
 * down the paper; behind it the print resolves from soft to sharp and the
 * extractor's field boxes latch on where the text actually is.
 *
 * The division of labour is deliberate and is the thing to judge: TIME drives
 * the read, SCROLL drives the camera. Scrubbing the scan to the scrollbar
 * sounds richer and is worse — a reader who lands mid-page would see a
 * half-read receipt and no story, and a reader who never scrolls would see
 * nothing happen at all. `.scan-line` in globals.css already settled this
 * rhythm for the 2D version: a 2.6s sweep, on a loop. This matches it, so the
 * two treatments of the same motif do not disagree.
 *
 * What scroll does instead is move the camera through depth, which is the one
 * thing the flat card cannot do and therefore the only honest reason for this
 * scene to exist.
 */

const PAPER_W = 1.0;
const PAPER_H = 1.45;

/**
 * The read is SCROLL-DRIVEN, with one concession.
 *
 * An earlier version ran it on a 2.6s loop to match `.scan-line`. Scrubbing it
 * to scroll is better and is what the page now does everywhere: the position
 * in the animation is the position on the page, so it cannot be out of step
 * with the reader and it reverses exactly when they scroll back up.
 *
 * The concession is the first second and a half. The hero is the top of the
 * document, so at rest its scroll progress never moves — a purely scrolled
 * scan would greet everyone with a blurred, unread docket and no indication
 * that it does anything. So an intro eases the read to INTRO_TARGET once, on
 * arrival, and scroll takes it the rest of the way. The two are combined with
 * max(), never added, so scrolling can only ever advance the read.
 */
const INTRO_SECONDS = 1.6;
const INTRO_TARGET = 0.42;

/** Where in the hero's pass through the viewport the read finishes. */
const SCAN_FROM = 0.42;
const SCAN_TO = 0.8;

/**
 * The curl. STATIC — it does not breathe.
 *
 * A saddle, not a cylinder: a docket that has been in a pocket bends on both
 * axes at once, and a perfectly cylindrical roll reads as a stock 3D "paper"
 * preset. These are also the numbers keeping the geometry honest — at this
 * amplitude the sheet catches the key light along one diagonal, which is what
 * makes it look photographed rather than shaded.
 *
 * An earlier revision had the curl breathing on a sine and the whole sheet
 * bobbing gently. Both are gone, and not for performance.
 * docs/DESIGN-HANDOFF.md §12.1 sets four constraints a futurist direction here
 * has to satisfy, and one of them is "motion that reports": every animation
 * must be the system doing something, NEVER ambient drift. A sheet of paper
 * idling in space is the definition of ambient drift, and it is the tell that
 * separates an instrument from a screensaver.
 *
 * What is left moves for exactly three reasons, all of them real: the sweep
 * (the document is being read), the scroll (the reader moved), and the pointer
 * (the reader moved). Nothing on this page moves on its own.
 */
const CURL_X = 0.16;
const CURL_Y = -0.07;

const VERTEX = /* glsl */ `
  uniform vec2  uSize;
  varying vec2  vUv;
  varying vec3  vNormal;

  void main() {
    vUv = uv;

    float x = uv.x - 0.5;
    float y = uv.y - 0.5;
    float curl = ${CURL_X.toFixed(3)} * x * x
               + ${CURL_Y.toFixed(3)} * y * y;

    vec3 pos = position;
    pos.z += curl;

    // Analytic normal. Cheaper and smoother than asking three to recompute
    // vertex normals on the CPU every frame for a surface whose derivative we
    // can simply write down.
    float dzdu = 2.0 * ${CURL_X.toFixed(3)} * x;
    float dzdv = 2.0 * ${CURL_Y.toFixed(3)} * y;
    vec3 n = normalize(vec3(-dzdu / uSize.x, -dzdv / uSize.y, 1.0));

    vNormal = normalMatrix * n;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`;

const FRAGMENT = /* glsl */ `
  uniform sampler2D uMap;
  uniform sampler2D uBoxes;
  uniform vec2  uTexel;
  uniform float uScan;
  uniform vec3  uScanColor;
  uniform vec3  uGround;
  uniform float uOpacity;
  varying vec2  vUv;
  varying vec3  vNormal;

  void main() {
    // v coordinate of the sweep: uScan 0 is the top edge, 1 the bottom.
    float scanV = 1.0 - uScan;
    float past  = vUv.y - scanV;

    vec4 sharp = texture2D(uMap, vUv);

    // Six taps is enough of a blur to read as "not yet resolved" without
    // becoming a bloom. This is the only place the scene spends texture
    // bandwidth, and it spends it on the one idea the product is about.
    vec4 soft = (
        texture2D(uMap, vUv + vec2( uTexel.x, 0.0))
      + texture2D(uMap, vUv + vec2(-uTexel.x, 0.0))
      + texture2D(uMap, vUv + vec2(0.0,  uTexel.y))
      + texture2D(uMap, vUv + vec2(0.0, -uTexel.y))
      + texture2D(uMap, vUv + uTexel)
      + texture2D(uMap, vUv - uTexel)
    ) / 6.0;

    float read   = smoothstep(-0.004, 0.035, past);
    vec3  unread = mix(uGround, soft.rgb, 0.70);
    vec3  paper  = mix(unread, sharp.rgb, read);

    // Field boxes latch on once the sweep has passed them, flaring briefly as
    // they resolve and then settling. The flare is short on purpose — a box
    // that keeps pulsing is decoration; one that flashes once is a detection.
    vec4  boxes = texture2D(uBoxes, vUv);
    float fresh = 1.0 - smoothstep(0.0, 0.10, past);
    float boxA  = boxes.a * smoothstep(0.0, 0.02, past);
    paper = mix(paper, boxes.rgb * (1.0 + fresh * 1.5), boxA);

    // The sweep itself, faded in and out at the two ends so it never parks on
    // an edge of the paper.
    //
    // The falloff squares "past" by MULTIPLICATION, and that is not a style
    // preference. pow(x, 2.0) is UNDEFINED in GLSL for x < 0, and "past" is
    // negative across the whole unread half of the sheet — so every fragment
    // above the sweep came back NaN, the NaN propagated through "paper" into
    // the alpha channel, and the entire docket was invisible. Nothing warns:
    // the shader compiles, the draw call is issued, every log reads correct,
    // and the sheet simply is not there. Cost a bisect down to a solid-colour
    // fragment to find.
    //
    // (No backticks in this file's GLSL comments either — the shaders live in
    // template literals, so one would end the string mid-comment.)
    float ends = smoothstep(0.0, 0.05, uScan) * (1.0 - smoothstep(0.94, 1.0, uScan));
    float falloff = past / 0.014;
    float band = exp(-(falloff * falloff)) * ends;
    paper += uScanColor * band * 0.9;

    // One key light, high and to the left, over a floor of ambient. No
    // specular and no rim: paper is a diffuse surface, and the moment it gets
    // a glossy highlight it stops being paper and starts being a product
    // render.
    vec3  N = normalize(vNormal);
    float diff = 0.82 + 0.18 * max(dot(N, normalize(vec3(-0.35, 0.65, 0.68))), 0.0);
    paper *= diff;

    gl_FragColor = vec4(paper, uOpacity);
    #include <colorspace_fragment>
  }
`;

/**
 * A drawn shadow, not a shadow map.
 *
 * Real shadows here would mean a light with a depth pass, a receiver plane and
 * a shadow camera — three things to tune and a render target to pay for, so
 * that a diffuse sheet can cast a blur `--shadow-card` already describes as
 * `0 8px 24px -12px` at 10% ink. This is that token, as a texture. Same look,
 * one quad.
 */
function useShadowTexture(palette: ScenePalette) {
  return useMemo(() => {
    if (typeof document === 'undefined') return null;
    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    const shade = new THREE.Color(palette.void);
    const rgb = [shade.r, shade.g, shade.b].map((c) => Math.round(c * 255)).join(', ');

    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, `rgba(${rgb}, 0.22)`);
    g.addColorStop(0.55, `rgba(${rgb}, 0.08)`);
    g.addColorStop(1, `rgba(${rgb}, 0)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }, [palette.void]);
}

function Docket({
  palette,
  progress,
  pointer,
}: {
  palette: ScenePalette;
  progress: RefObject<number>;
  pointer: RefObject<{ x: number; y: number }>;
}) {
  const group = useRef<THREE.Group>(null);
  /**
   * The frame loop drives the material through THIS ref, never through the
   * `uniforms` object below.
   *
   * react-three-fiber does not hand a ShaderMaterial the uniforms object it was
   * given — the material ends up with a copy, so `material.uniforms !== the
   * object this component created`. Mutating the local one, which is what every
   * obvious version of this code does, updates something nothing renders: the
   * scan sits at 0, the fade-in sits at 0, the sheet is transparent forever,
   * and every value you log looks perfect because the object you are logging is
   * the one you are writing to. Proved by asserting the identity in the browser
   * rather than by reading either library's source.
   *
   * So `uniforms` below is SEED DATA — what the material is built from — and
   * everything per-frame goes through `material.current.uniforms`.
   */
  const material = useRef<THREE.ShaderMaterial>(null);
  const [textures, setTextures] = useState<{ map: THREE.Texture; boxes: THREE.Texture } | null>(
    null,
  );
  const shadow = useShadowTexture(palette);

  /**
   * Redrawn whenever the palette changes, which is what makes the theme toggle
   * work: the docket is painted in the theme's own ink on the theme's own
   * paper, rather than being a light-mode bitmap dimmed for dark.
   */
  useEffect(() => {
    let live = true;
    const made: THREE.Texture[] = [];

    void (async () => {
      const { canvas, boxes } = await drawDocket(palette);
      if (!live) return;
      const overlay = drawFieldOverlay(boxes, palette);

      const map = new THREE.CanvasTexture(canvas);
      const boxMap = new THREE.CanvasTexture(overlay);
      for (const t of [map, boxMap]) {
        t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = 8;
        t.minFilter = THREE.LinearMipmapLinearFilter;
        made.push(t);
      }
      setTextures({ map, boxes: boxMap });
    })();

    return () => {
      live = false;
      for (const t of made) t.dispose();
    };
  }, [palette]);

  /**
   * Built only once the textures exist, and rebuilt if they are replaced.
   *
   * The obvious version of this — stable uniforms created with
   * `uMap: { value: null }`, filled in later from the frame loop — renders a
   * blank white sheet, and does it silently. A material is compiled the first
   * time its mesh is drawn, and what it is compiled against is what it keeps:
   * three picks the shader program from the state of the material at that
   * moment, and react-three-fiber does not set `needsUpdate` when a texture
   * arrives afterwards. So the paper draws, the lighting works, the scan runs,
   * every log says the texture is bound — and the docket is not there. It cost
   * a diagnostic pass swapping in a `meshBasicMaterial` to see it, because
   * nothing anywhere throws.
   *
   * Keying the uniforms on `textures` and gating the mesh below on the same
   * value removes the window entirely: the material is never created before
   * there is something for it to sample.
   */
  const uniforms = useMemo(
    () => ({
      uMap: { value: textures?.map ?? null },
      uBoxes: { value: textures?.boxes ?? null },
      uTexel: { value: new THREE.Vector2(1.6 / 1024, 1.6 / 1448) },
      uScan: { value: 0 },
      uScanColor: { value: new THREE.Color(palette.scan) },
      uGround: { value: new THREE.Color(palette.ground) },
      uSize: { value: new THREE.Vector2(PAPER_W, PAPER_H) },
      uOpacity: { value: 0 },
    }),
    // `palette` seeds the colours; the frame loop keeps them current after
    // that, so a theme change tweens rather than rebuilding the material.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [textures],
  );

  /** Reused every frame so the theme tween allocates nothing. */
  const scanTarget = useMemo(() => new THREE.Color(), []);
  const groundTarget = useMemo(() => new THREE.Color(), []);

  useFrame((state, delta) => {
    const u = material.current?.uniforms as typeof uniforms | undefined;
    if (!u) return;
    const t = state.clock.elapsedTime;

    // Fade in over ~0.5s, so the handover from the 2D twin is a dissolve
    // rather than a pop. The textures are already bound by the time this mesh
    // exists — see the note on `uniforms`.
    u.uOpacity.value = Math.min(1, u.uOpacity.value + delta * 2);

    u.uScanColor.value.lerp(scanTarget.set(palette.scan), 0.08);
    u.uGround.value.lerp(groundTarget.set(palette.ground), 0.08);

    // The read: an intro that plays once, then scroll.
    const intro = INTRO_TARGET * THREE.MathUtils.smoothstep(t, 0.25, INTRO_SECONDS);
    const scrolled = THREE.MathUtils.smoothstep(progress.current, SCAN_FROM, SCAN_TO);
    u.uScan.value = Math.max(intro, scrolled);

    const g = group.current;
    if (!g) return;

    /**
     * Scroll is depth. The sheet starts turned away and set back, and comes
     * square to the camera as the section takes the viewport — so the reward
     * for scrolling is that the document turns to face you.
     */
    const settle = THREE.MathUtils.smoothstep(progress.current, 0.3, 0.82);
    const targetY = THREE.MathUtils.lerp(-0.58, -0.04, settle);
    const targetX = THREE.MathUtils.lerp(0.26, 0.02, settle);
    const targetZ = THREE.MathUtils.lerp(-0.85, 0.12, settle);

    // Parallax on top, damped. Two degrees, not twenty.
    const { x: px, y: py } = pointer.current;

    g.rotation.y = THREE.MathUtils.damp(g.rotation.y, targetY + px * 0.1, 4, delta);
    g.rotation.x = THREE.MathUtils.damp(g.rotation.x, targetX + py * 0.07, 4, delta);
    g.position.z = THREE.MathUtils.damp(g.position.z, targetZ, 3, delta);
  });

  return (
    <group ref={group}>
      {shadow ? (
        <mesh position={[0.06, -0.1, -0.22]} scale={[PAPER_W * 2.1, PAPER_H * 1.7, 1]}>
          <planeGeometry args={[1, 1]} />
          <meshBasicMaterial map={shadow} transparent depthWrite={false} />
        </mesh>
      ) : null}

      {/* No sheet until there is something printed on it. */}
      {textures ? (
        <mesh>
          <planeGeometry args={[PAPER_W, PAPER_H, 48, 64]} />
          <shaderMaterial
            ref={material}
            key={textures.map.uuid}
            vertexShader={VERTEX}
            fragmentShader={FRAGMENT}
            uniforms={uniforms}
            transparent
          />
        </mesh>
      ) : null}
    </group>
  );
}

/** Camera parallax. Kept off the docket so the two motions stay separable. */
function Rig({ pointer }: { pointer: RefObject<{ x: number; y: number }> }) {
  useFrame(({ camera }, delta) => {
    camera.position.x = THREE.MathUtils.damp(camera.position.x, pointer.current.x * 0.14, 3, delta);
    camera.position.y = THREE.MathUtils.damp(camera.position.y, -pointer.current.y * 0.1, 3, delta);
    camera.lookAt(0, 0, 0);
  });
  return null;
}

export default function CaptureChamber({
  className,
  onFirstFrame,
}: {
  className?: string;
  onFirstFrame?: () => void;
}) {
  const host = useRef<HTMLDivElement | null>(null);
  const progress = useSceneScroll(host);
  const pointer = usePointerParallax();
  const palette = useScenePalette();

  return (
    <div ref={host} className={className}>
      <Stage className="h-full w-full" onFirstFrame={onFirstFrame}>
        <Docket palette={palette} progress={progress} pointer={pointer} />
        <Rig pointer={pointer} />
      </Stage>
    </div>
  );
}
