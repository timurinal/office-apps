import { describe, expect, it } from 'vitest';
import type { Box } from '../model/model';
import { smartSnap, spacingHints } from './guideSnap';

const W = 1920;
const H = 1080;
const TOL = 6;
const b = (x: number, y: number, w = 100, h = 100): Box => ({ x, y, w, h });

describe('aligning with the slide', () => {
  it('lines a box’s centre up with the slide’s centre line, and draws the line the whole height', () => {
    const r = smartSnap(b(857, 300, 200, 100), [], W, H, TOL)!;
    expect(r.dx).toBe(3);
    expect(r.dy).toBe(0);
    expect(r.guides).toEqual([{ axis: 'x', at: 960, from: 0, to: 1080 }]);
  });

  it('snaps to the slide’s edges and its horizontal centre line', () => {
    const left = smartSnap(b(4, 300), [], W, H, TOL)!;
    expect(left.dx).toBe(-4);
    const right = smartSnap(b(1920 - 100 + 5, 300), [], W, H, TOL)!;
    expect(right.dx).toBe(-5);
    const middle = smartSnap(b(300, 540 - 50 - 2), [], W, H, TOL)!;
    expect(middle.dy).toBe(2);
    expect(middle.guides).toEqual([{ axis: 'y', at: 540, from: 0, to: 1920 }]);
  });

  it('does not snap beyond the tolerance, and a larger tolerance reaches further', () => {
    expect(smartSnap(b(7, 200), [], W, H, TOL)).toBeNull();
    // Zoomed out, six screen px are more slide px.
    expect(smartSnap(b(7, 200), [], W, H, 12)?.dx).toBe(-7);
  });
});

describe('aligning with other objects', () => {
  it('lines an edge up with another object’s edge, the line running through both', () => {
    const r = smartSnap(b(504, 700, 100, 50), [b(500, 100, 300, 100)], W, H, TOL)!;
    expect(r.dx).toBe(-4);
    expect(r.guides[0]).toEqual({ axis: 'x', at: 500, from: 100, to: 750 });
  });

  it('lines centres up too', () => {
    // A box 100 wide whose centre (650) is 3 past another's centre (647.5 + ... 300 wide at 500 is 650).
    const r = smartSnap(b(603, 700, 100, 50), [b(500, 100, 300, 100)], W, H, TOL)!;
    expect(r.dx).toBe(-3);
    expect(r.guides[0]!.at).toBe(650);
  });

  it('takes the nearest of several lines', () => {
    const r = smartSnap(b(503, 700), [b(500, 0, 10, 10), b(505, 0, 10, 10)], W, H, TOL)!;
    expect(r.dx).toBe(2);
  });

  it('snaps both axes at once', () => {
    const r = smartSnap(b(498, 203, 100, 100), [b(500, 200, 300, 100)], W, H, TOL)!;
    expect([r.dx, r.dy]).toEqual([2, -3]);
    expect(r.guides.map((g) => g.axis).sort()).toEqual(['x', 'y']);
  });
});

describe('Alt', () => {
  it('turns every snap off', () => {
    expect(smartSnap(b(857, 300, 200, 100), [], W, H, TOL, { alt: true })).toBeNull();
    expect(smartSnap(b(504, 700), [b(500, 100, 300, 100)], W, H, TOL, { alt: true })).toBeNull();
  });
});

describe('a resize', () => {
  it('snaps only the edges its handle moves', () => {
    // The east handle: the right edge is 3 short of the centre line.
    const r = smartSnap(b(100, 100, 857, 50), [], W, H, TOL, { kind: 'resize', handle: 'e' })!;
    expect([r.dx, r.dy]).toEqual([3, 0]);
    // The box's own centre is within reach of the line too, and is left alone.
    expect(smartSnap(b(857, 100, 200, 50), [], W, H, TOL, { kind: 'resize', handle: 'se' })).toBeNull();
  });

  it('does not use spacing', () => {
    const others = [b(0, 480), b(200, 480)];
    expect(smartSnap(b(404, 502), others, W, H, TOL, { kind: 'resize', handle: 'e' })).toBeNull();
  });
});

describe('equal spacing', () => {
  // Two objects with a gap of 100 between them, in one row.
  const row = [b(0, 480), b(200, 480)];

  it('puts a box the same gap past the second of two', () => {
    const r = smartSnap(b(404, 502), row, W, H, TOL)!;
    expect(r.dx).toBe(-4);
    expect(r.dy).toBe(0);
    expect(r.guides).toEqual([]);
  });

  it('puts a box the same gap before the first of two', () => {
    // Before the first: 0 - 100 - 100 = -200.
    const wide = [b(500, 480), b(700, 480)];
    const r = smartSnap(b(296, 502), wide, W, H, TOL)!;
    expect(r.dx).toBe(4);
  });

  it('centres a box between two with room for it', () => {
    const apart = [b(0, 480), b(400, 480)];
    const r = smartSnap(b(197, 502), apart, W, H, TOL)!;
    // The gap is 300 and the box takes 100: 100 each side, so it starts at 200.
    expect(r.dx).toBe(3);
  });

  it('does not centre a box between two it does not fit between', () => {
    const tight = [b(0, 480), b(150, 480)];
    expect(smartSnap(b(75, 502, 100, 100), tight, W, H, TOL)).toBeNull();
  });

  it('needs the others to share a row with the box', () => {
    // The same two, but far above the box: no row.
    expect(smartSnap(b(404, 800), [b(0, 100), b(200, 100)], W, H, TOL)).toBeNull();
  });

  it('works down a column too', () => {
    const column = [b(480, 0), b(480, 200)];
    const r = smartSnap(b(502, 404), column, W, H, TOL)!;
    expect(r.dy).toBe(-4);
    expect(r.dx).toBe(0);
  });

  it('leaves an axis alone that already lined up', () => {
    // The box's left edge is 3 from another object's left edge, so that is the answer on x.
    const r = smartSnap(b(203, 502), [...row, b(200, 100, 60, 60)], W, H, TOL)!;
    expect(r.dx).toBe(-3);
    expect(r.guides.some((g) => g.axis === 'x')).toBe(true);
  });

  it('is not used for a gap past the tolerance', () => {
    expect(smartSnap(b(412, 502), row, W, H, TOL)).toBeNull();
  });
});

describe('where to mark equal gaps', () => {
  it('marks both gaps when a box repeats the gap between two others', () => {
    const hints = spacingHints(b(400, 502), [b(0, 480), b(200, 480)]);
    expect(hints).toEqual([
      { axis: 'x', from: 100, to: 200, at: 530 },
      { axis: 'x', from: 300, to: 400, at: 541 }
    ]);
  });

  it('marks both sides of a box with equal room on each', () => {
    const hints = spacingHints(b(200, 480), [b(0, 480), b(400, 480)]);
    expect(hints.map((h) => [h.from, h.to])).toEqual([[100, 200], [300, 400]]);
  });

  it('marks nothing when the gaps differ', () => {
    expect(spacingHints(b(450, 502), [b(0, 480), b(200, 480)])).toEqual([]);
    expect(spacingHints(b(200, 480), [b(0, 480), b(410, 480)])).toEqual([]);
  });

  it('marks down a column', () => {
    const hints = spacingHints(b(502, 400), [b(480, 0), b(480, 200)]);
    expect(hints.map((h) => [h.axis, h.from, h.to])).toEqual([['y', 100, 200], ['y', 300, 400]]);
  });

  it('ignores objects that are touching, which have no gap to repeat', () => {
    expect(spacingHints(b(200, 480), [b(0, 480), b(100, 480)])).toEqual([]);
  });
});
