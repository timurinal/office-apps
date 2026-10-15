import { describe, expect, it } from 'vitest';
import { placeFloat } from './hooks';

const VIEW = { width: 1000, height: 700 };
const SIZE = { width: 300, height: 120 };

describe('placing a floating panel', () => {
  it('goes under the anchor, flush with its left edge', () => {
    expect(placeFloat({ top: 200, left: 400, bottom: 220 }, SIZE, VIEW)).toEqual({ top: 226, left: 400 });
  });

  it('is kept inside the window at the right', () => {
    expect(placeFloat({ top: 200, left: 950, bottom: 220 }, SIZE, VIEW).left).toBe(1000 - 300 - 12);
  });

  it('is kept inside the window at the left', () => {
    expect(placeFloat({ top: 200, left: -40, bottom: 220 }, SIZE, VIEW).left).toBe(12);
  });

  it('goes above the anchor when there is no room below', () => {
    const at = placeFloat({ top: 600, left: 100, bottom: 620 }, SIZE, VIEW);
    expect(at.top).toBe(600 - 6 - 120);
  });

  it('stays below when it fits in neither place, rather than off the top', () => {
    const at = placeFloat({ top: 50, left: 100, bottom: 70 }, { width: 300, height: 640 }, VIEW);
    expect(at.top).toBeGreaterThanOrEqual(12);
    expect(at.top + 640).toBeLessThanOrEqual(700 - 12 + 1);
  });
});
