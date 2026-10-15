// @vitest-environment happy-dom
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DUR } from '../../motion';
import { easeOut, lerpList, play, plan, rectFrom, tween } from './animate';
import { layoutChart, resolveInput, type ChartGeom, type RectMark } from './layout';
import { ChartSvg, linePath } from './render';
import { data, measure } from './testing';
import type { ChartSpec } from './types';

const bar = (over: Partial<RectMark> = {}): RectMark => ({ kind: 'rect', key: 'r0.0', x: 10, y: 100, w: 20, h: 100, fill: '#2a78d6', round: 'up', base: 'bottom', gap: false, ...over });

const geom = (series: Record<string, (number | null)[]>, type: ChartSpec['type'] = 'column', size = { w: 420, h: 280 }): ChartGeom =>
  layoutChart(resolveInput({ type }, data(series, ['a', 'b', 'c'])), size, measure);

/** Where a point of `next`'s rectangle lands under the transform `rectFrom` answers, about the bar's baseline corner. */
function apply(transform: string, r: RectMark, px: number, py: number): [number, number] {
  const m = /translate\((-?[\d.e-]+)px, (-?[\d.e-]+)px\) scale\((-?[\d.e-]+), (-?[\d.e-]+)\)/.exec(transform)!;
  const [tx, ty, sx, sy] = [1, 2, 3, 4].map((i) => Number(m[i]));
  const o = r.base === 'bottom' ? [r.x, r.y + r.h] : r.base === 'right' ? [r.x + r.w, r.y] : [r.x, r.y];
  return [o[0]! + tx! + sx! * (px - o[0]!), o[1]! + ty! + sy! * (py - o[1]!)];
}

describe('rectFrom', () => {
  it('maps the new bar onto the old one, from the baseline', () => {
    const next = bar();
    const prev = bar({ y: 150, h: 50 });
    const t = rectFrom(prev, next)!;
    // The top of the new bar lands on the top of the old one, the foot stays where it is.
    expect(apply(t, next, 10, 100)[1]).toBeCloseTo(150, 6);
    expect(apply(t, next, 10, 200)[1]).toBeCloseTo(200, 6);
    expect(apply(t, next, 30, 100)[0]).toBeCloseTo(30, 6);
  });

  it('follows a bar that moved sideways and got wider', () => {
    const next = bar({ x: 50, w: 40 });
    const prev = bar({ x: 10, w: 20 });
    const t = rectFrom(prev, next)!;
    expect(apply(t, next, 50, 200)[0]).toBeCloseTo(10, 6);
    expect(apply(t, next, 90, 200)[0]).toBeCloseTo(30, 6);
  });

  it('works from the other bases: a hanging bar, a horizontal one from the left and from the right', () => {
    for (const base of ['top', 'left', 'right'] as const) {
      const next = bar({ base, y: 40, h: 60, x: 20, w: 80 });
      const prev = bar({ base, y: 40, h: 30, x: 60, w: 40 });
      const t = rectFrom(prev, next)!;
      const [x0, y0] = apply(t, next, next.x, next.y);
      const [x1, y1] = apply(t, next, next.x + next.w, next.y + next.h);
      // The whole new rectangle lands exactly on the old one.
      expect([x0, y0, x1, y1].map((n) => Math.round(n * 1000) / 1000)).toEqual([prev.x, prev.y, prev.x + prev.w, prev.y + prev.h]);
    }
  });

  it('grows a bar that is new, or that was nothing, from its baseline', () => {
    expect(rectFrom(null, bar())).toBe('scale(1, 0)');
    expect(rectFrom(bar({ h: 0 }), bar())).toBe('scale(1, 0)');
    expect(rectFrom(null, bar({ base: 'left' }))).toBe('scale(0, 1)');
  });

  it('is nothing where nothing moved, or where there is nothing to draw', () => {
    expect(rectFrom(bar(), bar())).toBeNull();
    expect(rectFrom(bar(), bar({ h: 0 }))).toBeNull();
    expect(rectFrom(bar(), bar({ w: 0 }))).toBeNull();
  });

  it('treats a bar that changed side as new: a value that went negative does not stretch through the baseline', () => {
    expect(rectFrom(bar({ base: 'top' }), bar({ base: 'bottom' }))).toBe('scale(1, 0)');
  });
});

