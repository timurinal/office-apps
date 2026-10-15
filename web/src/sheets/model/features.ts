/**
 * Conditional formats, validation, filters and charts: what they store, and what they answer.
 *
 * Each lives in its own map on the sheet (structure.ts), one entry per rule or chart, keyed by
 * a fresh id, so two people adding rules at once keep both. Every rectangle is an `IdRect`
 * and takes part in deletes through the registry at the bottom of this file.
 *
 *   cf          rule id → CfRule          { ranges, priority, when, style, stop? }
 *   validation  rule id → ValidationRule  { ranges, check, strict?, allowBlank?, message? }
 *   filter      'range' → IdRect           the header row is the range's top row
 *               `c:<column id>` → FilterCriterion
 *   charts      chart id → ChartSpec      { type, sheet, data, anchor, w, h, title?, options? }
 *
 * What they answer is computed per sheet and per version (`FeatureView`), from the engine's
 * values, so a rule never stores a result and a value changing anywhere is seen at once.
 */

import type * as Y from 'yjs';
import { type Engine, type Scalar, compare, isError, numberToText } from '../engine';
import type { Sheet } from '../engine/sheet';
import type { GridCell, Rect } from '../grid/types';
import { type IdRect, type SheetMap, field, mapRanges, registerFeatureRanges, resolveRect, sheetsOf } from './structure';

// ── shapes ──────────────────────────────────────────────────────────────────

export type Comparison = 'gt' | 'ge' | 'lt' | 'le' | 'eq' | 'ne' | 'between' | 'notBetween';

export type CfCondition =
  | { kind: 'cell'; op: Comparison; a: number | string; b?: number | string }
  | { kind: 'text'; op: 'contains' | 'notContains' | 'begins' | 'ends'; text: string }
  | { kind: 'blank' }
  | { kind: 'notBlank' }
  | { kind: 'error' }
  | { kind: 'notError' }
  /** A stored formula (`=` and ids), written for the first range's top-left cell and shifted for the others. */
  | { kind: 'formula'; f: string }
  | { kind: 'duplicate' }
  | { kind: 'unique' }
  | { kind: 'top'; n: number; percent?: boolean; bottom?: boolean }
  | { kind: 'average'; below?: boolean }
  /** A colour scale from the lowest number in the ranges to the highest, through `mid` at the median. */
  | { kind: 'scale'; min: string; mid?: string; max: string }
  /** A bar in each number's cell, as long as the number is next to the others. Negatives run the other way, in `negative`. */
  | { kind: 'bar'; color: string; negative?: string };

export type CfStyle = NonNullable<GridCell['conditional']>;

export interface CfRule {
  ranges: IdRect[];
  /** Lower first. */
  priority: number;
  when: CfCondition;
  /** Ignored for a scale and a bar, which set the fill and the bar. */
  style: CfStyle;
  /** No rule after this one applies to a cell this one matched. */
  stop?: boolean;
}

export type ValidationCheck =
  | { kind: 'list'; items: string[] }
  /** The choices are the values in a block of a sheet, which may be another sheet. */
  | { kind: 'listRange'; sheet: string; range: IdRect }
  | { kind: 'number' | 'integer' | 'date' | 'textLength'; op: Comparison; a: number; b?: number }
  | { kind: 'formula'; f: string };

export interface ValidationRule {
  ranges: IdRect[];
  check: ValidationCheck;
  /** Refuse a value that fails; otherwise it is kept and only marked. */
  strict?: boolean;
  /** An empty cell passes. Default true. */
  allowBlank?: boolean;
  /** What the refusal says, or the warning, whichever the rule is. */
  message?: string;
  /** Shown beside the cell when the pointer rests on it, before anything is typed. */
  prompt?: { title?: string; text: string };
}

export type FilterCriterion =
  /** The values unticked in the filter menu, as the cells show them; '' is the blanks. */
  | { kind: 'values'; hidden: string[] }
  | { kind: 'condition'; op: Comparison; a: number | string; b?: number | string }
  /** Text a cell shows: contains, does not contain, begins with, ends with. Case is ignored. */
  | { kind: 'text'; op: 'contains' | 'notContains' | 'begins' | 'ends'; text: string }
  /** Only the empty cells, or with `not` only the cells that are not. */
  | { kind: 'blank'; not?: boolean };

