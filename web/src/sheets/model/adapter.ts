/**
 * One sheet as the grid reads it (`GridData`, grid/types.ts), and the grid's intents applied.
 *
 * The grid calls `cell` for every cell on screen on every frame, so a cell is computed once and
 * kept: formatted text, kind, and its format interned (column, then row, then its own; styles.ts).
 * The cache is keyed by ids, so an insert or a move leaves every cached cell right. It drops:
 *
 *   · one cell, when the engine says its value may have changed (`Engine.onTouch`: every content
 *     change and every formula that ran in a recalculation) or its own format changed;
 *   · everything, when a row's or column's format changes, when the rules change, and, on a
 *     sheet with conditional formats, at every version, because a format can depend on any cell
 *     in its range (a duplicate, the top ten, a colour scale).
 *
 * A hit is two map lookups and the order arrays' index; a miss formats one value. Row heights and
 * column widths are arrays rebuilt when the layout changes, because the grid sums every one of
 * them each version (grid/geometry.ts).
 */

import type * as Y from 'yjs';
import type { Awareness } from 'y-protocols/awareness';
import { readUser } from '../../core/presence';
import {
  type Engine,
  type Scalar,
  OWN_FUNCTIONS,
  formatValue,
  formulajsFunctions,
  isDateFormat,
  isError,
  numberToText,
  parseValue
} from '../engine';
import type { Sheet } from '../engine/sheet';
import type { CellStyle, GridCell, GridData, GridIntent, PeerSelection, Rect } from '../grid/types';
import { FeatureView } from './features';
import type { ChangeKind } from './mirror';
import type { SheetModel } from './model';
import { type ClipCellOut, type OwnClip, toHtml, toTsv } from './paste';
import {
  DEFAULT_COL_WIDTH,
  DEFAULT_ROW_HEIGHT,
  type IdRect,
  type SheetMap,
  field,
  namesOf,
  resolveRect,
  sheetsOf
} from './structure';
import { EMPTY_STYLE, type StoredStyle, type StyleBook } from './styles';

/** What a view reads from its model. */
export interface ViewHost {
  readonly engine: Engine;
  readonly doc: Y.Doc;
  readonly book: StyleBook;
  readonly version: number;
  readonly awareness: Awareness | null;
  /** Names the workbook in a copy, so formulas paste as formulas only into it. */
  readonly clipDoc: string;
  /** Formulas drawn as their text: one viewer's setting. */
  readonly showFormulas: boolean;
  isReadOnly(): boolean;
  styleId(sheetId: string, rowId: string, colId: string): string | undefined;
  /** Cells with a format of their own, column id → row id → style id. */
  styled(sheetId: string): ReadonlyMap<string, ReadonlyMap<string, string>> | undefined;
  subscribe(listener: () => void): () => void;
}

/** Above this many cells a copy carries text only: an HTML table of millions of cells helps nobody. */
export const COPY_RICH_CELLS = 200_000;

/**
 * formulajs answers some functions under a second, undotted name of its own (CEILINGMATH for
 * CEILING.MATH). They work if typed, as Excel's do not, so they are left out of the list. The
 * legacy names Excel itself has (STDEVP, NORMDIST, …) stay.
 */
const ALIASES = new Set([
  'CEILINGMATH',
  'CEILINGPRECISE',
  'CHIDISTRT',
  'CHIINVRT',
  'COVARIANCEP',
  'COVARIANCES',
  'FDISTRT',
  'FINVRT',
  'FLOORMATH',
  'FLOORPRECISE',
  'GAMMALNPRECISE',
  'LOGNORMINV',
  'MODEMULT',
  'MODESNGL',
  'NETWORKDAYSINTL',
  'PERCENTILEEXC',
  'PERCENTILEINC',
  'PERCENTRANKEXC',
  'PERCENTRANKINC',
  'POISSONDIST',
  'QUARTILEEXC',
  'QUARTILEINC',
  'RANKAVG',
  'RANKEQ',
  'SKEWP',
  'STDEVS',
  'TDISTRT',
  'VARS',
  'WEIBULLDIST',
  'WORKDAYINTL'
]);

let functionList: string[] | null = null;

/** Every function a person can type, once. */
export function functionNames(): readonly string[] {
  functionList ??= [...new Set([...OWN_FUNCTIONS, ...formulajsFunctions()])].filter((n) => !ALIASES.has(n)).sort();
  return functionList;
}

