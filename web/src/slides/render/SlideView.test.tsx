// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DeckJSON, ElementJSON, SlideJSON, TextDoc } from '../model/deck';
import { LAYOUTS, MASTER, testDeck, txt } from '../model/testing';
import { SlideAssets } from './assets';
import { SlideView, type RenderMode } from './SlideView';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const readSlideDesign = (d: DeckJSON) => ({ theme: d.theme, master: d.master, layouts: d.layouts, size: d.size });

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function draw(slide: SlideJSON, o: { mode?: RenderMode; number?: number; editing?: string; deck?: DeckJSON; width?: number } = {}) {
  const deck = o.deck ?? testDeck([slide]);
  act(() =>
    root.render(
      <SlideAssets.Provider value={(id) => `/assets/${id}`}>
        <SlideView design={readSlideDesign(deck)} slide={slide} width={o.width ?? 480} mode={o.mode} number={o.number} editing={o.editing} />
      </SlideAssets.Provider>
    )
  );
  return host;
}

const el = (id: string) => host.querySelector(`[data-el="${id}"]`) as HTMLElement | null;
const paras = (id: string) => [...(el(id)?.querySelectorAll('.sl-p') ?? [])] as HTMLElement[];

const title: ElementJSON = { id: 't', type: 'shape', shape: 'rect', x: 154, y: 100, w: 1612, h: 240, ph: { type: 'title' }, text: txt('Quarterly review') };

