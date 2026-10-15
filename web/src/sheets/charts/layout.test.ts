import { describe, expect, it } from 'vitest';
import { dateToSerial } from '../engine';
import { SERIES_COLORS } from './palette';
import { MIN_H, MIN_W, effectiveLegend, layoutChart, resolveInput, tickFormatter, type ChartGeom, type LineMark, type RectMark, type SliceMark } from './layout';
import { data, measure } from './testing';
import type { ChartSpec } from './types';

type Spec = Pick<ChartSpec, 'type' | 'title' | 'options'>;
const lay = (spec: Spec, d: ReturnType<typeof data>, size = { w: 420, h: 280 }): ChartGeom => layoutChart(resolveInput(spec, d), size, measure);
const rects = (g: ChartGeom) => g.marks.filter((m): m is RectMark => m.kind === 'rect');
const lines = (g: ChartGeom) => g.marks.filter((m): m is LineMark => m.kind === 'line');
const slices = (g: ChartGeom) => g.marks.filter((m): m is SliceMark => m.kind === 'slice');
const textOf = (g: ChartGeom, prefix: string) => g.texts.filter((t) => t.key.startsWith(prefix)).map((t) => t.text);

const SPEND = data({ Total: [61_900, 65_600, 71_500, 74_000] }, ['Q1', 'Q2', 'Q3', 'Q4']);

describe('resolveInput', () => {
  it('chooses a legend when none was chosen: none for one series, below for two, at the right for a pie', () => {
    expect(effectiveLegend('column', 1)).toBe('none');
    expect(effectiveLegend('column', 2)).toBe('bottom');
    expect(effectiveLegend('pie', 1)).toBe('right');
    expect(effectiveLegend('doughnut', 1)).toBe('right');
    expect(effectiveLegend('line', 3, 'top')).toBe('top');
    expect(effectiveLegend('line', 1, 'none')).toBe('none');
  });

  it('takes series colours in order, a chosen one over the default, and an empty string for the default', () => {
    const i = resolveInput({ type: 'line', options: { colors: ['#112233', ''] } }, data({ a: [1], b: [2], c: [3] }));
    expect(i.colors).toEqual(['#112233', SERIES_COLORS[1], SERIES_COLORS[2]]);
  });

  it('colours a pie by category, not by series', () => {
    const i = resolveInput({ type: 'pie' }, data({ v: [1, 2, 3] }, ['a', 'b', 'c']));
    expect(i.colors).toHaveLength(3);
  });

  it('stacks only the types that can be stacked', () => {
    expect(resolveInput({ type: 'column', options: { stacked: true } }, SPEND).stacked).toBe(true);
    expect(resolveInput({ type: 'line', options: { stacked: true } }, SPEND).stacked).toBe(false);
    expect(resolveInput({ type: 'scatter', options: { stacked: true } }, SPEND).stacked).toBe(false);
  });
});

