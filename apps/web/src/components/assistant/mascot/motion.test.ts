import { describe, expect, it } from 'vitest';

import { Motion, type Pose } from './motion';
import { CHEEK, EYE, field, frontZ, GAZE_SLIDE, MOUTH_SPOT, PLATE } from './shape';

const run = (m: Motion, seconds: number, each?: (p: Pose) => void) => {
  for (let t = 0; t < seconds; t += 1 / 60) {
    m.step(1 / 60);
    each?.(m.pose);
  }
};
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

describe('Snapper motion', () => {
  it('starts on exactly the poster pose', () => {
    const live = new Motion(false);
    const poster = new Motion(false);
    poster.settle('idle');
    expect(live.pose).toEqual(poster.pose);
    expect(live.pose.y).toBe(0);
    expect(live.pose.yaw).toBe(0);
    expect(live.pose.flash).toBe(0);
  });

  it('happy and sorry fall back to idle by themselves', () => {
    const m = new Motion(false);
    m.setMood('happy');
    run(m, 3.1);
    expect(m.currentMood).toBe('idle');
    m.setMood('sorry');
    run(m, 2.7);
    expect(m.currentMood).toBe('idle');
  });

  it('happy pops the brackets a quarter-turn (an invisible jump) and turns them back', () => {
    const m = new Motion(false);
    m.setMood('happy');
    m.step(1 / 60);
    expect(m.pose.frameSpin).toBeGreaterThan(1.3);
    run(m, 2.5);
    expect(Math.abs(m.pose.frameSpin)).toBeLessThan(0.02);
  });

  it('snap presses, flashes once and lets go', () => {
    const m = new Motion(false);
    let flash = 0;
    let press = 0;
    m.snap();
    run(m, 0.7, (p) => {
      flash = Math.max(flash, p.flash);
      press = Math.max(press, p.press);
    });
    expect(flash).toBeGreaterThan(0.9);
    expect(press).toBeGreaterThan(0.9);
    expect(m.pose.flash).toBeLessThan(0.01);
    expect(m.pose.press).toBe(0);
  });

  it('dizzy spins with spiral eyes and lands facing front', () => {
    const m = new Motion(false);
    let swirl = 0;
    let spun = 0;
    m.dizzy();
    run(m, 3.1, (p) => {
      swirl = Math.max(swirl, p.swirl);
      spun = Math.max(spun, p.yaw);
    });
    expect(swirl).toBeGreaterThan(0.95);
    expect(spun).toBeGreaterThan(Math.PI * 3.5);
    expect(m.pose.swirl).toBe(0);
    expect(Math.abs(wrap(m.pose.yaw))).toBeLessThan(0.02);
    expect(Math.abs(wrap(m.pose.frameSpin))).toBeLessThan(0.02);
  });

  it('reduced motion never leaves the ground or spins', () => {
    const m = new Motion(true);
    let high = 0;
    let turn = 0;
    m.snap();
    m.hop();
    m.dizzy();
    m.setMood('happy');
    run(m, 3.5, (p) => {
      high = Math.max(high, Math.abs(p.y));
      turn = Math.max(turn, Math.abs(p.yaw));
    });
    expect(high).toBeLessThan(1e-6);
    expect(turn).toBeLessThan(1e-6);
  });

  it('never produces a non-finite pose', () => {
    const m = new Motion(false);
    const moods = ['idle', 'attentive', 'listening', 'thinking', 'talking', 'happy', 'sorry'] as const;
    for (let i = 0; i < 400; i++) {
      const k = i % 9;
      if (k === 0) m.setMood(moods[i % moods.length]!);
      if (k === 1) m.speak(Math.random());
      if (k === 2) m.look(Math.random() * 2 - 1, Math.random() * 2 - 1);
      if (k === 3) m.nod();
      if (k === 4 && i % 27 === 4) m.snap();
      if (k === 5 && i % 45 === 5) m.dizzy();
      if (k === 6 && i % 36 === 6) m.wave();
      if (k === 7 && i % 54 === 7) m.hop();
      m.step(i % 13 === 0 ? 0.2 : 1 / 60);
      for (const v of Object.values(m.pose)) expect(Number.isFinite(v)).toBe(true);
    }
  });
});

describe('Snapper shape', () => {
  it('the front height field lies on the body surface', () => {
    for (const [x, y] of [[0, 0.5], [0.2, 0.7], [-0.3, 0.25], [0.31, 0.86]] as const) {
      const z = frontZ(x, y);
      expect(z).toBeGreaterThan(0.1);
      expect(Math.abs(field(x, y, z))).toBeLessThan(1e-6);
    }
  });

  it('the face stays on the docket at full gaze', () => {
    for (const s of [-1, 1]) {
      const outer = s * (EYE.x + GAZE_SLIDE.x + EYE.a * 1.15);
      expect(Math.abs(outer)).toBeLessThan(PLATE.halfW);
      expect(EYE.y + GAZE_SLIDE.y + EYE.b * 1.15).toBeLessThan(PLATE.top);
      // The blush fades out well inside its patch; its visible part stays on the paper.
      expect(CHEEK.x + GAZE_SLIDE.x * 0.85 + CHEEK.a * 0.7).toBeLessThan(PLATE.halfW);
    }
    expect(MOUTH_SPOT.y - MOUTH_SPOT.b - GAZE_SLIDE.y).toBeGreaterThan(PLATE.bottom);
  });
});
