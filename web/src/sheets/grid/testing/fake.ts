/**
 * A sheet for testing the grid without the model: a `GridData` over plain storage that
 * applies every `GridIntent` the way a model would, so a test or the harness can type, fill,
 * paste, resize and move and then read what came back.
 *
 * It is deliberately not the model. It has no ids, no engine and no undo; a formula is
 * evaluated by a small recursive-descent reader (numbers, references, `+ - * /`, and SUM,
 * AVERAGE, MIN, MAX and COUNT over ranges) which is enough to see a total change when a cell
 * does. A sheet may also have a `generate` function standing in for storage, so the harness can
 * have a hundred thousand rows without holding two and a half million cells.
 */

import { lettersToCol } from '../a1';
import type { Cellpos, CellStyle, GridCell, GridData, GridIntent, PeerSelection, Rect } from '../types';

const STRIDE = 16_384;
const key = (row: number, col: number): number => row * STRIDE + col;

export interface Generated {
  /** What the formula bar shows and an edit starts from. */
  edit: string;
  /** The formatted text. */
  text: string;
  kind: GridCell['kind'];
  value?: number;
  style?: CellStyle;
  note?: string;
}

export interface FakeOptions {
  rows?: number;
  cols?: number;
  rowHeight?: number;
  colWidth?: number;
  readOnly?: boolean;
  /** Stands in for stored cells; an edit overrides it. */
  generate?: (row: number, col: number) => Generated | null;
}

const FUNCTIONS = ['AVERAGE', 'COUNT', 'IF', 'MAX', 'MIN', 'ROUND', 'SUM', 'SUMIF', 'VLOOKUP'];

export class FakeSheet implements GridData {
  version = 1;
  rows: number;
  cols: number;
  defaultRowHeight: number;
  defaultColWidth: number;
  frozenRows = 0;
  frozenCols = 0;
  mergeList: Rect[] = [];
  peerList: PeerSelection[] = [];
  filterInfo: ReturnType<GridData['filter']> = null;
  readOnlyFlag: boolean;
  /** Give the grid a `layoutVersion`, bumped by `layoutChanged()` and by every resize. */
  trackLayout = false;
  private sizeRev = 1;
  /** Every intent the grid has sent, in order. */
  intents: GridIntent[] = [];
  /** Validation lists and comments, by cell key. */
  lists = new Map<number, readonly string[]>();
  notes = new Map<number, string>();

  /** Extra fields laid over a cell: a conditional format, a colour, a note, a comment mark. */
  private patches = new Map<number, Partial<GridCell>>();
  private raw = new Map<number, string>();
  private styles = new Map<number, CellStyle>();
  private interned = new Map<string, CellStyle>();
  private rowH = new Map<number, number>();
  private colW = new Map<number, number>();
  private cache = new Map<number, GridCell | null>();
  private listeners = new Set<() => void>();
  generate: FakeOptions['generate'];

  constructor(o: FakeOptions = {}) {
    this.rows = o.rows ?? 1000;
    this.cols = o.cols ?? 26;
    this.defaultRowHeight = o.rowHeight ?? 26;
    this.defaultColWidth = o.colWidth ?? 100;
    this.readOnlyFlag = o.readOnly ?? false;
    this.generate = o.generate;
  }

  // ── building a sheet ──────────────────────────────────────────────────────

  /** One style object per distinct look, as the model hands them out. */
  style(s: CellStyle): CellStyle {
    const k = JSON.stringify(s);
    let v = this.interned.get(k);
    if (!v) {
      v = Object.freeze({ ...s });
      this.interned.set(k, v);
    }
    return v;
  }

  put(row: number, col: number, text: string, style?: CellStyle): this {
    this.raw.set(key(row, col), text);
    if (style) this.styles.set(key(row, col), this.style(style));
    this.touch();
    return this;
  }

  styleRange(r: Rect, style: CellStyle): this {
    const st = this.style(style);
    for (let row = r.r1; row <= r.r2; row++) for (let col = r.c1; col <= r.c2; col++) this.styles.set(key(row, col), st);
    this.touch();
    return this;
  }

  patch(row: number, col: number, p: Partial<GridCell>): this {
    this.patches.set(key(row, col), p);
    this.touch();
    return this;
  }

  setRowHeight(row: number, h: number): void {
    this.rowH.set(row, h);
    this.sizeRev++;
    this.touch();
  }