describe('column', () => {
  const g = lay({ type: 'column', title: 'Spend by quarter' }, SPEND);

  it('draws a bar per value, inside the plot, from the baseline', () => {
    const bars = rects(g);
    expect(bars).toHaveLength(4);
    for (const b of bars) {
      expect(b.x).toBeGreaterThanOrEqual(g.plot.x);
      expect(b.x + b.w).toBeLessThanOrEqual(g.plot.x + g.plot.w + 0.01);
      expect(b.y).toBeGreaterThanOrEqual(g.plot.y - 0.01);
      expect(b.y + b.h).toBeLessThanOrEqual(g.plot.y + g.plot.h + 0.01);
      expect(b.base).toBe('bottom');
      expect(b.round).toBe('up');
    }
    // Every bar sits on the same baseline, and a taller value is a taller bar.
    const bottoms = bars.map((b) => Math.round(b.y + b.h));
    expect(new Set(bottoms).size).toBe(1);
    const heights = bars.map((b) => b.h);
    expect([...heights].sort((a, b) => a - b)).toEqual(heights);
    // The ratio of the heights is the ratio of the values.
    expect(heights[3]! / heights[0]!).toBeCloseTo(74_000 / 61_900, 2);
  });

  it('starts the value axis at zero and rounds its top onto a tick', () => {
    const labels = textOf(g, 'ty');
    expect(labels[0]).toBe('0');
    expect(labels.at(-1)).toBe('80,000');
  });

  it('labels the categories and titles the chart', () => {
    expect(textOf(g, 'tx')).toEqual(['Q1', 'Q2', 'Q3', 'Q4']);
    expect(g.texts.find((t) => t.key === 'title')).toMatchObject({ text: 'Spend by quarter', weight: 600, size: 14 });
  });

  it('puts a value on each bar for a single series, in the cells\' own format', () => {
    const money = data({ Spend: [61_900, 65_600] }, ['Q1', 'Q2'], {});
    money.series[0]!.fmt = '£#,##0';
    const m = lay({ type: 'column' }, money);
    expect(textOf(m, 'vl')).toEqual(['£61,900', '£65,600']);
    expect(textOf(m, 'ty').at(-1)).toBe('£80,000');
  });

  it('has no legend for one series and a hover target per category', () => {
    expect(g.legend).toHaveLength(0);
    expect(g.hits).toHaveLength(4);
    expect(g.tips[0]).toEqual({ title: 'Q1', rows: [{ color: SERIES_COLORS[0], name: 'Total', value: '61,900' }] });
  });

  it('groups several series side by side with 2px between them, and a legend below', () => {
    const two = lay({ type: 'column' }, data({ A: [10, 20], B: [15, 5] }, ['x', 'y']));
    const bars = rects(two);
    expect(bars).toHaveLength(4);
    const a0 = bars.find((b) => b.key === 'r0.0')!;
    const b0 = bars.find((b) => b.key === 'r1.0')!;
    expect(b0.x - (a0.x + a0.w)).toBeCloseTo(2, 5);
    expect(two.legend.map((l) => l.text)).toEqual(['A', 'B']);
    expect(two.legend[0]!.y).toBeGreaterThan(two.plot.y + two.plot.h);
    expect(textOf(two, 'vl')).toHaveLength(0);
  });

  it('draws negative values below the axis with their rounded end downwards', () => {
    const neg = lay({ type: 'column' }, data({ P: [10, -6] }, ['a', 'b']));
    const [up, down] = rects(neg);
    expect(up!.round).toBe('up');
    expect(down!.round).toBe('down');
    expect(down!.base).toBe('top');
    // The negative bar hangs from the line the positive one stands on.
    expect(down!.y).toBeCloseTo(up!.y + up!.h, 1);
  });

  it('skips a missing value and keeps the others where they were', () => {
    const gap = lay({ type: 'column' }, data({ A: [10, null, 30] }, ['a', 'b', 'c']));
    expect(rects(gap).map((r) => r.key)).toEqual(['r0.0', 'r0.2']);
  });

  it('stacks: segments meet, only the end of the stack is rounded, and the axis spans the totals', () => {
    const s = lay({ type: 'column', options: { stacked: true } }, data({ A: [10, 20], B: [5, 5], C: [5, 0] }, ['x', 'y']));
    const first = rects(s).filter((r) => r.key.endsWith('.0'));
    expect(first.map((r) => r.round)).toEqual(['none', 'none', 'up']);
    expect(first.every((r) => r.gap)).toBe(true);
    // Each segment stands on the one below it.
    expect(first[1]!.y + first[1]!.h).toBeCloseTo(first[0]!.y, 1);
    expect(first[2]!.y + first[2]!.h).toBeCloseTo(first[1]!.y, 1);
    // The axis reaches the larger total, 25.
    expect(Number(textOf(s, 'ty').at(-1))).toBeGreaterThanOrEqual(25);
  });

  it('honours a fixed minimum and maximum', () => {
    const fixed = lay({ type: 'column', options: { yMin: 50_000, yMax: 100_000 } }, SPEND);
    const labels = textOf(fixed, 'ty');
    expect(labels[0]).toBe('50,000');
    expect(labels.at(-1)).toBe('100,000');
  });

  it('gives the axes their titles and the plot less room', () => {
    const plain = lay({ type: 'column' }, SPEND);
    const titled = lay({ type: 'column', options: { xTitle: 'Quarter', yTitle: 'Spend' } }, SPEND);
    expect(titled.texts.find((t) => t.key === 'ytitle')).toMatchObject({ text: 'Spend', rotate: -90 });
    expect(titled.texts.find((t) => t.key === 'xtitle')?.text).toBe('Quarter');
    expect(titled.plot.x).toBeGreaterThan(plain.plot.x);
    expect(titled.plot.h).toBeLessThan(plain.plot.h);
  });

  it('thins the category labels when they would touch', () => {
    const many = Array.from({ length: 30 }, (_, i) => `Category ${i + 1}`);
    const g2 = lay({ type: 'column' }, data({ v: many.map((_, i) => i + 1) }, many));
    const shown = textOf(g2, 'tx');
    expect(shown.length).toBeLessThan(30);
    expect(shown.length).toBeGreaterThan(2);
  });

  it('never draws smaller than it can be read', () => {
    const tiny = lay({ type: 'column' }, SPEND, { w: 50, h: 40 });
    expect([tiny.w, tiny.h]).toEqual([MIN_W, MIN_H]);
  });
});

