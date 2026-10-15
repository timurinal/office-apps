/**
 * A new workbook, made in the page: the blank one a new spreadsheet starts as, and the one an
 * importer (xlsx, csv) builds from a file. Either way the result is what `POST /documents`
 * takes for `kind: 'sheets'`: the structure as a Yjs update (`state`) and the cells as a list
 * (`cells`, shared/cells.ts), applied by the room as one `import:` edit.
 *
 *     const seed = buildSheetSeed((b) => {
 *       const s = b.addSheet('Budget');
 *       s.cell(0, 0, { value: 'Rent' }).cell(0, 1, { value: 950, style: { numFmt: '£#,##0' } });
 *       s.cell(1, 1, { formula: 'SUM(B1:B1)' });
 *     });
 *     await documents.create({ kind: 'sheets', title, ...sheetSeedRequest(seed) });
 *
 * Positions are zero-based. A formula is A1 text as a file holds it, `=` or not, and is bound
 * to the workbook's ids here, after every sheet and name exists, so a reference to a sheet
 * further on reads. One that does not read keeps its cached value, if the file had one, and is
 * counted in `unread`. A sheet grows to hold every cell and every reference made to it.
 *
 * A sheet may also be given conditional formats (`cf`), validations (`validation`) and a filter
 * (`filter`), by position like everything else: their ranges become ids and their formulas bind as
 * a cell's do. A rule whose formula does not read is left out and counted in `skipped.rules`; one
 * with no range on its sheet is left out.
 *
 * Ids are short (structure.ts `seqId`): a 100k-row import spends a byte a character a row.
 */

import * as Y from 'yjs';
import { type CreateDocumentRequest, LIMITS } from '@shared/api';
import { CELL_LIMITS, type CellOp, type StoredCell, cellWeight, encodeCellList, utf8Length } from '@shared/cells';
import { toBase64 } from '../../crypto/primitives';
import { Engine, MAX_COLS, MAX_ROWS, errorFromLiteral } from '../engine';
import type { Rect } from '../grid/types';
import {
  type IdRect,
  NEW_SHEET_COLS,
  NEW_SHEET_ROWS,
  type StoredName,
  createSheet,
  nameKey,
  namesOf,
  newId,
  part,
  seqId
} from './structure';
import { type CfCondition, type CfRule, type CfStyle, FILTER_RANGE, type ValidationCheck, type ValidationRule } from './features';
import { type StoredStyle, cleanStyle, internStyle } from './styles';

/** One cell as a file holds it. */
export interface SeedCell {
  /** A value as it is, never parsed: `'1'` stays text. */
  value?: number | string | boolean;
  /** A formula in A1 text, with or without its `=`. Its `value`, if any, is kept only when it does not read. */
  formula?: string;
  /** An error literal, `#N/A`. */
  error?: string;
  style?: StoredStyle;
}

/** A conditional format's condition as a file writes it: a formula is A1 text, written for the first range's top-left cell. */
export type SeedCondition = Exclude<CfCondition, { kind: 'formula' }> | { kind: 'formula'; formula: string };

export interface SeedCf {
  ranges: Rect[];
  when: SeedCondition;
  style: CfStyle;
  /** Lower first; the order they were added in when absent. */
  priority?: number;
  stop?: boolean;
}

export type SeedCheck =
  | Exclude<ValidationCheck, { kind: 'formula' | 'listRange' }>
  | { kind: 'formula'; formula: string }
  /** The choices are the values in `range` of `sheet`, which may be another sheet of the workbook. */
  | { kind: 'listRange'; sheet: SeedSheetBuilder; range: Rect };

export interface SeedValidation extends Omit<ValidationRule, 'ranges' | 'check'> {
  ranges: Rect[];
  check: SeedCheck;
}

export interface SheetSeed {
  state: Uint8Array;
  cells: CellOp[];
  /** Formulas and names that did not read here; each formula kept its cached value, if it had one. */
  unread: { formulas: number; names: number };
  /** Conditional formats and validations left out because a formula in one did not read, or none of its ranges was on the sheet. */
  skipped: { rules: number };
}

/** A seed past one of the room's caps, which `POST /documents` would refuse. */
export class SheetSeedTooLarge extends Error {
  constructor(
    readonly what: 'structure' | 'cells' | 'bytes',
    readonly size: number,
    readonly limit: number
  ) {
    super('That spreadsheet is too large.');
    this.name = 'SheetSeedTooLarge';
  }
}

