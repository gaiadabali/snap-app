'use client';

/**
 * Snapper's dev preview, built on the public API only (`createMascot`), the
 * way the widget uses it: every mood and gesture, pointer follow, reduced
 * motion, light and dark pages, the size grid, and mock-ups of the 64 px
 * launcher orb and the panel header placed with MASCOT_FRAME.
 *
 * `poster` mode is the exception: it draws one settled pose through the
 * stage directly (as the live canvas's first frame is drawn), for the poster
 * script.
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

import { createMascot, MASCOT_FRAME, type Mascot, type MascotMood } from '@/components/assistant/mascot';

const MOODS: MascotMood[] = ['idle', 'attentive', 'listening', 'thinking', 'talking', 'happy', 'sorry'];
const SIZES = [64, 80, 120, 160, 320];

export function MascotLab({ poster, size }: { poster: 'idle' | 'happy' | null; size: number }) {
  return poster ? <PosterShot mood={poster} size={size} /> : <Lab />;
}

// ── Poster mode ─────────────────────────────────────────────────────────

function PosterShot({ mood, size }: { mood: 'idle' | 'happy'; size: number }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let cancelled = false;
    let dispose: (() => void) | undefined;
    // A fresh canvas per run: React's dev double-effect must not hand a lost
    // context from the first run to the second.
    const canvas = document.createElement('canvas');
    canvas.dataset.poster = mood;
    canvas.style.display = 'block';
    host.current?.append(canvas);
    delete document.body.dataset.ready;
    void (async () => {
      try {
        const { buildStage } = await import('@/components/assistant/mascot/runtime');
        if (cancelled) return;
        const st = await buildStage(canvas, size, false);
        if (cancelled) {
          st.dispose();
          return;
        }
        dispose = st.dispose;
        st.rig.tick(10); // no sparkles left over
        st.motion.settle(mood);
        if (mood === 'happy') {
          st.rig.apply(st.motion.pose);
          st.rig.burst();
          st.rig.tick(0.24);
        }
        st.rig.apply(st.motion.pose);
        st.draw();
        requestAnimationFrame(() => {
          if (cancelled) return;
          document.body.dataset.layout = JSON.stringify({ ...st.layout, triangles: st.triangles() });
          document.body.dataset.ready = '1';
        });
      } catch (e) {
        document.body.dataset.ready = 'error';
        document.body.dataset.error = String(e);
      }
    })();
    return () => {
      cancelled = true;
      dispose?.();
      canvas.remove();
    };
  }, [mood, size]);
  return (
    <>
      {/* Transparent page, and no Next dev badge over the shot. */}
      <style>{'html,body{background:transparent!important;margin:0}nextjs-portal{display:none!important}'}</style>
      <div ref={host} style={{ position: 'absolute', left: 0, top: 0, width: size, height: size }} />
    </>
  );
}

// ── The lab ─────────────────────────────────────────────────────────────

type Register = (m: Mascot, on: boolean) => void;