describe('legend', () => {
  const three = data({ Alpha: [1, 2], Beta: [2, 3], Gamma: [3, 1] }, ['x', 'y']);

  it('at the right takes a column of the width and leaves the plot narrower', () => {
    const base = lay({ type: 'column' }, three);
    const right = lay({ type: 'column', options: { legend: 'right' } }, three);
    expect(right.plot.w).toBeLessThan(base.plot.w);
    expect(new Set(right.legend.map((l) => l.x)).size).toBe(1);
    expect(right.legend.map((l) => l.y)).toEqual([...right.legend.map((l) => l.y)].sort((a, b) => a - b));
  });

  it('on top takes a strip under the title', () => {
    const top = lay({ type: 'column', title: 'T', options: { legend: 'top' } }, three);
    const base = lay({ type: 'column', title: 'T', options: { legend: 'none' } }, three);
    expect(top.plot.y).toBeGreaterThan(base.plot.y);
    expect(top.legend[0]!.y).toBeLessThan(top.plot.y);
  });

  it('can be turned off', () => {
    expect(lay({ type: 'column', options: { legend: 'none' } }, three).legend).toHaveLength(0);
  });

  it('wraps onto more rows when the entries do not fit in one', () => {
    const names = Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`Quarterly spend ${i}`, [1, 2]]));
    const g = lay({ type: 'column' }, data(names, ['x', 'y']));
    expect(g.legend).toHaveLength(8);
    expect(new Set(g.legend.map((l) => l.y)).size).toBeGreaterThan(1);
  });

  it('is left out where it would take more than a third of the card', () => {
    const names = Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`A fairly long series name ${i}`, [1, 2]]));
    expect(lay({ type: 'column' }, data(names, ['x', 'y']), { w: 420, h: 200 }).legend).toHaveLength(0);
    expect(lay({ type: 'column', options: { legend: 'right' } }, data(names, ['x', 'y']), { w: 260, h: 280 }).legend).toHaveLength(0);
    // The plot has the room instead.
    const withLegend = lay({ type: 'column' }, three, { w: 420, h: 280 });
    expect(withLegend.legend.length).toBe(3);
  });

  it('keys a line by a short line, a scatter by a dot, a column by a swatch', () => {
    expect(lay({ type: 'line' }, three).legend[0]!.shape).toBe('line');
    expect(lay({ type: 'scatter' }, three).legend[0]!.shape).toBe('dot');
    expect(lay({ type: 'column' }, three).legend[0]!.shape).toBe('swatch');
  });
});

