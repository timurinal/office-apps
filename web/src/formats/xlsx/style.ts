/**
 * A cell's format as ExcelJS reads it from a workbook, as the model stores one.
 *
 * What is dropped is a choice and is said where it is made. The model has no theme, so a theme
 * colour is resolved to the RGB it is; no gradient, pattern or diagonal border; no rotation,
 * shrink-to-fit or reading order. Whatever the workbook's own default is (its Normal font, black
 * text, "General") is not carried, so a cell in the default format has no format here and the
 * sheet is drawn in the model's own default, in light and in dark.
 */

import type ExcelJS from 'exceljs';
import type { DateOrder } from '../../sheets/engine';
import type { BorderLine } from '../../sheets/grid/types';
import { type StoredStyle, cleanStyle } from '../../sheets/model/styles';
import { type ExcelColor, resolveColor } from './colors';

export interface StyleContext {
  theme: readonly string[];
  defaultFont: { name?: string; size?: number };
  dateOrder: DateOrder;
  /** Called once for each kind of thing that is left out. */
  lost: (what: 'gradient') => void;
}

const BORDERS: Record<string, BorderLine> = {
  thin: 'thin',
  hair: 'dotted',
  dotted: 'dotted',
  dashed: 'dashed',
  dashDot: 'dashed',
  dashDotDot: 'dashed',
  slantDashDot: 'dashed',
  medium: 'medium',
  mediumDashed: 'medium',
  mediumDashDot: 'medium',
  mediumDashDotDot: 'medium',
  thick: 'thick',
  double: 'double'
};

/** Black is how a workbook says "automatic" as often as it says black, and automatic must stay readable on a dark sheet. */
const INK = '#000000';

const color = (c: ExcelColor | undefined, ctx: StyleContext): string | undefined => {
  const hex = resolveColor(c, ctx.theme);
  return hex && hex !== INK ? hex : undefined;
};

/**
 * Number format 14, which Excel shows as the system's short date, is `mm-dd-yy` by the time
 * ExcelJS hands it over. Month first is the US reading of it; the workbook's own order wins.
 */
function numFmt(code: string | undefined, order: DateOrder): string | undefined {
  if (!code || code === 'General') return undefined;
  if (code === 'mm-dd-yy') return order === 'dmy' ? 'dd/mm/yyyy' : 'm/d/yyyy';
  return code.length <= 255 ? code : undefined;
}

const sameName = (a: string | undefined, b: string | undefined) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

export function mapStyle(style: Partial<ExcelJS.Style> | null | undefined, ctx: StyleContext): StoredStyle {
  if (!style) return {};
  const out: Record<string, unknown> = {};

  const fmt = numFmt(style.numFmt, ctx.dateOrder);
  if (fmt) out.numFmt = fmt;

  const f = style.font;
  if (f) {
    if (f.name && !sameName(f.name, ctx.defaultFont.name)) out.font = f.name;
    if (f.size && f.size !== ctx.defaultFont.size) out.size = f.size;
    if (f.bold) out.bold = true;
    if (f.italic) out.italic = true;
    if (f.underline && f.underline !== ('none' as unknown)) out.underline = true;
    if (f.strike) out.strike = true;
    const c = color(f.color as ExcelColor | undefined, ctx);
    if (c) out.color = c;
  }

  const fill = style.fill as (ExcelJS.Fill & { pattern?: string; fgColor?: ExcelColor; bgColor?: ExcelColor }) | undefined;
  if (fill) {
    if (fill.type === 'gradient') ctx.lost('gradient');
    else if (fill.pattern === 'solid') {
      const c = resolveColor(fill.fgColor, ctx.theme) ?? resolveColor(fill.bgColor, ctx.theme);
      if (c) out.fill = c;
    }
  }

  const a = style.alignment;
  if (a) {
    if (a.horizontal === 'left' || a.horizontal === 'center' || a.horizontal === 'right') out.h = a.horizontal;
    else if (a.horizontal === 'centerContinuous') out.h = 'center';
    else if (a.horizontal === 'justify' || a.horizontal === 'distributed' || a.horizontal === 'fill') out.h = 'left';
    if (a.vertical === 'top' || a.vertical === 'bottom') out.v = a.vertical;
    else if (a.vertical === 'middle' || a.vertical === 'distributed' || a.vertical === 'justify') out.v = 'middle';
    if (a.wrapText) out.wrap = true;
    if (a.indent && a.indent > 0) out.indent = a.indent;
  }

  const b = style.border;
  if (b) {
    for (const [side, key] of [['top', 'borderTop'], ['right', 'borderRight'], ['bottom', 'borderBottom'], ['left', 'borderLeft']] as const) {
      const edge = b[side];
      const line = edge?.style ? BORDERS[edge.style] : undefined;
      if (!edge || !line) continue;
      const c = color(edge.color as ExcelColor | undefined, ctx);
      out[key] = c ? { line, color: c } : { line };
    }
  }
  return cleanStyle(out);
}
