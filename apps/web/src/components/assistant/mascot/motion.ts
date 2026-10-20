/**
 * Snapper's behaviour: a small state machine that turns moods and one-shot
 * gestures into a Pose, through damped springs so nothing ever snaps.
 * Ported from Tunas (gaiada-web-revamp, src/scripts/chat/mascot/motion.ts),
 * with the viewfinder brackets, the scan line, the shutter and the dizzy spin
 * added and the sprout taken out.
 *
 * No three.js here; the rig (rig.ts) reads the Pose each frame.
 *
 * At t = 0 in `idle` with no gaze every oscillator is at zero, so the first
 * frame of the live canvas is exactly the poster (scripts/render-snapper-poster.py).
 */
import type { MascotMood } from './index';

export interface Pose {
  /** Float height (bob + hop), body units. */
  y: number;
  /** Squash and stretch: scale y, and x/z keeping the volume. */
  sy: number;
  sx: number;
  /** Bottom-pivot rotations: side rock and lean toward the viewer (+). */
  roll: number;
  lean: number;
  /** Centre-pivot rotations: turn toward the gaze (plus the dizzy spin), nod (+ = face down). */
  yaw: number;
  pitch: number;
  /** Gaze, -1..1, screen axes (x right, y down). */
  lookX: number;
  lookY: number;
  /** 1 open … 0 shut. */
  eyeOpen: number;
  /** 0..1: smiling ^ ^ eyes. */
  eyeHappy: number;
  /** 0..1: sad, drooping lids. */
  eyeSad: number;
  eyeScale: number;
  /** 0..1: dizzy spiral eyes, and the spiral's turn (rad). */
  swirl: number;
  swirlSpin: number;
  /** -1 frown … 1 big smile. */
  smile: number;
  /** 0..1 jaw open (talking, laughing). */
  mouthOpen: number;
  /** 0..1 rounded "o". */
  mouthO: number;
  blush: number;
  /** Arm raise (rad): the arm on screen left (wave arm) and on screen right. */
  armL: number;
  armR: number;
  /** The waving arm stretches a little so the wave reads at 64 px. */
  armLStretch: number;
  /** 0..1 while waving (the arm also swings toward the viewer). */
  wave: number;
  /** Viewfinder brackets: spread (1 = rest), turn about the face (rad), droop 0..1, lag (body units). */
  frame: number;
  frameSpin: number;
  frameDroop: number;
  frameY: number;
  /** Scan line: visibility 0..1 and position 0 (top of the docket) … 1 (bottom). */
  scan: number;
  scanPos: number;
  /** Shutter button travel 0..1 and the flash 0..1. */
  press: number;
  flash: number;
  /** Thinking dots: visibility 0..1 and ring angle. */
  orbs: number;
  orbSpin: number;
  /** Contact shadow scale 0..1 (shrinks as Snapper rises). */
  shadow: number;
  time: number;
}

const TAU = Math.PI * 2;
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const smooth = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const easeOutCubic = (x: number) => {
  const u = 1 - clamp(x, 0, 1);
  return 1 - u * u * u;
};

export class Spring {
  x: number;
  v = 0;
  target: number;
  private k = 0;
  private c = 0;
  constructor(x: number, hz: number, zeta: number) {
    this.x = x;
    this.target = x;
    this.tune(hz, zeta);
  }
  tune(hz: number, zeta: number): void {
    const w = TAU * hz;
    this.k = w * w;
    this.c = 2 * zeta * w;
  }
  step(dt: number): void {
    const a = -this.k * (this.x - this.target) - this.c * this.v;
    this.v += a * dt;
    this.x += this.v * dt;
  }
  snap(): void {
    this.x = this.target;
    this.v = 0;
  }
  get moving(): boolean {
    return Math.abs(this.v) > 1e-4 || Math.abs(this.x - this.target) > 1e-4;
  }
}

interface MoodShape {
  stretch: number;
  lean: number;
  eyeScale: number;
  happy: number;
  sad: number;
  smile: number;
  mouthO: number;
  mouthOpen: number;
  blush: number;
  bob: number;
  rock: number;
  orbs: number;
  arms: number;
  /** Bracket spread (1 = rest), whether they stop breathing (locked on), droop. */
  frame: number;
  lock: number;
  droop: number;
  scan: number;
  /** A gaze the mood imposes over the pointer (thinking looks up and aside). */
  look: [number, number] | null;
}

