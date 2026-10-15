/**
 * Writing a template's slides: a layout, the text for its placeholders, and whatever else goes on
 * the slide (a table, a chart).
 *
 * A template is a `DeckJSON` made from a theme's own layouts, so a slide's placeholders are copies
 * of its layout's, with text in them. Ids are `s1`, `s2`, ... for slides and `e1`, `e2`, ... in a
 * slide, so building one twice gives the same JSON.
 *
 * Pure: no DOM, no Yjs.
 */

import type { ChartElement, Color, DeckJSON, ElementJSON, LayoutJSON, SlideJSON, TableCell, TableElement, TextDoc, TextNode, ThemeJSON } from '../model/deck';
import { bold, doc, para, plainText, tinted, withIds } from '../themes/build';
import type { Box, Run } from '../themes/build';
import { layoutsFor, SLIDE_NUMBER_TEXT, type LayoutId } from '../themes/layouts';
import { masterFor } from '../themes/master';
import { lookOf, themeById, tonesOf } from '../themes/themes';

export { bold, doc, para };
export { plainText };

// ── text ────────────────────────────────────────────────────────────────────

/** A list: a string is a point, `[text, 1]` is a point one level in, a node is a paragraph as it is. */
export function list(...items: (string | [string, number] | TextNode)[]): TextDoc {
  return doc(
    ...items.map((item) => {
      if (typeof item === 'string') return para(item);
      return Array.isArray(item) ? para(item[0], { level: item[1] }) : item;
    })
  );
}

/** A line with no bullet, for a column heading or a line of prose in a body placeholder. */
export const plain = (runs: Run | Run[], extra: { align?: 'left' | 'center' | 'right' } = {}): TextNode =>
  para(runs, { bullet: { kind: 'none' }, ...extra });

/**
 * A title. In a deck on a theme whose second accent is the brand's teal, the full stop is teal, as
 * the wordmark's is and as the Slides board has it.
 */
export function heading(text: string, dot: boolean): TextDoc {
  const stop = dot && text.endsWith('.');
  return doc(para(stop ? [text.slice(0, -1), tinted('.', { theme: 'accent2' })] : text));
}

// ── a table and a chart ─────────────────────────────────────────────────────

const CELL_PT = 22;

/** A table cell. Sizes are set on the run: a table's cells inherit the master's 20 pt `other`. */
function cell(text: string, options: { bold?: boolean; align?: 'left' | 'center' | 'right'; fill?: TableCell['fill']; color?: Color } = {}): TableCell {
  const run: TextNode = {
    type: 'text',
    text,
    marks: [...(options.bold ? [{ type: 'bold' }] : []), { type: 'textStyle', attrs: { fontSize: CELL_PT, ...(options.color ? { color: options.color } : {}) } }]
  };
  return {
    text: doc(para(text ? [run] : [], options.align ? { align: options.align } : {})),
    anchor: 'middle',
    ...(options.fill ? { fill: options.fill } : {})
  };
}

/**
 * A table whose first row is its header. Fills are written on the cells, as theme slots, so the
 * table reads the same wherever it is drawn and follows the theme if it changes. `align` is by
 * column.
 */
export function table(
  theme: ThemeJSON,
  box: Box,
  widths: number[],
  rows: string[][],
  options: { rowHeight?: number; headerHeight?: number; align?: ('left' | 'center' | 'right')[] } = {}
): TableElement {
  const look = lookOf(theme);
  const tones = tonesOf(theme);
  const { rowHeight = 72, headerHeight = 80, align = [] } = options;
  return {
    type: 'table',
    ...box,
    h: headerHeight + (rows.length - 1) * rowHeight,
    cols: widths,
    firstRow: true,
    bandRows: true,
    border: { color: tones.surface, width: 2 },
    rows: rows.map((row, r) => ({
      h: r === 0 ? headerHeight : rowHeight,
      cells: row.map((text, c): TableCell =>
        r === 0
          ? cell(text, { bold: true, align: align[c], fill: { kind: 'solid', color: look.hero.bg }, color: look.hero.ink })
          : cell(text, { align: align[c], fill: r % 2 === 0 ? { kind: 'solid', color: tones.surface } : { kind: 'none' } })
      )
    }))
  };
}

export const chart = (box: Box, spec: Pick<ChartElement, 'chart' | 'categories' | 'series' | 'title'>, name: string, alt: string): ChartElement => ({
  type: 'chart',
  ...box,
  name,
  alt,
  ...spec
});

// ── slides and decks ────────────────────────────────────────────────────────

export interface SlideSpec {
  layout: LayoutId;
  /** Text for the layout's placeholders: `title`, `body:1`, `subTitle:2`. A key no placeholder has is an error. */
  text: Record<string, TextDoc | string>;
  /** Everything else on the slide, in front of the placeholders. */
  extra?: ElementJSON[];
  /** Speaker notes, a paragraph each. */
  notes?: string[];
}

const keyOf = (el: ElementJSON): string | null => (el.ph ? (el.ph.idx === undefined ? el.ph.type : `${el.ph.type}:${el.ph.idx}`) : null);

function slideOf(layout: LayoutJSON, spec: SlideSpec, footer: string | null, index: number): SlideJSON {
  const keys = new Set(layout.elements.map(keyOf).filter((k): k is string => k !== null));
  for (const key of Object.keys(spec.text)) {
    if (!keys.has(key)) throw new Error(`Slide ${index + 1}: the ${layout.id} layout has no placeholder ${key}`);
  }

  // A copy of a layout's placeholder, with the text it was given and no id: ids are numbered over the slide.
  const filled = (el: ElementJSON, text: TextDoc): ElementJSON => {
    const { id: _id, ...rest } = el;
    return { ...rest, text } as ElementJSON;
  };

  const content: ElementJSON[] = [];
  const foot: ElementJSON[] = [];
  for (const el of layout.elements) {
    if (el.ph?.type === 'ftr' || el.ph?.type === 'sldNum') {
      // A footer is on every slide but the title's, with the text this deck's is given.
      if (footer !== null) foot.push(filled(el, doc(el.ph.type === 'ftr' ? footer : SLIDE_NUMBER_TEXT)));
      continue;
    }
    const text = spec.text[keyOf(el) ?? ''];
    if (text !== undefined && el.type === 'shape') content.push(filled(el, typeof text === 'string' ? doc(text) : text));
  }
  // Content first, then what was added over it, then the footer line.

  return {
    id: `s${index + 1}`,
    layout: layout.id,
    elements: withIds([...content, ...(spec.extra ?? []), ...foot]),
    ...(spec.notes?.length ? { notes: doc(...spec.notes) } : {})
  };
}

/**
 * A deck in `themeId`: its master and layouts, and `slides` as slides (given the theme, for a table
 * that draws its header from it). `footer` is the text of every slide's footer but a title slide's.
 */
export function makeDeck(themeId: string, footer: string, slides: (theme: ThemeJSON) => SlideSpec[]): DeckJSON {
  const theme = themeById(themeId);
  if (!theme) throw new Error(`No theme ${themeId}`);
  const layouts = layoutsFor(theme);
  const specs = slides(theme);
  return {
    v: 1,
    size: '16:9',
    theme,
    master: masterFor(theme),
    layouts,
    slides: specs.map((spec, i) => {
      const layout = layouts.find((l) => l.id === spec.layout);
      if (!layout) throw new Error(`Slide ${i + 1}: no layout ${spec.layout}`);
      return slideOf(layout, spec, spec.layout === 'title' ? null : footer, i);
    })
  };
}

