/**
 * A workbook as the model saves it, into an xlsx file.
 *
 *     const { bytes, warnings } = await writeXlsx(model.export(), { title });
 *
 * The file is complete in itself: every formula is written as Excel reads it with the value the
 * engine calculated beside it, so a reader with no calculator (a previewer, a script, a mail
 * client) shows numbers, and the workbook is marked to be calculated again when Excel opens it.
 * Formats, sizes, merges, frozen panes, tab colours, names, conditional formats, validations and
 * the filter are written as the model holds them. What has no place in a file, or that ExcelJS
 * cannot write (charts), is counted in `warnings` and left out.
 *
 * ExcelJS is lenient about what it writes and Excel is not, so these are the rules Excel refuses
 * a file for, kept here: a sheet name of 31 characters at most without `\ / ? * [ ] :`, unique to
 * the letter case; a conditional format only of the kinds ExcelJS writes validly, with everything
 * else said as the formula it is (which every Excel reads); a literal list of 255 characters.
 */

import type ExcelJS from 'exceljs';
import { CellError, type Scalar, cellAddress, colToLetters, formatValue, parseStored } from '../../sheets/engine';
import { printA1, quoteSheetName } from '../../sheets/engine/parser';
import type { CellStyle } from '../../sheets/grid/types';
import { type CfRule, FILTER_RANGE, FeatureView, type ValidationRule } from '../../sheets/model/features';
import { DEFAULT_COL_WIDTH, DEFAULT_ROW_HEIGHT, type IdRect, field, namesOf, part, resolveRect } from '../../sheets/model/structure';
import { Warnings, plural, type Warning } from '../types';
import { type Book, type BookFile, type BookSheet, openBook } from './book';
import { cssToArgb } from './css';
import { loadExcel } from './exceljs';
import { toFile } from './formula';

export interface XlsxWriteOptions {
  title: string;
  /** Unix milliseconds: the date the file says it was made. */
  now?: number;
}

export interface WrittenXlsx {
  bytes: Uint8Array;
  warnings: Warning[];
}

const PX_PER_CHAR = 7;
const POINTS_PER_PX = 0.75;
const FALLBACK_FONT = 'Calibri';
const FALLBACK_SIZE = 11;
/** A hidden or formatted row with nothing in it is written only if it has a height, so it gets the sheet's own. */
const DEFAULT_ROW_POINTS = DEFAULT_ROW_HEIGHT * POINTS_PER_PX;

const OPERATORS = { gt: 'greaterThan', ge: 'greaterThanOrEqual', lt: 'lessThan', le: 'lessThanOrEqual', eq: 'equal', ne: 'notEqual', between: 'between', notBetween: 'notBetween' } as const;
const BORDER_LINES = new Set(['thin', 'medium', 'thick', 'dashed', 'dotted', 'double']);

/** A name Excel accepts, unlike any in `taken` (lower case). */
export function sheetNameFor(name: string, taken: ReadonlySet<string>): string {
  const base = (name.replace(/[\\/?*[\]:]/g, '_').replace(/^'+|'+$/g, '').trim() || 'Sheet').slice(0, 31);
  if (!taken.has(base.toLowerCase())) return base;
  for (let i = 2; ; i++) {
    const suffix = ` (${i})`;
    const candidate = base.slice(0, 31 - suffix.length) + suffix;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

/** A format as ExcelJS wants it. A font is always whole: one without a name or a size is drawn in whatever the reader likes. */
function excelStyle(st: CellStyle): Partial<ExcelJS.Style> {
  const font: Record<string, unknown> = { name: st.font ?? FALLBACK_FONT, size: st.size ?? FALLBACK_SIZE };
  if (st.bold) font.bold = true;
  if (st.italic) font.italic = true;
  if (st.underline) font.underline = true;
  if (st.strike) font.strike = true;
  const color = st.color && cssToArgb(st.color);
  if (color) font.color = { argb: color };
  const out: Record<string, unknown> = { font };
  const fill = st.fill && cssToArgb(st.fill);
  if (fill) out.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill }, bgColor: { indexed: 64 } };
  if (st.numFmt) out.numFmt = st.numFmt;
  // The grid draws an unset vertical alignment in the middle; a file's own default is the bottom.
  const alignment: Record<string, unknown> = { vertical: st.v ?? 'middle' };
  if (st.h && st.h !== 'general') alignment.horizontal = st.h;
  if (st.wrap) alignment.wrapText = true;
  if (st.indent) alignment.indent = st.indent;
  out.alignment = alignment;
  const border: Record<string, unknown> = {};
  for (const [key, side] of [['borderTop', 'top'], ['borderRight', 'right'], ['borderBottom', 'bottom'], ['borderLeft', 'left']] as const) {
    const b = st[key];
    if (!b) continue;
    const argb = b.color && cssToArgb(b.color);
    border[side] = { style: BORDER_LINES.has(b.line) ? b.line : 'thin', ...(argb ? { color: { argb } } : {}) };
  }
  if (Object.keys(border).length) out.border = border;
  return out as Partial<ExcelJS.Style>;
}