function kindOf(v: Scalar): GridCell['kind'] {
  if (v === null) return 'empty';
  if (typeof v === 'number') return 'number';
  if (typeof v === 'string') return 'text';
  if (typeof v === 'boolean') return 'boolean';
  return 'error';
}

/** The selection a client publishes in its awareness state: ids, so it stays put through inserts. */
export interface SelectionState {
  sheet: string;
  r1: string;
  c1: string;
  r2: string;
  c2: string;
  ar: string;
  ac: string;
}

export class SheetView implements GridData {
  private cells = new Map<string, Map<string, GridCell | null>>();
  private cacheAt = -1;
  private fv: FeatureView | null = null;
  private fvAt = -1;
  private layoutStale = true;
  private sizesAt = -1;
  /** How many times the sizes have been rebuilt: `layoutVersion`. */
  private layoutSeq = 0;
  private heights: Float64Array = new Float64Array(0);
  private widths: Float64Array = new Float64Array(0);
  private mergeList: Rect[] | null = null;
  private used: Rect | null | undefined;
  private peerList: PeerSelection[] = [];
  private peersAt = -1;

  constructor(
    private readonly host: ViewHost,
    readonly sheetId: string
  ) {}

  get version(): number {
    return this.host.version;
  }

  private sheet(): Sheet | undefined {
    return this.host.engine.sheet(this.sheetId);
  }

  private map(): SheetMap | undefined {
    return sheetsOf(this.host.doc).get(this.sheetId);
  }

  // ── invalidation, called by the model ─────────────────────────────────────

  /** One cell's value or own format may have changed. */
  touch(rowId: string, colId: string): void {
    this.cells.get(colId)?.delete(rowId);
  }

  /** A cell became empty or stopped being: the used range moves. */
  shapeChanged(): void {
    this.used = undefined;
  }

  changed(kind: ChangeKind): void {
    switch (kind) {
      case 'layout':
        this.layoutStale = true;
        this.mergeList = null;
        break;
      case 'order':
        this.layoutStale = true;
        this.mergeList = null;
        this.used = undefined;
        // A rule's range is by ids; which cells it covers can change with a move.
        if (this.hasAnyRules()) this.cells.clear();
        break;
      case 'styles':
      case 'rules':
      case 'sheets':
        this.cells.clear();
        this.layoutStale = true;
        this.mergeList = null;
        this.used = undefined;
        break;
      case 'names':
        break;
    }
  }

  private hasAnyRules(): boolean {
    const m = this.map();
    return !!m && ((field(m, 'cf')?.size ?? 0) > 0 || (field(m, 'validation')?.size ?? 0) > 0 || (field(m, 'filter')?.size ?? 0) > 0);
  }

  /** The rules at this version. */
  features(): FeatureView | null {
    const map = this.map();
    if (!map || !this.sheet()) return null;
    if (!this.fv || this.fvAt !== this.host.version) {
      this.fv = new FeatureView(this.host.engine, this.sheetId, map, (r, c) => this.textOf(r, c));
      this.fvAt = this.host.version;
    }
    return this.fv;
  }

  // ── GridData ──────────────────────────────────────────────────────────────

  /**
   * Changes when a size, a hidden line, the frozen panes or the merges may have: not on a cell's
   * edit, and not on somebody else's cursor. The grid rebuilds its row and column sums when it
   * changes, a pass over every row (grid/types.ts `layoutVersion`).
   */
  get layoutVersion(): number {
    this.sizes();
    return this.layoutSeq;
  }

  rowCount(): number {
    return this.sheet()?.rowOrder.length ?? 0;
  }

  colCount(): number {
    return this.sheet()?.colOrder.length ?? 0;
  }

  /**
   * Brings the row and column sizes up to date. The grid asks for every row's height, 100,000 times
   * on a sheet that long, and each ask lands here, so a call that has nothing to do answers from
   * two fields: the one question that costs anything (whether a filter is on, which counts a Yjs
   * map) is asked once for each version and not once for each row.
   */
  private sizes(): void {
    if (!this.layoutStale && this.sizesAt === this.host.version) return;
    const m = this.map();
    const filtered = !!m && (field(m, 'filter')?.size ?? 0) > 0;
    this.sizesAt = this.host.version;
    // The version moved. Unless a size changed or a filter may have hidden other rows, so did nothing here.
    if (!this.layoutStale && !filtered) return;
    this.layoutStale = false;
    this.layoutSeq++;
    const sh = this.sheet();
    const map = m;
    if (!sh || !map) {
      this.heights = new Float64Array(0);
      this.widths = new Float64Array(0);
      return;
    }
    this.heights = this.build(sh.rowOrder.length, sh.rowIndex(), DEFAULT_ROW_HEIGHT, field(map, 'heights'), field(map, 'hiddenRows'));
    this.widths = this.build(sh.colOrder.length, sh.colIndex(), DEFAULT_COL_WIDTH, field(map, 'widths'), field(map, 'hiddenCols'));
    if (filtered) for (const r of this.features()?.filter()?.hidden ?? []) this.heights[r] = 0;
  }

