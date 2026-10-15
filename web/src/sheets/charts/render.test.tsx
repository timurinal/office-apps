import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { dateToSerial } from '../engine';
import { layoutChart, resolveInput } from './layout';
import { ChartSvg, areaPath, linePath, rectPath, slicePath } from './render';
import { data, measure } from './testing';
import type { ChartSpec } from './types';

const draw = (spec: Pick<ChartSpec, 'type' | 'title' | 'options'>, d: ReturnType<typeof data>, size = { w: 420, h: 280 }): string =>
  renderToStaticMarkup(<ChartSvg geom={layoutChart(resolveInput(spec, d), size, measure)} />);

const count = (svg: string, re: RegExp): number => (svg.match(re) ?? []).length;

const SPEND = data({ Spend: [61_900, 65_600, 71_500, 74_000] }, ['Q1', 'Q2', 'Q3', 'Q4']);
const TWO = data({ Salaries: [48, 6.5, 2.4], Software: [50, 8, 2.4] }, ['Q1', 'Q2', 'Q3']);

describe('paths', () => {
  it('linePath breaks at a gap, and a lone point between gaps draws nothing', () => {
    expect(linePath([0, 0, 10, 5, 20, 0])).toBe('M0 0L10 5L20 0');
    expect(linePath([0, 0, Number.NaN, Number.NaN, 20, 0, 30, 5])).toBe('M0 0M20 0L30 5');
    expect(linePath([])).toBe('');
  });

  it('areaPath closes each unbroken run down to its floor', () => {
    expect(areaPath([0, 5, 10, 3, 20, 4], [10, 10, 10])).toBe('M0 5L10 3L20 4L20 10L10 10L0 10Z');
    expect(areaPath([0, 5, 10, 3, Number.NaN, Number.NaN, 30, 2, 40, 1], [10, 10, 10, 10, 10])).toBe('M0 5L10 3L10 10L0 10ZM30 2L40 1L40 10L30 10Z');
    // A single point has no area.
    expect(areaPath([0, 5, Number.NaN, Number.NaN, 20, 4], [10, 10, 10])).toBe('');
  });

  it('rectPath rounds only the data end, by 4px or as much as the bar allows', () => {
    const r = { x: 10, y: 20, w: 40, h: 30 };
    expect(rectPath({ ...r, round: 'up' })).toBe('M10 50V24A4 4 0 0 1 14 20H46A4 4 0 0 1 50 24V50Z');
    expect(rectPath({ ...r, round: 'down' })).toBe('M10 20V46A4 4 0 0 0 14 50H46A4 4 0 0 0 50 46V20Z');
    expect(rectPath({ ...r, round: 'right' })).toBe('M10 20H46A4 4 0 0 1 50 24V46A4 4 0 0 1 46 50H10Z');
    expect(rectPath({ ...r, round: 'left' })).toBe('M50 20H14A4 4 0 0 0 10 24V46A4 4 0 0 0 14 50H50Z');
    expect(rectPath({ ...r, round: 'none' })).toBe('M10 20H50V50H10Z');
    // A bar 2px high has a radius no bigger than itself.
    expect(rectPath({ x: 0, y: 0, w: 40, h: 2, round: 'up' })).toContain('A2 2');
    // A horizontal bar's rounded end is bounded by its thickness.
    expect(rectPath({ x: 0, y: 0, w: 40, h: 4, round: 'right' })).toContain('A2 2');
  });

  it('slicePath: a wedge, a ring segment, the large arc, and a whole circle as two arcs', () => {
    const base = { cx: 100, cy: 100, r0: 0, r1: 50 };
    expect(slicePath({ ...base, a0: 0, a1: Math.PI / 2 })).toBe('M100 100L100 50A50 50 0 0 1 150 100Z');
    expect(slicePath({ ...base, a0: 0, a1: Math.PI * 1.5 })).toContain('A50 50 0 1 1');
    expect(slicePath({ ...base, r0: 25, a0: 0, a1: Math.PI / 2 })).toBe('M100 50A50 50 0 0 1 150 100L125 100A25 25 0 0 0 100 75Z');
    const whole = slicePath({ ...base, a0: 0, a1: Math.PI * 2 });
    expect(count(whole, /A50 50/g)).toBe(2);
    expect(count(slicePath({ ...base, r0: 20, a0: 0, a1: Math.PI * 2 }), /Z/g)).toBe(2);
  });
});

