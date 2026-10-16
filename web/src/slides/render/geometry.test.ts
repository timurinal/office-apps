import { describe, expect, it } from 'vitest';
import type { ShapeKind } from '../model/deck';
import { dashArray, lineEnds, SHAPE_KINDS, shapePath } from './geometry';

// Every ShapeKind, so a kind added to the contract and not here fails to compile.
const ALL: Record<ShapeKind, true> = {
  rect: true, roundRect: true, ellipse: true, triangle: true, rtTriangle: true, diamond: true, parallelogram: true,
  trapezoid: true, pentagon: true, hexagon: true, octagon: true, star5: true, star6: true, rightArrow: true,
  leftArrow: true, upArrow: true, downArrow: true, leftRightArrow: true, chevron: true, homePlate: true, plus: true,
  heart: true, cloud: true, wedgeRectCallout: true, wedgeRoundRectCallout: true, donut: true, blockArc: true, can: true,
  cube: true, bracketPair: true, bracePair: true
};

const numbers = (d: string): number[] => (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);

describe('shapePath', () => {
  it('lists every kind once', () => {
    expect([...SHAPE_KINDS].sort()).toEqual(Object.keys(ALL).sort());
  });

  for (const kind of Object.keys(ALL) as ShapeKind[]) {
    it(`draws ${kind} inside its box, at any size`, () => {
      for (const [w, h] of [[400, 200], [10, 300], [0, 0]] as const) {
        const p = shapePath(kind, w, h);
        expect(p.d.startsWith('M')).toBe(true);
        for (const part of [p.d, p.stroke ?? '', ...(p.shades ?? []).map((s) => s.d)]) {
          expect(part).not.toMatch(/NaN|Infinity/);
        }
        if (w === 0) continue; // An arc's flags are 0 and 1, which an empty box cannot contain.
        const xs = numbers(p.d);
        // Callouts point below their box; every other outline stays within it.
        const reach = kind.startsWith('wedge') ? 1.13 : 1;
        expect(Math.max(...xs)).toBeLessThanOrEqual(Math.max(w, h) * reach + 0.01);
        expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
      }
    });
  }

  it('rounds a rectangle by its adjust, as a share of the shorter side, up to a half', () => {
    expect(shapePath('roundRect', 400, 200, 0.25).d).toContain('A50 50');
    expect(shapePath('roundRect', 400, 200, 0.9).d).toContain('A100 100');
    expect(shapePath('roundRect', 400, 200, 0).d).not.toContain('A');
    // PowerPoint's default when none is given.
    expect(shapePath('roundRect', 600, 600).d).toContain('A100 100');
  });

  it('draws an unknown kind as a rectangle', () => {
    expect(shapePath('squiggle', 10, 20).d).toBe(shapePath('rect', 10, 20).d);
  });
});

describe('lines', () => {
  it('scale their dashes with their width', () => {
    expect(dashArray('dash', 2)).toBe('8 6');
    expect(dashArray('solid', 2)).toBeUndefined();
    expect(dashArray(undefined, 2)).toBeUndefined();
  });

  it('run corner to corner, the flips picking which', () => {
    expect(lineEnds(100, 50)).toEqual({ x1: 0, y1: 0, x2: 100, y2: 50 });
    expect(lineEnds(100, 50, true)).toEqual({ x1: 100, y1: 0, x2: 0, y2: 50 });
    expect(lineEnds(100, 50, false, true)).toEqual({ x1: 0, y1: 50, x2: 100, y2: 0 });
  });
});