  private build(n: number, index: Map<string, number>, def: number, sizes?: Y.Map<number>, hidden?: Y.Map<true>): Float64Array {
    const out = new Float64Array(n).fill(def);
    if (sizes) {
      for (const [id, px] of sizes.entries()) {
        const i = index.get(id);
        if (i !== undefined && typeof px === 'number' && px > 0) out[i] = px;
      }
    }
    if (hidden) {
      for (const id of hidden.keys()) {
        const i = index.get(id);
        if (i !== undefined) out[i] = 0;
      }
    }
    return out;
  }

  rowHeight(row: number): number {
    this.sizes();
    return this.heights[row] ?? DEFAULT_ROW_HEIGHT;
  }

  colWidth(col: number): number {
    this.sizes();
    return this.widths[col] ?? DEFAULT_COL_WIDTH;
  }

  frozen(): { rows: number; cols: number } {
    const map = this.map();
    const rows = Number(map ? field(map, 'frozenRows') : 0) || 0;
    const cols = Number(map ? field(map, 'frozenCols') : 0) || 0;
    return { rows: Math.max(0, Math.min(rows, this.rowCount())), cols: Math.max(0, Math.min(cols, this.colCount())) };
  }

  merges(): readonly Rect[] {
    if (this.mergeList) return this.mergeList;
    const sh = this.sheet();
    const m = this.map();
    const out: Rect[] = [];
    if (sh && m) {
      for (const r of field(m, 'merges')?.values() ?? []) {
        const rect = resolveRect(sh, r as IdRect);
        if (rect && (rect.r1 !== rect.r2 || rect.c1 !== rect.c2)) out.push(rect);
      }
    }
    return (this.mergeList = out);
  }

  cell(row: number, col: number): GridCell | null {
    const sh = this.sheet();
    if (!sh) return null;
    const rowId = sh.rowOrder[row];
    const colId = sh.colOrder[col];
    if (rowId === undefined || colId === undefined) return null;
    if (this.cacheAt !== this.host.version) {
      // Conditional formats read other cells, so on a sheet with any, nothing outlives a version.
      const m = this.map();
      if (m && (field(m, 'cf')?.size ?? 0) > 0) this.cells.clear();
      this.cacheAt = this.host.version;
    }
    let column = this.cells.get(colId);
    if (column) {
      const hit = column.get(rowId);
      if (hit !== undefined) return hit;
    } else this.cells.set(colId, (column = new Map()));
    const out = this.compute(sh, row, col, rowId, colId);
    column.set(rowId, out);
    return out;
  }

  private styleOf(rowId: string, colId: string): CellStyle | null {
    const m = this.map();
    const own = this.host.styleId(this.sheetId, rowId, colId);
    const rs = m ? field(m, 'rowStyles')?.get(rowId) : undefined;
    const cs = m ? field(m, 'colStyles')?.get(colId) : undefined;
    if (own === undefined && rs === undefined && cs === undefined) return null;
    return this.host.book.effective(cs, rs, own);
  }

  private compute(sh: Sheet, row: number, col: number, rowId: string, colId: string): GridCell | null {
    const c = sh.cell(rowId, colId);
    const style = this.styleOf(rowId, colId);
    const fv = this.hasAnyRules() ? this.features() : null;
    const cond = fv?.hasRules() ? fv.conditional(row, col) : undefined;
    const rule = fv ? fv.validationAt(row, col) : undefined;
    const list = rule?.check.kind;
    const hasList = list === 'list' || list === 'listRange';
    if (!c && !style && !cond && !hasList && !rule?.prompt) return null;
    const v = c?.value ?? null;
    const st = style ?? EMPTY_STYLE;
    // Show formulas: the cell reads as the text a person would edit, left aligned as text is.
    if (this.host.showFormulas && c?.content.f !== undefined) {
      const out: GridCell = { text: this.editText(row, col), kind: 'text', style: st };
      if (cond) out.conditional = cond;
      return out;
    }
    const f = formatValue(v, st.numFmt);
    const out: GridCell = { text: f.text, kind: kindOf(v), style: st };
    if (typeof v === 'number') out.value = v;
    if (f.color) out.color = f.color;
    if (cond) out.conditional = cond;
    if (hasList) out.hasList = true;
    if (isError(v) && v.detail) out.note = v.detail;
    else if (rule?.prompt) out.tip = rule.prompt.title ? `${rule.prompt.title}\n${rule.prompt.text}` : rule.prompt.text;
    return out;
  }

