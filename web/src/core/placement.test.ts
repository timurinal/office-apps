import { describe, expect, it } from 'vitest';
import { placeAtPoint, placeBelow, placeBeside, EDGE } from './placement';

const vp = { width: 800, height: 600 };

describe('a menu opened at a point', () => {
  it('goes down and to the right of the point', () => {
    expect(placeAtPoint({ x: 100, y: 120 }, { w: 200, h: 300 }, vp)).toMatchObject({ left: 100, top: 120, side: 'below' });
  });

  it('flips above the point where there is no room below, and left where there is none to the right', () => {
    expect(placeAtPoint({ x: 700, y: 500 }, { w: 200, h: 300 }, vp)).toMatchObject({ left: 500, top: 200, side: 'above' });
  });

  it('slides back inside when neither side has room', () => {
    const p = placeAtPoint({ x: 100, y: 300 }, { w: 200, h: 560 }, vp);
    expect(p.top).toBe(600 - 560 - EDGE);
    expect(p.top + 560).toBeLessThanOrEqual(600 - EDGE);
  });

  it('takes a height to scroll in when the menu is taller than the window', () => {
    const p = placeAtPoint({ x: 10, y: 10 }, { w: 200, h: 2000 }, vp);
    expect(p.maxHeight).toBe(600 - EDGE * 2);
    expect(p.top).toBe(EDGE);
  });

  it('is never nearer an edge than the margin', () => {
    expect(placeAtPoint({ x: 0, y: 0 }, { w: 100, h: 100 }, vp)).toMatchObject({ left: EDGE, top: EDGE });
    expect(placeAtPoint({ x: 790, y: 590 }, { w: 3000, h: 100 }, vp).left).toBeGreaterThanOrEqual(EDGE);
  });
});

describe('a dropdown under a button', () => {
  const button = { left: 100, top: 100, right: 260, bottom: 132 };

  it('opens below, at the button\'s left edge', () => {
    expect(placeBelow(button, { w: 160, h: 200 }, vp)).toMatchObject({ left: 100, top: 136, side: 'below' });
  });

  it('opens above when below is too short and above is longer', () => {
    const low = { left: 100, top: 520, right: 260, bottom: 552 };
    const p = placeBelow(low, { w: 160, h: 200 }, vp);
    expect(p.side).toBe('above');
    expect(p.top).toBe(520 - 4 - 200);
  });

  it('stays below when both sides are short but below is the longer', () => {
    const p = placeBelow({ left: 0, top: 40, right: 100, bottom: 72 }, { w: 100, h: 900 }, vp);
    expect(p.side).toBe('below');
    expect(p.maxHeight).toBe(600 - 72 - 4 - EDGE);
  });

  it('gives a height to scroll in that is the room on the side it took', () => {
    const p = placeBelow({ left: 100, top: 500, right: 260, bottom: 532 }, { w: 160, h: 900 }, vp);
    expect(p.side).toBe('above');
    expect(p.maxHeight).toBe(500 - 4 - EDGE);
    expect(p.top).toBe(500 - 4 - p.maxHeight);
  });

  it('is pulled in from the right edge', () => {
    expect(placeBelow({ left: 750, top: 100, right: 790, bottom: 132 }, { w: 200, h: 100 }, vp).left).toBe(800 - 200 - EDGE);
  });
});

describe('a submenu beside its row', () => {
  const row = { left: 100, top: 200, right: 300, bottom: 230 };

  it('goes to the right with its first row level with the parent row', () => {
    expect(placeBeside(row, { w: 180, h: 200 }, vp)).toMatchObject({ left: 296, top: 194, side: 'right' });
  });

  it('goes to the left when the right has no room', () => {
    const edge = { left: 560, top: 200, right: 760, bottom: 230 };
    const p = placeBeside(edge, { w: 180, h: 200 }, vp);
    expect(p.side).toBe('left');
    expect(p.left).toBe(560 - 180 + 4);
  });

  it('moves up where it would run off the bottom', () => {
    const p = placeBeside({ ...row, top: 560, bottom: 590 }, { w: 180, h: 300 }, vp);
    expect(p.top).toBe(600 - 300 - EDGE);
  });
});