export class SeedSheetBuilder {
  /** row → column → cell. */
  readonly cells = new Map<number, Map<number, SeedCell>>();
  readonly heights = new Map<number, number>();
  readonly widths = new Map<number, number>();
  readonly hiddenRows = new Set<number>();
  readonly hiddenCols = new Set<number>();
  readonly rowStyles = new Map<number, StoredStyle>();
  readonly colStyles = new Map<number, StoredStyle>();
  readonly merges: Rect[] = [];
  readonly cfRules: SeedCf[] = [];
  readonly validations: SeedValidation[] = [];
  filterRect: Rect | null = null;
  frozen: [number, number] = [0, 0];
  tabColor: string | null = null;
  isHidden = false;
  rows: number;
  cols: number;

  constructor(
    readonly name: string,
    rows: number,
    cols: number
  ) {
    this.rows = rows;
    this.cols = cols;
  }

  private reach(row: number, col: number): void {
    if (!Number.isInteger(row) || !Number.isInteger(col) || row < 0 || col < 0 || row >= MAX_ROWS || col >= MAX_COLS) {
      throw new RangeError(`No cell at row ${row}, column ${col}`);
    }
    if (row >= this.rows) this.rows = row + 1;
    if (col >= this.cols) this.cols = col + 1;
  }

  cell(row: number, col: number, cell: SeedCell): this {
    this.reach(row, col);
    let r = this.cells.get(row);
    if (!r) this.cells.set(row, (r = new Map()));
    r.set(col, cell);
    return this;
  }

  /** CSS px at 100%; 0 hides. */
  rowHeight(row: number, px: number): this {
    this.reach(row, 0);
    if (px <= 0) this.hiddenRows.add(row);
    else this.heights.set(row, Math.round(px));
    return this;
  }

  colWidth(col: number, px: number): this {
    this.reach(0, col);
    if (px <= 0) this.hiddenCols.add(col);
    else this.widths.set(col, Math.round(px));
    return this;
  }

  hideRow(row: number): this {
    this.reach(row, 0);
    this.hiddenRows.add(row);
    return this;
  }

  hideCol(col: number): this {
    this.reach(0, col);
    this.hiddenCols.add(col);
    return this;
  }

  rowStyle(row: number, style: StoredStyle): this {
    this.reach(row, 0);
    this.rowStyles.set(row, style);
    return this;
  }

  colStyle(col: number, style: StoredStyle): this {
    this.reach(0, col);
    this.colStyles.set(col, style);
    return this;
  }

  freeze(rows: number, cols: number): this {
    this.frozen = [Math.max(0, rows), Math.max(0, cols)];
    return this;
  }

  merge(rect: Rect): this {
    this.reach(rect.r2, rect.c2);
    if (rect.r1 !== rect.r2 || rect.c1 !== rect.c2) this.merges.push(rect);
    return this;
  }

  tab(color: string | null): this {
    this.tabColor = color;
    return this;
  }

  /** A conditional format. Ranges beyond the sheet are dropped when the seed is built. */
  cf(rule: SeedCf): this {
    this.cfRules.push(rule);
    return this;
  }

  validation(rule: SeedValidation): this {
    this.validations.push(rule);
    return this;
  }

  /** The filter's range, header row included. Its criteria are not seeded. */
  filter(rect: Rect): this {
    this.reach(rect.r2, rect.c2);
    this.filterRect = rect;
    return this;
  }

  hide(): this {
    this.isHidden = true;
    return this;
  }
}

export class SheetSeedBuilder {
  readonly sheets: SeedSheetBuilder[] = [];
  readonly names: { name: string; text: string; scope?: SeedSheetBuilder }[] = [];

  /** A sheet of at least `rows` by `cols`, 1,000 by 26 unless asked; it grows to hold what is put in it. */
  addSheet(name: string, size: { rows?: number; cols?: number } = {}): SeedSheetBuilder {
    const s = new SeedSheetBuilder(
      name,
      Math.max(1, Math.min(MAX_ROWS, size.rows ?? NEW_SHEET_ROWS)),
      Math.max(1, Math.min(MAX_COLS, size.cols ?? NEW_SHEET_COLS))
    );
    this.sheets.push(s);
    return s;
  }