function Slot({
  size,
  reduced,
  register,
  label,
  style,
  onPointerDown,
}: {
  size: number;
  reduced: boolean;
  register: Register;
  label?: string;
  style?: CSSProperties;
  onPointerDown?: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState('loading');
  const [posterOk, setPosterOk] = useState(true);
  useEffect(() => {
    let alive = true;
    let mascot: Mascot | null = null;
    const t0 = performance.now();
    setStatus('loading');
    void createMascot({ size, reducedMotion: reduced }).then((m) => {
      if (!alive) {
        m?.dispose();
        return;
      }
      if (!m) {
        setStatus('no WebGL2: poster');
        return;
      }
      mascot = m;
      m.canvas.style.position = 'absolute';
      m.canvas.style.inset = '0';
      box.current?.append(m.canvas);
      register(m, true);
      setStatus(`${Math.round(performance.now() - t0)} ms (stage ${m.canvas.dataset.snapperReadyMs} ms)`);
    });
    return () => {
      alive = false;
      if (mascot) {
        register(mascot, false);
        mascot.dispose();
        mascot.canvas.remove();
      }
    };
  }, [size, reduced, register]);
  const live = status !== 'loading' && !status.startsWith('no WebGL');
  return (
    <figure className="lab-slot" style={style}>
      <div
        ref={box}
        className="lab-box"
        data-mascot=""
        style={{ width: size, height: size }}
        onPointerDown={onPointerDown}
      >
        {posterOk && !live ? (
          // A plain img on purpose: dev page, and the poster may not exist yet.
          <img
            src={size > 100 ? '/assistant/snapper-poster.webp' : '/assistant/snapper-poster-160.webp'}
            alt=""
            width={size}
            height={size}
            onError={() => setPosterOk(false)}
          />
        ) : null}
      </div>
      {label ? (
        <figcaption>
          {label} · {status}
        </figcaption>
      ) : null}
    </figure>
  );
}

function Lab() {
  const [reduced, setReduced] = useState(false);
  const [dark, setDark] = useState(false);
  const [follow, setFollow] = useState(true);
  const [active, setActiveState] = useState(true);
  const [mood, setMoodState] = useState<MascotMood>('idle');
  const [log, setLog] = useState<string[]>([]);
  const mascots = useRef(new Set<Mascot>());
  const moodRef = useRef<MascotMood>('idle');
  const activeRef = useRef(true);
  const timers = useRef<number[]>([]);
  const pokes = useRef<number[]>([]);

  const note = useCallback((s: string) => setLog((l) => [s, ...l].slice(0, 6)), []);
  const every = useCallback((f: (m: Mascot) => void) => mascots.current.forEach(f), []);
  const register = useCallback<Register>((m, on) => {
    if (on) {
      mascots.current.add(m);
      m.setMood(moodRef.current);
      m.setActive(activeRef.current);
    } else {
      mascots.current.delete(m);
    }
  }, []);

  const setMood = useCallback(
    (m: MascotMood) => {
      moodRef.current = m;
      setMoodState(m);
      every((x) => x.setMood(m));
      note(`mood: ${m}`);
    },
    [every, note],
  );

  const later = (ms: number, f: () => void) => {
    timers.current.push(window.setTimeout(f, ms));
  };
  const clearTimers = () => {
    timers.current.forEach((t) => clearTimeout(t));
    timers.current = [];
  };
  useEffect(() => clearTimers, []);

  // happy and sorry fall back to idle inside the mascot; keep the buttons honest.
  useEffect(() => {
    if (mood !== 'happy' && mood !== 'sorry') return;
    const t = window.setTimeout(() => {
      moodRef.current = 'idle';
      setMoodState('idle');
    }, mood === 'happy' ? 2800 : 2500);
    return () => clearTimeout(t);
  }, [mood]);

  const actions: Array<[string, () => void]> = [
    ['nod', () => every((m) => m.nod())],
    ['hop', () => every((m) => m.hop())],
    ['wave', () => every((m) => m.wave())],
    ['snap', () => every((m) => m.snap())],
    ['dizzy', () => every((m) => m.dizzy())],
    ['speak once', () => every((m) => m.speak(1))],
    [
      'type 3s',
      () => {
        clearTimers();
        setMood('listening');
        const end = performance.now() + 3000;
        const key = () => {
          every((m) => m.nod());
          if (performance.now() < end) later(50 + Math.random() * 180, key);
        };
        key();
      },
    ],
    [
      'think → talk',
      () => {
        clearTimers();
        setMood('thinking');
        later(2600, () => {
          setMood('talking');
          const end = performance.now() + 3500;
          const chunk = () => {
            every((m) => m.speak(0.3 + Math.random() * 0.7));
            if (performance.now() < end) later(50 + Math.random() * 90, chunk);
            else setMood('idle');
          };
          chunk();
        });
      },
    ],
    ['CTA (happy)', () => setMood('happy')],
    ['error (sorry)', () => setMood('sorry')],
  ];

  // Pointer follow.
  useEffect(() => {
    const move = (e: PointerEvent) => {
      if (follow) every((m) => m.lookAt(e.clientX, e.clientY));
    };
    const leave = () => every((m) => m.lookAt(null, null));
    window.addEventListener('pointermove', move);
    document.documentElement.addEventListener('pointerleave', leave);
    if (!follow) leave();
    return () => {
      window.removeEventListener('pointermove', move);
      document.documentElement.removeEventListener('pointerleave', leave);
    };
  }, [follow, every]);

  // Hovering a mascot makes it attentive (while idle), as the launcher will.
  useEffect(() => {
    const box = (t: EventTarget | null) => (t instanceof Element ? t.closest('[data-mascot]') : null);
    const over = (e: PointerEvent) => {
      if (box(e.target) && box(e.target) !== box(e.relatedTarget) && moodRef.current === 'idle') every((m) => m.setMood('attentive'));
    };
    const out = (e: PointerEvent) => {
      if (box(e.target) && box(e.target) !== box(e.relatedTarget) && moodRef.current === 'idle') every((m) => m.setMood('idle'));
    };
    document.addEventListener('pointerover', over);
    document.addEventListener('pointerout', out);
    return () => {
      document.removeEventListener('pointerover', over);
      document.removeEventListener('pointerout', out);
    };
  }, [every]);

  // A click snaps; three quick pokes make it dizzy (docs/ASSISTANT.md §10).
  const poke = useCallback(() => {
    const now = performance.now();
    pokes.current = [...pokes.current.filter((t) => now - t < 900), now];
    if (pokes.current.length >= 3) {
      pokes.current = [];
      every((m) => m.dizzy());
      note('three pokes: dizzy');
    } else {
      every((m) => m.snap());
      note('poke: snap');
    }
  }, [every, note]);

  const L = 80;
  const orbTop = Math.round(32 - MASCOT_FRAME.body.centreY * L);

  return (
    <div className="lab" data-dark={dark ? '' : undefined}>
      <style>{LAB_CSS}</style>
      <header className="lab-head">
        <h1>Snapper · mascot lab</h1>
        <p>Dev only. Click the big one to snap; poke it three times quickly to make it dizzy.</p>
      </header>

      <section className="lab-main">
        <Slot size={360} reduced={reduced} register={register} label="360 px" onPointerDown={poke} />
        <div className="lab-controls">
          <Group title="Mood">
            {MOODS.map((m) => (
              <button key={m} type="button" aria-pressed={mood === m} onClick={() => setMood(m)}>
                {m}
              </button>
            ))}
          </Group>
          <Group title="Gestures">
            {actions.map(([name, f]) => (
              <button
                key={name}
                type="button"
                onClick={() => {
                  f();
                  note(`action: ${name}`);
                }}
              >
                {name}
              </button>
            ))}
          </Group>
          <Group title="Options">
            <label>
              <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} /> follow pointer
            </label>
            <label>
              <input type="checkbox" checked={reduced} onChange={(e) => setReduced(e.target.checked)} /> reduced motion (remounts)
            </label>
            <label>
              <input
                type="checkbox"
                checked={active}
                onChange={(e) => {
                  activeRef.current = e.target.checked;
                  setActiveState(e.target.checked);
                  every((m) => m.setActive(e.target.checked));
                }}
              />{' '}
              active
            </label>
            <label>
              <input type="checkbox" checked={dark} onChange={(e) => setDark(e.target.checked)} /> dark page
            </label>
          </Group>
          <pre className="lab-log" aria-live="polite">
            {log.join('\n')}
          </pre>
        </div>
      </section>

      <section>
        <h2>Sizes</h2>
        <div className="lab-grid">
          {SIZES.map((s) => (
            <Slot key={s} size={s} reduced={reduced} register={register} label={`${s} px`} />
          ))}
        </div>
      </section>

      <section>
        <h2>In place</h2>
        <div className="lab-grid">
          <figure className="lab-slot">
            <div className="lab-orb">
              <Slot
                size={64}
                reduced={reduced}
                register={register}
                style={{ position: 'absolute', left: 0, top: Math.round(32 - MASCOT_FRAME.body.centreY * 64), margin: 0 }}
              />
            </div>
            <figcaption>64 px orb · 64 px canvas</figcaption>
          </figure>
          <figure className="lab-slot">
            <div className="lab-orb">
              <Slot size={L} reduced={reduced} register={register} style={{ position: 'absolute', left: (64 - L) / 2, top: orbTop, margin: 0 }} />
            </div>
            <figcaption>
              64 px orb · {L} px canvas at ({(64 - L) / 2}, {orbTop})
            </figcaption>
          </figure>
          <figure className="lab-slot">
            <div className="lab-header-mock">
              <Slot size={72} reduced={reduced} register={register} style={{ margin: '-10px 0 -10px -8px' }} />
              <div>
                <strong>Snapper</strong>
                <span>The Snap Apps assistant</span>
              </div>
            </div>
            <figcaption>panel header · 72 px canvas</figcaption>
          </figure>
        </div>
      </section>
    </div>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="lab-group">
      <legend>{title}</legend>
      {children}
    </fieldset>
  );
}

