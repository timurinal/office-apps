/**
 * What the Home tab's formatting buttons do, as plain functions over the context, one model call
 * each (or one `batch`, which is still one step): so each is one undo and one frame to the room,
 * and a button and its key mean the same thing.
 *
 * The state a button shows is the active cell's: `activeStyle` reads what the grid draws there, which
 * is the column's format, then the row's, then the cell's own. A toggle follows Excel: if the active
 * cell has the format the whole selection loses it, and otherwise the whole selection gets it.
 *
 * A format is switched off with `null` ("the default here"), never with `false` or an empty value:
 * the model drops a null that has nothing underneath, so a cell that is back to plain holds nothing.
 */

import type { Cellpos, CellStyle, Rect } from '../grid/types';
import { DEFAULT_FONT_PT } from '../grid/theme';
import type { StoredStyle } from '../model';
import { EMPTY_STYLE } from '../model/styles';
import type { ActionContext } from './actions';
import { type FormatId, FORMATS, categoryOf, currencyCode, hasThousands, stepDecimals } from './numfmt';

// ── what the active cell looks like ─────────────────────────────────────────

/** The active cell's format as drawn, or the empty one. */
export function activeStyle(c: Pick<ActionContext, 'data' | 'selection'>): CellStyle {
  const { active } = c.selection();
  return c.data.cell(active.row, active.col)?.style ?? EMPTY_STYLE;
}

const rectOf = (c: ActionContext): Rect => c.selection().rect;

/** The format laid over the selection. */
export function patch(c: ActionContext, p: StoredStyle): void {
  c.model.setStyle(c.sheetId, rectOf(c), p);
}

// ── font ────────────────────────────────────────────────────────────────────

export type Toggle = 'bold' | 'italic' | 'underline' | 'strike' | 'wrap';

/** On for the whole selection, or off for it, by what the active cell has. */
export function toggle(c: ActionContext, key: Toggle): void {
  patch(c, { [key]: activeStyle(c)[key] === true ? null : true });
}

export const DEFAULT_FONT = 'Inter';

/** Inter is the sheet's own font, so choosing it is going back to the default. */
export function setFont(c: ActionContext, name: string): void {
  patch(c, { font: name === DEFAULT_FONT ? null : name });
}

export function setSize(c: ActionContext, pt: number): void {
  patch(c, { size: pt === DEFAULT_FONT_PT ? null : pt });
}

/** What the size box shows. */
export const sizeOf = (c: Pick<ActionContext, 'data' | 'selection'>): number => activeStyle(c).size ?? DEFAULT_FONT_PT;

/** A typed size: whole or half points, 1 to 409, as the model keeps them. */
export function parseSize(text: string): number | null {
  const m = /^\s*(\d{1,3}(?:[.,]\d)?)\s*(?:pt)?\s*$/i.exec(text);
  if (!m) return null;
  const n = Math.round(Number(m[1]!.replace(',', '.')) * 2) / 2;
  return n >= 1 && n <= 409 ? n : null;
}

/** The size above or below `from` in the list the dropdown offers. */
export function stepSize(from: number, direction: 1 | -1, sizes: readonly number[]): number {
  if (direction === 1) return sizes.find((s) => s > from) ?? Math.min(409, from + 1);
  return [...sizes].reverse().find((s) => s < from) ?? Math.max(1, from - 1);
}

export function setColor(c: ActionContext, which: 'color' | 'fill', value: string | null): void {
  patch(c, { [which]: value });
}

// ── alignment ───────────────────────────────────────────────────────────────

export type Horizontal = 'left' | 'center' | 'right';
export type Vertical = 'top' | 'middle' | 'bottom';

/** Choosing the alignment a cell already has takes it away, as Excel's buttons do. */
export function alignH(c: ActionContext, h: Horizontal): void {
  patch(c, { h: (activeStyle(c).h ?? 'general') === h ? null : h });
}