describe('bar', () => {
  const g = lay({ type: 'bar' }, data({ v: [10, 40, 25] }, ['Alpha', 'Beta', 'Gamma']));

  it('runs the bars left to right, the first category at the top', () => {
    const bars = rects(g);
    expect(bars.map((b) => b.base)).toEqual(['left', 'left', 'left']);
    expect(bars.map((b) => b.round)).toEqual(['right', 'right', 'right']);
    expect(bars[0]!.y).toBeLessThan(bars[1]!.y);
    expect(bars[1]!.w).toBeGreaterThan(bars[2]!.w);
    expect(bars[2]!.w).toBeGreaterThan(bars[0]!.w);
  });

  it('puts the categories down the left and the values along the bottom', () => {
    const cats = g.texts.filter((t) => t.key.startsWith('cat'));
    expect(cats.map((t) => t.text)).toEqual(['Alpha', 'Beta', 'Gamma']);
    expect(cats.every((t) => t.anchor === 'end' && t.x < g.plot.x)).toBe(true);
    expect(textOf(g, 'tx')[0]).toBe('0');
    expect(g.texts.find((t) => t.key === 'tx0')!.y).toBeGreaterThan(g.plot.y + g.plot.h);
  });
});

describe('line and area', () => {
  const g = lay({ type: 'line' }, data({ A: [1, 3, 2, 5] }, ['a', 'b', 'c', 'd']));

  it('draws one line through the points at the middle of each category, and a marker on each', () => {
    const [line] = lines(g);
    expect(line!.pts).toHaveLength(8);
    expect(g.marks.filter((m) => m.kind === 'dot')).toHaveLength(4);
    // The points rise with the values: y falls as the value rises.
    const ys = line!.pts.filter((_, i) => i % 2 === 1);
    expect(ys[1]!).toBeLessThan(ys[0]!);
    expect(ys[3]!).toBeLessThan(ys[1]!);
  });

  it('breaks the line at a gap and leaves no marker there', () => {
    const gap = lay({ type: 'line' }, data({ A: [1, null, 3] }, ['a', 'b', 'c']));
    expect(lines(gap)[0]!.pts.slice(2, 4).every(Number.isNaN)).toBe(true);
    expect(gap.marks.filter((m) => m.kind === 'dot')).toHaveLength(2);
  });

  it('gives each series another marker shape, so colour is not the only difference', () => {
    const two = lay({ type: 'line' }, data({ A: [1, 2], B: [2, 1] }, ['a', 'b']));
    const shapes = new Set(two.marks.flatMap((m) => (m.kind === 'dot' ? [m.shape] : [])));
    expect(shapes.size).toBe(2);
  });

  it('has no markers when there are too many points to read, and still has hover targets', () => {
    const n = 60;
    const long = lay({ type: 'line' }, data({ A: Array.from({ length: n }, (_, i) => i) }, Array.from({ length: n }, (_, i) => `p${i}`)));
    expect(long.marks.filter((m) => m.kind === 'dot')).toHaveLength(0);
    expect(long.hits).toHaveLength(n);
  });

  it('does not start at zero for a narrow band, and does for a wide one', () => {
    const narrow = lay({ type: 'line' }, data({ A: [9_800, 10_000, 10_200] }, ['a', 'b', 'c']));
    expect(Number(textOf(narrow, 'ty')[0]!.replace(/,/g, ''))).toBeGreaterThan(0);
    const wide = lay({ type: 'line' }, data({ A: [1, 50, 100] }, ['a', 'b', 'c']));
    expect(textOf(wide, 'ty')[0]).toBe('0');
  });

  it('puts dates on a time axis: spaced by the days between them, ticked on month starts', () => {
    const d = (m: number, day = 1) => dateToSerial(2025, m, day);
    const dated = data({ Sales: [10, 20, 30] }, ['', '', ''], { x: [d(1), d(2), d(4)], xDate: true, xFmt: 'dd/mm/yyyy' });
    const t = lay({ type: 'line' }, dated);
    const pts = lines(t)[0]!.pts;
    const gap1 = pts[2]! - pts[0]!;
    const gap2 = pts[4]! - pts[2]!;
    // January to February is 31 days, February to April 59.
    expect(gap2 / gap1).toBeCloseTo(59 / 31, 2);
    expect(textOf(t, 'tx')).toEqual(expect.arrayContaining(['Feb 2025', 'Mar 2025']));
    expect(t.hits.every((h) => h.kind === 'rect' && h.guide !== undefined)).toBe(true);
  });

  it('fills an area down to the baseline', () => {
    const a = lay({ type: 'area' }, data({ A: [1, 3, 2] }, ['a', 'b', 'c']));
    const [mark] = lines(a);
    expect(mark!.floor).toHaveLength(3);
    expect(new Set(mark!.floor).size).toBe(1);
    expect(a.marks.filter((m) => m.kind === 'dot')[0]).toMatchObject({ shape: 0 });
  });

  it('stacks areas: each series\' floor is the one below it', () => {
    const a = lay({ type: 'area', options: { stacked: true } }, data({ A: [1, 1], B: [2, 2] }, ['a', 'b']));
    const [first, second] = lines(a);
    expect(second!.floor).toEqual(first!.pts.filter((_, i) => i % 2 === 1));
  });
});

