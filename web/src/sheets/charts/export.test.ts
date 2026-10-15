// @vitest-environment happy-dom
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const saved: { bytes: Uint8Array; mime: string; name: string }[] = [];
vi.mock('../../formats/browser/saveFile', async (original) => ({
  ...(await original<typeof import('../../formats/browser/saveFile')>()),
  save: (bytes: Uint8Array, mime: string, name: string) => void saved.push({ bytes, mime, name })
}));

import { downloadChart, svgText } from './export';
import { layoutChart, resolveInput } from './layout';
import { ChartSvg } from './render';
import { data, measure } from './testing';

const make = (title = 'Spend by quarter'): SVGSVGElement => {
  const geom = layoutChart(resolveInput({ type: 'column', title }, data({ Spend: [1, 2, 3] }, ['a', 'b', 'c'])), { w: 420, h: 280 }, measure);
  const host = document.createElement('div');
  host.innerHTML = renderToStaticMarkup(createElement(ChartSvg, { geom }));
  document.body.appendChild(host);
  return host.querySelector('svg')!;
};

beforeEach(() => void (saved.length = 0));
afterEach(() => void (document.body.innerHTML = ''));

describe('svgText', () => {
  it('is a standalone file: the XML declaration, the namespace, the whole chart', () => {
    const text = svgText(make());
    expect(text.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(text).toContain('Spend by quarter');
    expect(text).toContain('data-k="r0.0"');
    expect(text.trimEnd().endsWith('</svg>')).toBe(true);
  });

  it('leaves out the layer that answers a pointer, and leaves the page\'s own svg as it was', () => {
    const svg = make();
    const text = svgText(svg);
    expect(text).not.toContain('data-hit');
    expect(text).not.toContain('data-tip');
    expect(svg.querySelector('[data-hit]')).not.toBeNull();
  });
});

describe('downloadChart', () => {
  it('saves an SVG under the chart\'s title', async () => {
    expect(await downloadChart(make(), 'Spend by quarter', 'svg')).toBe(true);
    expect(saved).toHaveLength(1);
    expect(saved[0]!.name).toBe('Spend by quarter.svg');
    expect(saved[0]!.mime).toBe('image/svg+xml');
    expect(new TextDecoder().decode(saved[0]!.bytes)).toContain('<svg');
  });

  it('is called Chart when it has no title, and a name a file system takes when it has an odd one', async () => {
    await downloadChart(make(''), '  ', 'svg');
    await downloadChart(make(), 'a/b: "c"?', 'svg');
    expect(saved.map((s) => s.name)).toEqual(['Chart.svg', 'a b c.svg']);
  });
});