/** A conditional format's differential format: what the rule changes, and nothing else. */
function differential(rule: CfRule): Record<string, unknown> {
  const s = rule.style;
  const out: Record<string, unknown> = {};
  const font: Record<string, unknown> = {};
  if (s.bold) font.bold = true;
  if (s.italic) font.italic = true;
  if (s.strike) font.strike = true;
  const color = s.color && cssToArgb(s.color);
  if (color) font.color = { argb: color };
  if (Object.keys(font).length) out.font = font;
  const fill = s.fill && cssToArgb(s.fill);
  // A differential fill keeps its colour in `bgColor`.
  if (fill) out.fill = { type: 'pattern', pattern: 'solid', bgColor: { argb: fill } };
  return out;
}

/** What a formula's cached result is in a file. An empty reference is shown by Excel as 0. */
function cachedResult(v: Scalar): number | string | boolean | { error: string } {
  if (v === null) return 0;
  return v instanceof CellError ? { error: v.code } : v;
}

const rangeA1 = (r: { r1: number; c1: number; r2: number; c2: number }): string =>
  r.r1 === r.r2 && r.c1 === r.c2 ? cellAddress(r.r1, r.c1) : `${cellAddress(r.r1, r.c1)}:${cellAddress(r.r2, r.c2)}`;

interface SheetOut {
  s: BookSheet;
  ws: ExcelJS.Worksheet;
  /** The name the file gives it. */
  name: string;
}

class Writer {
  readonly warnings = new Warnings();
  private readonly styles = new Map<object, Partial<ExcelJS.Style>>();

  constructor(
    private readonly book: Book,
    private readonly outs: Map<string, SheetOut>
  ) {}

  private style(st: CellStyle): Partial<ExcelJS.Style> {
    let hit = this.styles.get(st);
    if (!hit) this.styles.set(st, (hit = excelStyle(st)));
    return hit;
  }

  /** A stored formula (`=` and ids) as the text a file holds, printed at today's positions. */
  a1(hostSheet: string, stored: string): string {
    const sheet = this.book.engine.sheet(hostSheet)!;
    return toFile(printA1(parseStored(stored), this.book.engine.locator(sheet)));
  }

  /** `'Sheet 2'!$A$1:$B$4`, or null when a corner's line is gone. */
  private absolute(sheetId: string, rect: IdRect): string | null {
    const sheet = this.book.engine.sheet(sheetId);
    const r = sheet && resolveRect(sheet, rect);
    const out = this.outs.get(sheetId);
    if (!r || !out) return null;
    const a = `$${colToLetters(r.c1)}$${r.r1 + 1}`;
    const b = `$${colToLetters(r.c2)}$${r.r2 + 1}`;
    return `${quoteSheetName(out.name)}!${a}${a === b ? '' : `:${b}`}`;
  }

