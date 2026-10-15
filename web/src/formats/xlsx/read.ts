/**
 * An xlsx file into a workbook seed.
 *
 *     const { seed, warnings } = await readXlsx(bytes);
 *     await documents.create({ kind: 'sheets', title, ...sheetSeedRequest(seed) });
 *
 * The order of work is the order of trust. `openXlsx` decides whether the file may be read at
 * all and hands ExcelJS only what is left of it; ExcelJS reads cells, formats, columns, rows and
 * conditional formats; everything stated as a range (merges, validations, names, the filter) comes
 * from `package.ts` and `sheetxml.ts`. The model's seed builder then binds every formula to
 * row and column ids, which is where a formula the engine cannot read is found and keeps the
 * last value the file gave it.
 *
 * Positions are kept as the file has them. A sheet is as large as the file's data needs, and
 * never smaller than a new sheet; whatever a file says about cells beyond that is dropped.
 */

import type ExcelJS from 'exceljs';
import { CELL_LIMITS } from '@shared/cells';
import type { DateOrder } from '../../sheets/engine';
import { DEFAULT_COL_WIDTH, DEFAULT_ROW_HEIGHT, NEW_SHEET_COLS, NEW_SHEET_ROWS } from '../../sheets/model/structure';
import { type SeedCell, type SeedSheetBuilder, type SheetSeed, SheetSeedTooLarge, buildSheetSeed } from '../../sheets/model/seed';
import type { StoredStyle } from '../../sheets/model/styles';
import { FormatError } from '../errors';
import { Warnings, plural, type Warning } from '../types';
import { loadExcel } from './exceljs';
import { farthestRow, fromFile, unknownFunction } from './formula';
import { MAX_LINES, MAX_MERGES, MAX_RULES } from './limits';
import { type OpenedXlsx, openXlsx } from './package';
import { parseRange, clamp } from './refs';
import { mapConditionalFormats, mapValidation } from './rules';
import { type StyleContext, mapStyle } from './style';
import { resolveColor } from './colors';

/** What every reader of a spreadsheet file answers. */
export interface SheetImport {
  seed: SheetSeed;
  /** What the file calls itself, if it says. */
  title: string | null;
  warnings: Warning[];
}

export interface XlsxOptions {
  /** How a short date reads where the file does not say: day first unless told. */
  dateOrder?: DateOrder;
}

/** ExcelJS's `ValueType`, which is a plain enum of numbers. */
const T = { Null: 0, Merge: 1, Number: 2, String: 3, Date: 4, Hyperlink: 5, Formula: 6, SharedString: 7, RichText: 8, Boolean: 9, Error: 10 } as const;

/** Excel's pixel width of a column is its width in characters of the digit 0, times 7, which is what a file's Normal font almost always gives. */
const PX_PER_CHAR = 7;
/** 96 dpi: a point is 4/3 of a pixel. */
const PX_PER_POINT = 4 / 3;
const DEFAULT_ROW_POINTS = 15;

const DAY_MS = 86_400_000;
/** The serial of 1970-01-01, which `Date` counts from. */
const EPOCH_SERIAL = 25_569;

/** Excel's own limits, in pixels: a row is at most 409.5 points tall and a column 255 characters wide. A file can say any number. */
const MAX_ROW_PX = Math.round(409.5 * PX_PER_POINT);
const MAX_COL_PX = 255 * PX_PER_CHAR;
const within = (px: number, max: number): number | null => (Number.isFinite(px) && px >= 1 ? Math.min(px, max) : null);

const serialOf = (d: Date): number | null => {
  const ms = d.getTime();
  if (!Number.isFinite(ms)) return null;
  // To ten places: a date is read back from milliseconds, and the quotient should not carry the noise.
  return Math.round((ms / DAY_MS + EPOCH_SERIAL) * 1e10) / 1e10;
};

interface Loaded {
  name: string;
  ws: ExcelJS.Worksheet;
  builder: SeedSheetBuilder;
  index: number;
  rows: number;
  cols: number;
}

