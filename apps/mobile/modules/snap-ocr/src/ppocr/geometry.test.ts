import { describe, expect, it } from 'vitest';

import { boxOf, scaleQuad, unionBoxes } from './geometry';

describe('boxOf', () => {
  it('returns the axis-aligned bounds of an unrotated quad', () => {
    const box = boxOf([10, 20, 110, 20, 110, 60, 10, 60]);
    expect(box.x).toBe(10);
    expect(box.y).toBe(20);
    expect(box.width).toBe(100);
    expect(box.height).toBe(40);
    expect(box.rotation).toBe(0);
  });

  it('reports a non-zero rotation for a tilted line', () => {
    // A line tilted 10 degrees: top-right sits above top-left.
    const angle = (10 * Math.PI) / 180;
    const tl = { x: 0, y: 20 };
    const tr = { x: 100 * Math.cos(angle), y: 20 - 100 * Math.sin(angle) };
    const box = boxOf([tl.x, tl.y, tr.x, tr.y, tr.x, tr.y + 40, tl.x, tl.y + 40]);
    expect(box.rotation).toBeCloseTo(-10, 1);
  });

  it('rejects anything that is not 4 points', () => {
    expect(() => boxOf([0, 0, 1, 1])).toThrow();
  });
});

describe('scaleQuad', () => {
  it('scales x and y coordinates independently', () => {
    const scaled = scaleQuad([1, 2, 3, 4, 5, 6, 7, 8], 2, 10);
    expect(scaled).toEqual([2, 20, 6, 40, 10, 60, 14, 80]);
  });

  it('round-trips through boxOf: scaling then bounding equals bounding then scaling', () => {
    const quad = [10, 20, 110, 20, 110, 60, 10, 60];
    const scaled = scaleQuad(quad, 2, 3);
    const boxFromScaled = boxOf(scaled);
    const boxFromOriginal = boxOf(quad);
    expect(boxFromScaled.x).toBeCloseTo(boxFromOriginal.x * 2);
    expect(boxFromScaled.y).toBeCloseTo(boxFromOriginal.y * 3);
    expect(boxFromScaled.width).toBeCloseTo(boxFromOriginal.width * 2);
    expect(boxFromScaled.height).toBeCloseTo(boxFromOriginal.height * 3);
  });
});

describe('unionBoxes', () => {
  it('unions two disjoint boxes into their bounding box', () => {
    const union = unionBoxes([
      { x: 0, y: 0, width: 10, height: 10 },
      { x: 50, y: 40, width: 5, height: 5 },
    ]);
    expect(union).toEqual({ x: 0, y: 0, width: 55, height: 45 });
  });

  it('a single box unions to itself', () => {
    const box = { x: 3, y: 4, width: 10, height: 10 };
    expect(unionBoxes([box])).toEqual(box);
  });

  it('refuses an empty list rather than returning a fake zero box', () => {
    expect(() => unionBoxes([])).toThrow();
  });
});
