// @vitest-environment happy-dom
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const saved: { bytes: Uint8Array; mime: string; name: string }[] = [];
vi.mock('../../formats/browser/saveFile', async (original) => ({
  ...(await original<typeof import('../../formats/browser/saveFile')>()),
  save: (bytes: Uint8Array, mime: string, name: string) => void saved.push({ bytes, mime, name })
}));

import { downloadChart, pngBytes, svgText } from './export';
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

describe('pngBytes', () => {
  /** A browser that can draw an image to a canvas: what the canvas was filled with, and drawn at. */
  function drawing() {
    const fills: string[] = [];
    const ctx = { fillStyle: '', fillRect: () => void fills.push(ctx.fillStyle), drawImage: vi.fn() };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((cb) => cb(new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' })));
    vi.stubGlobal(
      'Image',
      class {
        onload: () => void = () => undefined;
        set src(_: string) {
          queueMicrotask(() => this.onload());
        }
      }
    );
    vi.stubGlobal(
      'URL',
      class extends URL {
        static override createObjectURL = () => 'blob:x';
        static override revokeObjectURL = () => undefined;
      }
    );
    return { fills, ctx };
  }
  afterEach(() => void vi.unstubAllGlobals());

  it('fills white first, as a chart’s PNG always has', async () => {
    const { fills } = drawing();
    expect(await pngBytes('<svg/>', 100, 50)).toEqual(new Uint8Array([1, 2, 3]));
    expect(fills).toEqual(['#ffffff']);
  });

  it('can be asked for a colour, or for none, which leaves the canvas transparent', async () => {
    const a = drawing();
    await pngBytes('<svg/>', 100, 50, 2, '#112233');
    expect(a.fills).toEqual(['#112233']);
    const b = drawing();
    await pngBytes('<svg/>', 100, 50, 2, null);
    expect(b.fills).toEqual([]);
    expect(b.ctx.drawImage).toHaveBeenCalledTimes(1);
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