const MOODS: Record<MascotMood, MoodShape> = {
  idle: { stretch: 1, lean: 0, eyeScale: 1, happy: 0, sad: 0, smile: 0.55, mouthO: 0, mouthOpen: 0, blush: 0.6, bob: 1, rock: 0, orbs: 0, arms: 0, frame: 1, lock: 0, droop: 0, scan: 0, look: null },
  attentive: { stretch: 1.04, lean: 0.05, eyeScale: 1.07, happy: 0.38, sad: 0, smile: 0.95, mouthO: 0, mouthOpen: 0.22, blush: 0.9, bob: 1.25, rock: 0, orbs: 0, arms: 0.4, frame: 1.09, lock: 0, droop: 0, scan: 0, look: null },
  listening: { stretch: 1.02, lean: 0.12, eyeScale: 1.12, happy: 0, sad: 0, smile: 0.4, mouthO: 0, mouthOpen: 0, blush: 0.65, bob: 0.6, rock: 0, orbs: 0, arms: 0.12, frame: 1.04, lock: 0, droop: 0, scan: 0, look: null },
  thinking: { stretch: 1, lean: -0.03, eyeScale: 1, happy: 0, sad: 0, smile: 0.1, mouthO: 0.42, mouthOpen: 0, blush: 0.55, bob: 0.6, rock: 1, orbs: 1, arms: 0, frame: 0.9, lock: 1, droop: 0, scan: 1, look: [0.45, -0.62] },
  talking: { stretch: 1.01, lean: 0.03, eyeScale: 1.03, happy: 0.12, sad: 0, smile: 0.7, mouthO: 0, mouthOpen: 0.04, blush: 0.7, bob: 1.3, rock: 0, orbs: 0, arms: 0.14, frame: 1.02, lock: 0, droop: 0, scan: 0, look: null },
  happy: { stretch: 1.012, lean: 0.03, eyeScale: 1, happy: 1, sad: 0, smile: 1, mouthO: 0, mouthOpen: 0.5, blush: 1, bob: 1.2, rock: 0, orbs: 0, arms: 1.2, frame: 1.14, lock: 0, droop: 0, scan: 0, look: [0, 0] },
  sorry: { stretch: 0.955, lean: -0.02, eyeScale: 0.95, happy: 0, sad: 1, smile: -0.6, mouthO: 0.12, mouthOpen: 0, blush: 0.45, bob: 0.5, rock: 0, orbs: 0, arms: -0.3, frame: 0.97, lock: 0, droop: 1, scan: 0, look: [0, 0.7] },
};

/** One-shot moods fall back to idle by themselves (seconds). */
const MOOD_TTL: Partial<Record<MascotMood, number>> = { happy: 2.8, sorry: 2.5 };

const HOP_V = 1.9; // launch speed: peak ≈ 0.12 body heights
const GRAVITY = 15;
/** The shutter: press, click (flash, blink), hop. */
const SNAP = { click: 0.075, hop: 0.12, end: 0.6 };
/** The dizzy spin: two turns, a wobble, a grin. */
const DIZZY = { spin: 1.15, end: 2.95, turns: 2 };

export class Motion {
  readonly pose: Pose;
  /** Set when a sparkle burst should fire; the runtime clears it. */
  burst = false;
  /** Seconds since the last input (mood, gaze, action). */
  quiet = 0;

  private mood: MascotMood = 'idle';
  private moodAge = 0;
  private t = 0;
  private readonly reduced: boolean;

