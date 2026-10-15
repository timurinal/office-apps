import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { LIMITS } from '@shared/api';
import type { DeckJSON, ElementJSON, SlideJSON } from './deck';
import { TextInvalid } from './schema';
import { testDeck, txt } from './testing';
import { DeckInvalid, DeckTooLarge, deckToY, elsOf, kidsOf, orderOf, readOrder, slidesOf, yToDeck, zOf } from './ydoc';

const rich = {
  type: 'doc' as const,
  content: [
    {
      type: 'paragraph',
      attrs: { align: 'center', level: 1, bullet: { kind: 'number', style: 'alphaLcPeriod', start: 3 }, spaceBefore: 6, spaceAfter: 0, lineHeight: 1.5, indent: 40, bulletIndent: 10 },
      content: [
        { type: 'text', text: 'Bold ', marks: [{ type: 'bold' }] },
        { type: 'text', text: 'red', marks: [{ type: 'textStyle', attrs: { color: '#ff0000', fontSize: 30, fontFamily: 'Inter' } }] },
        { type: 'hardBreak' },
        { type: 'text', text: 'link', marks: [{ type: 'link', attrs: { href: 'https://example.com', target: '_blank', rel: 'noopener noreferrer nofollow' } }] }
      ]
    },
    { type: 'paragraph', content: [{ type: 'text', text: 'x', marks: [{ type: 'highlight', attrs: { color: { theme: 'accent4' } } }, { type: 'sup' }] }] }
  ]
};

const everything: SlideJSON = {
  id: 'a',
  layout: 'titleContent',
  bg: { kind: 'gradient', angle: 90, stops: [{ at: 0, color: '#000000' }, { at: 1, color: { theme: 'accent1', lum: 0.4 } }] },
  hidden: true,
  showMaster: false,
  transition: { kind: 'push', duration: 400, from: 'left' },
  notes: txt('Say hello.', 'Then stop.'),
  elements: [
    { id: 'title', type: 'shape', shape: 'rect', x: 154, y: 100, w: 1612, h: 240, ph: { type: 'title' }, text: txt('Q4') },
    { id: 'body', type: 'shape', shape: 'roundRect', adjust: 0.2, x: 10, y: 20, w: 30, h: 40, rot: 45, flipH: true, fill: { kind: 'solid', color: '#abcdef', alpha: 0.5 }, line: { color: { theme: 'dk1' }, width: 4, dash: 'dash' }, text: rich, textBox: { anchor: 'middle', insets: { l: 1, t: 2, r: 3, b: 4 }, autofit: 'shrink' } },
    { id: 'pic', type: 'image', x: 0, y: 0, w: 100, h: 50, asset: { id: 'asset_1' }, crop: { l: 0.1, t: 0, r: 0, b: 0.2 }, alt: 'A cat.' },
    { id: 'ln', type: 'line', x: 0, y: 0, w: 300, h: 0, line: { color: '#000000', width: 2, head: 'arrow', tail: 'oval' } },
    {
      id: 'tbl',
      type: 'table',
      x: 0,
      y: 0,
      w: 200,
      h: 80,
      cols: [100, 100],
      firstRow: true,
      rows: [
        { h: 40, cells: [{ text: txt('A'), colSpan: 2, fill: { kind: 'solid', color: '#eeeeee' } }, { text: txt(''), merged: true }] },
        { h: 40, cells: [{ text: txt('1'), anchor: 'middle' }, { text: txt('2') }] }
      ]
    },
    {
      id: 'g',
      type: 'group',
      x: 0,
      y: 0,
      w: 500,
      h: 500,
      children: [
        { id: 'g1', type: 'shape', shape: 'ellipse', x: 0, y: 0, w: 10, h: 10 },
        { id: 'g2', type: 'group', x: 100, y: 100, w: 50, h: 50, children: [{ id: 'g21', type: 'shape', shape: 'star5', x: 100, y: 100, w: 50, h: 50 }] }
      ]
    },
    { id: 'ch', type: 'chart', chart: 'column', x: 0, y: 0, w: 800, h: 450, categories: ['Q1', 'Q2'], series: [{ name: 'Sales', values: [1, 2], color: { theme: 'accent2' } }], title: 'Sales' }
  ]
};

const load = (state: Uint8Array): Y.Doc => {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, state);
  return doc;
};