/** Middle is where a cell sits unless it says otherwise, so it is the one that is never stored. */
export function alignV(c: ActionContext, v: Vertical): void {
  patch(c, { v: v === 'middle' || (activeStyle(c).v ?? 'middle') === v ? null : v });
}

export const INDENT_MAX = 15;

/**
 * One step of indent more or less. Excel indents only left- or right-aligned text, so a cell
 * on General takes the alignment its content already has.
 */
export function indent(c: ActionContext, delta: 1 | -1): void {
  const s = activeStyle(c);
  const next = Math.max(0, Math.min(INDENT_MAX, (s.indent ?? 0) + delta));
  const { active } = c.selection();
  const kind = c.data.cell(active.row, active.col)?.kind;
  const h = (s.h ?? 'general') === 'general' && next > 0 ? (kind === 'number' ? 'right' : 'left') : undefined;
  patch(c, { indent: next === 0 ? null : next, ...(h ? { h } : {}) });
}

// ── merging ─────────────────────────────────────────────────────────────────

export type MergeKind = 'cells' | 'centre' | 'across' | 'unmerge';

const contains = (r: Rect, p: Cellpos): boolean => p.row >= r.r1 && p.row <= r.r2 && p.col >= r.c1 && p.col <= r.c2;

/** Whether the active cell is in a merged area. */
export const isMerged = (c: Pick<ActionContext, 'data' | 'selection'>): boolean => {
  const { active } = c.selection();
  return c.data.merges().some((m) => contains(m, active));
};

/**
 * Merge and centre is one step that merges and then centres, and where the area is already merged it
 * undoes the merge, as Excel's button does. A single cell has nothing to merge.
 */
export function merge(c: ActionContext, kind: MergeKind): void {
  const r = rectOf(c);
  const single = r.r1 === r.r2 && r.c1 === r.c2;
  switch (kind) {
    case 'unmerge':
      c.model.unmerge(c.sheetId, r);
      return;
    case 'cells':
      if (!single) c.model.merge(c.sheetId, r);
      return;
    case 'centre':
      if (isMerged(c)) {
        c.model.unmerge(c.sheetId, r);
        return;
      }
      if (single) return;
      c.model.batch(() => {
        c.model.merge(c.sheetId, r);
        c.model.setStyle(c.sheetId, r, { h: 'center' });
      });
      return;
    case 'across':
      if (r.c1 === r.c2) return;
      c.model.batch(() => {
        for (let row = r.r1; row <= r.r2; row++) c.model.merge(c.sheetId, { ...r, r1: row, r2: row });
      });
  }
}

// ── number formats ──────────────────────────────────────────────────────────

/** A format code onto the selection; General is the absence of one. */
export function setNumberFormat(c: ActionContext, code: string): void {
  patch(c, { numFmt: /^general$/i.test(code.trim()) ? null : code });
}

export const categoryNow = (c: Pick<ActionContext, 'data' | 'selection'>): FormatId => categoryOf(activeStyle(c).numFmt);

/** A category from the dropdown, in the currency in use. */
export function applyCategory(c: ActionContext, id: FormatId, currency: string): void {
  const choice = FORMATS.find((f) => f.id === id);
  if (choice) setNumberFormat(c, choice.code(currency));
}

/** The currency button: the symbol's code with two places. */
export function applyCurrency(c: ActionContext, symbol: string): void {
  setNumberFormat(c, currencyCode(symbol));
}

/** Percent is on when the cell shows one, and pressing it again goes back to General. */
export function togglePercent(c: ActionContext): void {
  setNumberFormat(c, categoryNow(c) === 'percent' ? 'General' : '0%');
}

/** The thousands separator, on a number with two places, and off again to General. */
export function toggleThousands(c: ActionContext): void {
  const code = activeStyle(c).numFmt;
  setNumberFormat(c, hasThousands(code) && categoryOf(code) === 'number' ? 'General' : '#,##0.00');
}

/** One place more or fewer, worked out from the active cell and given to all of them. */
export function moreDecimals(c: ActionContext, delta: 1 | -1): void {
  const code = stepDecimals(activeStyle(c).numFmt, delta);
  if (code !== (activeStyle(c).numFmt ?? 'General')) setNumberFormat(c, code);
}