  private readonly stretch = new Spring(1, 3.2, 0.35);
  private readonly lean = new Spring(0, 2, 0.7);
  private readonly eyeScale = new Spring(1, 4, 0.5);
  private readonly happy = new Spring(0, 4, 0.9);
  private readonly sad = new Spring(0, 3, 0.95);
  private readonly smile = new Spring(0.55, 4, 0.8);
  private readonly mouthO = new Spring(0, 6, 0.8);
  private readonly mouthOpen = new Spring(0, 9, 0.75);
  private readonly blush = new Spring(0.6, 1.5, 1);
  private readonly bobAmp = new Spring(1, 1, 1);
  private readonly rockAmp = new Spring(0, 0.8, 1);
  private readonly orbs = new Spring(0, 1.1, 1);
  private readonly arms = new Spring(0, 3, 0.45);
  private readonly eyeX = new Spring(0, 5.5, 0.85);
  private readonly eyeY = new Spring(0, 5.5, 0.85);
  private readonly yaw = new Spring(0, 1.5, 0.75);
  private readonly pitch = new Spring(0, 1.5, 0.75);
  private readonly nodS = new Spring(0, 5, 0.42);
  private readonly squash = new Spring(1, 3.4, 0.25);
  private readonly talkBob = new Spring(0, 5, 0.35);
  private readonly frame = new Spring(1, 3.2, 0.42);
  private readonly frameSpin = new Spring(0, 1.7, 0.5);
  private readonly frameLag = new Spring(0, 3, 0.38);
  private readonly lock = new Spring(0, 2.5, 1);
  private readonly droop = new Spring(0, 2.2, 0.6);
  private readonly scan = new Spring(0, 2.4, 1);
  private readonly springs: Spring[];

  private pointer: [number, number] | null = null;
  private glance: [number, number] | null = null;
  private glanceLeft = 0;
  private nextGlance = 4.5;
  private blinkT = -1;
  private nextBlink = 2.6;
  private doubleBlink = false;
  private hopPhase: 0 | 1 | 2 = 0; // none, anticipation, airborne
  private hopTimer = 0;
  private hopPower = 1;
  private hy = 0;
  private vy = 0;
  private hopQueued = false;
  private hopBurst = false;
  private waveT = -1;
  private snapT = -1;
  private dizzyT = -1;
  private speakLevel = 0;
  private wiggle = 0;
  private thinkSide = 1;
  private thinkFlip = 2.6;
  private orbSpin = 0;
  private scanPhase = 0;
  private sigh = 0;

  constructor(reduced: boolean) {
    this.reduced = reduced;
    this.springs = [
      this.stretch, this.lean, this.eyeScale, this.happy, this.sad, this.smile, this.mouthO,
      this.mouthOpen, this.blush, this.bobAmp, this.rockAmp, this.orbs, this.arms, this.eyeX,
      this.eyeY, this.yaw, this.pitch, this.nodS, this.squash, this.talkBob, this.frame,
      this.frameSpin, this.frameLag, this.lock, this.droop, this.scan,
    ];
    if (reduced) {
      // Eased, never bouncy: every spring critically damped and calm.
      for (const s of this.springs) s.tune(1.6, 1);
      this.eyeX.tune(2.5, 1);
      this.eyeY.tune(2.5, 1);
      this.yaw.tune(1, 1);
      this.pitch.tune(1, 1);
      this.nodS.tune(3, 1);
      this.mouthOpen.tune(4, 1);
      this.bobAmp.target = 0;
      this.bobAmp.snap();
    }
    this.pose = {
      y: 0, sy: 1, sx: 1, roll: 0, lean: 0, yaw: 0, pitch: 0, lookX: 0, lookY: 0,
      eyeOpen: 1, eyeHappy: 0, eyeSad: 0, eyeScale: 1, swirl: 0, swirlSpin: 0,
      smile: 0.55, mouthOpen: 0, mouthO: 0, blush: 0.6,
      armL: 0, armR: 0, armLStretch: 1, wave: 0,
      frame: 1, frameSpin: 0, frameDroop: 0, frameY: 0, scan: 0, scanPos: 0, press: 0, flash: 0,
      orbs: 0, orbSpin: 0, shadow: 1, time: 0,
    };
    this.applyMood(false);
    this.compose();
  }

  get currentMood(): MascotMood {
    return this.mood;
  }

  setMood(m: MascotMood): void {
    this.quiet = 0;
    if (m === this.mood) {
      if (MOOD_TTL[m]) this.moodAge = 0; // a repeated one-shot restarts its timer
      return;
    }
    this.mood = m;
    this.moodAge = 0;
    this.applyMood(true);
  }

  /** The gaze as -1..1 screen-axis offsets, or null to face the viewer. */
  look(x: number | null, y: number | null): void {
    if (x === null || y === null) {
      if (this.pointer) this.quiet = 0;
      this.pointer = null;
      return;
    }
    const nx = clamp(x, -1, 1);
    const ny = clamp(y, -1, 1);
    if (!this.pointer || Math.abs(this.pointer[0] - nx) + Math.abs(this.pointer[1] - ny) > 0.01) this.quiet = 0;
    this.pointer = [nx, ny];
  }