const LAB_CSS = `
.lab { --bg: #ffffff; --card: #f4f7fb; --ink: #0b111a; --ink-3: #67707b; --edge: rgb(15 30 49 / 0.1);
  min-height: 100dvh; background: var(--bg); color: var(--ink); font-family: var(--font-geist, system-ui), system-ui, sans-serif;
  padding: 24px clamp(16px, 4vw, 40px) 64px; box-sizing: border-box; }
.lab[data-dark] { --bg: #080c13; --card: #111824; --ink: #f2f5f9; --ink-3: #8f99a6; --edge: rgb(255 255 255 / 0.1); }
.lab h1 { font-size: 22px; margin: 0 0 4px; letter-spacing: -0.02em; }
.lab h2 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.12em; color: var(--ink-3); margin: 32px 0 12px; }
.lab-head p { margin: 0 0 20px; color: var(--ink-3); font-size: 14px; }
.lab-main { display: flex; flex-wrap: wrap; gap: 24px; align-items: flex-start; }
.lab-controls { flex: 1 1 320px; display: grid; gap: 12px; }
.lab-group { border: 1px solid var(--edge); border-radius: 14px; padding: 10px 12px 12px; margin: 0; display: flex; flex-wrap: wrap; gap: 8px; }
.lab-group legend { font-size: 12px; color: var(--ink-3); padding: 0 4px; }
.lab-group button { font: inherit; font-size: 13px; padding: 6px 12px; border-radius: 999px; border: 1px solid var(--edge);
  background: var(--card); color: var(--ink); cursor: pointer; }
.lab-group button:hover { border-color: #1878d8; }
.lab-group button:focus-visible { outline: 2px solid #1878d8; outline-offset: 2px; }
.lab-group button[aria-pressed='true'] { background: #1878d8; border-color: #1878d8; color: #fff; }
.lab-group label { font-size: 13px; display: inline-flex; gap: 6px; align-items: center; margin-right: 12px; }
.lab-log { margin: 0; font-size: 12px; color: var(--ink-3); min-height: 6em; white-space: pre-wrap; }
.lab-grid { display: flex; flex-wrap: wrap; gap: 20px; align-items: flex-end; }
.lab-slot { margin: 0; display: grid; gap: 6px; justify-items: center; }
.lab-slot figcaption { font-size: 11px; color: var(--ink-3); }
.lab-box { position: relative; border-radius: 12px; background: var(--card); outline: 1px dashed var(--edge); }
.lab-box img { position: absolute; inset: 0; width: 100%; height: 100%; }
.lab-orb { position: relative; width: 64px; height: 64px; border-radius: 50%; margin: 16px;
  background: var(--card); box-shadow: 0 1px 2px rgb(11 17 26 / 0.06), 0 14px 34px -14px rgb(11 17 26 / 0.3); }
.lab-orb .lab-box { background: transparent; outline: none; }
.lab-header-mock { display: flex; align-items: center; gap: 4px; width: 300px; height: 56px; padding: 0 12px; border-radius: 16px;
  background: var(--card); border: 1px solid var(--edge); overflow: hidden; }
.lab-header-mock .lab-box { background: transparent; outline: none; }
.lab-header-mock .lab-slot { flex: none; }
.lab-header-mock strong { display: block; font-size: 15px; }
.lab-header-mock span { font-size: 12px; color: var(--ink-3); }
`;