/**
 * What a chart is, apart from where it sits (charts/ draws it and writes it). `seriesIn`,
 * `headers` and `labels` say how `data` is read, and an absent one means Excel's usual layout:
 * series in columns, the first row their names, the first column the categories. A new chart
 * always stores all three, so an absent one only means a chart this code did not make.
 */
export interface ChartOptions {
  /** Absent: at the bottom for two series or more, at the right for a pie, none for one series. */
  legend?: 'none' | 'right' | 'bottom' | 'top';
  stacked?: boolean;
  seriesIn?: 'cols' | 'rows';
  /** The first row (series in columns) or first column (series in rows) holds the series' names. */
  headers?: boolean;
  /** The first column (series in columns) or first row (series in rows) holds the categories, or a scatter's x. */
  labels?: boolean;
  /** The axis along the bottom and the one along the left, whichever way round the chart is. */
  xTitle?: string;
  yTitle?: string;
  /** The value axis' ends; the horizontal one of a bar chart. */
  yMin?: number;
  yMax?: number;
  /** The scatter's horizontal axis, or a time axis. */
  xMin?: number;
  xMax?: number;
  /** One CSS colour per series, or per slice of a pie; an empty string keeps the default for that one. */
  colors?: string[];
}

export interface ChartSpec {
  type: 'column' | 'bar' | 'line' | 'area' | 'pie' | 'doughnut' | 'scatter';
  /** The sheet the data is on, which may not be the sheet the chart sits on. */
  sheet: string;
  /** Series in columns, headers in the first row, unless `options` says otherwise. */
  data: IdRect;
  /** The cell the chart's top-left corner sits in, and how far into it, in CSS px. */
  anchor: { row: string; col: string; dx: number; dy: number };
  w: number;
  h: number;
  title?: string;
  options?: ChartOptions;
}

export const FILTER_RANGE = 'range';
export const filterKey = (colId: string): string => `c:${colId}`;

// ── the registry: deletes move every rectangle here off the deleted lines ─────

const keepRanges = <T extends { ranges: IdRect[] }>(v: T, next: (IdRect | null)[]): T | null => {
  const ranges = next.filter((r): r is IdRect => r !== null);
  return ranges.length ? { ...v, ranges } : null;
};

registerFeatureRanges({
  key: 'cf',
  ranges: (doc, sheetId) => {
    const s = sheetsOf(doc).get(sheetId);
    return mapRanges<CfRule>(s ? field(s, 'cf') : undefined, (r) => r.ranges, keepRanges);
  }
});

registerFeatureRanges({
  key: 'validation',
  ranges: (doc, sheetId) => {
    const s = sheetsOf(doc).get(sheetId);
    return mapRanges<ValidationRule>(s ? field(s, 'validation') : undefined, (r) => r.ranges, keepRanges);
  }
});

registerFeatureRanges({
  key: 'validation-source',
  *ranges(doc, sheetId) {
    for (const s of sheetsOf(doc).values()) {
      yield* mapRanges<ValidationRule>(
        field(s, 'validation'),
        (r) => (r.check.kind === 'listRange' && r.check.sheet === sheetId ? [r.check.range] : []),
        (r, next) => (next[0] && r.check.kind === 'listRange' ? { ...r, check: { ...r.check, range: next[0] } } : null)
      );
    }
  }
});

registerFeatureRanges({
  key: 'filter',
  *ranges(doc, sheetId) {
    const s = sheetsOf(doc).get(sheetId);
    const filter = s ? field(s, 'filter') : undefined;
    const rect = filter?.get(FILTER_RANGE) as IdRect | undefined;
    if (!filter || !rect) return;
    yield {
      rect,
      replace(next) {
        if (next) filter.set(FILTER_RANGE, next);
        else for (const k of [...filter.keys()]) filter.delete(k);
      }
    };
  }
});

registerFeatureRanges({
  key: 'charts',
  *ranges(doc, sheetId) {
    for (const s of sheetsOf(doc).values()) {
      yield* mapRanges<ChartSpec>(
        field(s, 'charts'),
        (c) => (c.sheet === sheetId ? [c.data] : []),
        (c, next) => (next[0] ? { ...c, data: next[0] } : null)
      );
    }
  }
});

/**
 * A chart's anchor is a single cell, and a delete would leave it on a row that is gone. It is
 * registered as a rectangle from the anchor to the sheet's last row and column, so that deleting
 * the anchor's own line moves it to the line that took its place (Excel's behaviour: the chart
 * stays where it was drawn). Only the first corner is written back, and only when it moved. When
 * the delete reaches the end of the sheet nothing is left to move to, and the chart is drawn at
 * its data instead (charts/place.ts).
 */