type CellValue = Pick<SeedCell, 'value' | 'formula' | 'error'>;

class Reader {
  private readonly styles = new Map<object, StoredStyle>();
  private readonly unknown = new Set<string>();
  private cells = 0;
  private arrays = 0;
  private far = 0;
  private gradients = false;
  private readonly ctx: StyleContext;
  readonly warnings: Warnings;

  get limit(): number {
    return this.farRow;
  }

  constructor(
    private readonly o: OpenedXlsx,
    dateOrder: DateOrder,
    /** A reference past this row asks the sheet to grow to it, and a formula that does is not worth that. */
    private readonly farRow: number
  ) {
    this.warnings = o.warnings;
    this.ctx = {
      theme: o.book.theme,
      defaultFont: o.book.defaultFont,
      dateOrder,
      lost: () => {
        this.gradients = true;
      }
    };
  }

  private style(s: object | null | undefined): StoredStyle {
    if (!s) return {};
    let hit = this.styles.get(s);
    if (!hit) this.styles.set(s, (hit = mapStyle(s as Partial<ExcelJS.Style>, this.ctx)));
    return hit;
  }

  /**
   * A cell's format as the model keeps it: what the cell says beyond its column and its row. A cell in a file has the
   * format of its own entry, whole; where that is the column's or the row's, it says nothing, and where it lacks a
   * field they set it asks for the default (`null`), or the column's would show through. A cell with nothing of its own
   * and nothing in it is not a cell.
   */
  private layered(own: StoredStyle, col: StoredStyle | undefined, row: StoredStyle | undefined, hasContent: boolean): StoredStyle | null {
    const under: Record<string, unknown> = { ...(col ?? {}), ...(row ?? {}) };
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(own)) if (JSON.stringify(under[k]) !== JSON.stringify(v)) out[k] = v;
    for (const k of Object.keys(under)) if (!(k in own) && (hasContent || Object.keys(own).length > 0)) out[k] = null;
    return Object.keys(out).length ? (out as StoredStyle) : null;
  }

  /** What a cell holds, as a seed cell's content; null for nothing. */
  private content(cell: ExcelJS.Cell): CellValue | null {
    const v = cell.value as unknown;
    switch (cell.type as number) {
      case T.Number:
      case T.String:
      case T.SharedString:
      case T.Boolean:
        return { value: v as number | string | boolean };
      case T.Date: {
        const n = serialOf(v as Date);
        return n === null ? null : { value: n };
      }
      case T.RichText:
        return { value: (v as { richText: { text: string }[] }).richText.map((t) => t.text).join('') };
      case T.Hyperlink: {
        const text = (v as { text?: unknown }).text;
        return typeof text === 'string' ? { value: text } : text && typeof text === 'object' && 'richText' in text ? { value: (text as { richText: { text: string }[] }).richText.map((t) => t.text).join('') } : null;
      }
      case T.Error:
        return { error: (v as { error: string }).error };
      case T.Formula:
        return this.formula(cell, v as { shareType?: string; ref?: string });
      default:
        return null;
    }
  }

  private formula(cell: ExcelJS.Cell, fv: { shareType?: string; ref?: string }): CellValue | null {
    // `cell.value` leaves out a result of 0, false or "", which are results; the cell's own accessor does not.
    const cached = this.cached((cell as unknown as { result?: unknown }).result);
    // An array formula over several cells is a block the engine cannot spill: its cells keep what they showed.
    if (fv.shareType === 'array' && fv.ref?.includes(':')) {
      this.arrays++;
      return cached;
    }
    const raw = (cell as unknown as { formula?: string }).formula;
    if (!raw) return cached;
    const formula = fromFile(raw);
    if (farthestRow(formula) > this.farRow) {
      this.far++;
      return cached;
    }
    const missing = unknownFunction(formula);
    // A last value of #NAME? is the program that saved the file saying it did not know the function either.
    if (missing && cached && cached.error !== '#NAME?') {
      this.unknown.add(missing);
      return cached;
    }
    return { formula, ...(cached ?? {}) };
  }

  private cached(result: unknown): CellValue | null {
    if (result === undefined || result === null) return null;
    if (typeof result === 'number' || typeof result === 'string' || typeof result === 'boolean') return { value: result };
    if (result instanceof Date) {
      const n = serialOf(result);
      return n === null ? null : { value: n };
    }
    const e = (result as { error?: unknown }).error;
    return typeof e === 'string' ? { error: e } : null;
  }

  /** One worksheet's cells, formats and layout. What is a range on the sheet (rules, merges, the filter) waits in `readXlsx` until every sheet has its size. */
  sheet(b: SeedSheetBuilder, ws: ExcelJS.Worksheet, state: string): void {
    if (state !== 'visible') b.hide();

    const colStyles = new Map<number, StoredStyle>();
    const rowStyles = new Map<number, StoredStyle>();
    for (const col of ws.columns ?? []) {
      if (!col?.number) continue;
      const i = col.number - 1;
      if (i < 0) continue;
      const st = this.style(col.style);
      if (Object.keys(st).length) colStyles.set(i, st);
    }

    let usedRows = 0;
    let usedCols = 0;
    const defaultPoints = (ws.properties as { defaultRowHeight?: number } | undefined)?.defaultRowHeight ?? DEFAULT_ROW_POINTS;
    // What a file says about a line is held until the sheet has its size: a row 900,000 with a height, or a column
    // definition that runs to the 16,384th, must not make the sheet that big.
    const hiddenRows: number[] = [];
    const heights: [number, number][] = [];
    // The rows and cells the file has, and no others: `eachRow` and `eachCell` with `includeEmpty` make the ones between,
    // and a cell made that way wears its row's and column's format as if the file had said so.
    const rows = (ws as unknown as { _rows: (ExcelJS.Row | undefined)[] })._rows;
    rows.forEach((row) => {
      if (!row) return;
      const r = row.number - 1;
      const rs = this.style((row as unknown as { style?: object }).style);
      if (Object.keys(rs).length) rowStyles.set(r, rs);
      const own = row as unknown as { height?: number; hidden?: boolean };
      if (own.hidden) hiddenRows.push(r);
      else if (own.height && Math.abs(own.height - defaultPoints) > 0.5 && Math.round(own.height * PX_PER_POINT) !== DEFAULT_ROW_HEIGHT) {
        const px = within(own.height * PX_PER_POINT, MAX_ROW_PX);
        if (px !== null) heights.push([r, px]);
      }
      for (const cell of (row as unknown as { _cells: (ExcelJS.Cell | undefined)[] })._cells) {
        if (!cell) continue;
        const c = Number(cell.col) - 1;
        const content = this.content(cell);
        const style = this.layered(this.style(cell.style), colStyles.get(c), rowStyles.get(r), content !== null);
        if (!content && !style) continue;
        if (++this.cells > CELL_LIMITS.cellsPerDocument) throw new FormatError('sheet_too_large', `${this.cells} cells`);
        const seed: SeedCell = { ...(content ?? {}) };
        if (style) seed.style = style;
        b.cell(r, c, seed);
        if (r + 1 > usedRows) usedRows = r + 1;
        if (c + 1 > usedCols) usedCols = c + 1;
      }
    });

    // The sheet is as big as its data, never smaller than a new one, and a little more where it is already full.
    b.rows = Math.max(b.rows, usedRows >= NEW_SHEET_ROWS ? usedRows + 100 : NEW_SHEET_ROWS);
    b.cols = Math.max(b.cols, usedCols >= NEW_SHEET_COLS ? usedCols + 2 : NEW_SHEET_COLS);

    for (const [c, st] of colStyles) if (c < b.cols) b.colStyle(c, st);
    for (const [r, st] of rowStyles) if (r < b.rows) b.rowStyle(r, st);
    for (const r of hiddenRows) if (r < b.rows) b.hideRow(r);
    for (const [r, px] of heights) if (r < b.rows) b.rowHeight(r, px);
    for (const col of ws.columns ?? []) {
      if (!col?.number) continue;
      const i = col.number - 1;
      if (i >= b.cols) continue;
      if (col.hidden) b.hideCol(i);
      else if (col.width && Math.round(col.width * PX_PER_CHAR) !== DEFAULT_COL_WIDTH) {
        const px = within(col.width * PX_PER_CHAR, MAX_COL_PX);
        if (px !== null) b.colWidth(i, px);
      }
    }

    const view = ws.views?.[0] as { state?: string; xSplit?: number; ySplit?: number } | undefined;
    if (view?.state === 'frozen') b.freeze(Math.max(0, Math.floor(view.ySplit ?? 0)), Math.max(0, Math.floor(view.xSplit ?? 0)));
    const tab = resolveColor((ws.properties as { tabColor?: Parameters<typeof resolveColor>[0] } | undefined)?.tabColor, this.o.book.theme);
    if (tab) b.tab(tab);
  }

  finish(): void {
    if (this.gradients) this.warnings.add('gradient', () => 'Gradient fills were left out.');
    if (this.far) this.warnings.add('far', (n) => `${plural(n, 'formula')} that reach far past the data ${n === 1 ? 'was' : 'were'} kept as ${n === 1 ? 'a value' : 'values'}.`, this.far);
    if (this.arrays) this.warnings.add('arrays', (n) => `${plural(n, 'array formula')} ${n === 1 ? 'was' : 'were'} kept as values.`, this.arrays);
    if (this.unknown.size) {
      const names = [...this.unknown].slice(0, 4).join(', ');
      this.warnings.add('functions', () => `Formulas that use ${names}${this.unknown.size > 4 ? ' and others' : ''} were kept as values.`);
    }
  }
}