describe('the svg', () => {
  const svg = draw({ type: 'column', title: 'Spend by quarter' }, SPEND);

  it('is standalone: a namespace, a size, a label for a reader, the surface under everything', () => {
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 420 280" width="420" height="280" role="img" aria-label="Column chart, Spend by quarter, 1 series, 4 points"')).toBe(true);
    expect(svg).toContain('<rect data-bg="" width="420" height="280" fill="#ffffff"></rect>');
  });

  it('carries its look as attributes, never classes or custom properties, so it opens anywhere', () => {
    expect(svg).not.toMatch(/class=/);
    expect(svg).not.toMatch(/var\(--/);
    expect(count(svg, /style="/g)).toBe(4);
    for (const style of svg.match(/style="[^"]*"/g) ?? []) expect(style).toMatch(/^style="transform-box:fill-box;transform-origin:[^"]+"$/);
  });

  it('keys each mark so it can be found again: data-k', () => {
    expect(svg).toMatch(/data-k="r0.0"/);
    expect(svg).toMatch(/data-k="r0.3"/);
  });

  it('has a hit layer that an export leaves out, one area per category', () => {
    expect(svg).toContain('<g data-hit="">');
    expect(count(svg, /data-tip="/g)).toBe(4);
  });

  it('draws its text as text: the title, the axis, the categories and the value on each bar', () => {
    expect(svg).toContain('>Spend by quarter</text>');
    expect(svg).toContain('>Q1</text>');
    expect(svg).toContain('>61,900</text>');
    expect(svg).toContain('>80,000</text>');
  });

  it('escapes what a cell holds, so a series named with markup is text', () => {
    const evil = draw({ type: 'column', title: '<script>alert(1)</script>' }, data({ '<img src=x onerror=alert(1)>': [1, 2] }, ['a&b', 'c"d']));
    expect(evil).not.toContain('<script>');
    expect(evil).not.toContain('<img');
    expect(evil).toContain('&lt;script&gt;');
    expect(evil).toContain('a&amp;b');
  });
});

describe('each type', () => {
  it('column: a bar per value, its own colour, a rounded top', () => {
    const svg = draw({ type: 'column' }, TWO);
    expect(count(svg, /data-k="r\d\.\d"/g)).toBe(6);
    expect(svg).toContain('fill="#2a78d6"');
    expect(svg).toContain('fill="#e0602a"');
    expect(svg).toContain('>Salaries</text>');
    expect(svg).toMatchSnapshot();
  });

  it('stacked column: segments parted by a surface-coloured stroke', () => {
    const svg = draw({ type: 'column', options: { stacked: true } }, TWO);
    expect(count(svg, /stroke="#ffffff" stroke-width="2"/g)).toBe(6);
    expect(svg).toMatchSnapshot();
  });

  it('bar: horizontal, the categories down the left', () => {
    const svg = draw({ type: 'bar' }, TWO);
    expect(svg).toContain('text-anchor="end"');
    expect(svg).toMatchSnapshot();
  });

  it('line: a 2px round line per series and a marker per point, a shape for each series', () => {
    const svg = draw({ type: 'line' }, TWO);
    expect(count(svg, /stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/g)).toBe(2);
    expect(count(svg, /<circle /g)).toBe(3 + 0);
    expect(count(svg, /data-k="d1\.\d"/g)).toBe(3);
    expect(svg).toMatchSnapshot();
  });

  it('line on dates: a time axis ticked on the first of the month', () => {
    const d = (m: number, day = 1) => dateToSerial(2025, m, day);
    const svg = draw({ type: 'line' }, data({ Sales: [10, 20, 30] }, ['', '', ''], { x: [d(1), d(2), d(4)], xDate: true }));
    expect(svg).toContain('>Mar 2025</text>');
    expect(svg).toMatchSnapshot();
  });

  it('area: a wash under the line at 12%, under every line', () => {
    const svg = draw({ type: 'area' }, TWO);
    expect(count(svg, /fill-opacity="0.12"/g)).toBe(2);
    expect(svg.indexOf('fill-opacity="0.12"')).toBeLessThan(svg.indexOf('fill="none" stroke="#2a78d6"'));
    expect(svg).toMatchSnapshot();
  });

  it('pie: a wedge per slice, a percentage inside, the categories listed', () => {
    const svg = draw({ type: 'pie' }, data({ Share: [50, 30, 20] }, ['Salaries', 'Rent', 'Other']));
    expect(count(svg, /data-k="p\d"/g)).toBe(3);
    expect(svg).toContain('>50%</text>');
    expect(svg).toContain('>Rent</text>');
    expect(svg).toMatchSnapshot();
  });

  it('doughnut: the same with a hole', () => {
    const svg = draw({ type: 'doughnut' }, data({ Share: [50, 30, 20] }, ['Salaries', 'Rent', 'Other']));
    // The ring's inner edge is an arc of the hole's radius, 58% of the outer.
    expect(svg).toMatch(/A71\.34 71\.34 0 0 0/);
    expect(svg).toMatchSnapshot();
  });

  it('scatter: a marker for each point and numeric axes', () => {
    const svg = draw({ type: 'scatter' }, data({ Weight: [50, 58, 66] }, ['150', '160', '170'], { x: [150, 160, 170] }));
    expect(count(svg, /data-k="d0\.\d"/g)).toBe(3);
    expect(svg).toContain('>160</text>');
    expect(svg).toMatchSnapshot();
  });

  it('says there is nothing to plot, and draws no marks', () => {
    const svg = draw({ type: 'line', title: 'Empty' }, data({ A: [null, null] }, ['a', 'b']));
    expect(svg).toContain('>Nothing to plot.</text>');
    expect(count(svg, /data-k=/g)).toBe(0);
  });

  it('with axis titles, a rotated one at the left', () => {
    const svg = draw({ type: 'column', options: { xTitle: 'Quarter', yTitle: 'Spend' } }, SPEND);
    expect(svg).toContain('>Quarter</text>');
    expect(svg).toMatch(/transform="rotate\(-90 [\d.]+ [\d.]+\)"[^>]*>Spend</);
  });
});