  sheet({ s, ws }: SheetOut): void {
    const engine = this.book.engine;
    const sheet = engine.sheet(s.id)!;
    const colStyleIds = part(s.map, 'colStyles');
    const rowStyleIds = part(s.map, 'rowStyles');
    const colIndex = sheet.colIndex();
    const rowIndex = sheet.rowIndex();

    // Sizes. The model's default line is larger than a file's, so the file says so.
    ws.properties.defaultColWidth = DEFAULT_COL_WIDTH / PX_PER_CHAR;
    ws.properties.defaultRowHeight = DEFAULT_ROW_POINTS;
    for (const [id, px] of part(s.map, 'widths')) {
      const i = colIndex.get(id);
      // ExcelJS takes a width of exactly 9 for "no width" and does not write it, which would give the column the sheet's wider default.
      if (i !== undefined && px > 0) ws.getColumn(i + 1).width = px === 63 ? 9 + 1e-6 : px / PX_PER_CHAR;
    }
    // A column that is written without a width is written with ExcelJS's 9, which is narrower than the sheet's own.
    const column = (i: number): ExcelJS.Column => {
      const c = ws.getColumn(i + 1);
      c.width ??= DEFAULT_COL_WIDTH / PX_PER_CHAR;
      return c;
    };
    for (const id of part(s.map, 'hiddenCols').keys()) {
      const i = colIndex.get(id);
      if (i !== undefined) column(i).hidden = true;
    }
    for (const [id, styleId] of colStyleIds) {
      const i = colIndex.get(id);
      const st = this.book.styles.effective(styleId, undefined, undefined);
      if (i !== undefined && Object.keys(st).length) column(i).style = this.style(st);
    }
    const row = (id: string): ExcelJS.Row | null => {
      const i = rowIndex.get(id);
      return i === undefined ? null : ws.getRow(i + 1);
    };
    for (const [id, px] of part(s.map, 'heights')) {
      const r = row(id);
      if (r && px > 0) r.height = px * POINTS_PER_PX;
    }
    const hide = (r: ExcelJS.Row | null) => {
      if (!r) return;
      r.hidden = true;
      r.height ||= DEFAULT_ROW_POINTS;
    };
    for (const id of part(s.map, 'hiddenRows').keys()) hide(row(id));
    for (const i of this.hiddenByFilter(s)) hide(ws.getRow(i + 1));
    for (const [id, styleId] of rowStyleIds) {
      const r = row(id);
      const st = this.book.styles.effective(undefined, styleId, undefined);
      if (r && Object.keys(st).length) {
        (r as unknown as { style: object }).style = this.style(st);
        r.height ||= DEFAULT_ROW_POINTS;
      }
    }

    for (const cell of this.book.cells.get(s.id) ?? []) {
      const { content } = cell;
      const x = ws.getCell(cell.r + 1, cell.c + 1);
      if (content.f !== undefined) {
        const text = engine.displayFormula(s.id, cell.row, cell.col);
        const result = cachedResult(engine.getValue(s.id, cell.row, cell.col));
        if (text) x.value = { formula: toFile(text), result } as ExcelJS.CellFormulaValue;
        else x.value = result as ExcelJS.CellValue;
      } else if (content.e !== undefined) x.value = { error: content.e } as ExcelJS.CellErrorValue;
      else if (content.v !== undefined) x.value = content.v;
      x.style = this.style(this.book.styles.effective(colStyleIds.get(cell.col), rowStyleIds.get(cell.row), content.s));
    }

    const frozenRows = Number(field(s.map, 'frozenRows') ?? 0);
    const frozenCols = Number(field(s.map, 'frozenCols') ?? 0);
    if (frozenRows > 0 || frozenCols > 0) {
      ws.views = [{ state: 'frozen', xSplit: frozenCols, ySplit: frozenRows, topLeftCell: cellAddress(frozenRows, frozenCols), activeCell: 'A1' } as ExcelJS.WorksheetView];
    }
    for (const rect of part(s.map, 'merges').values()) {
      const r = resolveRect(sheet, rect);
      if (!r || (r.r1 === r.r2 && r.c1 === r.c2)) continue;
      try {
        // Without the master's format on the others: a merged area's outline is drawn by its own cells' borders.
        ws.mergeCellsWithoutStyle(r.r1 + 1, r.c1 + 1, r.r2 + 1, r.c2 + 1);
      } catch {
        // Two merges that overlap, which Excel does not allow either: the first stays.
      }
    }
    const filter = field(s.map, 'filter')?.get(FILTER_RANGE) as IdRect | undefined;
    const fr = filter && resolveRect(sheet, filter);
    if (fr) ws.autoFilter = rangeA1(fr);

    this.conditionalFormats(s, ws);
    this.validations(s, ws);

    const charts = part(s.map, 'charts').size;
    if (charts) this.warnings.add('charts', (n) => `${plural(n, 'chart')} ${n === 1 ? 'was' : 'were'} left out.`, charts);
  }

  /** The rows the filter hides now, by index: what the grid hides, so the file shows what was on the screen. */
  private hiddenByFilter(s: BookSheet): Set<number> {
    const filter = field(s.map, 'filter');
    if (!filter || filter.size < 2) return new Set();
    const engine = this.book.engine;
    const colStyleIds = part(s.map, 'colStyles');
    const rowStyleIds = part(s.map, 'rowStyles');
    const own = new Map<string, string | undefined>();
    for (const c of this.book.cells.get(s.id) ?? []) own.set(`${c.row}\0${c.col}`, c.content.s);
    const shown = (rowId: string, colId: string): string => {
      const st = this.book.styles.effective(colStyleIds.get(colId), rowStyleIds.get(rowId), own.get(`${rowId}\0${colId}`));
      return formatValue(engine.getValue(s.id, rowId, colId), st.numFmt).text;
    };
    return new FeatureView(engine, s.id, s.map, shown).filter()?.hidden ?? new Set();
  }