  nod(): void {
    this.quiet = 0;
    const room = 1 - Math.min(1, Math.abs(this.nodS.x) / 0.16); // fast typing accumulates, never piles up
    this.nodS.v += (this.reduced ? 1.1 : 3.4) * room;
    if (!this.reduced) this.squash.v -= 0.35 * room;
  }

  hop(power = 1): void {
    this.quiet = 0;
    if (this.reduced) {
      this.nod();
      return;
    }
    if (this.hopPhase !== 0) {
      this.hopQueued = true;
      return;
    }
    this.hopPhase = 1;
    this.hopTimer = 0;
    this.hopPower = clamp(power, 0.3, 1);
  }

  wave(): void {
    this.quiet = 0;
    if (this.reduced) {
      this.nod();
      return;
    }
    if (this.waveT < 0 || this.waveT > 1.0) this.waveT = 0;
  }

  /** The shutter: press, click with a flash and a blink, a small hop. */
  snap(): void {
    this.quiet = 0;
    if (this.snapT >= 0 && this.snapT < SNAP.hop) return; // mid-press: one click at a time
    this.snapT = 0;
    if (this.reduced) return;
    this.squash.target = 1;
    this.squash.v -= 0.6;
    this.frame.v -= 1.6; // the brackets focus in, then spring back
  }

  /** Three quick pokes: a spin with spiral eyes, a wobble, then a grin. */
  dizzy(): void {
    this.quiet = 0;
    if (this.dizzyT >= 0 && this.dizzyT < DIZZY.end - 0.6) return;
    this.dizzyT = 0;
    if (this.reduced) return;
    this.squash.v += 1.4;
    this.frame.v += 1.2;
  }

  speak(level: number): void {
    this.quiet = 0;
    const l = clamp(Number.isFinite(level) ? level : 0, 0, 1);
    if (this.reduced) {
      this.speakLevel = Math.max(this.speakLevel, Math.min(0.3, l));
      return;
    }
    this.speakLevel = Math.max(this.speakLevel, 0.25 + 0.75 * l);
    // A little vowel variety so a stream of chunks does not flap like a puppet.
    this.mouthO.target = Math.random() < 0.3 ? 0.25 + Math.random() * 0.4 : 0;
    this.talkBob.v += 0.22 * l;
  }

  /** Jump straight to the mood's resting pose (posters, tests). */
  settle(m: MascotMood): void {
    this.mood = m;
    this.moodAge = 0;
    this.t = 0;
    this.orbSpin = 0;
    this.scanPhase = 0;
    this.blinkT = -1;
    this.nextBlink = 2.6;
    this.glance = null;
    this.nextGlance = 4.5;
    this.hopPhase = 0;
    this.hopQueued = false;
    this.hopBurst = false;
    this.hy = 0;
    this.vy = 0;
    this.waveT = -1;
    this.snapT = -1;
    this.dizzyT = -1;
    this.speakLevel = 0;
    this.wiggle = 0;
    this.sigh = 0;
    this.applyMood(false);
    this.mouthOpen.target = MOODS[m].mouthOpen;
    this.burst = false;
    for (const s of this.springs) s.snap();
    this.compose();
  }

  /** Whether the pose is still changing (reduced motion renders only then). */
  get busy(): boolean {
    if (!this.reduced) return true;
    if (this.blinkT >= 0 || this.snapT >= 0 || this.dizzyT >= 0) return true;
    if (this.scan.x > 0.01) return true;
    for (const s of this.springs) if (s.moving) return true;
    return this.speakLevel > 1e-3;
  }

