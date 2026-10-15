/**
 * A drawing of a document's first page, made from its content.
 *
 * Office keeps no preview image of a document, and a template card draws a small page in
 * the app's colours, as the Main board does: a heading bar in the 700, accent bars in the
 * 300, and lines in the soft border. For a predefined template the page is not the generic
 * one. It is this template's: a letter's right-aligned address, a plan's table, a
 * newsletter's centred masthead, so the card shows what is inside before it is opened.
 *
 * Pure: content in, a list of rows out, and `SketchThumb` (home/SketchThumb.tsx) only
 * draws them. Widths come from the text's length and a hash of it, so the same content
 * always draws the same page and two paragraphs do not draw the same line.
 *
 * It draws the first page that has something on it, and stops at the next page break or when
 * the card is full. A page of fewer than five rows that a break follows is a cover, and a
 * card that showed it would show a title and white space, so the page after it is drawn.
 */

import type { JSONContent } from '@tiptap/core';

export type Align = 'center' | 'right';

export type SketchRow =
  /** The title, or the heading that opens the page: the 700 bar. */
  | { t: 'title'; w: number; align?: Align }
  /** A heading, and the subtitle: the 300 bar. */
  | { t: 'heading'; w: number; align?: Align }
  | { t: 'line'; w: number; align?: Align }
  | { t: 'item'; w: number; mark: 'dot' | 'box' | 'number' }
  | { t: 'quote'; w: number }
  | { t: 'rule' }
  | { t: 'table'; cols: number; rows: number; header: boolean };

export interface Sketch {
  rows: SketchRow[];
  /** A landscape page: wider than a portrait one. */
  wide: boolean;
}

/** The thumbnail's page area: 112px tall less its 16px top padding. A row is its height and a 6px gap. */
export const SKETCH_HEIGHT = 94;
/** A page with fewer rows than this, before a page break, is a cover. */
const COVER_ROWS = 5;
export const SKETCH_GAP = 6;

/** Each row's height in pixels. A table's is its rows, and `TABLE_ROW` each. */
const ROW_HEIGHT = { title: 7, heading: 5, line: 4, item: 4, quote: 4, rule: 1 } as const;
export const TABLE_ROW = 6;

export const heightOf = (row: SketchRow): number => (row.t === 'table' ? row.rows * TABLE_ROW + 1 : ROW_HEIGHT[row.t]);

/** Headings sit 4px further from what is above them, as the board has them. */
const extraBefore = (row: SketchRow): number => (row.t === 'heading' ? 4 : 0);

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** A width from 92 to 100 that depends on the text, so full lines are not all the same. */
const full = (seed: string): number => 92 + (hash(seed) % 9);

const textOf = (n: JSONContent): string => (n.type === 'text' ? (n.text ?? '') : (n.content ?? []).map(textOf).join(''));

const alignOf = (n: JSONContent): Align | undefined => {
  const a = n.attrs?.textAlign;
  return a === 'center' || a === 'right' ? a : undefined;
};

const PER_LINE = 64;
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/** A short line is as wide as its text; a long one fills the page and ends where the text does. */
function lines(text: string, align?: Align): SketchRow[] {
  if (text.length === 0) return [];
  const count = Math.min(3, Math.ceil(text.length / PER_LINE));
  return Array.from({ length: count }, (_, i): SketchRow => {
    const w = i === count - 1 ? clamp(Math.round(((text.length - i * PER_LINE) / PER_LINE) * 100), 24, 96) : full(text + i);
    return { t: 'line', w, ...(align ? { align } : {}) };
  });
}

const itemWidth = (text: string): number => clamp(Math.round((text.length / 48) * 100), 34, 86);

/** Adds a block's rows to `out`, and says 'stop' for a page break. */
function rowsOf(node: JSONContent, out: SketchRow[]): 'stop' | void {
  const text = textOf(node);
  const align = alignOf(node);
  switch (node.type) {
    case 'pageBreak':
      return 'stop';
    case 'heading': {
      const level = Number(node.attrs?.level) || 1;
      const w = Math.round(Math.max(30, Math.min(level === 1 ? 70 : 48, text.length * 3.2)));
      out.push({ t: 'heading', w, ...(align ? { align } : {}) });
      return;
    }
    case 'paragraph': {
      const style = node.attrs?.paraStyle;
      if (style === 'title') out.push({ t: 'title', w: Math.round(Math.max(30, Math.min(70, text.length * 3.6))), ...(align ? { align } : {}) });
      else if (style === 'subtitle') out.push({ t: 'heading', w: Math.round(Math.max(30, Math.min(56, text.length * 2.6))), ...(align ? { align } : {}) });
      else out.push(...lines(text, align));
      return;
    }
    case 'bulletList':
    case 'orderedList':
    case 'taskList': {
      const mark = node.type === 'bulletList' ? 'dot' : node.type === 'orderedList' ? 'number' : 'box';
      // Two items say "a list"; a third costs the space of a later block.
      for (const li of (node.content ?? []).slice(0, 2)) out.push({ t: 'item', w: itemWidth(textOf(li)), mark });
      return;
    }
    case 'blockquote':
      out.push({ t: 'quote', w: itemWidth(text) });
      return;
    case 'horizontalRule':
      out.push({ t: 'rule' });
      return;
    case 'tableOfContents':
      // Three short entries: a contents page reads as a column of lines.
      out.push({ t: 'line', w: 70 }, { t: 'line', w: 58 }, { t: 'line', w: 66 });
      return;
    case 'table': {
      const rows = node.content ?? [];
      const cols = Math.max(1, Math.min(6, rows[0]?.content?.length ?? 1));
      out.push({ t: 'table', cols, rows: Math.max(1, Math.min(3, rows.length)), header: rows[0]?.content?.[0]?.type === 'tableHeader' });
      return;
    }
    default:
      return;
  }
}

/** The first page of `blocks`, as rows that fit the card. */
export function sketchOf(blocks: readonly JSONContent[], { wide = false }: { wide?: boolean } = {}): Sketch {
  const pages: SketchRow[][] = [[]];
  for (const block of blocks) if (rowsOf(block, pages[pages.length - 1]!) === 'stop') pages.push([]);
  // The first page with something on it; if every page is thin, the fullest.
  const all = pages.find((p) => p.length >= COVER_ROWS) ?? pages.reduce((a, b) => (b.length > a.length ? b : a));

  // A page that opens with a heading is titled by it, as the board's pages are.
  const first = all[0];
  if (first?.t === 'heading') all[0] = { ...first, t: 'title' };

  const rows: SketchRow[] = [];
  let used = 0;
  for (const row of all) {
    const next = used + (rows.length ? SKETCH_GAP : 0) + extraBefore(row) + heightOf(row);
    if (next > SKETCH_HEIGHT) break;
    rows.push(row);
    used = next;
  }
  return { rows, wide };
}