// ── borders ─────────────────────────────────────────────────────────────────

export type BorderPreset =
  | 'all'
  | 'outside'
  | 'thick-outside'
  | 'inside'
  | 'inside-h'
  | 'inside-v'
  | 'top'
  | 'bottom'
  | 'left'
  | 'right'
  | 'top-bottom'
  | 'bottom-double'
  | 'bottom-thick'
  | 'none';

export type BorderLine = 'thin' | 'medium' | 'thick' | 'dashed' | 'dotted' | 'double';

export interface BorderPen {
  line: BorderLine;
  /** CSS colour; absent is the default ink. */
  color?: string;
}

type Side = 'borderTop' | 'borderRight' | 'borderBottom' | 'borderLeft';

/**
 * A border preset onto the selection, as one step. An edge between two cells is written on both,
 * the same on each, so it reads the same whichever the grid draws and a border that is taken away
 * is gone from both sides of it, as in Excel. Presets that draw (anything but `none`) use `pen`;
 * the double and the thick ones say their own line.
 */
export function applyBorders(c: ActionContext, preset: BorderPreset, pen: BorderPen): void {
  const r = rectOf(c);
  const rows = c.data.rowCount();
  const cols = c.data.colCount();
  const line = (l: BorderLine) => (preset === 'none' ? null : { line: l, ...(pen.color ? { color: pen.color } : {}) });
  const own = line(pen.line);
  const thick = line('thick');
  const double = line('double');

  // One edge: the cells of the selection's side, and the row or column of neighbours beyond it.
  const edge = (side: 'top' | 'bottom' | 'left' | 'right', value: ReturnType<typeof line>, within: Rect = r) => {
    const mine: Side = side === 'top' ? 'borderTop' : side === 'bottom' ? 'borderBottom' : side === 'left' ? 'borderLeft' : 'borderRight';
    const facing: Side = side === 'top' ? 'borderBottom' : side === 'bottom' ? 'borderTop' : side === 'left' ? 'borderRight' : 'borderLeft';
    const strip: Rect =
      side === 'top'
        ? { ...within, r2: within.r1 }
        : side === 'bottom'
          ? { ...within, r1: within.r2 }
          : side === 'left'
            ? { ...within, c2: within.c1 }
            : { ...within, c1: within.c2 };
    c.model.setStyle(c.sheetId, strip, { [mine]: value });
    const beyond: Rect | null =
      side === 'top'
        ? within.r1 > 0 ? { ...strip, r1: within.r1 - 1, r2: within.r1 - 1 } : null
        : side === 'bottom'
          ? within.r2 < rows - 1 ? { ...strip, r1: within.r2 + 1, r2: within.r2 + 1 } : null
          : side === 'left'
            ? within.c1 > 0 ? { ...strip, c1: within.c1 - 1, c2: within.c1 - 1 } : null
            : within.c2 < cols - 1 ? { ...strip, c1: within.c2 + 1, c2: within.c2 + 1 } : null;
    if (beyond) c.model.setStyle(c.sheetId, beyond, { [facing]: value });
  };

  /** The edges between the rows of the selection (horizontal lines) and between its columns. */
  const between = (axis: 'rows' | 'cols', value: ReturnType<typeof line>) => {
    if (axis === 'rows') {
      if (r.r1 === r.r2) return;
      c.model.setStyle(c.sheetId, { ...r, r2: r.r2 - 1 }, { borderBottom: value });
      c.model.setStyle(c.sheetId, { ...r, r1: r.r1 + 1 }, { borderTop: value });
    } else {
      if (r.c1 === r.c2) return;
      c.model.setStyle(c.sheetId, { ...r, c2: r.c2 - 1 }, { borderRight: value });
      c.model.setStyle(c.sheetId, { ...r, c1: r.c1 + 1 }, { borderLeft: value });
    }
  };

  const outside = (value: ReturnType<typeof line>) => {
    for (const side of ['top', 'bottom', 'left', 'right'] as const) edge(side, value);
  };

  c.model.batch(() => {
    switch (preset) {
      case 'all':
        outside(own);
        between('rows', own);
        between('cols', own);
        break;
      case 'none':
        outside(null);
        between('rows', null);
        between('cols', null);
        break;
      case 'outside':
        outside(own);
        break;
      case 'thick-outside':
        outside(thick);
        break;
      case 'inside':
        between('rows', own);
        between('cols', own);
        break;
      case 'inside-h':
        between('rows', own);
        break;
      case 'inside-v':
        between('cols', own);
        break;
      case 'top':
      case 'bottom':
      case 'left':
      case 'right':
        edge(preset, own);
        break;
      case 'top-bottom':
        edge('top', own);
        edge('bottom', own);
        break;
      case 'bottom-double':
        edge('bottom', double);
        break;
      case 'bottom-thick':
        edge('bottom', thick);
        break;
    }
  });
}

