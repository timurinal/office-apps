// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { animate, DUR, ENTER, motionOff, withoutMovement } from './index';
import { boxOf, invert } from './flip';
import { viewTransition } from './viewTransition';

afterEach(() => {
  delete document.documentElement.dataset.motion;
  vi.restoreAllMocks();
});

describe('reduced motion', () => {
  it('is off when the root says so, whatever the reader asked for', () => {
    expect(motionOff()).toBe(false);
    document.documentElement.dataset.motion = 'off';
    expect(motionOff()).toBe(true);
  });

  it('is off when the reader prefers reduced motion', () => {
    vi.stubGlobal('matchMedia', (q: string) => ({
      matches: q.includes('reduce'),
      addEventListener: () => undefined,
      removeEventListener: () => undefined
    }));
    expect(motionOff()).toBe(true);
    vi.unstubAllGlobals();
  });

  it('drops the transform from every shape and keeps the opacity', () => {
    for (const [name, frames] of Object.entries(ENTER)) {
      const calm = withoutMovement(frames);
      expect(calm.every((f) => !('transform' in f)), name).toBe(true);
      expect(calm.map((f) => f.opacity), name).toEqual([0, 1]);
    }
  });

  it('runs a fade, not a movement, when movement is off', () => {
    document.documentElement.dataset.motion = 'off';
    const el = document.createElement('div');
    const animateFn = vi.fn(() => ({ finished: Promise.resolve() }) as unknown as Animation);
    (el as unknown as { animate: typeof animateFn }).animate = animateFn;
    animate(el, ENTER.pop);
    const frames = (animateFn.mock.calls[0] as unknown as [Keyframe[]])[0];
    expect(frames).toEqual([{ opacity: 0 }, { opacity: 1 }]);
  });

  it('runs nothing at all when only movement was asked for', () => {
    document.documentElement.dataset.motion = 'off';
    const el = document.createElement('div');
    const animateFn = vi.fn();
    (el as unknown as { animate: typeof animateFn }).animate = animateFn;
    expect(animate(el, [{ transform: 'translateX(4px)' }, { transform: 'none' }])).toBeNull();
    expect(animateFn).not.toHaveBeenCalled();
  });
});

describe('the durations', () => {
  it('are the design system tokens', () => {
    expect(DUR).toEqual({ instant: 80, fast: 120, base: 180, slow: 280, page: 420 });
  });
});

describe('FLIP', () => {
  const at = (x: number, y: number, w = 100, h = 40) => ({ x, y, w, h });

  it('inverts a move into the translation that undoes it', () => {
    expect(invert(at(0, 100), at(0, 40))).toEqual({ dx: 0, dy: 60, sx: 1, sy: 1 });
    expect(invert(at(30, 0), at(80, 0))).toEqual({ dx: -50, dy: 0, sx: 1, sy: 1 });
  });

  it('ignores a move too small to see', () => {
    expect(invert(at(0, 10), at(0, 10.3))).toBeNull();
  });

  it('only scales when asked to', () => {
    expect(invert(at(0, 0, 200, 40), at(0, 0, 100, 40))).toBeNull();
    expect(invert(at(0, 0, 200, 40), at(0, 0, 100, 40), { scale: true })).toEqual({ dx: 0, dy: 0, sx: 2, sy: 1 });
  });

  it('measures against the container, so a scroll is not movement', () => {
    const container = document.createElement('div');
    const el = document.createElement('div');
    container.getBoundingClientRect = () => ({ left: 10, top: 200 }) as DOMRect;
    el.getBoundingClientRect = () => ({ left: 30, top: 260, width: 50, height: 20 }) as DOMRect;
    expect(boxOf(el, container)).toEqual({ x: 20, y: 60, w: 50, h: 20 });
  });
});

describe('view transitions', () => {
  it('just runs the update where the browser has none', async () => {
    const update = vi.fn();
    await viewTransition(update);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('names the morphing elements for the length of the transition only', async () => {
    const from = document.createElement('div');
    const to = document.createElement('div');
    document.body.appendChild(from);
    document.body.appendChild(to);
    const seen: string[] = [];
    (document as unknown as { startViewTransition: unknown }).startViewTransition = (cb: () => Promise<void>) => {
      seen.push(`from:${from.style.getPropertyValue('view-transition-name')}`);
      const finished = cb().then(() => {
        seen.push(`to:${to.style.getPropertyValue('view-transition-name')}`);
      });
      return { finished };
    };
    await viewTransition(() => undefined, { from, to: () => to, name: 'card' });
    expect(seen).toEqual(['from:card', 'to:card']);
    expect(from.style.getPropertyValue('view-transition-name')).toBe('');
    expect(to.style.getPropertyValue('view-transition-name')).toBe('');
    expect(document.documentElement.classList.contains('oa-vt')).toBe(false);
    delete (document as unknown as { startViewTransition?: unknown }).startViewTransition;
  });
});
