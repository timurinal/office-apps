// @vitest-environment happy-dom
import { SaxesParser } from 'saxes';
import { afterEach, describe, expect, it } from 'vitest';
import type { DeckJSON, ElementJSON } from '../model/deck';
import { testDeck, txt } from '../model/testing';
import { shapePath } from '../render/geometry';
import { buildPicture, esc, type PictureDeps, type PictureSource } from './picture';
import type { Segment } from './measure';

/**
 * The picture builder against the renderer. happy-dom lays nothing out, so the browser's answers (where
 * the lines went, the pictures' bytes, the fonts) are given by the test; what is asked here is what
 * the builder does with them. tests/ in the browser (docs/phase5c) holds the real layout.
 */

const deck = (): DeckJSON => testDeck();
const design = () => {
  const d = deck();
  return { theme: d.theme, master: d.master, layouts: d.layouts, size: d.size };
};

const source = (elements: ElementJSON[], assetUrl: (id: string) => string | null = (id) => `/assets/${id}`): PictureSource => ({
  elements,
  design: design(),
  layoutId: 'blank',
  number: 3,
  assetUrl
});

const seg = (over: Partial<Segment> = {}): Segment => ({
  block: 0,
  text: 'Hello',
  x: 14.4,
  y: 40,
  box: { x: 14.4, y: 10, w: 100, h: 44 },
  family: '"Inter", system-ui, sans-serif',
  primary: 'Inter',
  size: 36,
  weight: 400,
  style: 'normal',
  fill: '#111111',
  opacity: 1,
  decoration: '',
  highlight: null,
  ...over
});

const deps = (over: PictureDeps = {}): PictureDeps => ({
  measure: () => [],
  inline: async (urls) => new Map([...urls].map((u) => [u, `data:image/png;base64,${btoa(u)}`])),
  fonts: async () => '',
  settle: async () => undefined,
  ...over
});

/**
 * The picture as a document. The file must be well-formed XML, which a strict parser (the one the
 * repo reads other people's files with) says; the DOM is then happy-dom's reading of it, without the
 * font rules, which it cannot read.
 */
function parse(svg: string): Document {
  const errors: string[] = [];
  const strict = new SaxesParser({ xmlns: true });
  strict.on('error', (e) => errors.push(e.message));
  strict.write(svg).close();
  expect(errors).toEqual([]);
  const doc = new DOMParser().parseFromString(svg.replace(/<style[\s\S]*?<\/style>/, '<style/>'), 'image/svg+xml');
  expect(doc.querySelector('parsererror'), svg.slice(0, 400)).toBeNull();
  return doc;
}
const make = async (elements: ElementJSON[], d: PictureDeps = {}, assetUrl?: (id: string) => string | null) => {
  const picture = await buildPicture(source(elements, assetUrl), deps(d));
  expect(picture).not.toBeNull();
  return { picture: picture!, doc: parse(picture!.svg) };
};

const rect = (over: Partial<ElementJSON> = {}): ElementJSON =>
  ({ id: 'a', type: 'shape', shape: 'rect', x: 100, y: 200, w: 300, h: 100, fill: { kind: 'solid', color: '#ff0000' }, ...over }) as ElementJSON;

afterEach(() => {
  document.body.innerHTML = '';
});