  /** What a cell shows, by ids: a filter's values are these. */
  textOf(rowId: string, colId: string): string {
    const v = this.sheet()?.cell(rowId, colId)?.value ?? null;
    return formatValue(v, this.styleOf(rowId, colId)?.numFmt).text;
  }

  editText(row: number, col: number): string {
    const sh = this.sheet();
    const rowId = sh?.rowOrder[row];
    const colId = sh?.colOrder[col];
    if (!sh || rowId === undefined || colId === undefined) return '';
    const c = sh.cell(rowId, colId);
    if (!c) return '';
    if (c.content.f !== undefined) return this.host.engine.displayFormula(this.sheetId, rowId, colId) ?? c.content.f;
    if (c.content.e !== undefined) return c.content.e;
    const v = c.content.v;
    if (v === undefined) return '';
    if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
    if (typeof v === 'number') {
      const fmt = this.styleOf(rowId, colId)?.numFmt;
      if (fmt && isDateFormat(fmt)) {
        const order = this.host.engine.dateOrder;
        const date = order === 'mdy' ? 'mm/dd/yyyy' : 'dd/mm/yyyy';
        const whole = Math.floor(v) === v;
        const time = /[hs]/i.test(fmt.replace(/"[^"]*"/g, ''));
        const code = whole ? date : Math.floor(v) === 0 && time ? 'hh:mm:ss' : `${date} hh:mm:ss`;
        return formatValue(v, code).text;
      }
      if (fmt && /%/.test(fmt.replace(/"[^"]*"/g, ''))) return `${numberToText(v * 100)}%`;
      return numberToText(v);
    }
    // Text that would read back as something else keeps the apostrophe that makes it text.
    const back = parseValue(v, this.host.engine.dateOrder).content;
    return v.startsWith('=') || v.startsWith("'") || back?.v !== v ? `'${v}` : v;
  }

  listChoices(row: number, col: number): readonly string[] | null {
    return this.features()?.listChoices(row, col) ?? null;
  }

  completions(prefix: string): readonly { label: string; detail?: string; kind: 'function' | 'name' }[] {
    const p = prefix.toUpperCase();
    const out: { label: string; detail?: string; kind: 'function' | 'name' }[] = [];
    for (const n of namesOf(this.host.doc).values()) {
      if (n.scope !== undefined && n.scope !== this.sheetId) continue;
      if (!n.name.toUpperCase().startsWith(p)) continue;
      const shown = this.host.engine.displayName(n.name, n.scope);
      out.push(shown ? { label: n.name, detail: shown, kind: 'name' } : { label: n.name, kind: 'name' });
    }
    out.sort((a, b) => a.label.localeCompare(b.label));
    for (const f of functionNames()) {
      if (out.length >= 100) break;
      if (f.startsWith(p)) out.push({ label: f, kind: 'function' });
    }
    return out;
  }

  peers(): readonly PeerSelection[] {
    if (this.peersAt === this.host.version) return this.peerList;
    this.peersAt = this.host.version;
    const aw = this.host.awareness;
    const sh = this.sheet();
    const out: PeerSelection[] = [];
    if (aw && sh) {
      const ri = sh.rowIndex();
      const ci = sh.colIndex();
      for (const [clientId, state] of aw.getStates()) {
        if (clientId === aw.clientID) continue;
        const sel = (state as { sel?: Partial<SelectionState> }).sel;
        if (!sel || sel.sheet !== this.sheetId) continue;
        const user = readUser(state);
        const at = (m: Map<string, number>, id: unknown) => (typeof id === 'string' ? m.get(id) : undefined);
        const r1 = at(ri, sel.r1);
        const r2 = at(ri, sel.r2);
        const c1 = at(ci, sel.c1);
        const c2 = at(ci, sel.c2);
        const ar = at(ri, sel.ar);
        const ac = at(ci, sel.ac);
        if (!user || r1 === undefined || r2 === undefined || c1 === undefined || c2 === undefined) continue;
        out.push({
          clientId,
          name: user.name,
          color: user.color,
          rect: { r1: Math.min(r1, r2), r2: Math.max(r1, r2), c1: Math.min(c1, c2), c2: Math.max(c1, c2) },
          active: { row: ar ?? r1, col: ac ?? c1 }
        });
      }
    }
    return (this.peerList = out);
  }

  copy(rect: Rect): { text: string; html: string } {
    const sh = this.sheet();
    const text: string[][] = [];
    const n = (rect.r2 - rect.r1 + 1) * (rect.c2 - rect.c1 + 1);
    const rich = n <= COPY_RICH_CELLS;
    const html: ClipCellOut[][] = [];
    const own: OwnClip = { doc: this.host.clipDoc, sheet: this.sheetId, r1: rect.r1, c1: rect.c1, cells: [] };
    for (let r = rect.r1; r <= rect.r2; r++) {
      const line: string[] = [];
      const htmlLine: ClipCellOut[] = [];
      const ownLine: OwnClip['cells'][number] = [];
      for (let c = rect.c1; c <= rect.c2; c++) {
        const cell = this.cell(r, c);
        line.push(cell?.text ?? '');
        if (!rich) continue;
        const out: ClipCellOut = { text: cell?.text ?? '', style: cell?.style ?? EMPTY_STYLE };
        if (cell?.value !== undefined) out.number = cell.value;
        htmlLine.push(out);
        const rowId = sh?.rowOrder[r];
        const colId = sh?.colOrder[c];
        const content = rowId !== undefined && colId !== undefined ? sh?.cell(rowId, colId)?.content : undefined;
        const st = cell && cell.style !== EMPTY_STYLE ? (cell.style as StoredStyle) : undefined;
        ownLine.push(content || st ? { ...(content ? { c: { ...content } } : {}), ...(st ? { st } : {}) } : null);
      }
      text.push(line);
      if (rich) {
        html.push(htmlLine);
        own.cells.push(ownLine);
      }
    }
    return { text: toTsv(text), html: rich ? toHtml(html, own) : '' };
  }

  filter(): { headerRow: number; cols: readonly number[]; active: readonly number[] } | null {
    const f = this.features()?.filter();
    return f ? { headerRow: f.headerRow, cols: f.cols, active: f.active } : null;
  }

  readOnly(): boolean {
    return this.host.isReadOnly();
  }

  usedRange(): Rect | null {
    if (this.used !== undefined) return this.used;
    const sh = this.sheet();
    if (!sh) return (this.used = null);
    const ri = sh.rowIndex();
    const ci = sh.colIndex();
    let r2 = -1;
    let c2 = -1;
    const see = (rowId: string, colId: string) => {
      const r = ri.get(rowId);
      const c = ci.get(colId);
      if (r === undefined || c === undefined) return;
      if (r > r2) r2 = r;
      if (c > c2) c2 = c;
    };
    for (const [colId, col] of sh.cols) for (const rowId of col.keys()) see(rowId, colId);
    for (const [colId, col] of this.host.styled(this.sheetId) ?? []) for (const rowId of col.keys()) see(rowId, colId);
    return (this.used = r2 < 0 ? null : { r1: 0, c1: 0, r2, c2 });
  }

  subscribe(listener: () => void): () => void {
    return this.host.subscribe(listener);
  }
}

/**
 * The grid's intent, applied as one step. False for the one intent that is the editor's to
 * handle rather than the model's: the filter menu.
 */
export function applyIntent(model: SheetModel, sheetId: string, intent: GridIntent): boolean {
  switch (intent.type) {
    case 'input':
      model.input(sheetId, intent.at, intent.text);
      return true;
    case 'choose':
      // A choice is the item itself, never a formula.
      model.input(sheetId, intent.at, intent.value.startsWith('=') ? `'${intent.value}` : intent.value);
      return true;
    case 'clear':
      model.clear(sheetId, intent.rect);
      return true;
    case 'paste':
      model.paste(sheetId, intent.at, intent.text, intent.html, intent.cut);
      return true;
    case 'fill':
      model.fill(sheetId, intent.source, intent.target);
      return true;
    case 'resize':
      model.resize(sheetId, intent.axis, intent.from, intent.to, intent.size);
      return true;
    case 'autofit':
      model.autofit(sheetId, intent.axis, intent.from, intent.to);
      return true;
    case 'move':
      model.move(sheetId, intent.axis, intent.from, intent.to, intent.count);
      return true;
    case 'select':
      model.select(sheetId, intent.rect, intent.active);
      return true;
    case 'filterMenu':
      return false;
  }
}