// ── clearing, painting, named styles ────────────────────────────────────────

export function clearFormats(c: ActionContext): void {
  c.model.clearFormats(c.sheetId, rectOf(c));
}

const STYLE_KEYS = [
  'font',
  'size',
  'bold',
  'italic',
  'underline',
  'strike',
  'color',
  'fill',
  'h',
  'v',
  'wrap',
  'indent',
  'numFmt',
  'borderTop',
  'borderRight',
  'borderBottom',
  'borderLeft'
] as const satisfies readonly (keyof CellStyle)[];

/**
 * What the format painter lifts from a cell: every field, with the ones the cell does not have
 * as `null`, so painting a plain cell onto a formatted one makes it plain.
 */
export function lift(style: CellStyle): StoredStyle {
  const out: Record<string, unknown> = {};
  for (const k of STYLE_KEYS) out[k] = style[k] ?? null;
  return out as StoredStyle;
}

/** A lifted format onto the selection. */
export function paint(c: ActionContext, lifted: StoredStyle): void {
  patch(c, lifted);
}

export interface NamedStyle {
  id: string;
  label: string;
  /** What it lays over the cell; empty for Normal, which clears the formats instead. */
  style: StoredStyle;
}

const ink = (hex: string) => ({ color: hex });

export const CELL_STYLES: readonly NamedStyle[] = [
  { id: 'normal', label: 'Normal', style: {} },
  { id: 'good', label: 'Good', style: { ...ink('#006100'), fill: '#c6efce' } },
  { id: 'bad', label: 'Bad', style: { ...ink('#9c0006'), fill: '#ffc7ce' } },
  { id: 'neutral', label: 'Neutral', style: { ...ink('#9c5700'), fill: '#ffeb9c' } },
  { id: 'input', label: 'Input', style: { ...ink('#3f3f76'), fill: '#ffcc99' } },
  { id: 'note', label: 'Note', style: { fill: '#ffffcc' } },
  { id: 'title', label: 'Title', style: { size: 15, bold: true } },
  { id: 'heading-1', label: 'Heading 1', style: { size: 13, bold: true, borderBottom: { line: 'medium', color: '#1e8255' } } },
  { id: 'heading-2', label: 'Heading 2', style: { size: 11, bold: true, borderBottom: { line: 'thin', color: '#82d1a8' } } },
  { id: 'total', label: 'Total', style: { bold: true, borderTop: { line: 'thin' }, borderBottom: { line: 'double' } } },
  { id: 'percent', label: 'Percent', style: { numFmt: '0.00%' } },
  { id: 'currency', label: 'Currency', style: { numFmt: '"£"#,##0.00' } },
  { id: 'comma', label: 'Comma', style: { numFmt: '#,##0.00' } }
];

export function applyCellStyle(c: ActionContext, id: string): void {
  const s = CELL_STYLES.find((x) => x.id === id);
  if (!s) return;
  if (id === 'normal') clearFormats(c);
  else patch(c, s.style);
}