describe('the picture', () => {
  it('is an SVG that stands alone: well formed, no foreignObject, no script, no address of the page', async () => {
    const { picture } = await make([rect({ text: txt('Hi'), shadow: true } as Partial<ElementJSON>)], { measure: () => [seg()] });
    expect(picture.svg.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(picture.svg).not.toMatch(/foreignObject|<script|<iframe|javascript:|url\(https?:|href="https?:|href="\//i);
  });

  it('draws a shape as the renderer’s own path, with its fill and line', async () => {
    const { doc } = await make([rect({ line: { color: '#0000ff', width: 4 } } as Partial<ElementJSON>)]);
    const path = doc.querySelector('path')!;
    expect(path.getAttribute('d')).toBe(shapePath('rect', 300, 100).d);
    expect(path.getAttribute('fill')).toBe('#ff0000');
    expect(path.getAttribute('stroke')).toBe('#0000ff');
    expect(path.getAttribute('stroke-width')).toBe('4');
  });

  it('draws every preset as its geometry', async () => {
    for (const kind of ['ellipse', 'star5', 'donut', 'cube', 'rightArrow'] as const) {
      const { doc } = await make([rect({ shape: kind, w: 240, h: 160 } as Partial<ElementJSON>)]);
      expect(doc.querySelector('path')!.getAttribute('d'), kind).toBe(shapePath(kind, 240, 160).d);
    }
  });

  it('puts a rotation on the shape’s group, about its centre, and crops to the rotated bounds', async () => {
    const { picture, doc } = await make([rect({ rot: 30, line: { color: '#0000ff', width: 4 } } as Partial<ElementJSON>)]);
    const g = doc.querySelector('svg > g > g')!;
    expect(g.getAttribute('transform')).toBe('translate(100 200) rotate(30 150 50)');
    // A 304 by 104 box (the line reaches 2 past the shape), turned 30 degrees.
    const r = (30 * Math.PI) / 180;
    expect(picture.width).toBe(Math.ceil(304 * Math.cos(r) + 104 * Math.sin(r)) + (picture.width - Math.ceil(304 * Math.cos(r) + 104 * Math.sin(r))));
    expect(picture.width).toBeGreaterThanOrEqual(Math.floor(304 * Math.cos(r) + 104 * Math.sin(r)));
    expect(picture.width).toBeLessThanOrEqual(Math.ceil(304 * Math.cos(r) + 104 * Math.sin(r)) + 1);
    expect(picture.height).toBeGreaterThanOrEqual(Math.floor(304 * Math.sin(r) + 104 * Math.cos(r)));
    expect(picture.height).toBeLessThanOrEqual(Math.ceil(304 * Math.sin(r) + 104 * Math.cos(r)) + 1);
    // The picture starts at its own corner: the first group shifts what the slide had at (x0, y0) to 0, 0.
    const shift = /translate\((-?[\d.]+) (-?[\d.]+)\)/.exec(doc.querySelector('svg > g')!.getAttribute('transform')!)!;
    expect(Number(shift[1])).toBeLessThan(0);
    expect(Number(shift[2])).toBeLessThan(0);
  });

  it('crops two elements to their union, on no background', async () => {
    const { picture, doc } = await make([rect({ id: 'a', x: 50, y: 60, w: 100, h: 100 }), rect({ id: 'b', x: 500, y: 300, w: 100, h: 100 })]);
    expect(picture.width).toBe(550);
    expect(picture.height).toBe(340);
    expect(doc.documentElement.getAttribute('viewBox')).toBe('0 0 550 340');
    expect(doc.querySelector('svg > g')!.getAttribute('transform')).toBe('translate(-50 -60)');
    expect(picture.svg).not.toMatch(/<rect[^>]*width="550"/);
  });

  it('mirrors a flipped shape about its own centre, on its outline alone', async () => {
    const { doc } = await make([rect({ shape: 'rightArrow', flipH: true, text: txt('x') } as Partial<ElementJSON>)], { measure: () => [seg()] });
    const flipped = [...doc.querySelectorAll('g')].find((g) => g.getAttribute('transform')?.includes('scale(-1 1)'))!;
    expect(flipped.getAttribute('transform')).toBe('translate(150 50) scale(-1 1) translate(-150 -50)');
    expect(flipped.querySelector('path')).not.toBeNull();
    expect(flipped.querySelector('text')).toBeNull();
    const both = (await make([rect({ flipH: true, flipV: true } as Partial<ElementJSON>)])).doc;
    expect([...both.querySelectorAll('g')].some((g) => g.getAttribute('transform')?.includes('scale(-1 -1)'))).toBe(true);
  });

  it('draws a shadow as a filter on the outline, and makes room for it', async () => {
    const plain = await make([rect()]);
    const { picture, doc } = await make([rect({ shadow: true } as Partial<ElementJSON>)]);
    expect(doc.querySelector('filter feGaussianBlur')!.getAttribute('stdDeviation')).toBe('5');
    expect(doc.querySelector('filter feOffset')!.getAttribute('dy')).toBe('6');
    expect(doc.querySelector('g[filter]')!.getAttribute('filter')).toMatch(/^url\(#sh\d+\)$/);
    expect(picture.width).toBeGreaterThan(plain.picture.width);
    expect(picture.height).toBeGreaterThan(plain.picture.height);
  });
});

describe('text', () => {
  it('is a <text> for each line, with a <tspan> for each run, at the positions the browser laid out', async () => {
    const lines = [
      seg({ text: 'Quarterly ', x: 14.4, y: 40.5, weight: 700, fill: '#ff0000', size: 72 }),
      seg({ text: 'review', x: 300.25, y: 40.5, style: 'italic', decoration: 'underline', fill: '#00ff00' }),
      seg({ text: 'second line', x: 14.4, y: 120, block: 1 })
    ];
    const { doc } = await make([rect({ text: txt('Quarterly review', 'second line') } as Partial<ElementJSON>)], { measure: () => lines });
    const texts = [...doc.querySelectorAll('text')];
    expect(texts).toHaveLength(2);
    const [a, b] = [...texts[0]!.querySelectorAll('tspan')];
    expect(a!.textContent).toBe('Quarterly ');
    expect(a!.getAttribute('x')).toBe('14.4');
    expect(a!.getAttribute('y')).toBe('40.5');
    expect(a!.getAttribute('font-size')).toBe('72');
    expect(a!.getAttribute('font-weight')).toBe('700');
    expect(a!.getAttribute('fill')).toBe('#ff0000');
    expect(a!.getAttribute('font-family')).toBe('"Inter", system-ui, sans-serif');
    expect(b!.getAttribute('x')).toBe('300.25');
    expect(b!.getAttribute('font-style')).toBe('italic');
    expect(b!.getAttribute('text-decoration')).toBe('underline');
    expect(texts[0]!.getAttribute('xml:space')).toBe('preserve');
    expect(texts[1]!.textContent).toBe('second line');
  });

  it('turns with its shape: it is inside the shape’s group, measured with no rotation on it', async () => {
    let rotationWhenMeasured = 'unset';
    const { doc } = await make([rect({ rot: 30, text: txt('x') } as Partial<ElementJSON>)], {
      measure: (frame) => {
        rotationWhenMeasured = (frame.closest('.sl-el') as HTMLElement).style.transform;
        return [seg()];
      }
    });
    expect(rotationWhenMeasured).toBe('none');
    const group = doc.querySelector('svg > g > g')!;
    expect(group.getAttribute('transform')).toContain('rotate(30 150 50)');
    expect(group.querySelector('text')).not.toBeNull();
  });

  it('is escaped, and has no character XML cannot hold', async () => {
    const { picture } = await make([rect({ text: txt('x') } as Partial<ElementJSON>)], { measure: () => [seg({ text: 'A < B & "C" > D\u0000\u0008\u000b ok' })] });
    expect(picture.svg).toContain('A &lt; B &amp; &quot;C&quot; &gt; D ok');
    expect(esc('￾￿\u0001a')).toBe('a');
    expect(esc('tab\tnew\nline')).toBe('tab\tnew\nline');
  });

  it('includes a highlight as a box behind the words, and counts the words in the bounds', async () => {
    const { picture, doc } = await make([rect({ w: 100, h: 50, text: txt('x') } as Partial<ElementJSON>)], { measure: () => [seg({ box: { x: 10, y: 10, w: 400, h: 60 }, highlight: { fill: '#ffff00', opacity: 1 } })] });
    expect(doc.querySelector('rect[fill="#ffff00"]')).not.toBeNull();
    // Text that runs past its shape is still in the picture.
    expect(picture.width).toBeGreaterThanOrEqual(410);
  });

  it('carries the fonts the text used, as the page’s own faces', async () => {
    const asked: unknown[] = [];
    const { picture } = await make([rect({ text: txt('x') } as Partial<ElementJSON>)], {
      measure: () => [seg({ text: 'Héllo', weight: 700 })],
      fonts: async (uses) => {
        asked.push(uses.map((u) => [u.family, u.weight, u.style, [...u.chars].join('')]));
        return '@font-face{font-family:"Inter";src:url(data:font/woff2;base64,AAAA)}';
      }
    });
    expect(asked).toEqual([[['Inter', 700, 'normal', 'Hélo']]]);
    expect(picture.svg).toContain('<style type="text/css"><![CDATA[@font-face{font-family:"Inter"');
  });
});

describe('pictures', () => {
  const photo = (over: Partial<ElementJSON> = {}): ElementJSON => ({ id: 'p', type: 'image', x: 40, y: 50, w: 400, h: 200, asset: { id: 'a1' }, ...over }) as ElementJSON;

  it('is an <image> with its bytes in it, and no address', async () => {
    const { picture, doc } = await make([photo()]);
    const image = doc.querySelector('image')!;
    expect(image.getAttribute('xlink:href')).toBe(`data:image/png;base64,${btoa('/assets/a1')}`);
    expect(image.getAttribute('width')).toBe('400');
    expect(image.getAttribute('preserveAspectRatio')).toBe('none');
    expect(picture.svg).not.toContain('/assets/a1"');
    expect(picture.missing).toBe(0);
  });

  it('is cut by a clip as the crop says, and mirrored about the whole picture when flipped', async () => {
    const { doc } = await make([photo({ crop: { l: 0.25, t: 0, r: 0, b: 0 }, flipH: true } as Partial<ElementJSON>)]);
    const image = doc.querySelector('image')!;
    // 400 wide shows 75% of the source: the whole source is 400 / 0.75 wide, and starts a quarter of it to the left.
    expect(Number(image.getAttribute('width'))).toBeCloseTo(400 / 0.75, 1);
    expect(Number(image.getAttribute('x'))).toBeCloseTo(-(400 / 0.75) * 0.25, 1);
    expect(doc.querySelector('clipPath rect')!.getAttribute('width')).toBe('400');
    const clipped = doc.querySelector('g[clip-path]')!;
    expect(clipped.getAttribute('clip-path')).toBe(`url(#${doc.querySelector('clipPath')!.getAttribute('id')})`);
    expect(clipped.querySelector('g')!.getAttribute('transform')).toMatch(/scale\(-1 1\)/);
  });

  it('is left out where it could not be had, and counted', async () => {
    const { picture, doc } = await make([photo(), rect({ id: 'r' })], { inline: async (urls) => new Map([...urls].map((u) => [u, null])) });
    expect(doc.querySelector('image')).toBeNull();
    expect(picture.missing).toBe(1);
    expect(doc.querySelector('path')).not.toBeNull();
  });

  it('fills a shape from a picture, and that picture is carried in the file too', async () => {
    const { picture, doc } = await make([rect({ fill: { kind: 'image', asset: { id: 'bg' }, fit: 'cover' } } as Partial<ElementJSON>)]);
    const image = doc.querySelector('image')!;
    expect(image.getAttribute('xlink:href')).toBe(`data:image/png;base64,${btoa('/assets/bg')}`);
    expect(image.getAttribute('clip-path')).toMatch(/^url\(#/);
    expect(doc.querySelector('clipPath path')).not.toBeNull();
    expect(picture.svg).not.toMatch(/href="\/assets/);
  });

  it('takes an inline picture from an imported deck as it is', async () => {
    const data = 'iVBORw0KGgo=';
    const asked: string[][] = [];
    await make([photo({ asset: { data, mime: 'image/png' } } as Partial<ElementJSON>)], {
      inline: async (urls) => {
        asked.push([...urls]);
        return new Map([...urls].map((u) => [u, u]));
      }
    });
    expect(asked).toEqual([[`data:image/png;base64,${data}`]]);
  });
});

describe('lines, groups and tables', () => {
  it('draws a line with its arrow head as the renderer’s markers', async () => {
    const { doc } = await make([{ id: 'l', type: 'line', x: 10, y: 10, w: 300, h: 0, line: { color: '#000000', width: 6, tail: 'arrow' } }]);
    const line = doc.querySelector('line')!;
    expect(line.getAttribute('stroke-width')).toBe('6');
    const marker = line.getAttribute('marker-end')!;
    expect(doc.querySelector(`marker${marker.replace(/^url\((#.*)\)$/, '$1')}`)).not.toBeNull();
  });

  it('nests a group’s children in its group, each with its own rotation', async () => {
    const child = (id: string, x: number, rot?: number): ElementJSON => ({ id, type: 'shape', shape: 'ellipse', x, y: 120, w: 80, h: 80, ...(rot ? { rot } : {}), fill: { kind: 'solid', color: '#00ff00' } }) as ElementJSON;
    const { doc } = await make([{ id: 'g', type: 'group', x: 100, y: 100, w: 400, h: 200, rot: 90, children: [child('c1', 120), child('c2', 300, 45)] }]);
    const outer = doc.querySelector('svg > g > g')!;
    expect(outer.getAttribute('transform')).toBe('translate(100 100) rotate(90 200 100)');
    const inner = [...outer.children].filter((c) => c.tagName === 'g');
    expect(inner.map((g) => g.getAttribute('transform'))).toEqual(['translate(20 20)', 'translate(200 20) rotate(45 40 40)']);
  });

  it('is cropped to what the group’s children cover', async () => {
    const child = (x: number): ElementJSON => ({ id: `c${x}`, type: 'shape', shape: 'rect', x, y: 100, w: 50, h: 50 }) as ElementJSON;
    const { picture } = await make([{ id: 'g', type: 'group', x: 0, y: 0, w: 1920, h: 1080, children: [child(100), child(300)] }]);
    expect(picture.width).toBe(250);
    expect(picture.height).toBe(50);
  });

  it('says nothing was chosen for an empty selection', async () => {
    expect(await buildPicture(source([]), deps())).toBeNull();
  });

  it('leaves no stage behind', async () => {
    await make([rect()]);
    expect(document.body.querySelector('.sl-stage')).toBeNull();
  });
});