  private conditionalFormats(s: BookSheet, ws: ExcelJS.Worksheet): void {
    const sheet = this.book.engine.sheet(s.id)!;
    const rules = [...part(s.map, 'cf').values()] as CfRule[];
    rules.sort((a, b) => a.priority - b.priority);
    const q = (t: string) => `"${t.replace(/"/g, '""')}"`;
    const literal = (x: number | string) => (typeof x === 'number' ? String(x) : q(x));
    let priority = 0;
    for (const rule of rules) {
      const rects = rule.ranges.map((r) => resolveRect(sheet, r)).filter((r) => r !== null);
      const top = rects[0];
      if (!top) continue;
      const tl = cellAddress(top.r1, top.c1);
      const block = `$${colToLetters(top.c1)}$${top.r1 + 1}:$${colToLetters(top.c2)}$${top.r2 + 1}`;
      const style = differential(rule);
      const w = rule.when;
      const expression = (f: string) => ({ type: 'expression', formulae: [f], style });
      let built: Record<string, unknown>;
      switch (w.kind) {
        case 'cell':
          built = { type: 'cellIs', operator: OPERATORS[w.op], formulae: w.b === undefined ? [literal(w.a)] : [literal(w.a), literal(w.b)], style };
          break;
        case 'text': {
          const t = q(w.text);
          built = expression({ contains: `NOT(ISERROR(SEARCH(${t},${tl})))`, notContains: `ISERROR(SEARCH(${t},${tl}))`, begins: `LEFT(${tl},LEN(${t}))=${t}`, ends: `RIGHT(${tl},LEN(${t}))=${t}` }[w.op]);
          break;
        }
        case 'blank':
          built = expression(`LEN(TRIM(${tl}))=0`);
          break;
        case 'notBlank':
          built = expression(`LEN(TRIM(${tl}))>0`);
          break;
        case 'error':
          built = expression(`ISERROR(${tl})`);
          break;
        case 'notError':
          built = expression(`NOT(ISERROR(${tl}))`);
          break;
        case 'formula':
          built = expression(this.a1(s.id, w.f));
          break;
        case 'duplicate':
          built = expression(`COUNTIF(${block},${tl})>1`);
          break;
        case 'unique':
          built = expression(`COUNTIF(${block},${tl})=1`);
          break;
        case 'top':
          built = { type: 'top10', rank: w.n, percent: !!w.percent, bottom: !!w.bottom, style };
          break;
        case 'average':
          built = { type: 'aboveAverage', aboveAverage: !w.below, style };
          break;
        case 'bar':
          // The negative colour has no place in what ExcelJS writes: Excel draws negatives in its own red.
          built = { type: 'dataBar', cfvo: [{ type: 'min' }, { type: 'max' }], color: { argb: cssToArgb(w.color) ?? 'FF638EC6' } };
          break;
        case 'scale':
          built = {
            type: 'colorScale',
            cfvo: w.mid ? [{ type: 'min' }, { type: 'percentile', value: 50 }, { type: 'max' }] : [{ type: 'min' }, { type: 'max' }],
            color: [w.min, ...(w.mid ? [w.mid] : []), w.max].map((c) => ({ argb: cssToArgb(c) ?? 'FFFFFFFF' }))
          };
          break;
      }
      ws.addConditionalFormatting({ ref: rects.map(rangeA1).join(' '), rules: [{ ...built, priority: ++priority }] as unknown as ExcelJS.ConditionalFormattingRule[] });
    }
  }

