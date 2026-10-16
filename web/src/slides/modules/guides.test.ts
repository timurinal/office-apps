import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SlideJSON } from '../model/deck';
import { box } from '../model/testing';
import { guidesModule } from './guides';
import { guidesOn, setGuides, toggleGuides } from './guidesState';
import type { CanvasDrag, SnapContext } from './types';

afterEach(() => {
  setGuides(true);
  vi.unstubAllGlobals();
});

const slide = (...els: ReturnType<typeof box>[]): SlideJSON => ({ id: 's', layout: 'blank', elements: els.map((e, i) => ({ ...e, id: `e${i}` })) });

const ctxFor = (s: SlideJSON, drag: Partial<CanvasDrag> = {}, scale = 1): SnapContext => ({
  ctx: {} as SnapContext['ctx'],
  slide: s,
  drag: { kind: 'move', ids: ['e0'], box: { x: 0, y: 0, w: 100, h: 100 }, handle: null, ...drag },
  width: 1920,
  height: 1080,
  scale
});

const snap = guidesModule.snap!;

describe('whether guides are on', () => {
  it('start on, and the switch turns them off and on', () => {
    expect(guidesOn()).toBe(true);
    toggleGuides();
    expect(guidesOn()).toBe(false);
    toggleGuides();
    expect(guidesOn()).toBe(true);
  });

  it('is remembered in this browser, and the guides are on without one', async () => {
    const saved = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => saved.get(k) ?? null,
      setItem: (k: string, v: string) => void saved.set(k, v),
      removeItem: (k: string) => void saved.delete(k)
    });
    vi.resetModules();
    const first = await import('./guidesState');
    expect(first.guidesOn()).toBe(true);
    first.setGuides(false);
    expect([...saved.values()]).toEqual(['off']);
    vi.resetModules();
    const second = await import('./guidesState');
    expect(second.guidesOn()).toBe(false);
    second.setGuides(true);
    expect(saved.size).toBe(0);
  });

  it('survives a browser that will not store it', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      }
    });
    vi.resetModules();
    const m = await import('./guidesState');
    expect(m.guidesOn()).toBe(true);
    m.setGuides(false);
    expect(m.guidesOn()).toBe(false);
  });
});

describe('the snap rule', () => {
  it('pulls a moved box onto the slide’s centre line, and draws it', () => {
    const r = snap({ x: 857, y: 300, w: 200, h: 100 }, ctxFor(slide(box(857, 300, 200, 100))))!;
    expect([r.dx, r.dy]).toEqual([3, 0]);
    expect(r.guides).toEqual([{ axis: 'x', at: 960, from: 0, to: 1080 }]);
  });

  it('ignores the objects being dragged, and lines up with the others', () => {
    // e0 is dragged and sits exactly where it would line up with itself; e1 is the other object.
    const s = slide(box(504, 700, 100, 50), box(500, 100, 300, 100));
    const r = snap({ x: 504, y: 700, w: 100, h: 50 }, ctxFor(s))!;
    expect(r.dx).toBe(-4);
    expect(r.guides[0]).toEqual({ axis: 'x', at: 500, from: 100, to: 750 });
  });

  it('reaches six screen px, so further in slide px when the slide is small on screen', () => {
    expect(snap({ x: 10, y: 300, w: 100, h: 100 }, ctxFor(slide(box(10, 300))))).toBeNull();
    expect(snap({ x: 10, y: 300, w: 100, h: 100 }, ctxFor(slide(box(10, 300)), {}, 0.5))!.dx).toBe(-10);
  });

  it('snaps only the edge a resize moves', () => {
    const r = snap({ x: 100, y: 100, w: 857, h: 50 }, ctxFor(slide(box(100, 100, 857, 50)), { kind: 'resize', handle: 'e' }))!;
    expect([r.dx, r.dy]).toEqual([3, 0]);
  });

  it('has no say about a turn or a marquee', () => {
    expect(snap({ x: 857, y: 300, w: 200, h: 100 }, ctxFor(slide(), { kind: 'rotate' }))).toBeNull();
    expect(snap({ x: 857, y: 300, w: 200, h: 100 }, ctxFor(slide(), { kind: 'marquee' }))).toBeNull();
  });

  it('with guides off, answers "nowhere to go", so core’s own rule is not asked', () => {
    setGuides(false);
    expect(snap({ x: 857, y: 300, w: 200, h: 100 }, ctxFor(slide(box(857, 300, 200, 100))))).toEqual({ dx: 0, dy: 0, guides: [] });
  });
});

describe('the canvas layer', () => {
  const layer = guidesModule.canvas![0]!;
  it('is drawn only during a drag', () => {
    const frame = { slide: slide(), scale: 1, width: 1920, height: 1080, drag: null };
    expect(layer.render({} as never, frame)).toBeNull();
    expect(layer.render({} as never, { ...frame, drag: { kind: 'move', ids: [], box: { x: 0, y: 0, w: 1, h: 1 }, handle: null } })).not.toBeNull();
  });
});