describe('lerpList and easeOut', () => {
  it('interpolates two lists and holds a missing end at the other\'s value', () => {
    expect(lerpList([0, 10], [10, 30], 0.5)).toEqual([5, 20]);
    expect(lerpList([Number.NaN, 4], [7, Number.NaN], 0.5).map(String)).toEqual(['7', 'NaN']);
    expect(lerpList([0], [8], 1)).toEqual([8]);
  });

  it('starts at 0, ends at 1 and leaves quickly', () => {
    expect(easeOut(0)).toBe(0);
    expect(easeOut(1)).toBe(1);
    expect(easeOut(0.5)).toBeGreaterThan(0.5);
  });
});

describe('tween', () => {
  let queue: ((t: number) => void)[] = [];
  beforeEach(() => {
    queue = [];
    vi.stubGlobal('requestAnimationFrame', (cb: (t: number) => void) => queue.push(cb));
    vi.stubGlobal('cancelAnimationFrame', () => {
      queue = [];
    });
  });
  afterEach(() => vi.unstubAllGlobals());
  const tick = (t: number) => {
    const run = queue;
    queue = [];
    run.forEach((cb) => cb(t));
  };

  it('runs 0, then eased values, then exactly 1 at the end of the time given', () => {
    const seen: number[] = [];
    tween((t) => seen.push(t), 180);
    expect(seen).toEqual([0]);
    tick(1000);
    tick(1090);
    expect(seen.at(-1)!).toBeCloseTo(easeOut(0.5), 8);
    tick(1180);
    expect(seen.at(-1)).toBe(1);
    expect(queue).toHaveLength(0);
  });

  it('stops when asked, and a stopped tween never calls back', () => {
    const seen: number[] = [];
    const stop = tween((t) => seen.push(t), 180);
    stop();
    tick(1000);
    expect(seen).toEqual([0]);
  });
});

describe('plan', () => {
  it('finds the bars that moved by key, and none for a chart that did not change', () => {
    const before = geom({ A: [10, 20, 30] });
    expect(plan(before, geom({ A: [10, 20, 30] }))).toBeNull();
    const after = geom({ A: [10, 25, 30] });
    const p = plan(before, after)!;
    expect(p.rects.map((r) => r.key)).toEqual(['r0.1']);
    expect(p.lines).toHaveLength(0);
    // A new maximum rescales the axis, and every bar moves with it.
    expect(plan(before, geom({ A: [10, 40, 30] }))!.rects).toHaveLength(3);
  });

  it('finds a line whose points moved, with its floor for an area, and not one that did not', () => {
    const p = plan(geom({ A: [1, 2, 3] }, 'line'), geom({ A: [1, 5, 3] }, 'line'))!;
    expect(p.lines).toHaveLength(1);
    expect(p.lines[0]!.key).toBe('s0');
    expect(p.dots.length).toBeGreaterThan(0);
    const area = plan(geom({ A: [1, 2, 3] }, 'area'), geom({ A: [1, 5, 3] }, 'area'))!;
    expect(area.lines[0]!.floorFrom).toBeDefined();
  });

  it('moves a marker by translation, and fades a new one in', () => {
    const p = plan(geom({ A: [1, 2] }, 'line'), geom({ A: [1, 5, 4] }, 'line'))!;
    // A different number of points: the line is replaced, the dots that existed move, the new one fades.
    expect(p.lines).toHaveLength(0);
    expect(p.dots.some((d) => d.transform === null)).toBe(true);
  });

  it('turns slices to their new angles', () => {
    const p = plan(geom({ A: [1, 1, 2] }, 'pie'), geom({ A: [3, 1, 2] }, 'pie'))!;
    expect(p.slices.length).toBeGreaterThan(0);
    expect(p.slices[0]!.to.a1).not.toBe(p.slices[0]!.from.a1);
  });

  it('plans nothing for a chart that changed size or type: that is a drag or a switch, and nothing moves under a drag', () => {
    const base = geom({ A: [1, 2, 3] });
    expect(plan(base, geom({ A: [1, 5, 3] }, 'column', { w: 500, h: 280 }))).toBeNull();
    expect(plan(base, geom({ A: [1, 5, 3] }, 'line'))).toBeNull();
  });
});

