import { describe, expect, it } from 'vitest';
import { applyResizeSnap, edgesFor, snapBox } from './snap';

describe('snapping', () => {
  it('centres on the slide', () => {
    const r = snapBox({ x: 857, y: 300, w: 200, h: 100 }, [], 1920, 1080, 6)!;
    expect(r.dx).toBe(3);
    expect(r.dy).toBe(0);
    expect(r.guides).toEqual([{ axis: 'x', at: 960, from: 0, to: 1080 }]);
  });

  it('lines up with another element’s edge, and the guide spans both', () => {
    const r = snapBox({ x: 504, y: 700, w: 100, h: 50 }, [{ x: 500, y: 100, w: 300, h: 100 }], 1920, 1080, 6)!;
    expect(r.dx).toBe(-4);
    expect(r.guides[0]).toEqual({ axis: 'x', at: 500, from: 100, to: 750 });
  });

  it('takes the nearest, and nothing beyond the tolerance', () => {
    expect(snapBox({ x: 100, y: 100, w: 10, h: 10 }, [], 1920, 1080, 6)).toBeNull();
    const r = snapBox({ x: 3, y: 1077 - 10, w: 10, h: 10 }, [], 1920, 1080, 6)!;
    expect([r.dx, r.dy]).toEqual([-3, 3]);
  });

  it('a resize snaps only the edges its handle moves', () => {
    expect(edgesFor('resize', 'se')).toEqual({ x: [1], y: [1] });
    expect(edgesFor('resize', 'n')).toEqual({ x: [], y: [0] });
    const r = snapBox({ x: 100, y: 100, w: 857, h: 50 }, [], 1920, 1080, 6, edgesFor('resize', 'e'))!;
    expect(r.dx).toBe(3);
    expect(applyResizeSnap({ x: 100, y: 100, w: 857, h: 50 }, 'e', r.dx, r.dy)).toEqual({ x: 100, y: 100, w: 860, h: 50 });
    expect(applyResizeSnap({ x: 100, y: 100, w: 50, h: 50 }, 'nw', -2, 4)).toEqual({ x: 98, y: 104, w: 52, h: 46 });
  });
});