  step(dt: number): void {
    dt = clamp(dt, 0, 1 / 20);
    this.t += dt;
    this.moodAge += dt;
    this.quiet += dt;
    const R = this.reduced;

    const ttl = MOOD_TTL[this.mood];
    if (ttl !== undefined && this.moodAge > ttl) {
      this.mood = 'idle';
      this.moodAge = 0;
      this.applyMood(false);
    }

    // Blinks: every 2–6 s, sometimes twice.
    if (this.blinkT >= 0) {
      this.blinkT += dt;
      if (this.blinkT > 0.24) {
        this.blinkT = -1;
        if (this.doubleBlink) {
          this.doubleBlink = false;
          this.nextBlink = 0.1;
        } else {
          this.nextBlink = 2 + Math.random() * 4 + (this.mood === 'thinking' ? 1.2 : 0);
        }
      }
    } else {
      this.nextBlink -= dt;
      if (this.nextBlink <= 0) {
        this.blinkT = 0;
        this.doubleBlink = Math.random() < 0.22;
      }
    }

    // Idle glances when nobody is pointing.
    if (!R && this.mood === 'idle' && !this.pointer && this.dizzyT < 0) {
      if (this.glance) {
        this.glanceLeft -= dt;
        if (this.glanceLeft <= 0) {
          this.glance = null;
          this.nextGlance = 3 + Math.random() * 4.5;
        }
      } else {
        this.nextGlance -= dt;
        if (this.nextGlance <= 0) {
          const side = Math.random() < 0.5 ? -1 : 1;
          this.glance = [side * (0.35 + Math.random() * 0.45), (Math.random() - 0.6) * 0.6];
          this.glanceLeft = 0.7 + Math.random() * 0.9;
        }
      }
    } else {
      this.glance = null;
    }

    // Thinking ponders one side, then the other.
    if (this.mood === 'thinking') {
      this.thinkFlip -= dt;
      if (this.thinkFlip <= 0) {
        this.thinkSide = -this.thinkSide;
        this.thinkFlip = 2.2 + Math.random() * 1.6;
      }
    }

    // Gaze: the mood's own, else the pointer, else a glance, else the viewer.
    const shape = MOODS[this.mood];
    let gx = 0;
    let gy = 0;
    if (shape.look) {
      gx = shape.look[0] * (this.mood === 'thinking' ? this.thinkSide : 1);
      gy = shape.look[1];
    } else if (this.pointer) {
      [gx, gy] = this.pointer;
    } else if (this.glance) {
      [gx, gy] = this.glance;
    }
    if (this.dizzyT >= 0) {
      gx = 0;
      gy = 0;
    }
    this.eyeX.target = gx;
    this.eyeY.target = gy;
    this.yaw.target = gx * 0.36;
    this.pitch.target = gy * 0.18;

    // The shutter: press, click (flash + blink), then a small hop.
    if (this.snapT >= 0) {
      const before = this.snapT;
      this.snapT += dt;
      if (before < SNAP.click && this.snapT >= SNAP.click) {
        this.blinkT = 0.02; // a squint at the flash
        this.doubleBlink = false;
      }
      if (!R && before < SNAP.hop && this.snapT >= SNAP.hop) this.hop(0.72);
      if (R && before < SNAP.hop && this.snapT >= SNAP.hop) this.nod();
      if (this.snapT > SNAP.end) this.snapT = -1;
    }

    // Dizzy: spin, wobble, grin.
    if (this.dizzyT >= 0) {
      this.dizzyT += dt;
      if (!R && this.dizzyT - dt < DIZZY.spin && this.dizzyT >= DIZZY.spin) this.frameLag.v -= 2;
      if (this.dizzyT > DIZZY.end) this.dizzyT = -1;
    }

    // Hop: anticipation, launch, flight, landing.
    if (this.hopPhase === 1) {
      this.hopTimer += dt;
      this.squash.target = 1 - 0.125 * this.hopPower;
      if (this.hopTimer > 0.11) {
        this.hopPhase = 2;
        this.vy = HOP_V * this.hopPower;
        this.squash.target = 1;
        this.squash.v += 1.3 * this.hopPower;
        this.frameLag.v -= 2.2 * this.hopPower;
        this.arms.v += 5 * this.hopPower;
        if (this.hopBurst) {
          this.burst = true;
          this.hopBurst = false;
        }
      }
    } else if (this.hopPhase === 2) {
      this.vy -= GRAVITY * dt;
      this.hy += this.vy * dt;
      if (this.hy <= 0) {
        const impact = Math.min(1, -this.vy / HOP_V);
        this.hy = 0;
        this.vy = 0;
        this.hopPhase = 0;
        this.squash.v -= 3.4 * impact;
        this.frameLag.v -= 3.2 * impact;
        if (this.hopQueued) {
          this.hopQueued = false;
          this.hopPhase = 1;
          this.hopTimer = 0;
        }
      }
    }

    // Speech: the mouth follows the chunk level and closes by itself (~120 ms).
    this.speakLevel *= Math.exp(-dt / (R ? 0.6 : 0.12));
    this.mouthOpen.target = Math.max(shape.mouthOpen, this.speakLevel * (R ? 1 : 0.85));
    if (this.speakLevel < 0.05 && this.mood !== 'thinking') this.mouthO.target = shape.mouthO;

    this.wiggle *= Math.exp(-dt / 0.75);
    this.sigh *= Math.exp(-dt / 0.9);

    // Integrate at ≥ 120 Hz so the stiff springs stay stable on slow frames.
    const n = Math.max(1, Math.ceil(dt * 120));
    const h = dt / n;
    for (let i = 0; i < n; i++) for (const s of this.springs) s.step(h);

    if (!R) this.orbSpin += dt * (0.55 + 0.35 * this.orbs.x);
    // The scan sweeps the docket top to bottom, about every 1.4 s, while it shows.
    if (this.scan.x > 0.01 || this.scan.target > 0) this.scanPhase += dt / (R ? 2.4 : 1.35);
    else this.scanPhase = 0;
    if (this.waveT >= 0) {
      this.waveT += dt;
      if (this.waveT > 1.6) this.waveT = -1;
    }
    this.compose();
  }