export async function readXlsx(bytes: Uint8Array, opts: XlsxOptions = {}): Promise<SheetImport> {
  const opened = openXlsx(bytes);
  const ExcelJS = await loadExcel();
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(opened.excelBytes as unknown as Parameters<typeof wb.xlsx.load>[0]);
  } catch (e) {
    throw new FormatError('xml_invalid', String(e));
  }

  const deepest = wb.worksheets.reduce((m, ws) => Math.max(m, ws.rowCount), 0);
  const reader = new Reader(opened, opts.dateOrder ?? 'dmy', Math.max(150_000, deepest + 10_000));
  const { warnings } = reader;
  let seed: SheetSeed;
  try {
    seed = buildSheetSeed((b) => {
      const loaded: Loaded[] = [];
      let lines = 0;
      opened.book.sheets.forEach((s, index) => {
        const ws = s.part ? wb.getWorksheet(s.name) : undefined;
        if (!ws) return;
        const builder = b.addSheet(s.name);
        reader.sheet(builder, ws, s.state);
        lines += builder.rows + builder.cols;
        if (lines > MAX_LINES) throw new FormatError('sheet_too_large', `${lines} rows and columns`);
        loaded.push({ name: s.name, ws, builder, index, rows: builder.rows, cols: builder.cols });
      });
      if (loaded.length === 0) throw new FormatError('empty');

      // Everything that is a range on a sheet waits until every sheet has its size.
      const bySheet = new Map(loaded.map((l) => [l.name, { builder: l.builder, rows: l.rows, cols: l.cols }]));
      const ruleContext = { theme: opened.book.theme, warnings };
      const names = new Map<string, string>();
      for (const n of opened.book.names) if (n.scope === null) names.set(n.name.toUpperCase(), fromFile(n.text));
      let links = 0;
      for (const l of loaded) {
        const facts = opened.sheets.get(l.name);
        links += facts?.hyperlinks ?? 0;
        mapConditionalFormats(l.ws, ruleContext, l.rows, l.cols, (rule) => l.builder.cf(rule), MAX_RULES);
        if (facts) {
          let merged = 0;
          for (const ref of facts.merges) {
            const rect = parseRange(ref);
            const inside = rect && clamp(rect, l.rows, l.cols);
            if (!inside || (inside.r1 === inside.r2 && inside.c1 === inside.c2)) continue;
            if (++merged > MAX_MERGES) {
              warnings.add('merges', () => `Merged cells past the first ${MAX_MERGES} on a sheet were left out.`);
              break;
            }
            l.builder.merge(inside);
          }
          let kept = 0;
          for (const raw of facts.validations) {
            const v = mapValidation(raw, l.name, l.rows, l.cols, { warnings, sheets: bySheet, names });
            if (!v) continue;
            if (++kept > MAX_RULES) {
              warnings.add('validation-cap', () => `Data validations past the first ${MAX_RULES} on a sheet were left out.`);
              break;
            }
            l.builder.validation(v);
          }
          if (facts.autoFilter) {
            const rect = parseRange(facts.autoFilter.ref);
            const inside = rect && clamp(rect, l.rows, l.cols);
            if (inside) l.builder.filter(inside);
            if (facts.autoFilter.criteria) warnings.add('filter', () => 'A filter\'s criteria were left out. The rows it hides stay hidden.');
          }
          if (facts.tables) warnings.add('tables', (n) => `${plural(n, 'table')} ${n === 1 ? 'was' : 'were'} kept as plain cells.`, facts.tables);
          if (facts.sparklines) warnings.add('sparklines', (n) => `${plural(n, 'sparkline group')} ${n === 1 ? 'was' : 'were'} left out.`, facts.sparklines);
          // Data bars and icon sets are stored twice, and ExcelJS has already read the one it sees; a rule that is only in the extension is not read.
          if (facts.extRules && !warnings.list().some((w) => w.code === 'cf-icons')) warnings.add('cf-ext', (n) => `${plural(n, 'conditional format')} could not be read and ${n === 1 ? 'was' : 'were'} left out.`, facts.extRules);
        }
      }
      if (links) warnings.add('links', (n) => `Links in ${plural(n, 'cell')} were left out.`, links);
      if (opened.book.date1904) warnings.add('date1904', () => 'Dates were converted from the 1904 date system.');

      for (const n of opened.book.names) {
        const scope = n.scope === null ? undefined : loaded.find((l) => l.index === n.scope)?.builder;
        if (n.scope !== null && !scope) continue;
        const text = fromFile(n.text);
        // A name that reaches past the data would have a sheet grow to it; one that long is not a name.
        if (text.length > CELL_LIMITS.formulaChars || farthestRow(text) > reader.limit) {
          warnings.add('names', (c) => `${plural(c, 'name')} could not be read and ${c === 1 ? 'was' : 'were'} left out.`);
          continue;
        }
        b.name(n.name, text, scope);
      }
    });
  } catch (e) {
    if (e instanceof SheetSeedTooLarge) throw new FormatError('sheet_too_large', `${e.what}: ${e.size} of ${e.limit}`);
    throw e;
  }
  reader.finish();
  if (seed.unread.formulas) warnings.add('unread', (n) => `${plural(n, 'formula')} could not be read and ${n === 1 ? 'kept its' : 'kept their'} last value${n === 1 ? '' : 's'}.`, seed.unread.formulas);
  if (seed.unread.names) warnings.add('names', (n) => `${plural(n, 'name')} could not be read and ${n === 1 ? 'was' : 'were'} left out.`, seed.unread.names);
  if (seed.skipped.rules) warnings.add('rules', (n) => `${plural(n, 'rule')} that use a formula that could not be read ${n === 1 ? 'was' : 'were'} left out.`, seed.skipped.rules);
  return { seed, title: null, warnings: warnings.list() };
}
