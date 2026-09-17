'use client';

import { useFrame } from '@react-three/fiber';
import { type RefObject, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';

import { type ScenePalette, useScenePalette } from './palette';
import { drawSplitDocket, type TaxBand } from './split-texture';
import { Stage } from './Stage';
import { usePointerParallax, useSceneScroll } from './use-scene-scroll';

/**
 * S2 — the split.
 *
 * One servo docket separating into the two tax positions it was always
 * carrying. Scroll drives it: at the top of the section it is a single sheet,
 * and by the middle it is two, with the GST-free lines held back on the
 * original plane and the taxable lines lifted forward onto their own.
 *
 * This is the one scene on the site that has to exist. `docs/MONETISATION.md`
 * §2 calls per-category tax subtotals the single capability no competitor at
 * any price offers, and the reason competitors miss it is genuinely spatial —
 * they read the header total, which is one number on one plane, and the
 * information they are missing is that the rows underneath it belong to two
 * different places. A bar chart cannot say that. A sheet of paper coming apart
 * along the tax boundary says it in one gesture.
 *
 * It also satisfies the hard constraint in §12.1 — motion that REPORTS. The
 * separation is not a transition effect: the distance between the two planes
 * is the classification, and a line's position is the answer to "can I claim
 * the GST on this?".
 */

const PAPER_W = 1.0;
const PAPER_H = 1.45;

/** Bands are uploaded as a fixed-size array; GLSL has no dynamic loops. */
const MAX_BANDS = 6;

const VERTEX = /* glsl */ `
  uniform vec2  uSize;
  uniform float uCurl;
  varying vec2  vUv;
  varying vec3  vNormal;

  void main() {
    vUv = uv;

    float x = uv.x - 0.5;
    float y = uv.y - 0.5;
    vec3 pos = position;
    pos.z += uCurl * (x * x) - (uCurl * 0.45) * (y * y);

    float dzdu = 2.0 * uCurl * x;
    float dzdv = -2.0 * (uCurl * 0.45) * y;
    vNormal = normalMatrix * normalize(vec3(-dzdu / uSize.x, -dzdv / uSize.y, 1.0));

    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`;

/**
 * Each plane draws the same docket and decides, per fragment, whether that
 * row is its own.
 *
 * One texture, two masks. The alternative — drawing two canvases with the
 * other half omitted — would have meant the two sheets could disagree about
 * where a row sits, which on a page arguing that the rows are read exactly is
 * not a risk worth taking for a texture upload we do not need.
 */
const FRAGMENT = /* glsl */ `
  uniform sampler2D uMap;
  uniform vec2  uBands[${MAX_BANDS}];
  uniform int   uBandCount;
  uniform float uSplit;
  uniform float uBase;
  uniform float uSeamV;
  uniform vec3  uGround;
  uniform vec3  uEdge;
  uniform float uOpacity;
  varying vec2  vUv;
  varying vec3  vNormal;

  void main() {
    vec4 sheet = texture2D(uMap, vUv);

    // Both sheets are masked by the SAME set of rows: the taxable ones, the
    // ones that move. The base sheet subtracts them and the lifted sheet is
    // made of them, so between the two every pixel of the docket is on screen
    // exactly once.
    //
    // The first version gave each sheet its own rows and kept only those.
    // Everything belonging to neither half — TOTAL 32.20, GST INCLUDED 1.40,
    // the footer — silently disappeared the moment the sheet came apart. On a
    // page whose entire argument is that nothing on the docket goes unread,
    // losing the total is the worst possible detail to lose.
    float mine = 0.0;
    for (int i = 0; i < ${MAX_BANDS}; i++) {
      if (i >= uBandCount) break;
      vec2 b = uBands[i];
      mine = max(mine, step(b.x, vUv.y) * step(vUv.y, b.y));
    }

    float lift = mine * uSplit;
    float visible = mix(lift, 1.0 - lift, uBase);

    vec3  N = normalize(vNormal);
    float diff = 0.82 + 0.18 * max(dot(N, normalize(vec3(-0.35, 0.65, 0.68))), 0.0);
    vec3  paper = mix(uGround, sheet.rgb, 1.0) * diff;

    // A hairline along the tear, in this sheet's own tone, only while it is
    // actually coming apart. uSeamV is a scalar rather than a lookup into
    // uBands: GLSL ES 1.00 only guarantees uniform arrays can be indexed by a
    // constant expression, and uBandCount - 1 is not one.
    float seam = (1.0 - smoothstep(0.0, 0.004, abs(vUv.y - uSeamV))) * uSplit;
    paper = mix(paper, uEdge, seam * 0.9);

    gl_FragColor = vec4(paper, visible * uOpacity);
    #include <colorspace_fragment>
  }
`;

type Uniforms = {
  uMap: { value: THREE.Texture | null };
  uBands: { value: THREE.Vector2[] };
  uBandCount: { value: number };
  uSplit: { value: number };
  uBase: { value: number };
  uSeamV: { value: number };
  uGround: { value: THREE.Color };
  uEdge: { value: THREE.Color };
  uOpacity: { value: number };
  uSize: { value: THREE.Vector2 };
  uCurl: { value: number };
};

function bandVectors(bands: TaxBand[], kind: 'free' | 'taxable'): THREE.Vector2[] {
  const mine = bands.filter((b) => b.kind === kind);
  const out: THREE.Vector2[] = [];
  for (let i = 0; i < MAX_BANDS; i++) {
    const b = mine[i];
    out.push(new THREE.Vector2(b ? b.v0 : 0, b ? b.v1 : 0));
  }
  return out;
}

function Sheet({
  texture,
  bands,
  kind,
  palette,
  split,
}: {
  texture: THREE.Texture;
  bands: TaxBand[];
  kind: 'free' | 'taxable';
  palette: ScenePalette;
  split: RefObject<number>;
}) {
  const group = useRef<THREE.Group>(null);
  const material = useRef<THREE.ShaderMaterial>(null);
  const isFree = kind === 'free';
  /** The tear: the top edge of the first row that leaves. */
  const seamV = bands.find((b) => b.kind === 'taxable')?.v1 ?? 0.5;

  const uniforms = useMemo<Uniforms>(
    () => ({
      uMap: { value: texture },
      // Always the TAXABLE rows, for both sheets — see the note in the
      // fragment shader for why the masks are shared and inverted.
      uBands: { value: bandVectors(bands, 'taxable') },
      uBandCount: { value: bands.filter((b) => b.kind === 'taxable').length },
      uSplit: { value: 0 },
      uBase: { value: isFree ? 1 : 0 },
      uSeamV: { value: seamV },
      uGround: { value: new THREE.Color(palette.ground) },
      uEdge: { value: new THREE.Color(isFree ? palette.good : palette.accent) },
      uOpacity: { value: 0 },
      uSize: { value: new THREE.Vector2(PAPER_W, PAPER_H) },
      uCurl: { value: isFree ? 0.14 : 0.1 },
    }),
    // Rebuilt with the texture, never filled in afterwards — react-three-fiber
    // hands the material a copy of this object, so a uniform that is null here
    // stays null there. Same trap as capture-chamber.tsx.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [texture],
  );

  const ground = useMemo(() => new THREE.Color(), []);
  const edge = useMemo(() => new THREE.Color(), []);

  useFrame((_, delta) => {
    const u = material.current?.uniforms as Uniforms | undefined;
    if (!u) return;

    u.uOpacity.value = Math.min(1, u.uOpacity.value + delta * 2.2);
    u.uSplit.value = THREE.MathUtils.damp(u.uSplit.value, split.current, 5, delta);
    u.uGround.value.lerp(ground.set(palette.ground), 0.08);
    u.uEdge.value.lerp(edge.set(isFree ? palette.good : palette.accent), 0.08);

    const g = group.current;
    if (!g) return;
    const t = u.uSplit.value;

    // The taxable half lifts toward the reader and to the right; the GST-free
    // half stays where the paper was. Which half moves is not arbitrary — the
    // one that moves is the one you can claim GST on, so the gesture and the
    // claim point the same way.
    const dir = isFree ? -1 : 1;
    g.position.x = THREE.MathUtils.damp(g.position.x, dir * 0.34 * t, 6, delta);
    g.position.z = THREE.MathUtils.damp(g.position.z, dir * 0.3 * t, 6, delta);
    g.rotation.y = THREE.MathUtils.damp(g.rotation.y, -dir * 0.22 * t, 6, delta);
  });

  return (
    <group ref={group}>
      <mesh>
        <planeGeometry args={[PAPER_W, PAPER_H, 40, 56]} />
        <shaderMaterial
          ref={material}
          key={texture.uuid + kind}
          vertexShader={VERTEX}
          fragmentShader={FRAGMENT}
          uniforms={uniforms}
          transparent
          side={THREE.DoubleSide}
        />
      </mesh>
    </group>
  );
}

function Rig({ pointer }: { pointer: RefObject<{ x: number; y: number }> }) {
  useFrame(({ camera }, delta) => {
    camera.position.x = THREE.MathUtils.damp(camera.position.x, pointer.current.x * 0.2, 3, delta);
    camera.position.y = THREE.MathUtils.damp(camera.position.y, -pointer.current.y * 0.12, 3, delta);
    camera.lookAt(0, 0, 0);
  });
  return null;
}

export default function TaxSplit({
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
  const [data, setData] = useState<{
    texture: THREE.Texture;
    bands: TaxBand[];
    headerV: number;
  } | null>(null);

  useEffect(() => {
    let live = true;
    let made: THREE.Texture | null = null;

    void (async () => {
      const { canvas, bands, headerV } = await drawSplitDocket(palette);
      if (!live) return;
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = 8;
      texture.minFilter = THREE.LinearMipmapLinearFilter;
      made = texture;
      setData({ texture, bands, headerV });
    })();

    return () => {
      live = false;
      made?.dispose();
    };
  }, [palette]);

  /**
   * Scroll maps onto the split, and stops well before the section leaves.
   *
   * The separation finishes at 55% of the pass rather than at 100%, so the
   * reader spends the back half of the section looking at the finished answer
   * instead of watching it still assembling as it scrolls away. A scrubbed
   * animation that is only complete at the moment it exits has, in practice,
   * never been seen by anyone.
   */
  const split = useRef(0);

  return (
    <div ref={host} className={className}>
      <Stage className="h-full w-full" onFirstFrame={onFirstFrame}>
        <SplitDriver progress={progress} split={split} />
        {data ? (
          /* The pair sits slightly forward of the frame so the sheet fills it
             rather than floating in the middle of a lot of empty ground. */
          <group scale={1.12}>
            <Sheet
              texture={data.texture}
              bands={data.bands}
              kind="free"
              palette={palette}
              split={split}
            />
            <Sheet
              texture={data.texture}
              bands={data.bands}
              kind="taxable"
              palette={palette}
              split={split}
            />
          </group>
        ) : null}
        <Rig pointer={pointer} />
      </Stage>
    </div>
  );
}

/** Converts viewport progress into the 0 → 1 the two sheets both read. */
function SplitDriver({
  progress,
  split,
}: {
  progress: RefObject<number>;
  split: RefObject<number>;
}) {
  useFrame(() => {
    split.current = THREE.MathUtils.smoothstep(progress.current, 0.16, 0.55);
  });
  return null;
}