registerFeatureRanges({
  key: 'chart-anchors',
  *ranges(doc, sheetId) {
    const s = sheetsOf(doc).get(sheetId);
    const charts = s ? field(s, 'charts') : undefined;
    const rows = s ? field(s, 'rowOrder') : undefined;
    const cols = s ? field(s, 'colOrder') : undefined;
    if (!charts || !rows || !cols || rows.length === 0 || cols.length === 0) return;
    const lastRow = rows.get(rows.length - 1)!;
    const lastCol = cols.get(cols.length - 1)!;
    for (const [key, value] of [...charts.entries()]) {
      const a = (value as ChartSpec).anchor;
      yield {
        rect: { r1: a.row, c1: a.col, r2: lastRow, c2: lastCol },
        replace(next) {
          const now = charts.get(key) as ChartSpec | undefined;
          if (!next || !now || (now.anchor.row === next.r1 && now.anchor.col === next.c1)) return;
          charts.set(key, { ...now, anchor: { ...now.anchor, row: next.r1, col: next.c1 } });
        }
      };
    }
  }
});

// ── evaluation ──────────────────────────────────────────────────────────────

/** A value as text, the way a criterion compares it. */
export function valueText(v: Scalar): string {
  if (v === null) return '';
  if (typeof v === 'number') return numberToText(v);
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (isError(v)) return v.code;
  return v;
}

function operand(x: number | string): Scalar {
  return x;
}

export function compares(v: Scalar, op: Comparison, a: number | string, b?: number | string): boolean {
  if (isError(v)) return false;
  const c = (x: number | string) => compare(v, operand(x));
  switch (op) {
    case 'gt':
      return c(a) > 0;
    case 'ge':
      return c(a) >= 0;
    case 'lt':
      return c(a) < 0;
    case 'le':
      return c(a) <= 0;
    case 'eq':
      return c(a) === 0;
    case 'ne':
      return c(a) !== 0;
    case 'between':
    case 'notBetween': {
      const lo = b === undefined ? a : compare(operand(a), operand(b)) <= 0 ? a : b;
      const hi = b === undefined ? a : lo === a ? b : a;
      const inside = c(lo) >= 0 && c(hi) <= 0;
      return op === 'between' ? inside : !inside;
    }
  }
}

const truthy = (v: Scalar) => v === true || (typeof v === 'number' && v !== 0);