  private applyMood(entering: boolean): void {
    const s = MOODS[this.mood];
    this.stretch.target = s.stretch;
    this.lean.target = s.lean;
    this.eyeScale.target = s.eyeScale;
    this.happy.target = s.happy;
    this.sad.target = s.sad;
    this.smile.target = s.smile;
    this.mouthO.target = s.mouthO;
    this.blush.target = s.blush;
    this.orbs.target = s.orbs;
    this.arms.target = s.arms;
    this.frame.target = s.frame;
    this.lock.target = s.lock;
    this.droop.target = s.droop;
    this.scan.target = s.scan;
    if (!this.reduced) {
      this.bobAmp.target = s.bob;
      this.rockAmp.target = s.rock;
      // Thinking snaps the brackets in hard and holds them; everything else is soft.
      if (this.mood === 'thinking') this.frame.tune(6.5, 0.5);
      else this.frame.tune(3.2, 0.42);
    }
    if (!entering || this.reduced) return;
    switch (this.mood) {
      case 'attentive':
        this.squash.v += 1.1;
        this.frameLag.v += 1.4;
        break;
      case 'happy':
        this.wiggle = 1;
        this.hopBurst = true;
        // The brackets pop out and turn a quarter back into place. A quarter
        // turn maps the four corners onto each other, so the jump is invisible.
        this.frameSpin.x += Math.PI / 2;
        this.frame.v += 1.8;
        this.hop();
        break;
      case 'sorry':
        this.squash.v -= 1.1;
        this.frameLag.v -= 1.4;
        this.sigh = 1;
        break;
      case 'thinking':
        this.thinkSide = Math.random() < 0.5 ? -1 : 1;
        this.thinkFlip = 2.4;
        this.scanPhase = 0;
        break;
      default:
        break;
    }
  }