describe('scatter', () => {
  const xy = data({ Weight: [50, 58, 66] }, ['150', '160', '170'], { x: [150, 160, 170] });
  const g = lay({ type: 'scatter' }, xy);

  it('puts each point at its x and y, on numeric axes', () => {
    const dots = g.marks.filter((m) => m.kind === 'dot');
    expect(dots).toHaveLength(3);
    const [a, b, c] = dots.map((d) => d.kind === 'dot' ? d.x : 0);
    expect((c! - b!) / (b! - a!)).toBeCloseTo(1, 5);
    expect(textOf(g, 'tx').length).toBeGreaterThan(2);
  });

  it('puts dates on the horizontal axis as dates, ticked on the first of the month', () => {
    const d = (m: number, day = 1) => dateToSerial(2025, m, day);
    const dated = lay({ type: 'scatter' }, data({ Sales: [10, 20, 30] }, ['', '', ''], { x: [d(1, 10), d(3, 5), d(5, 20)], xDate: true, xFmt: 'dd/mm/yyyy' }));
    const ticks = textOf(dated, 'tx');
    expect(ticks).toEqual(expect.arrayContaining(['Mar 2025']));
    expect(ticks.every((t) => /^[A-Z][a-z]{2} \d{4}$/.test(t))).toBe(true);
    // And the tooltip says the date as the cells do.
    expect(dated.tips[0]!.rows[0]).toEqual({ name: 'x', value: '10/01/2025' });
  });

  it('honours fixed limits on the horizontal axis', () => {
    const g2 = lay({ type: 'scatter', options: { xMin: 100, xMax: 300 } }, xy);
    expect(textOf(g2, 'tx')[0]).toBe('100');
    expect(textOf(g2, 'tx').at(-1)).toBe('300');
  });

  it('answers a pointer within 12px of a point', () => {
    expect(g.hits).toHaveLength(3);
    expect(g.hits.every((h) => h.kind === 'circle' && h.r === 12)).toBe(true);
    expect(g.tips[0]!.rows.map((r) => r.name)).toEqual(['x', 'y']);
  });

  it('counts 1, 2, 3 along x when there are no x values', () => {
    const none = lay({ type: 'scatter' }, data({ v: [3, 1, 2] }));
    const xs = none.marks.flatMap((m) => (m.kind === 'dot' ? [m.x] : []));
    expect(xs[1]! - xs[0]!).toBeCloseTo(xs[2]! - xs[1]!, 5);
  });
});