  setColWidth(col: number, w: number): void {
    this.colW.set(col, w);
    this.sizeRev++;
    this.touch();
  }

  touch(): void {
    this.version++;
    this.cache.clear();
    for (const fn of [...this.listeners]) fn();
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  // ── GridData ──────────────────────────────────────────────────────────────

  get layoutVersion(): number | undefined {
    return this.trackLayout ? this.sizeRev : undefined;
  }

  /** Something that is not a size changed the layout: the frozen panes, the merges, the row count. */
  layoutChanged(): void {
    this.sizeRev++;
    this.touch();
  }

  rowCount = (): number => this.rows;
  colCount = (): number => this.cols;
  rowHeight = (row: number): number => this.rowH.get(row) ?? this.defaultRowHeight;
  colWidth = (col: number): number => this.colW.get(col) ?? this.defaultColWidth;
  frozen = (): { rows: number; cols: number } => ({ rows: this.frozenRows, cols: this.frozenCols });
  merges = (): readonly Rect[] => this.mergeList;
  peers = (): readonly PeerSelection[] => this.peerList;
  filter = (): ReturnType<GridData['filter']> => this.filterInfo;
  readOnly = (): boolean => this.readOnlyFlag;

  private text(row: number, col: number): string | undefined {
    const k = key(row, col);
    if (this.raw.has(k)) return this.raw.get(k);
    return this.generate?.(row, col)?.edit;
  }

  editText(row: number, col: number): string {
    return this.text(row, col) ?? '';
  }

  /** The number or text a cell stands for, for the evaluator. */
  private valueOf(row: number, col: number, depth = 0): number | string {
    if (depth > 20) return '#REF!';
    const t = this.raw.has(key(row, col)) ? this.raw.get(key(row, col))! : undefined;
    if (t === undefined) {
      const g = this.generate?.(row, col);
      return g ? (g.value ?? g.text) : '';
    }
    if (t.startsWith('=')) return this.evaluate(t.slice(1), depth + 1);
    const n = Number(t.replace(/[£,%]/g, ''));
    return t.trim() !== '' && Number.isFinite(n) ? (t.endsWith('%') ? n / 100 : n) : t;
  }

  cell(row: number, col: number): GridCell | null {
    const k = key(row, col);
    const hit = this.cache.get(k);
    if (hit !== undefined) return hit;
    let made = this.make(row, col);
    const patch = this.patches.get(k);
    if (patch) made = { ...(made ?? { text: '', kind: 'empty' as const, style: this.style({}) }), ...patch };
    if (this.cache.size > 60_000) this.cache.clear();
    this.cache.set(k, made);
    return made;
  }

  private make(row: number, col: number): GridCell | null {
    const k = key(row, col);
    const own = this.raw.get(k);
    const style = this.styles.get(k);
    if (own === undefined) {
      const g = this.generate?.(row, col);
      if (!g) return style ? { text: '', kind: 'empty', style } : null;
      const out: GridCell = { text: g.text, kind: g.kind, style: g.style ?? this.style({}) };
      if (g.value !== undefined) out.value = g.value;
      if (g.note) out.note = g.note;
      return out;
    }
    const st = style ?? this.style({});
    const v = this.valueOf(row, col);
    let out: GridCell;
    if (own === '') out = { text: '', kind: 'empty', style: st };
    else if (typeof v === 'number') out = { text: formatNumber(v, st.numFmt), kind: 'number', value: v, style: st };
    else if (v.startsWith('#')) out = { text: v, kind: 'error', style: st, note: v === '#DIV/0!' ? 'Division by zero' : 'This formula has an error' };
    else if (v === 'TRUE' || v === 'FALSE') out = { text: v, kind: 'boolean', style: st };
    else out = { text: v, kind: 'text', style: st };
    const list = this.lists.get(k);
    if (list) out.hasList = true;
    const note = this.notes.get(k);
    if (note) out.commented = true;
    return out;
  }

  listChoices(row: number, col: number): readonly string[] | null {
    return this.lists.get(key(row, col)) ?? null;
  }

  completions(prefix: string): readonly { label: string; detail?: string; kind: 'function' | 'name' }[] {
    const p = prefix.toUpperCase();
    const fns = FUNCTIONS.filter((f) => f.startsWith(p)).map((label) => ({ label, kind: 'function' as const }));
    const names = ['Revenue', 'TaxRate'].filter((n) => n.toUpperCase().startsWith(p)).map((label) => ({ label, kind: 'name' as const }));
    return [...fns, ...names];
  }

  usedRange(): Rect | null {
    if (this.generate) return { r1: 0, r2: this.rows - 1, c1: 0, c2: this.cols - 1 };
    let r1 = Infinity;
    let r2 = -1;
    let c1 = Infinity;
    let c2 = -1;
    for (const [k, v] of this.raw) {
      if (v === '') continue;
      const row = Math.floor(k / STRIDE);
      const col = k % STRIDE;
      r1 = Math.min(r1, row);
      r2 = Math.max(r2, row);
      c1 = Math.min(c1, col);
      c2 = Math.max(c2, col);
    }
    return r2 < 0 ? null : { r1, r2, c1, c2 };
  }

  copy(rect: Rect): { text: string; html: string } {
    const lines: string[] = [];
    const trs: string[] = [];
    for (let r = rect.r1; r <= rect.r2; r++) {
      const cells: string[] = [];
      const tds: string[] = [];
      for (let c = rect.c1; c <= rect.c2; c++) {
        const t = this.cell(r, c)?.text ?? '';
        cells.push(t);
        tds.push(`<td>${t.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</td>`);
      }
      lines.push(cells.join('\t'));
      trs.push(`<tr>${tds.join('')}</tr>`);
    }
    return { text: lines.join('\n'), html: `<table>${trs.join('')}</table>` };
  }

  // ── intents, applied as a model would ─────────────────────────────────────

  apply(i: GridIntent): void {
    this.intents.push(i);
    if (this.readOnlyFlag && i.type !== 'select' && i.type !== 'filterMenu') return;
    switch (i.type) {
      case 'input':
        this.raw.set(key(i.at.row, i.at.col), i.text);
        break;
      case 'choose':
        this.raw.set(key(i.at.row, i.at.col), i.value);
        break;
      case 'clear':
        for (let r = i.rect.r1; r <= i.rect.r2; r++) for (let c = i.rect.c1; c <= i.rect.c2; c++) this.raw.delete(key(r, c));
        break;
      case 'paste': {
        if (i.cut) for (let r = i.cut.r1; r <= i.cut.r2; r++) for (let c = i.cut.c1; c <= i.cut.c2; c++) this.raw.delete(key(r, c));
        i.text.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n').forEach((line, dr) => {
          line.split('\t').forEach((v, dc) => {
            if (i.at.row + dr < this.rows && i.at.col + dc < this.cols) this.raw.set(key(i.at.row + dr, i.at.col + dc), v);
          });
        });
        break;
      }
      case 'fill': {
        const { source: s, target: t } = i;
        const h = s.r2 - s.r1 + 1;
        const w = s.c2 - s.c1 + 1;
        for (let r = t.r1; r <= t.r2; r++) {
          for (let c = t.c1; c <= t.c2; c++) {
            if (r >= s.r1 && r <= s.r2 && c >= s.c1 && c <= s.c2) continue;
            const sr = s.r1 + ((((r - s.r1) % h) + h) % h);
            const sc = s.c1 + ((((c - s.c1) % w) + w) % w);
            this.raw.set(key(r, c), this.raw.get(key(sr, sc)) ?? '');
          }
        }
        break;
      }
      case 'resize':
        for (let n = i.from; n <= i.to; n++) (i.axis === 'row' ? this.rowH : this.colW).set(n, i.size);
        this.sizeRev++;
        break;
      case 'autofit':
        this.sizeRev++;
        for (let n = i.from; n <= i.to; n++) {
          if (i.axis === 'row') this.rowH.set(n, this.defaultRowHeight);
          else {
            let longest = 3;
            for (let r = 0; r < Math.min(this.rows, 500); r++) longest = Math.max(longest, (this.cell(r, n)?.text ?? '').length);
            this.colW.set(n, Math.round(longest * 7.5 + 20));
          }
        }
        break;
      case 'move': {
        const order = Array.from({ length: i.axis === 'row' ? this.rows : this.cols }, (_, n) => n);
        const block = order.splice(i.from, i.count);
        order.splice(i.to, 0, ...block);
        const next = new Map<number, string>();
        for (const [k, v] of this.raw) {
          const row = Math.floor(k / STRIDE);
          const col = k % STRIDE;
          if (i.axis === 'row') next.set(key(order.indexOf(row), col), v);
          else next.set(key(row, order.indexOf(col)), v);
        }
        this.raw = next;
        break;
      }
      case 'select':
      case 'filterMenu':
        return;
    }
    this.touch();
  }

  /** The typed text of a rectangle, as rows, for assertions. */
  rowsOf(r: Rect): string[][] {
    const out: string[][] = [];
    for (let row = r.r1; row <= r.r2; row++) {
      const line: string[] = [];
      for (let col = r.c1; col <= r.c2; col++) line.push(this.editText(row, col));
      out.push(line);
    }
    return out;
  }

  // ── a small evaluator ─────────────────────────────────────────────────────

  private evaluate(src: string, depth: number): number | string {
    const s = src.replace(/\s+/g, '');
    let i = 0;
    const fail = (): never => {
      throw new Error('bad formula');
    };
    const peek = () => s[i];
    const cellRef = /^([A-Z]{1,3})(\d{1,7})/;

    const range = (): number[] | null => {
      const a = cellRef.exec(s.slice(i));
      if (!a) return null;
      const from: Cellpos = { row: Number(a[2]) - 1, col: lettersToCol(a[1]!) };
      let to = from;
      i += a[0].length;
      if (s[i] === ':') {
        const b = cellRef.exec(s.slice(i + 1));
        if (!b) return fail();
        to = { row: Number(b[2]) - 1, col: lettersToCol(b[1]!) };
        i += 1 + b[0].length;
      }
      const out: number[] = [];
      for (let r = Math.min(from.row, to.row); r <= Math.max(from.row, to.row); r++) {
        for (let c = Math.min(from.col, to.col); c <= Math.max(from.col, to.col); c++) {
          const v = this.valueOf(r, c, depth);
          if (typeof v === 'number') out.push(v);
        }
      }
      return out;
    };

    const primary = (): number => {
      if (peek() === '(') {
        i++;
        const v = sum();
        if (peek() !== ')') fail();
        i++;
        return v;
      }
      if (peek() === '-') {
        i++;
        return -primary();
      }
      const num = /^\d+\.?\d*/.exec(s.slice(i));
      if (num) {
        i += num[0].length;
        return Number(num[0]);
      }
      const fn = /^([A-Z]+)\(/.exec(s.slice(i));
      if (fn) {
        i += fn[0].length;
        const nums: number[] = [];
        while (peek() !== ')') {
          const r = range();
          if (r) nums.push(...r);
          else nums.push(sum());
          if (peek() === ',') i++;
          else if (peek() !== ')') fail();
        }
        i++;
        switch (fn[1]) {
          case 'SUM':
            return nums.reduce((a, b) => a + b, 0);
          case 'AVERAGE':
            return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : NaN;
          case 'MIN':
            return Math.min(...nums);
          case 'MAX':
            return Math.max(...nums);
          case 'COUNT':
            return nums.length;
          default:
            return fail();
        }
      }
      const r = range();
      if (r) return r[0] ?? 0;
      return fail();
    };
    const product = (): number => {
      let v = primary();
      while (peek() === '*' || peek() === '/') {
        const op = s[i++];
        const rhs = primary();
        if (op === '/' && rhs === 0) throw new RangeError('div0');
        v = op === '*' ? v * rhs : v / rhs;
      }
      return v;
    };
    const sum = (): number => {
      let v = product();
      while (peek() === '+' || peek() === '-') v = s[i++] === '+' ? v + product() : v - product();
      return v;
    };
    try {
      const v = sum();
      if (i < s.length) return '#ERROR!';
      return Number.isNaN(v) ? '#DIV/0!' : v;
    } catch (e) {
      return e instanceof RangeError ? '#DIV/0!' : '#ERROR!';
    }
  }
}

/** The few formats the tests and the harness use. */
export function formatNumber(n: number, fmt?: string): string {
  if (!fmt) return Number.isInteger(n) ? String(n) : String(Math.round(n * 1e6) / 1e6);
  const decimals = /0\.(0+)/.exec(fmt)?.[1]?.length ?? 0;
  const grouped = n.toLocaleString('en-GB', { minimumFractionDigits: decimals, maximumFractionDigits: decimals, useGrouping: fmt.includes(',') || fmt.includes('£') });
  if (fmt.includes('%')) return `${(n * 100).toLocaleString('en-GB', { maximumFractionDigits: decimals })}%`;
  if (fmt.includes('£')) return n < 0 ? `-£${(-n).toLocaleString('en-GB', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}` : `£${grouped}`;
  return grouped;
}