  /** A defined name from A1 text (`Sheet1!$A$1:$B$4`, or a constant); a sheet's own when `scope` is given. */
  name(name: string, text: string, scope?: SeedSheetBuilder): this {
    this.names.push(scope ? { name, text, scope } : { name, text });
    return this;
  }
}

/** The blank workbook (Sheet1, 1,000 by 26) without `build`; otherwise what `build` makes. */
export function buildSheetSeed(build?: (b: SheetSeedBuilder) => void): SheetSeed {
  const b = new SheetSeedBuilder();
  build?.(b);
  if (b.sheets.length === 0) b.addSheet('Sheet1');
  // A workbook shows at least one sheet.
  if (b.sheets.every((s) => s.isHidden)) b.sheets[0]!.isHidden = false;

  const engine = new Engine();
  const ids = b.sheets.map(() => newId());
  b.sheets.forEach((s, i) => {
    engine.addSheet(ids[i]!, s.name, range(s.rows), range(s.cols));
  });
  const idOf = (s: SeedSheetBuilder) => ids[b.sheets.indexOf(s)]!;
  const grow = (sheets: readonly { sheetId: string; rows: number; cols: number }[]) => {
    for (const g of sheets) {
      const sh = engine.sheet(g.sheetId);
      if (!sh) continue;
      const rows = sh.rowOrder.length;
      const cols = sh.colOrder.length;
      if (g.rows > rows) engine.insertRows(g.sheetId, rows, range(g.rows, rows));
      if (g.cols > cols) engine.insertCols(g.sheetId, cols, range(g.cols, cols));
    }
  };

  const unread = { formulas: 0, names: 0 };
  const names: StoredName[] = [];
  for (const n of b.names) {
    const scope = n.scope ? idOf(n.scope) : undefined;
    const host = scope ?? ids[0]!;
    const text = n.text.startsWith('=') ? n.text : `=${n.text}`;
    let r = engine.nameFromInput(n.name, scope, text, host);
    if (r.kind === 'grow') {
      grow(r.sheets);
      r = engine.nameFromInput(n.name, scope, text, host);
    }
    if (r.kind !== 'content' || !r.content?.f) {
      unread.names++;
      continue;
    }
    engine.setName(n.name, scope, r.content.f);
    names.push(scope === undefined ? { name: n.name, f: r.content.f } : { name: n.name, scope, f: r.content.f });
  }

  // Contents first, with every formula bound: binding may grow a sheet.
  const contents: { sheet: number; row: number; col: number; content: StoredCell | null; style?: StoredStyle }[] = [];
  b.sheets.forEach((s, i) => {
    const sheetId = ids[i]!;
    for (const [row, cols] of s.cells) {
      for (const [col, cell] of cols) {
        const content = bind(engine, sheetId, cell, grow, unread);
        if (content || cell.style) contents.push(cell.style ? { sheet: i, row, col, content, style: cell.style } : { sheet: i, row, col, content });
      }
    }
  });

  // Rules next, for the same reason: a formula in one may reach past the grid.
  const skipped = { rules: 0 };
  const rules = b.sheets.map((s, i) => bindRules(engine, ids[i]!, s, idOf, grow, skipped));

  const doc = new Y.Doc();
  const cells: CellOp[] = [];
  doc.transact(() => {
    const intern = (st: StoredStyle | undefined): string | undefined => {
      const clean = st ? cleanStyle(st) : {};
      return Object.keys(clean).length ? internStyle(doc, clean) : undefined;
    };
    b.sheets.forEach((s, i) => {
      const sh = engine.sheet(ids[i]!)!;
      const rows = sh.rowOrder;
      const cols = sh.colOrder;
      const m = createSheet(doc, { id: ids[i]!, name: s.name, rows, cols });
      const heights = part(m, 'heights');
      const widths = part(m, 'widths');
      for (const [r, px] of s.heights) heights.set(rows[r]!, px);
      for (const [c, px] of s.widths) widths.set(cols[c]!, px);
      for (const r of s.hiddenRows) part(m, 'hiddenRows').set(rows[r]!, true);
      for (const c of s.hiddenCols) part(m, 'hiddenCols').set(cols[c]!, true);
      for (const [r, st] of s.rowStyles) {
        const id = intern(st);
        if (id) part(m, 'rowStyles').set(rows[r]!, id);
      }
      for (const [c, st] of s.colStyles) {
        const id = intern(st);
        if (id) part(m, 'colStyles').set(cols[c]!, id);
      }
      for (const x of s.merges) {
        part(m, 'merges').set(seqId(part(m, 'merges').size), { r1: rows[x.r1]!, c1: cols[x.c1]!, r2: rows[x.r2]!, c2: cols[x.c2]! });
      }
      m.set('frozenRows', Math.min(s.frozen[0], rows.length - 1));
      m.set('frozenCols', Math.min(s.frozen[1], cols.length - 1));
      if (s.tabColor) m.set('tab', s.tabColor.slice(0, 64));
      if (s.isHidden) m.set('hidden', true);
      writeRules(m, rules[i]!, rows, cols, (sheetId) => engine.sheet(sheetId));
    });
    const table = namesOf(doc);
    for (const n of names) table.set(nameKey(n.name, n.scope), n);
    for (const c of contents) {
      const sh = engine.sheet(ids[c.sheet]!)!;
      const s = intern(c.style);
      const content: StoredCell = { ...(c.content ?? {}) };
      if (s !== undefined) content.s = s;
      if (Object.keys(content).length) cells.push({ sheet: sh.id, row: sh.rowOrder[c.row]!, col: sh.colOrder[c.col]!, content });
    }
  });
  const state = Y.encodeStateAsUpdate(doc);
  doc.destroy();
  if (state.length > LIMITS.docStateMaxBytes) throw new SheetSeedTooLarge('structure', state.length, LIMITS.docStateMaxBytes);
  if (cells.length > CELL_LIMITS.cellsPerDocument) throw new SheetSeedTooLarge('cells', cells.length, CELL_LIMITS.cellsPerDocument);
  let bytes = 0;
  for (const c of cells) bytes += cellWeight(c.sheet, c.row, c.col, utf8Length(JSON.stringify(c.content)));
  if (bytes > CELL_LIMITS.bytesPerDocument) throw new SheetSeedTooLarge('bytes', bytes, CELL_LIMITS.bytesPerDocument);
  return { state, cells, unread, skipped };
}