describe('pie and doughnut', () => {
  const d = data({ Share: [50, 30, 20] }, ['Salaries', 'Rent', 'Other']);

  it('divides the circle by value, clockwise from twelve', () => {
    const g = lay({ type: 'pie' }, d);
    const s = slices(g);
    expect(s).toHaveLength(3);
    expect(s[0]!.a0).toBe(0);
    expect(s.at(-1)!.a1).toBeCloseTo(Math.PI * 2, 8);
    expect(s[0]!.a1).toBeCloseTo(Math.PI, 8);
    for (let k = 1; k < s.length; k++) expect(s[k]!.a0).toBeCloseTo(s[k - 1]!.a1, 8);
    expect(s.every((x) => x.r0 === 0)).toBe(true);
  });

  it('labels slices with their share, white or ink by the fill, and lists the categories at the right', () => {
    const g = lay({ type: 'pie' }, d);
    expect(textOf(g, 'pl')).toEqual(['50%', '30%', '20%']);
    expect(g.legend.map((l) => l.text)).toEqual(['Salaries', 'Rent', 'Other']);
    expect(g.tips[1]).toMatchObject({ title: 'Rent' });
    expect(g.tips[1]!.rows[1]).toEqual({ name: 'Share', value: '30%' });
  });

  it('cuts a hole for a doughnut', () => {
    const s = slices(lay({ type: 'doughnut' }, d));
    expect(s[0]!.r0).toBeGreaterThan(0);
    expect(s[0]!.r0).toBeLessThan(s[0]!.r1);
  });

  it('leaves out what is zero or negative, and does not label a sliver', () => {
    const g = lay({ type: 'pie' }, data({ v: [97, 0, -5, 3] }, ['a', 'b', 'c', 'd']));
    expect(slices(g).map((x) => x.key)).toEqual(['p0', 'p3']);
    expect(textOf(g, 'pl')).toEqual(['97%']);
  });

  it('draws a single slice as the whole circle', () => {
    const s = slices(lay({ type: 'pie' }, data({ v: [5] }, ['a'])));
    expect(s[0]!.a1 - s[0]!.a0).toBeCloseTo(Math.PI * 2, 8);
  });

  it('keeps the circle inside the room the legend leaves', () => {
    const g = lay({ type: 'pie' }, d);
    const s = slices(g)[0]!;
    expect(s.cx + s.r1).toBeLessThanOrEqual(g.legend[0]!.x);
  });
});

describe('nothing to draw', () => {
  it('says so, with no marks, for no series, for all gaps, and for a pie of zeros', () => {
    const cases: [ChartSpec['type'], Record<string, (number | null)[]>][] = [
      ['column', {}],
      ['line', { A: [null, null] }],
      ['pie', { A: [0, 0] }]
    ];
    for (const [type, series] of cases) {
      const g = lay({ type }, data(series, ['a', 'b']));
      expect(g.empty).toBe('Nothing to plot.');
      expect(g.marks).toHaveLength(0);
    }
  });
});

describe('tickFormatter', () => {
  it('uses the cells\' format when it keeps the digits the step needs', () => {
    expect(tickFormatter(1000, '£#,##0')(4000)).toBe('£4,000');
    expect(tickFormatter(0.1, '0.0%')(0.3)).toBe('30.0%');
    expect(tickFormatter(0.1, '0%')(0.3)).toBe('30%');
  });

  it('adds digits when the step is finer than the format, so 0.5 is not shown as 1', () => {
    const f = tickFormatter(0.5, '£#,##0');
    expect(f(0.5)).toBe('£0.5');
    expect(f(1)).toBe('£1.0');
  });

  it('groups thousands where the cells have no format', () => {
    expect(tickFormatter(500_000, undefined)(1_500_000)).toBe('1,500,000');
    expect(tickFormatter(0.25, undefined)(0.75)).toBe('0.75');
  });
});