  private validations(s: BookSheet, ws: ExcelJS.Worksheet): void {
    const sheet = this.book.engine.sheet(s.id)!;
    for (const rule of part(s.map, 'validation').values() as Iterable<ValidationRule>) {
      const rects = rule.ranges.map((r) => resolveRect(sheet, r)).filter((r) => r !== null);
      if (!rects.length) continue;
      const c = rule.check;
      const model: Record<string, unknown> = {};
      switch (c.kind) {
        case 'list': {
          const joined = c.items.join(',');
          // Excel's literal list is comma separated and 255 characters long, and has no way to quote a comma.
          if (c.items.some((i) => i.includes(',')) || joined.length > 255) {
            this.warnings.add('list', (n) => `${plural(n, 'list validation')} that an .xlsx file cannot hold ${n === 1 ? 'was' : 'were'} left out.`);
            continue;
          }
          model.type = 'list';
          model.formulae = [`"${joined.replace(/"/g, '""')}"`];
          break;
        }
        case 'listRange': {
          const text = this.absolute(c.sheet, c.range);
          if (!text) continue;
          model.type = 'list';
          model.formulae = [text];
          break;
        }
        case 'formula':
          model.type = 'custom';
          model.formulae = [this.a1(s.id, c.f)];
          break;
        default: {
          model.type = { number: 'decimal', integer: 'whole', date: 'date', textLength: 'textLength' }[c.kind];
          model.operator = OPERATORS[c.op];
          // ExcelJS writes a date's formula through a Date; the serial is the same number either way.
          const as = (n: number): number | Date => (c.kind === 'date' ? new Date((n - 25569) * 86_400_000) : n);
          model.formulae = c.b === undefined ? [as(c.a)] : [as(c.a), as(c.b)];
        }
      }
      model.allowBlank = rule.allowBlank !== false;
      model.showErrorMessage = true;
      model.errorStyle = rule.strict ? 'stop' : 'warning';
      if (rule.message) model.error = rule.message.slice(0, 255);
      const table = (ws as unknown as { dataValidations: { model: Record<string, unknown> } }).dataValidations.model;
      for (const r of rects) table[rangeA1(r)] = model;
    }
  }

  /** The names, in the file's own words. ExcelJS writes only names that are ranges, so they are handed over ready-made. */
  names(wb: ExcelJS.Workbook, order: readonly string[]): void {
    const list: { name: string; ranges: string[]; localSheetId?: number }[] = [];
    for (const n of namesOf(this.book.doc).values()) {
      const host = n.scope ?? order[0];
      if (!host || !this.book.engine.sheet(host)) continue;
      const ranges = [this.a1(host, n.f)];
      const index = n.scope === undefined ? -1 : order.indexOf(n.scope);
      if (n.scope !== undefined && index < 0) continue;
      list.push(index < 0 ? { name: n.name, ranges } : { name: n.name, ranges, localSheetId: index });
    }
    Object.defineProperty(wb.definedNames, 'model', { get: () => list, configurable: true });
  }
}

export async function writeXlsx(file: BookFile, opts: XlsxWriteOptions): Promise<WrittenXlsx> {
  const book = openBook(file);
  const ExcelJS = await loadExcel();
  const wb = new ExcelJS.Workbook();
  const when = new Date(opts.now ?? Date.now());
  wb.creator = 'Office';
  wb.title = opts.title;
  wb.created = when;
  wb.modified = when;
  wb.calcProperties = { fullCalcOnLoad: true } as ExcelJS.CalculationProperties;

  const outs = new Map<string, SheetOut>();
  const writer = new Writer(book, outs);
  const taken = new Set<string>();
  let renamed = 0;
  for (const s of book.sheets) {
    const name = sheetNameFor(s.name, taken);
    taken.add(name.toLowerCase());
    if (name !== s.name) {
      renamed++;
      // The engine prints a sheet in a reference by its name, and the file must have the same one.
      book.engine.renameSheet(s.id, name);
    }
    const tab = field(s.map, 'tab');
    const argb = typeof tab === 'string' ? cssToArgb(tab) : undefined;
    const ws = wb.addWorksheet(name, { state: field(s.map, 'hidden') ? 'hidden' : 'visible', ...(argb ? { properties: { tabColor: { argb } } } : {}) } as ExcelJS.AddWorksheetOptions);
    outs.set(s.id, { s, ws, name });
  }
  if (renamed) writer.warnings.add('sheet-names', (n) => `${plural(n, 'sheet name')} ${n === 1 ? 'was' : 'were'} changed to fit an .xlsx file.`, renamed);
  for (const out of outs.values()) writer.sheet(out);
  writer.names(wb, book.sheets.map((s) => s.id));

  // The workbook opens on a sheet that can be seen.
  const first = book.sheets.findIndex((s) => !field(s.map, 'hidden'));
  wb.views = [{ x: 0, y: 0, width: 28800, height: 17000, firstSheet: 0, activeTab: Math.max(0, first), visibility: 'visible' } as ExcelJS.WorkbookView];

  const buffer = (await wb.xlsx.writeBuffer()) as unknown as ArrayBuffer | Uint8Array;
  return { bytes: buffer instanceof Uint8Array ? new Uint8Array(buffer) : new Uint8Array(buffer), warnings: writer.warnings.list() };
}