describe('deckToY and yToDeck', () => {
  it('round-trip every kind of element, slide field and text mark', () => {
    const deck = testDeck([everything, { id: 'b', layout: 'blank', elements: [] }]);
    const back = yToDeck(load(deckToY(deck)));
    expect(back.slides[1]).toEqual({ id: 'b', layout: 'blank', elements: [], notes: txt('') });
    expect(back).toEqual({ ...deck, slides: [everything, back.slides[1]] });
  });

  it('give an element without an id, or with one its slide already has, a fresh one', () => {
    const els: ElementJSON[] = [
      { type: 'shape', shape: 'rect', x: 0, y: 0, w: 1, h: 1 },
      { id: 'same', type: 'shape', shape: 'rect', x: 0, y: 0, w: 1, h: 1 },
      { id: 'same', type: 'shape', shape: 'ellipse', x: 0, y: 0, w: 1, h: 1 }
    ];
    const back = yToDeck(load(deckToY(testDeck([{ layout: 'blank', elements: els }, { id: 'x', layout: 'blank', elements: [] }, { id: 'x', layout: 'blank', elements: [] }]))));
    const ids = back.slides[0]!.elements.map((e) => e.id);
    expect(ids[1]).toBe('same');
    expect(new Set(ids).size).toBe(3);
    expect(ids.every((id) => typeof id === 'string' && id.length > 0)).toBe(true);
    expect(back.slides.length).toBe(3);
    expect(new Set(back.slides.map((s) => s.id)).size).toBe(3);
  });

  it('refuse a picture that has not been uploaded, unless asked to keep it inline', () => {
    const deck = testDeck([{ layout: 'blank', elements: [{ type: 'image', x: 0, y: 0, w: 1, h: 1, asset: { data: 'AAAA', mime: 'image/png' } }] }]);
    expect(() => deckToY(deck)).toThrow(DeckInvalid);
    const back = yToDeck(load(deckToY(deck, { allowInlineAssets: true })));
    expect((back.slides[0]!.elements[0] as { asset: unknown }).asset).toEqual({ mime: 'image/png', data: 'AAAA' });
  });

  it('refuse a deck past each of DECK_LIMITS', () => {
    const shape = (): ElementJSON => ({ type: 'shape', shape: 'rect', x: 0, y: 0, w: 1, h: 1 });
    const nest = (depth: number): ElementJSON => (depth === 0 ? shape() : { type: 'group', x: 0, y: 0, w: 1, h: 1, children: [nest(depth - 1)] });
    const cells = (n: number) => Array.from({ length: n }, () => ({ text: txt('') }));
    expect(() => deckToY(testDeck(Array.from({ length: 501 }, () => ({ layout: 'blank', elements: [] }))))).toThrow(/at most 500 slides/);
    expect(() => deckToY(testDeck([{ layout: 'blank', elements: Array.from({ length: 401 }, shape) }]))).toThrow(/at most 400 objects/);
    // A group of a group of ... 9 deep, then 8 deep.
    expect(() => deckToY(testDeck([{ layout: 'blank', elements: [nest(9)] }]))).toThrow(/nested at most 8/);
    expect(() => deckToY(testDeck([{ layout: 'blank', elements: [nest(8)] }]))).not.toThrow();
    const table = (n: number): ElementJSON => ({ type: 'table', x: 0, y: 0, w: 1, h: 1, cols: [1], rows: [{ h: 1, cells: cells(n) }] });
    expect(() => deckToY(testDeck([{ layout: 'blank', elements: [table(2501)] }]))).toThrow(/2,500 cells/);
    // Elements inside groups count.
    expect(() => deckToY(testDeck([{ layout: 'blank', elements: [{ type: 'group', x: 0, y: 0, w: 1, h: 1, children: Array.from({ length: 400 }, shape) }] }]))).toThrow(DeckInvalid);
  });

  it('refuse a deck whose state is over the room’s cap', () => {
    const huge = 'x'.repeat(LIMITS.docStateMaxBytes + 10);
    expect(() => deckToY(testDeck([{ layout: 'blank', elements: [{ type: 'shape', shape: 'rect', x: 0, y: 0, w: 1, h: 1, text: txt(huge) }] }]))).toThrow(DeckTooLarge);
  });

  it('refuse text the schema does not have', () => {
    const bad = { type: 'doc' as const, content: [{ type: 'heading', content: [{ type: 'text', text: 'x' }] }] };
    expect(() => deckToY(testDeck([{ layout: 'blank', elements: [{ type: 'shape', shape: 'rect', x: 0, y: 0, w: 1, h: 1, text: bad }] }]))).toThrow(TextInvalid);
  });

  it('drop a link the schema would not open', () => {
    const js = { type: 'doc' as const, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] }] }] };
    const back = yToDeck(load(deckToY(testDeck([{ layout: 'blank', elements: [{ type: 'shape', shape: 'rect', x: 0, y: 0, w: 1, h: 1, text: js }] }]))));
    expect(JSON.stringify(back)).not.toContain('javascript');
  });
});

