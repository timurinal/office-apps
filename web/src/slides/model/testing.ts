/**
 * A small design and deck for the model's and the renderer's tests. Not shipped: nothing but a
 * test imports it. It stands in for slides/themes so these tests read only what they test.
 */

import * as Y from 'yjs';
import type { DeckJSON, ElementJSON, LayoutJSON, MasterJSON, PlaceholderType, ShapeElement, TextDoc, ThemeJSON } from './deck';
import { SlideModel, type SlideModelOptions } from './model';
import { writeDeck } from './ydoc';

export const THEME: ThemeJSON = {
  id: 'test',
  name: 'Test',
  colors: {
    dk1: '#111111',
    lt1: '#ffffff',
    dk2: '#222244',
    lt2: '#eeeeee',
    accent1: '#f97316',
    accent2: '#0ea5e9',
    accent3: '#22c55e',
    accent4: '#eab308',
    accent5: '#a855f7',
    accent6: '#ef4444',
    hlink: '#2563eb'
  },
  fonts: { major: 'Fraunces', minor: 'Inter' }
};

export const MASTER: MasterJSON = {
  bg: { kind: 'solid', color: { theme: 'lt1' } },
  elements: [],
  styles: {
    title: { fontSize: 44, bold: true, color: { theme: 'dk1' } },
    body: [
      { fontSize: 24, bullet: { kind: 'char', char: '•' }, indent: 44, bulletIndent: 0 },
      { fontSize: 22, bullet: { kind: 'char', char: '–' }, indent: 96, bulletIndent: 52 },
      { fontSize: 20 }
    ],
    other: { fontSize: 20 }
  }
};

export const txt = (...paras: string[]): TextDoc => ({
  type: 'doc',
  content: paras.map((p) => (p ? { type: 'paragraph', content: [{ type: 'text', text: p }] } : { type: 'paragraph' }))
});

const ph = (type: PlaceholderType, x: number, y: number, w: number, h: number, prompt: string, idx?: number): ShapeElement => ({
  type: 'shape',
  shape: 'rect',
  x,
  y,
  w,
  h,
  ph: idx === undefined ? { type } : { type, idx },
  text: txt(prompt)
});

const footers = (): ElementJSON[] => [
  ph('dt', 1100, 972, 400, 44, 'Date', 10),
  ph('ftr', 154, 972, 900, 44, 'Footer', 11),
  ph('sldNum', 1566, 972, 200, 44, '‹#›', 12)
];

export const LAYOUTS: LayoutJSON[] = [
  {
    id: 'title',
    name: 'Title slide',
    elements: [ph('ctrTitle', 154, 270, 1400, 340, 'Add a title.'), ph('subTitle', 154, 690, 1400, 160, 'Add a subtitle.'), ...footers()],
    styles: { ctrTitle: [{ fontSize: 60 }], subTitle: [{ fontSize: 28, bullet: { kind: 'none' } }] }
  },
  {
    id: 'titleContent',
    name: 'Title and content',
    elements: [ph('title', 154, 100, 1612, 240, 'Add a title.'), ph('body', 154, 368, 1612, 560, 'Add your points.', 1), ...footers()]
  },
  {
    id: 'twoContent',
    name: 'Two content',
    elements: [
      ph('title', 154, 100, 1612, 240, 'Add a title.'),
      ph('body', 154, 368, 776, 560, 'Add your points.', 1),
      ph('body', 990, 368, 776, 560, 'Add your points.', 2),
      ...footers()
    ]
  },
  {
    id: 'blank',
    name: 'Blank',
    elements: [{ type: 'shape', shape: 'rect', x: 0, y: 1060, w: 1920, h: 20, fill: { kind: 'solid', color: { theme: 'accent1' } } }]
  }
];

export function testDeck(slides: DeckJSON['slides'] = [{ id: 's1', layout: 'blank', elements: [] }]): DeckJSON {
  return { v: 1, size: '16:9', theme: THEME, master: MASTER, layouts: LAYOUTS, slides };
}

export function docOf(deck: DeckJSON = testDeck()): Y.Doc {
  const doc = new Y.Doc();
  writeDeck(doc, deck);
  return doc;
}

export function modelOf(deck: DeckJSON = testDeck(), options: SlideModelOptions = {}): SlideModel {
  return new SlideModel(docOf(deck), options);
}

/** Exchanges what each document lacks, both ways: two clients coming back online. */
export function sync(a: Y.Doc, b: Y.Doc): void {
  const toB = Y.encodeStateAsUpdate(a, Y.encodeStateVector(b));
  const toA = Y.encodeStateAsUpdate(b, Y.encodeStateVector(a));
  Y.applyUpdate(b, toB, 'remote');
  Y.applyUpdate(a, toA, 'remote');
}

/** A second client: a document holding `a`'s state, with its own model. */
export function peerOf(a: Y.Doc, options: SlideModelOptions = {}): SlideModel {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(a), 'remote');
  return new SlideModel(doc, options);
}

export const box = (x: number, y: number, w = 100, h = 100): ShapeElement => ({ type: 'shape', shape: 'rect', x, y, w, h });