  private compose(): void {
    const p = this.pose;
    const t = this.t;
    const R = this.reduced;
    const bobA = R ? 0 : this.bobAmp.x;

    // Wave: raise, three waves, lower; the body leans into it.
    let wave = 0;
    let waveEnv = 0;
    if (this.waveT >= 0) {
      const w = this.waveT;
      waveEnv = smooth(0, 0.24, w) * (1 - smooth(1.25, 1.6, w));
      const swing = Math.sin((w - 0.2) * TAU * 2.5) * smooth(0.16, 0.32, w) * (1 - smooth(1.05, 1.32, w));
      wave = waveEnv * 1.72 + swing * 0.42;
    }

    // Dizzy: the spin eases out of the poke, the wobble follows, then a grin.
    let spin = 0;
    let wobble = 0;
    let swirl = 0;
    let grin = 0;
    let flail = 0;
    let frameUnwind = 0;
    if (this.dizzyT >= 0) {
      const d = this.dizzyT;
      if (!R) {
        spin = DIZZY.turns * TAU * easeOutCubic(d / DIZZY.spin);
        frameUnwind = -TAU * (1 - easeOutCubic(d / (DIZZY.spin + 0.35)));
        const wEnv = smooth(0.05, 0.4, d) * (1 - smooth(1.7, 2.5, d));
        wobble = Math.sin(d * 10.5) * 0.13 * wEnv;
        flail = smooth(0, 0.15, d) * (1 - smooth(0.9, 1.5, d));
      }
      swirl = smooth(0.08, 0.3, d) * (1 - smooth(1.85, 2.2, d));
      grin = smooth(1.95, 2.25, d) * (1 - smooth(2.6, DIZZY.end, d));
    }

    // The shutter's travel and the flash.
    let press = 0;
    let flash = 0;
    if (this.snapT >= 0) {
      const s = this.snapT;
      press = s < SNAP.click ? smooth(0, SNAP.click, s) : 1 - smooth(SNAP.click + 0.04, SNAP.click + 0.2, s);
      const f = s - SNAP.click;
      flash = f < 0 ? 0 : f < 0.025 ? f / 0.025 : Math.exp(-(f - 0.025) / 0.1);
      if (R) flash *= 0.55;
    }

    const breath = Math.sin((TAU * t) / 3.4);
    p.y = Math.sin((TAU * t) / 2.8) * 0.024 * bobA + this.talkBob.x + this.hy;
    const air = this.hopPhase === 2 ? 0.05 * clamp(this.vy / HOP_V, -1, 1) : 0;
    p.sy = this.stretch.x * this.squash.x * (1 + breath * 0.012 * bobA) * (1 + air) * (1 - 0.025 * this.sigh);
    p.sx = 1 / Math.sqrt(p.sy);
    // Leaning away from the waving arm shows it clear of the body.
    p.roll = Math.sin((TAU * t) / 4.4) * 0.06 * this.rockAmp.x - waveEnv * 0.09 + wobble;
    p.lean = this.lean.x;
    p.yaw = this.yaw.x + spin;
    p.pitch = this.pitch.x + this.nodS.x;
    p.lookX = this.eyeX.x;
    p.lookY = this.eyeY.x;

    let blink = 0;
    if (this.blinkT >= 0) {
      const b = this.blinkT;
      blink = b < 0.07 ? smooth(0, 0.07, b) : b < 0.11 ? 1 : 1 - smooth(0.11, 0.24, b);
    }
    p.eyeOpen = 1 - blink * (1 - swirl);
    p.eyeHappy = clamp(this.happy.x + waveEnv * 0.5 + grin, 0, 1);
    p.eyeSad = clamp(this.sad.x, 0, 1);
    p.eyeScale = this.eyeScale.x * (1 + 0.08 * swirl);
    p.swirl = swirl;
    p.swirlSpin = R ? 0 : t * 7;
    p.smile = clamp(this.smile.x + waveEnv * 0.3 + grin * 0.6 + swirl * 0.2, -1, 1);
    p.mouthOpen = clamp(this.mouthOpen.x + waveEnv * 0.18 + grin * 0.4, 0, 1);
    p.mouthO = clamp(this.mouthO.x + swirl * 0.55, 0, 1);
    p.blush = clamp(this.blush.x + grin * 0.4 + flash * 0.3, 0, 1);

    const armBreath = breath * 0.05 * bobA;
    p.armL = this.arms.x + armBreath + wave + flail * 1.1;
    p.armR = this.arms.x + armBreath + flail * 1.1;
    p.armLStretch = 1 + 0.3 * waveEnv;
    p.wave = waveEnv;

    // Brackets: breathe at rest, lock still when thinking, lag behind hops.
    const lock = clamp(this.lock.x, 0, 1);
    const wig = R ? 0 : this.wiggle;
    p.frame = this.frame.x * (1 + breath * 0.022 * bobA * (1 - lock)) + Math.sin(t * 19) * 0.025 * wig;
    p.frameSpin = this.frameSpin.x + frameUnwind;
    p.frameDroop = clamp(this.droop.x, -0.2, 1.3);
    p.frameY = this.frameLag.x * 0.05;

    const ph = this.scanPhase % 1;
    p.scan = clamp(this.scan.x, 0, 1);
    p.scanPos = ph < 0.82 ? smooth(0, 0.82, ph) * 0.15 + (ph / 0.82) * 0.85 : 1; // a short rest at the bottom
    p.press = press;
    p.flash = flash;

    p.orbs = clamp(this.orbs.x, 0, 1);
    p.orbSpin = this.orbSpin;
    p.shadow = 1 - clamp(p.y / 0.3, 0, 1) * 0.5;
    p.time = R ? 0 : t; // drives the dots' drift, which reduced motion stills
  }
}