/** `state` and `cells` for `CreateDocumentRequest`. */
export function sheetSeedRequest(seed: SheetSeed): Required<Pick<CreateDocumentRequest, 'state' | 'cells'>> {
  return { state: toBase64(seed.state), cells: toBase64(encodeCellList(seed.cells)) };
}

/** Ids `from` to `to - 1`. */
function range(to: number, from = 0): string[] {
  const out = new Array<string>(Math.max(0, to - from));
  for (let i = from; i < to; i++) out[i - from] = seqId(i);
  return out;
}

function bind(
  engine: Engine,
  sheetId: string,
  cell: SeedCell,
  grow: (sheets: readonly { sheetId: string; rows: number; cols: number }[]) => void,
  unread: { formulas: number }
): StoredCell | null {
  if (cell.formula !== undefined && cell.formula !== '' && cell.formula !== '=') {
    const text = cell.formula.startsWith('=') ? cell.formula : `=${cell.formula}`;
    if (text.length <= CELL_LIMITS.formulaChars) {
      let r = engine.contentFromInput(sheetId, text);
      if (r.kind === 'grow') {
        grow(r.sheets);
        r = engine.contentFromInput(sheetId, text);
      }
      if (r.kind === 'content' && r.content?.f) return { f: r.content.f };
    }
    unread.formulas++;
  }
  if (cell.error !== undefined && errorFromLiteral(cell.error)) return { e: cell.error };
  const v = cell.value;
  if (typeof v === 'number') return Number.isFinite(v) ? { v } : null;
  if (typeof v === 'boolean') return { v };
  if (typeof v === 'string' && v !== '') return { v: v.slice(0, CELL_LIMITS.textChars) };
  return null;
}

// ── rules ───────────────────────────────────────────────────────────────────