describe('SlideView', () => {
  it('scales one 1920-wide stage to the width it is given', () => {
    draw({ id: 's', layout: 'blank', elements: [] }, { width: 480 });
    const view = host.querySelector('.sl-view') as HTMLElement;
    expect(view.style.width).toBe('480px');
    expect(view.style.height).toBe('270px');
    expect((host.querySelector('.sl-stage') as HTMLElement).style.transform).toBe('scale(0.25)');
  });

  it('draws text with the cascade: the master’s title style, the theme’s heading font', () => {
    draw({ id: 's', layout: 'titleContent', elements: [title] });
    const [p] = paras('t');
    expect(p!.textContent).toBe('Quarterly review');
    expect(p!.style.fontSize).toBe('88px');
    expect(p!.style.fontWeight).toBe('700');
    expect(p!.style.fontFamily).toContain('Fraunces');
    expect(p!.style.color).toBe('#111111');
  });

  it('draws bullets and numbers per level, with the indents the style gives', () => {
    const body: TextDoc = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'One' }] },
        { type: 'paragraph', attrs: { level: 1 }, content: [{ type: 'text', text: 'Sub' }] },
        { type: 'paragraph', attrs: { bullet: { kind: 'number', style: 'arabicPeriod' } }, content: [{ type: 'text', text: 'A' }] },
        { type: 'paragraph', attrs: { bullet: { kind: 'number', style: 'arabicPeriod' } }, content: [{ type: 'text', text: 'B' }] },
        { type: 'paragraph' }
      ]
    };
    draw({ id: 's', layout: 'titleContent', elements: [{ id: 'b', type: 'shape', shape: 'rect', x: 154, y: 368, w: 1612, h: 560, ph: { type: 'body', idx: 1 }, text: body }] });
    const ps = paras('b');
    expect(ps.map((p) => p.querySelector('.sl-bullet')?.textContent ?? null)).toEqual(['•', '–', '1.', '2.', null]);
    expect(ps[0]!.style.paddingLeft).toBe('44px');
    expect(ps[0]!.style.textIndent).toBe('-44px');
    expect(ps[1]!.style.paddingLeft).toBe('96px');
    expect((ps[1]!.querySelector('.sl-bullet') as HTMLElement).style.minWidth).toBe('44px');
    // An empty paragraph keeps its line.
    expect(ps[4]!.querySelector('br')).not.toBeNull();
  });

  it('shows an empty placeholder’s prompt in the editor only, and never in a thumbnail', () => {
    const empty: SlideJSON = { id: 's', layout: 'titleContent', elements: [{ ...title, text: txt('') }] };
    draw(empty, { mode: 'edit' });
    expect(el('t')!.textContent).toBe('Add a title.');
    expect(el('t')!.querySelector('.sl-prompt')).not.toBeNull();
    draw(empty, { mode: 'thumb' });
    expect(el('t')!.textContent).toBe('');
  });

  it('leaves out the text the editor is drawing, and keeps the shape', () => {
    draw({ id: 's', layout: 'blank', elements: [{ ...title, ph: undefined, fill: { kind: 'solid', color: '#ff0000' } }] }, { editing: 't', mode: 'edit' });
    expect(el('t')!.textContent).toBe('');
    expect(el('t')!.querySelector('path')!.getAttribute('fill')).toBe('#ff0000');
  });

  it('puts the slide’s number in a slide-number placeholder', () => {
    draw({ id: 's', layout: 'blank', elements: [{ id: 'n', type: 'shape', shape: 'rect', x: 0, y: 0, w: 100, h: 40, ph: { type: 'sldNum', idx: 12 }, text: txt('Slide ‹#›') }] }, { number: 7 });
    expect(el('n')!.textContent).toBe('Slide 7');
  });

  it('draws the master’s elements, then the layout’s decorations, then the slide’s, and the slide can turn the first two off', () => {
    const deck = testDeck([]);
    deck.master = { ...MASTER, elements: [{ id: 'logo', type: 'shape', shape: 'ellipse', x: 0, y: 0, w: 10, h: 10, fill: { kind: 'solid', color: '#000000' } }, { ...title, id: 'mt' }] };
    const slide: SlideJSON = { id: 's', layout: 'blank', elements: [{ id: 'mine', type: 'shape', shape: 'rect', x: 0, y: 0, w: 10, h: 10, fill: { kind: 'solid', color: '#00ff00' } }] };
    draw(slide, { deck });
    const order = [...host.querySelectorAll('.sl-stage > .sl-el')].map((n) => n.getAttribute('data-el'));
    // The master's placeholder is not drawn; the layout's accent bar has no id.
    expect(order).toEqual(['logo', null, 'mine']);
    draw({ ...slide, showMaster: false }, { deck });
    expect([...host.querySelectorAll('.sl-stage > .sl-el')].map((n) => n.getAttribute('data-el'))).toEqual(['mine']);
  });

  it('takes the background from the slide, else its layout, else the master', () => {
    draw({ id: 's', layout: 'blank', elements: [] });
    expect((host.querySelector('.sl-stage') as HTMLElement).style.background).toContain('#ffffff');
    draw({ id: 's', layout: 'blank', bg: { kind: 'solid', color: { theme: 'accent2' } }, elements: [] });
    expect((host.querySelector('.sl-stage') as HTMLElement).style.background).toContain('#0ea5e9');
  });

  it('crops a picture by its fractions and draws it from the document’s assets', () => {
    draw({ id: 's', layout: 'blank', elements: [{ id: 'p', type: 'image', x: 0, y: 0, w: 400, h: 300, asset: { id: 'a1' }, crop: { l: 0.5, t: 0, r: 0, b: 0.25 }, alt: 'A cat.' }] }, { mode: 'present' });
    const img = el('p')!.querySelector('img')!;
    expect(img.getAttribute('src')).toBe('/assets/a1');
    expect(img.style.width).toBe('800px');
    expect(img.style.height).toBe('400px');
    expect(img.style.left).toBe('-400px');
    expect(img.getAttribute('alt')).toBe('A cat.');
  });

  it('lays a table out as a grid, with a merge’s spans and without the cells it covers', () => {
    draw({
      id: 's',
      layout: 'blank',
      elements: [
        {
          id: 'tb',
          type: 'table',
          x: 0,
          y: 0,
          w: 300,
          h: 80,
          cols: [100, 200],
          firstRow: true,
          rows: [
            { h: 40, cells: [{ text: txt('Head'), colSpan: 2 }, { text: txt(''), merged: true }] },
            { h: 40, cells: [{ text: txt('1') }, { text: txt('2') }] }
          ]
        }
      ]
    });
    const cells = [...el('tb')!.querySelectorAll('.sl-cell')] as HTMLElement[];
    expect(cells.map((c) => c.textContent)).toEqual(['Head', '1', '2']);
    expect(cells[0]!.style.gridColumn).toBe('1 / span 2');
    expect((cells[0]!.querySelector('.sl-p') as HTMLElement).style.fontWeight).toBe('700');
    expect((el('tb')!.querySelector('.sl-grid') as HTMLElement).style.gridTemplateColumns).toBe('100px 200px');
  });

  it('draws a group’s children inside the group’s box', () => {
    draw({
      id: 's',
      layout: 'blank',
      elements: [{ id: 'g', type: 'group', x: 100, y: 50, w: 200, h: 100, children: [{ id: 'k', type: 'shape', shape: 'rect', x: 150, y: 70, w: 10, h: 10 }] }]
    });
    expect(el('k')!.parentElement!.getAttribute('data-el')).toBe('g');
    expect(el('k')!.style.left).toBe('50px');
    expect(el('k')!.style.top).toBe('20px');
  });

  it('opens a link only in the show', () => {
    const linked: TextDoc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'site', marks: [{ type: 'link', attrs: { href: 'https://example.com' } }] }] }] };
    const slide: SlideJSON = { id: 's', layout: 'blank', elements: [{ id: 'x', type: 'shape', shape: 'rect', x: 0, y: 0, w: 100, h: 40, text: linked }] };
    draw(slide, { mode: 'edit' });
    expect(el('x')!.querySelector('a')).toBeNull();
    draw(slide, { mode: 'present' });
    expect(el('x')!.querySelector('a')!.getAttribute('href')).toBe('https://example.com');
  });

  it('shrinks a body that does not fit, laying it out wider by the same factor', () => {
    // happy-dom does no layout: a body is 1000 px tall at its own width and 500 px when twice as wide.
    const desc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight');
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
      configurable: true,
      get(this: HTMLElement) {
        return this.classList.contains('sl-text') ? (this.style.width && this.style.width !== '100%' ? 500 : 1000) : 0;
      }
    });
    try {
      draw({ id: 's', layout: 'blank', elements: [{ id: 'f', type: 'shape', shape: 'rect', x: 0, y: 0, w: 800, h: 514.4, text: txt('Long'), textBox: { autofit: 'shrink' } }] });
      const body = el('f')!.querySelector('.sl-text') as HTMLElement;
      expect(body.style.transform).toBe('scale(0.5)');
      expect(body.style.width).toBe('200%');
      expect((el('f')!.querySelector('.sl-fit') as HTMLElement).style.height).toBe('250px');
    } finally {
      if (desc) Object.defineProperty(HTMLElement.prototype, 'scrollHeight', desc);
    }
  });

  it('draws a chart through Sheets’ chart code, in the theme’s accents, once that code has loaded', async () => {
    draw({ id: 's', layout: 'blank', elements: [{ id: 'c', type: 'chart', chart: 'column', x: 0, y: 0, w: 1000, h: 600, categories: ['Q1', 'Q2'], series: [{ name: 'Sales', values: [3, 5] }] }] });
    expect(el('c')!.querySelector('.sl-chart-wait')).not.toBeNull();
    await act(async () => {
      await import('./ChartBody');
      await new Promise((r) => setTimeout(r, 0));
    });
    const svg = el('c')!.querySelector('svg')!;
    expect(svg).not.toBeNull();
    expect(svg.innerHTML).toContain('#f97316');
  });

  it('draws every layout of the test deck without a hitch', () => {
    for (const l of LAYOUTS) {
      draw({ id: 's', layout: l.id, elements: [] }, { mode: 'edit' });
      expect(host.querySelector('.sl-stage')).not.toBeNull();
    }
  });
});