describe('play', () => {
  const svgOf = (g: ChartGeom): SVGSVGElement => {
    const host = document.createElement('div');
    host.innerHTML = renderToStaticMarkup(createElement(ChartSvg, { geom: g }));
    document.body.appendChild(host);
    return host.querySelector('svg')!;
  };

  let calls: { el: Element; frames: Keyframe[]; options: KeyframeAnimationOptions }[] = [];
  let queue: ((t: number) => void)[] = [];
  beforeEach(() => {
    calls = [];
    queue = [];
    (Element.prototype as unknown as { animate: unknown }).animate = function (this: Element, frames: Keyframe[], options: KeyframeAnimationOptions) {
      calls.push({ el: this, frames, options });
      return { finished: Promise.resolve(), cancel() {} };
    };
    vi.stubGlobal('requestAnimationFrame', (cb: (t: number) => void) => queue.push(cb));
    vi.stubGlobal('cancelAnimationFrame', () => {
      queue = [];
    });
    delete document.documentElement.dataset.motion;
  });
  afterEach(() => {
    delete (Element.prototype as unknown as { animate?: unknown }).animate;
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
    delete document.documentElement.dataset.motion;
  });

  it('animates a changed bar by transform alone, in 180ms', () => {
    // The maximum stays, so the axis does and only the one bar moves.
    const before = geom({ A: [10, 20, 30] });
    const after = geom({ A: [10, 25, 30] });
    const svg = svgOf(after);
    play(svg, before, after);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.el.getAttribute('data-k')).toBe('r0.1');
    expect(calls[0]!.options.duration).toBe(DUR.base);
    const props = new Set(calls[0]!.frames.flatMap((f) => Object.keys(f)));
    expect([...props]).toEqual(['transform']);
    expect(calls[0]!.frames[1]).toEqual({ transform: 'none' });
  });

  it('tweens a line\'s path to the new one, ending exactly on it', () => {
    const before = geom({ A: [1, 2, 3] }, 'line');
    const after = geom({ A: [1, 5, 3] }, 'line');
    const svg = svgOf(after);
    const el = svg.querySelector('[data-k="s0"]')!;
    play(svg, before, after);
    // Straight away it is where it was; a frame in, between; at the end, where it is going.
    expect(el.getAttribute('d')).toBe(linePath((before.marks.find((m) => m.key === 's0') as { pts: number[] }).pts));
    const run = (t: number) => {
      const q = queue;
      queue = [];
      q.forEach((cb) => cb(t));
    };
    run(500);
    run(590);
    const mid = el.getAttribute('d');
    expect(mid).not.toBe(linePath((after.marks.find((m) => m.key === 's0') as { pts: number[] }).pts));
    run(680);
    expect(el.getAttribute('d')).toBe(linePath((after.marks.find((m) => m.key === 's0') as { pts: number[] }).pts));
  });

  it('does nothing under reduced motion: no transform, and no script tween of a line either', () => {
    document.documentElement.dataset.motion = 'off';
    const cases: [ChartSpec['type'], Record<string, number[]>, Record<string, number[]>][] = [
      ['column', { A: [10, 20, 30] }, { A: [10, 25, 30] }],
      ['line', { A: [1, 2, 3] }, { A: [1, 5, 3] }],
      ['pie', { A: [1, 1, 2] }, { A: [3, 1, 2] }]
    ];
    for (const [type, was, now] of cases) {
      const before = geom(was, type);
      const after = geom(now, type);
      const svg = svgOf(after);
      const d = [...svg.querySelectorAll('[data-k]')].map((e) => e.getAttribute('d'));
      play(svg, before, after);
      expect(calls, type).toHaveLength(0);
      expect(queue, type).toHaveLength(0);
      expect([...svg.querySelectorAll('[data-k]')].map((e) => e.getAttribute('d')), type).toEqual(d);
    }
  });

  it('does nothing for a chart that did not change, and the stop it returns is safe to call', () => {
    const g = geom({ A: [10, 20, 30] });
    const svg = svgOf(g);
    const stop = play(svg, g, geom({ A: [10, 20, 30] }));
    expect(calls).toHaveLength(0);
    expect(() => stop()).not.toThrow();
  });

  it('stops a tween in flight when asked', () => {
    const before = geom({ A: [1, 2, 3] }, 'line');
    const after = geom({ A: [1, 5, 3] }, 'line');
    const svg = svgOf(after);
    const stop = play(svg, before, after);
    stop();
    expect(queue).toHaveLength(0);
  });
});