/** A formula's stored form, or null when it does not read here. */
function bindFormula(
  engine: Engine,
  sheetId: string,
  text: string,
  grow: (sheets: readonly { sheetId: string; rows: number; cols: number }[]) => void
): string | null {
  const t = text.startsWith('=') ? text : `=${text}`;
  if (t.length <= 1 || t.length > CELL_LIMITS.formulaChars) return null;
  let r = engine.contentFromInput(sheetId, t);
  if (r.kind === 'grow') {
    grow(r.sheets);
    r = engine.contentFromInput(sheetId, t);
  }
  return r.kind === 'content' && r.content?.f ? r.content.f : null;
}

interface BoundRules {
  /** Ranges are still positions; they become ids when the sheet's lines are known. */
  cf: { ranges: Rect[]; priority: number; when: CfCondition; style: CfStyle; stop?: boolean }[];
  validations: { ranges: Rect[]; check: ValidationCheck & { sheet?: string }; rest: Omit<ValidationRule, 'ranges' | 'check'>; source?: Rect }[];
  filter: Rect | null;
}

function bindRules(
  engine: Engine,
  sheetId: string,
  s: SeedSheetBuilder,
  idOf: (s: SeedSheetBuilder) => string,
  grow: (sheets: readonly { sheetId: string; rows: number; cols: number }[]) => void,
  skipped: { rules: number }
): BoundRules {
  const out: BoundRules = { cf: [], validations: [], filter: s.filterRect };
  s.cfRules.forEach((r, i) => {
    let when: CfCondition;
    if (r.when.kind === 'formula') {
      const f = bindFormula(engine, sheetId, r.when.formula, grow);
      if (!f) {
        skipped.rules++;
        return;
      }
      when = { kind: 'formula', f };
    } else when = r.when;
    out.cf.push({ ranges: r.ranges, priority: r.priority ?? i, when, style: r.style, ...(r.stop ? { stop: true } : {}) });
  });
  for (const v of s.validations) {
    const { ranges, check, ...rest } = v;
    let bound: ValidationCheck & { sheet?: string };
    let source: Rect | undefined;
    if (check.kind === 'formula') {
      const f = bindFormula(engine, sheetId, check.formula, grow);
      if (!f) {
        skipped.rules++;
        continue;
      }
      bound = { kind: 'formula', f };
    } else if (check.kind === 'listRange') {
      bound = { kind: 'listRange', sheet: idOf(check.sheet), range: {} as IdRect };
      source = check.range;
    } else bound = check;
    out.validations.push(source ? { ranges, check: bound, rest, source } : { ranges, check: bound, rest });
  }
  return out;
}

/** The rectangle as ids, or null when any corner is outside the sheet. */
function toIds(rect: Rect, rows: readonly string[], cols: readonly string[]): IdRect | null {
  const r1 = rows[rect.r1];
  const r2 = rows[rect.r2];
  const c1 = cols[rect.c1];
  const c2 = cols[rect.c2];
  return r1 && r2 && c1 && c2 ? { r1, c1, r2, c2 } : null;
}

/** Writes a sheet's rules into its maps. A range outside the sheet is left out, and a rule with none is too. */
function writeRules(
  m: ReturnType<typeof createSheet>,
  rules: BoundRules,
  rows: readonly string[],
  cols: readonly string[],
  sheetOf: (id: string) => { rowOrder: string[]; colOrder: string[] } | undefined
): void {
  const ids = (list: Rect[]) => list.map((r) => toIds(r, rows, cols)).filter((r): r is IdRect => r !== null);
  const cf = part(m, 'cf');
  for (const r of rules.cf) {
    const ranges = ids(r.ranges);
    if (!ranges.length) continue;
    const rule: CfRule = { ranges, priority: r.priority, when: r.when, style: r.style, ...(r.stop ? { stop: true } : {}) };
    cf.set(seqId(cf.size), rule);
  }
  const validation = part(m, 'validation');
  for (const v of rules.validations) {
    const ranges = ids(v.ranges);
    if (!ranges.length) continue;
    let check = v.check;
    if (check.kind === 'listRange' && v.source) {
      const host = sheetOf(check.sheet);
      const range = host && toIds(v.source, host.rowOrder, host.colOrder);
      if (!range) continue;
      check = { kind: 'listRange', sheet: check.sheet, range };
    }
    validation.set(seqId(validation.size), { ranges, check, ...v.rest } as ValidationRule);
  }
  const filter = part(m, 'filter');
  const range = rules.filter && toIds(rules.filter, rows, cols);
  if (range) filter.set(FILTER_RANGE, range);
}