function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mix(a: string, b: string, t: number): string {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  if (!x || !y) return t < 0.5 ? a : b;
  const c = x.map((v, i) => Math.round(v + (y[i]! - v) * t));
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

interface Resolved<T> {
  id: string;
  rule: T;
  rects: Rect[];
}

const inside = (rects: Rect[], r: number, c: number) => rects.some((x) => r >= x.r1 && r <= x.r2 && c >= x.c1 && c <= x.c2);

/**
 * One sheet's rules at one version: resolved to today's indexes once, and each rule's
 * statistics (the duplicates, the top ten, the average) once, when a cell first asks.
 */
export class FeatureView {
  private cf: Resolved<CfRule>[] | null = null;
  private val: Resolved<ValidationRule>[] | null = null;
  private stats = new Map<string, unknown>();
  private filterState: { headerRow: number; cols: number[]; active: number[]; hidden: Set<number> } | null | undefined;

  constructor(
    private readonly engine: Engine,
    private readonly sheetId: string,
    private readonly map: SheetMap,
    /** What a cell shows, for a filter's ticked values. */
    private readonly display: (rowId: string, colId: string) => string
  ) {}

  private resolve<T extends { ranges: IdRect[] }>(m: Y.Map<unknown> | undefined): Resolved<T>[] {
    const sheet = this.engine.sheet(this.sheetId);
    if (!m || !sheet || m.size === 0) return [];
    const out: Resolved<T>[] = [];
    for (const [id, raw] of m.entries()) {
      const rule = raw as T;
      const rects = (rule.ranges ?? []).map((r) => resolveRect(sheet, r)).filter((r): r is Rect => r !== null);
      if (rects.length) out.push({ id, rule, rects });
    }
    return out;
  }

  private value(r: number, c: number): Scalar {
    const sheet = this.engine.sheet(this.sheetId)!;
    const rowId = sheet.rowOrder[r];
    const colId = sheet.colOrder[c];
    return rowId && colId ? (sheet.cell(rowId, colId)?.value ?? null) : null;
  }

  private eachValue(rects: Rect[], visit: (v: Scalar) => void): void {
    const sheet = this.engine.sheet(this.sheetId)!;
    const ri = sheet.rowIndex();
    for (const x of rects) {
      for (let c = x.c1; c <= x.c2; c++) {
        const col = sheet.cols.get(sheet.colOrder[c] ?? '');
        if (!col) continue;
        for (const [rowId, cell] of col) {
          const r = ri.get(rowId);
          if (r !== undefined && r >= x.r1 && r <= x.r2) visit(cell.value);
        }
      }
    }
  }

  hasRules(): boolean {
    return (field(this.map, 'cf')?.size ?? 0) > 0;
  }

  /** The conditional formats' decision for one cell, or undefined. */
  conditional(r: number, c: number): CfStyle | undefined {
    this.cf ??= this.resolve<CfRule>(field(this.map, 'cf')).sort((a, b) => a.rule.priority - b.rule.priority || (a.id < b.id ? -1 : 1));
    if (!this.cf.length) return undefined;
    let out: CfStyle | undefined;
    for (const res of this.cf) {
      if (!inside(res.rects, r, c)) continue;
      const v = this.value(r, c);
      const hit = this.matches(res, r, c, v);
      if (!hit) continue;
      // Earlier rules win a field; later ones fill in what earlier ones left.
      out = { ...hit, ...(out ?? {}) };
      if (res.rule.stop) break;
    }
    return out;
  }

  private matches(res: Resolved<CfRule>, r: number, c: number, v: Scalar): CfStyle | null {
    const { rule } = res;
    const w = rule.when;
    const yes = (b: boolean) => (b ? rule.style : null);
    switch (w.kind) {
      case 'cell':
        return v === null ? null : yes(compares(v, w.op, w.a, w.b));
      case 'text': {
        const t = valueText(v).toLowerCase();
        const s = w.text.toLowerCase();
        const has = w.op === 'begins' ? t.startsWith(s) : w.op === 'ends' ? t.endsWith(s) : t.includes(s);
        return yes(w.op === 'notContains' ? !has : has);
      }
      case 'blank':
        return yes(v === null || v === '');
      case 'notBlank':
        return yes(!(v === null || v === ''));
      case 'error':
        return yes(isError(v));
      case 'notError':
        return yes(!isError(v));
      case 'formula':
        return yes(truthy(this.formulaAt(res, w.f, r, c)));
      case 'duplicate':
      case 'unique': {
        if (v === null) return null;
        const counts = this.stat(res.id, () => {
          const m = new Map<string, number>();
          this.eachValue(res.rects, (x) => {
            if (x === null) return;
            const k = valueText(x).toLowerCase();
            m.set(k, (m.get(k) ?? 0) + 1);
          });
          return m;
        });
        const n = counts.get(valueText(v).toLowerCase()) ?? 0;
        return yes(w.kind === 'duplicate' ? n > 1 : n === 1);
      }
      case 'top': {
        if (typeof v !== 'number') return null;
        const cut = this.stat(res.id, () => {
          const xs: number[] = [];
          this.eachValue(res.rects, (x) => typeof x === 'number' && xs.push(x));
          xs.sort((a, b) => (w.bottom ? a - b : b - a));
          const k = Math.max(1, w.percent ? Math.floor((xs.length * w.n) / 100) : w.n);
          return xs.length ? xs[Math.min(k, xs.length) - 1]! : null;
        });
        return cut === null ? null : yes(w.bottom ? v <= cut : v >= cut);
      }
      case 'average': {
        if (typeof v !== 'number') return null;
        const mean = this.stat(res.id, () => {
          let sum = 0;
          let n = 0;
          this.eachValue(res.rects, (x) => {
            if (typeof x === 'number') {
              sum += x;
              n++;
            }
          });
          return n ? sum / n : null;
        });
        return mean === null ? null : yes(w.below ? v < mean : v > mean);
      }
      case 'scale': {
        if (typeof v !== 'number') return null;
        const span = this.stat(res.id, () => {
          const xs: number[] = [];
          this.eachValue(res.rects, (x) => typeof x === 'number' && xs.push(x));
          xs.sort((a, b) => a - b);
          return xs.length ? { lo: xs[0]!, mid: xs[Math.floor((xs.length - 1) / 2)]!, hi: xs[xs.length - 1]! } : null;
        });
        if (!span) return null;
        let fill: string;
        if (w.mid !== undefined) {
          fill =
            v <= span.mid
              ? mix(w.min, w.mid, span.mid === span.lo ? 0 : (v - span.lo) / (span.mid - span.lo))
              : mix(w.mid, w.max, span.hi === span.mid ? 1 : (v - span.mid) / (span.hi - span.mid));
        } else fill = mix(w.min, w.max, span.hi === span.lo ? 0 : (v - span.lo) / (span.hi - span.lo));
        return { fill };
      }
      case 'bar': {
        if (typeof v !== 'number') return null;
        const span = this.stat(res.id, () => {
          let lo = 0;
          let hi = 0;
          this.eachValue(res.rects, (x) => {
            if (typeof x !== 'number') return;
            if (x < lo) lo = x;
            if (x > hi) hi = x;
          });
          return hi === lo ? null : { lo, hi };
        });
        if (!span) return null;
        // The axis is where zero is: a bar grows from it, left for a negative and right for the rest.
        const at = (n: number) => (n - span.lo) / (span.hi - span.lo);
        const a = at(0);
        const p = at(v);
        if (p === a) return null;
        return { bar: { from: Math.min(a, p), to: Math.max(a, p), color: v < 0 ? (w.negative ?? w.color) : w.color } };
      }
    }
  }

  private stat<T>(id: string, make: () => T): T {
    if (!this.stats.has(id)) this.stats.set(id, make());
    return this.stats.get(id) as T;
  }

  /** A rule's formula read at (r, c): written for the first range's top-left, shifted as a copy. */
  private formulaAt(res: { rects: Rect[] }, f: string, r: number, c: number): Scalar {
    const sheet = this.engine.sheet(this.sheetId)!;
    const top = res.rects[0]!;
    try {
      const s = this.engine.shiftFormula(f, { sheetId: this.sheetId, row: top.r1, col: top.c1 }, { sheetId: this.sheetId, row: r, col: c });
      if (s.kind !== 'formula') return null;
      return this.engine.evaluateAt(this.sheetId, sheet.rowOrder[r]!, sheet.colOrder[c]!, s.formula);
    } catch {
      return null;
    }
  }

  // ── validation ──

  validationAt(r: number, c: number): ValidationRule | undefined {
    this.val ??= this.resolve<ValidationRule>(field(this.map, 'validation')).sort((a, b) => (a.id < b.id ? -1 : 1));
    return this.val.find((v) => inside(v.rects, r, c))?.rule;
  }

  /** The choices of a list rule at (r, c), or null when it has none. */
  listChoices(r: number, c: number): string[] | null {
    const rule = this.validationAt(r, c);
    if (!rule) return null;
    const check = rule.check;
    if (check.kind === 'list') return check.items;
    if (check.kind !== 'listRange') return null;
    const sheet = this.engine.sheet(check.sheet);
    const rect = sheet ? resolveRect(sheet, check.range) : null;
    if (!sheet || !rect) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (let rr = rect.r1; rr <= rect.r2; rr++) {
      for (let cc = rect.c1; cc <= rect.c2; cc++) {
        const t = valueText(sheet.cell(sheet.rowOrder[rr]!, sheet.colOrder[cc]!)?.value ?? null);
        if (t && !seen.has(t)) {
          seen.add(t);
          out.push(t);
        }
      }
    }
    return out;
  }

  /** Whether a value passes the rule at (r, c). A formula's result is not checked, as in Excel. */
  passes(r: number, c: number, v: Scalar, formula: boolean): { ok: true } | { ok: false; rule: ValidationRule } {
    const rule = this.validationAt(r, c);
    if (!rule || formula) return { ok: true };
    const ok = (b: boolean) => (b ? ({ ok: true } as const) : ({ ok: false, rule } as const));
    if (v === null || v === '') return ok(rule.allowBlank !== false);
    const check = rule.check;
    switch (check.kind) {
      case 'list':
      case 'listRange': {
        const t = valueText(v).toLowerCase();
        return ok((this.listChoices(r, c) ?? []).some((x) => x.toLowerCase() === t));
      }
      case 'number':
      case 'date':
        return ok(typeof v === 'number' && compares(v, check.op, check.a, check.b));
      case 'integer':
        return ok(typeof v === 'number' && Number.isInteger(v) && compares(v, check.op, check.a, check.b));
      case 'textLength':
        return ok(compares(valueText(v).length, check.op, check.a, check.b));
      case 'formula':
        return ok(truthy(this.formulaAt({ rects: this.val!.find((x) => x.rule === rule)!.rects }, check.f, r, c)));
    }
  }

  // ── filter ──

  /** The filter's rectangle and the criteria its columns carry, or null when there is no filter. */
  private filterParts(): { sheet: Sheet; rect: Rect; criteria: FilterTest[] } | null {
    const m = field(this.map, 'filter');
    const sheet = this.engine.sheet(this.sheetId);
    const range = m?.get(FILTER_RANGE) as IdRect | undefined;
    const rect = sheet && range ? resolveRect(sheet, range) : null;
    if (!m || !sheet || !rect) return null;
    const criteria: FilterTest[] = [];
    for (let c = rect.c1; c <= rect.c2; c++) {
      const colId = sheet.colOrder[c]!;
      const crit = m.get(filterKey(colId)) as FilterCriterion | undefined;
      if (!crit) continue;
      criteria.push(crit.kind === 'values' ? { col: c, colId, crit, hidden: new Set(crit.hidden) } : { col: c, colId, crit });
    }
    return { sheet, rect, criteria };
  }

  /** Whether a row's cell in `k`'s column passes `k`'s criterion. */
  private passesFilter(sheet: Sheet, rowId: string, k: FilterTest): boolean {
    const crit = k.crit;
    switch (crit.kind) {
      case 'values':
        return !k.hidden!.has(this.display(rowId, k.colId));
      case 'condition':
        return compares(sheet.cell(rowId, k.colId)?.value ?? null, crit.op, crit.a, crit.b);
      case 'text': {
        const t = this.display(rowId, k.colId).toLowerCase();
        const s = crit.text.toLowerCase();
        const has = crit.op === 'begins' ? t.startsWith(s) : crit.op === 'ends' ? t.endsWith(s) : t.includes(s);
        return crit.op === 'notContains' ? !has : has;
      }
      case 'blank': {
        const v = sheet.cell(rowId, k.colId)?.value ?? null;
        const blank = v === null || v === '';
        return crit.not ? !blank : blank;
      }
    }
  }

  filter(): { headerRow: number; cols: number[]; active: number[]; hidden: Set<number> } | null {
    if (this.filterState !== undefined) return this.filterState;
    const parts = this.filterParts();
    if (!parts) return (this.filterState = null);
    const { sheet, rect, criteria } = parts;
    const cols: number[] = [];
    for (let c = rect.c1; c <= rect.c2; c++) cols.push(c);
    const hidden = new Set<number>();
    if (criteria.length) {
      for (let r = rect.r1 + 1; r <= rect.r2; r++) {
        const rowId = sheet.rowOrder[r]!;
        if (!criteria.every((k) => this.passesFilter(sheet, rowId, k))) hidden.add(r);
      }
    }
    return (this.filterState = { headerRow: rect.r1, cols, active: criteria.map((k) => k.col), hidden });
  }

  /**
   * What a filter menu lists for one column: each value as the cells show it, how many rows hold it,
   * and the value itself to sort by. Only rows the other columns' criteria let through are counted,
   * as in Excel, so narrowing one column narrows the lists of the rest.
   */
  columnValues(col: number): { text: string; count: number; value: Scalar }[] {
    const parts = this.filterParts();
    if (!parts) return [];
    const { sheet, rect, criteria } = parts;
    const colId = sheet.colOrder[col];
    if (!colId || col < rect.c1 || col > rect.c2) return [];
    const others = criteria.filter((k) => k.col !== col);
    const seen = new Map<string, { text: string; count: number; value: Scalar }>();
    for (let r = rect.r1 + 1; r <= rect.r2; r++) {
      const rowId = sheet.rowOrder[r]!;
      if (!others.every((k) => this.passesFilter(sheet, rowId, k))) continue;
      const text = this.display(rowId, colId);
      const hit = seen.get(text);
      if (hit) hit.count++;
      else seen.set(text, { text, count: 1, value: sheet.cell(rowId, colId)?.value ?? null });
    }
    return [...seen.values()].sort((a, b) => {
      // Blanks last, then Excel's own order of values.
      if (a.text === '' || b.text === '') return a.text === b.text ? 0 : a.text === '' ? 1 : -1;
      return compare(a.value, b.value) || (a.text < b.text ? -1 : 1);
    });
  }
}

interface FilterTest {
  col: number;
  colId: string;
  crit: FilterCriterion;
  hidden?: Set<string>;
}
