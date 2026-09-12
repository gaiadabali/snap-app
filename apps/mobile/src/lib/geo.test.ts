import { describe, expect, it } from 'vitest';

import { haversineMetres, metresToKm, shouldCount, tripDistanceMetres, type Fix } from './geo';

/**
 * Trip measurement.
 *
 * A logbook is a tax record, and every fault here biases a deduction. The two
 * that matter are the ones a real drive produces: a phone parked at a truck
 * stop wandering with GPS drift, and a bad fix that jumps to another suburb.
 * Both inflate a claim, which is the direction of error that gets a taxpayer
 * into trouble rather than merely out of pocket.
 */

const fix = (latitude: number, longitude: number, accuracy = 8, t = 0): Fix => ({
  latitude,
  longitude,
  accuracy,
  timestamp: t,
});

// Two real points ~5 km apart on the Hume: Goulburn and just north of it.
const GOULBURN = fix(-34.7515, 149.7209);
const NORTH = fix(-34.7065, 149.7209, 8, 300_000);

describe('haversine', () => {
  it('measures a known separation', () => {
    // 0.045° of latitude is very close to 5.0 km.
    const m = haversineMetres(GOULBURN, NORTH);
    expect(m).toBeGreaterThan(4_900);
    expect(m).toBeLessThan(5_100);
  });

  it('is zero for the same point', () => {
    expect(haversineMetres(GOULBURN, GOULBURN)).toBe(0);
  });

  it('is symmetric', () => {
    expect(haversineMetres(GOULBURN, NORTH)).toBeCloseTo(haversineMetres(NORTH, GOULBURN), 6);
  });
});

describe('which fixes count', () => {
  it('counts real movement', () => {
    expect(shouldCount(GOULBURN, NORTH).count).toBe(true);
  });

  it('discards a fix too vague to measure with', () => {
    const vague = { ...NORTH, accuracy: 400 };
    expect(shouldCount(GOULBURN, vague)).toMatchObject({ count: false, reason: 'accuracy' });
  });

  it('ignores GPS drift while parked', () => {
    // ~11 m of wander with 20 m accuracy: noise, not a trip.
    const drift = fix(-34.7516, 149.7209, 20, 60_000);
    expect(shouldCount({ ...GOULBURN, accuracy: 20 }, drift)).toMatchObject({
      count: false,
      reason: 'noise',
    });
  });

  it('rejects a jump no vehicle could make', () => {
    // 5 km in two seconds is 9,000 km/h — a tower handover, not a drive.
    const teleport = { ...NORTH, timestamp: 2_000 };
    expect(shouldCount(GOULBURN, teleport)).toMatchObject({
      count: false,
      reason: 'implausible',
    });
  });
});

describe('trip distance', () => {
  it('sums a sequence', () => {
    const path = [
      fix(-34.7515, 149.7209, 8, 0),
      fix(-34.7065, 149.7209, 8, 300_000),
      fix(-34.6615, 149.7209, 8, 600_000),
    ];
    const m = tripDistanceMetres(path);
    expect(m).toBeGreaterThan(9_800);
    expect(m).toBeLessThan(10_200);
  });

  it('does not accumulate a stationary phone', () => {
    // An hour parked, drifting a few metres each minute.
    const parked: Fix[] = Array.from({ length: 60 }, (_, i) =>
      fix(-34.7515 + (i % 2 ? 0.00004 : -0.00004), 149.7209, 15, i * 60_000),
    );
    expect(tripDistanceMetres(parked)).toBe(0);
  });

  it('never adopts a rejected fix as the new position', () => {
    // If a bad fix became the baseline, the following good fix would measure
    // from the wrong place and log distance that was never driven.
    const path = [
      fix(-34.7515, 149.7209, 8, 0),
      fix(-30.0, 149.7209, 500, 60_000), // 500 m accuracy: discarded
      fix(-34.7065, 149.7209, 8, 300_000),
    ];
    const m = tripDistanceMetres(path);
    expect(m).toBeGreaterThan(4_900);
    expect(m).toBeLessThan(5_100);
  });

  it('handles one fix, or none', () => {
    expect(tripDistanceMetres([])).toBe(0);
    expect(tripDistanceMetres([GOULBURN])).toBe(0);
  });
});

describe('kilometres', () => {
  it('rounds down, never up', () => {
    // Rounding up on every trip over-states a year's claim, and the taxpayer
    // carries that risk — not the app.
    expect(metresToKm(1_999)).toBe(1.9);
    expect(metresToKm(1_950)).toBe(1.9);
    expect(metresToKm(2_000)).toBe(2);
    expect(metresToKm(99)).toBe(0);
  });
});