describe('readers', () => {
  it('take the first occurrence of a slide and skip an id with no slide', () => {
    const doc = load(deckToY(testDeck([{ id: 'a', layout: 'blank', elements: [] }, { id: 'b', layout: 'blank', elements: [] }])));
    orderOf(doc).push(['a', 'ghost', 'b']);
    expect(orderOf(doc).toArray()).toEqual(['a', 'b', 'a', 'ghost', 'b']);
    expect(readOrder(doc)).toEqual(['a', 'b']);
    expect(yToDeck(doc).slides.map((s) => s.id)).toEqual(['a', 'b']);
  });

  it('draw an element once, where the walk first meets it, when it is in z and in a group', () => {
    const deck: DeckJSON = testDeck([
      {
        id: 's',
        layout: 'blank',
        elements: [
          { id: 'g', type: 'group', x: 0, y: 0, w: 1, h: 1, children: [{ id: 'k', type: 'shape', shape: 'rect', x: 0, y: 0, w: 1, h: 1 }] },
          { id: 'top', type: 'shape', shape: 'rect', x: 0, y: 0, w: 1, h: 1 }
        ]
      }
    ]);
    const doc = load(deckToY(deck));
    const slide = slidesOf(doc).get('s')!;
    zOf(slide)!.push(['k', 'nothing']);
    kidsOf(elsOf(slide)!.get('g')!)!.push(['top']);
    const els = yToDeck(doc).slides[0]!.elements;
    // `k` is met first inside the group; `top` is met first inside the group too, since g is before it in z.
    expect(els.map((e) => e.id)).toEqual(['g']);
    expect((els[0] as { children: ElementJSON[] }).children.map((e) => e.id)).toEqual(['k', 'top']);
  });
});

describe('replaceAssetIds', () => {
  it('points every picture with a placeholder id at its asset, in the slides, the master and the layouts, and nothing else', async () => {
    const { replaceAssetIds } = await import('./ydoc');
    const deck = testDeck();
    const image = (id: string): ElementJSON => ({ type: 'image', x: 0, y: 0, w: 10, h: 10, asset: { id } });
    deck.master = { ...deck.master, bg: { kind: 'image', asset: { id: 'import-0' }, fit: 'cover' } };
    deck.layouts = deck.layouts.map((l, i) => (i === 0 ? { ...l, elements: [...l.elements, image('import-1')] } : l));
    deck.slides = [
      {
        id: 's1',
        layout: deck.layouts[0]!.id,
        bg: { kind: 'image', asset: { id: 'import-1' }, fit: 'cover' },
        elements: [
          image('import-0'),
          { type: 'shape', shape: 'rect', x: 0, y: 0, w: 10, h: 10, fill: { kind: 'image', asset: { id: 'import-2' }, fit: 'stretch' } },
          { type: 'group', x: 0, y: 0, w: 10, h: 10, children: [image('import-1'), image('kept_1')] },
          { type: 'table', x: 0, y: 0, w: 10, h: 10, cols: [10], rows: [{ h: 10, cells: [{ text: txt('x'), fill: { kind: 'image', asset: { id: 'import-2' }, fit: 'cover' } }] }] }
        ]
      }
    ];
    const doc = new Y.Doc();
    Y.applyUpdate(doc, deckToY(deck));
    const ids = new Map([
      ['import-0', 'a0'],
      ['import-1', 'a1']
    ]);
    const seen: unknown[] = [];
    doc.on('afterTransaction', (tr: Y.Transaction) => seen.push(tr.origin));
    expect(replaceAssetIds(doc, ids, 'import-pictures')).toBe(5);
    expect(seen).toEqual(['import-pictures']);

    const out = yToDeck(doc);
    const [pic, shape, group, table] = out.slides[0]!.elements as any[];
    expect(pic.asset).toEqual({ id: 'a0' });
    expect(shape.fill.asset).toEqual({ id: 'import-2' });
    expect(group.children.map((c: any) => c.asset.id)).toEqual(['a1', 'kept_1']);
    expect(table.rows[0].cells[0].fill.asset).toEqual({ id: 'import-2' });
    expect((out.slides[0]!.bg as any).asset).toEqual({ id: 'a1' });
    expect((out.master.bg as any).asset).toEqual({ id: 'a0' });
    expect((out.layouts[0]!.elements.at(-1) as any).asset).toEqual({ id: 'a1' });
  });
});
