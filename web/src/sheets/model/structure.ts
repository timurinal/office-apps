/**
 * The structure document: the part of a workbook that lives in Yjs, and the helpers that read
 * and write it. Cells do not live here (shared/cells.ts); everything
 * else does, so two people inserting rows, resizing columns and adding sheets at once merge
 * the way Yjs merges.
 *
 * ── The layout ──────────────────────────────────────────────────────────────
 *
 *   sheetOrder    Y.Array<string>        sheet ids, in tab order
 *   sheets        Y.Map<Y.Map>           sheet id → the sheet:
 *     name          string
 *     rowOrder      Y.Array<string>      row ids, top to bottom
 *     colOrder      Y.Array<string>      column ids, left to right
 *     heights       Y.Map<number>        row id → CSS px at 100%; absent is the default
 *     widths        Y.Map<number>        column id → CSS px
 *     hiddenRows    Y.Map<true>          row id → hidden
 *     hiddenCols    Y.Map<true>
 *     rowStyles     Y.Map<string>        row id → style id, the row's own format
 *     colStyles     Y.Map<string>        column id → style id
 *     merges        Y.Map<IdRect>        merge id → its corners, by id
 *     frozenRows    number               rows frozen at the top, as a count
 *     frozenCols    number
 *     tab           string               the tab's colour, CSS; absent is none
 *     hidden        boolean              the tab is hidden
 *     cf            Y.Map<CfRule>          rule id → conditional format (features.ts)
 *     validation    Y.Map<ValidationRule>  rule id → data validation
 *     filter        Y.Map                  'range' → IdRect, `c:<column id>` → FilterCriterion
 *     charts        Y.Map<ChartSpec>       chart id → chart
 *   styles        Y.Map<StoredStyle>     style id → a format, keyed by a hash of its canonical
 *                                        JSON (styles.ts); written once and never changed
 *   names         Y.Map<StoredName>      `<scope>!<NAME>` → a defined name; scope is a sheet id,
 *                                        empty for the workbook
 *
 * Every map of a sheet is made with the sheet. A feature never creates one itself: two people
 * creating the same map at once would each make their own, and one of them would be lost.
 *
 * ── Ranges a feature keeps ──────────────────────────────────────────────────
 * A merge, a conditional format, a validation, a filter and a chart each hold a rectangle by
 * the ids of its corners (`IdRect`), so an insert anywhere leaves it whole and a row inserted
 * inside it widens it, as a formula's range does. `resolveRect` turns one into today's indexes
 * and answers null when a corner's line is gone. A delete moves every such corner off the
 * deleted lines in the same step, through `shrinkFeatureRanges`; a feature takes part by
 * calling `registerFeatureRanges` once.
 */

import * as Y from 'yjs';
import type { Rect } from '../grid/types';
import type { StoredStyle } from './styles';

/** An inclusive rectangle by the ids of its top-left and bottom-right lines. */
export interface IdRect {
  r1: string;
  c1: string;
  r2: string;
  c2: string;
}

export interface StoredName {
  name: string;
  /** A sheet id for a sheet-level name. */
  scope?: string;
  /** The engine's stored form, `=` and ids. */
  f: string;
}

/** The typed fields of one sheet's map. */
export interface SheetFields {
  name: string;
  rowOrder: Y.Array<string>;
  colOrder: Y.Array<string>;
  heights: Y.Map<number>;
  widths: Y.Map<number>;
  hiddenRows: Y.Map<true>;
  hiddenCols: Y.Map<true>;
  rowStyles: Y.Map<string>;
  colStyles: Y.Map<string>;
  merges: Y.Map<IdRect>;
  frozenRows: number;
  frozenCols: number;
  tab: string;
  hidden: boolean;
  cf: Y.Map<unknown>;
  validation: Y.Map<unknown>;
  filter: Y.Map<unknown>;
  charts: Y.Map<unknown>;
}

export type SheetMap = Y.Map<unknown>;

export const sheetOrderOf = (doc: Y.Doc): Y.Array<string> => doc.getArray<string>('sheetOrder');
export const sheetsOf = (doc: Y.Doc): Y.Map<SheetMap> => doc.getMap<SheetMap>('sheets');
export const stylesOf = (doc: Y.Doc): Y.Map<StoredStyle> => doc.getMap<StoredStyle>('styles');
export const namesOf = (doc: Y.Doc): Y.Map<StoredName> => doc.getMap<StoredName>('names');

export function field<K extends keyof SheetFields>(sheet: SheetMap, key: K): SheetFields[K] | undefined {
  return sheet.get(key) as SheetFields[K] | undefined;
}

/** A sheet's sub-map or array, which every sheet has from birth. */
export function part<K extends Exclude<keyof SheetFields, 'name' | 'frozenRows' | 'frozenCols' | 'tab' | 'hidden'>>(
  sheet: SheetMap,
  key: K
): SheetFields[K] {
  const v = sheet.get(key);
  if (!v) throw new Error(`A sheet without ${key}`);
  return v as SheetFields[K];
}

export const nameKey = (name: string, scope?: string): string => `${scope ?? ''}!${name.toUpperCase()}`;

/** The size a line has when nobody set one: the Sheets board's grid. */
export const DEFAULT_ROW_HEIGHT = 26;
export const DEFAULT_COL_WIDTH = 112;
/** A new sheet's size, as in Google Sheets. */
export const NEW_SHEET_ROWS = 1000;
export const NEW_SHEET_COLS = 26;

// ── ids ─────────────────────────────────────────────────────────────────────

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/**
 * A fresh id: 8 random base-62 characters, so two people who insert rows at once never pick the
 * same one (about one chance in 10^4 of a clash anywhere in a million-row sheet). A seed's ids
 * are sequential and at most 4 characters (`seqId`), so the two kinds can never meet. Never `_`,
 * which the engine uses for a line that does not exist yet.
 */
export function newId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  let s = '';
  for (const b of bytes) s += ALPHABET[b % 62];
  return s;
}

export function newIds(n: number): string[] {
  const out = new Array<string>(n);
  for (let i = 0; i < n; i++) out[i] = newId();
  return out;
}

/** The i-th id of a seed: base 36, short, because a 100k-row import spends a byte per character per row. */
export const seqId = (i: number): string => i.toString(36);

// ── sheets ──────────────────────────────────────────────────────────────────

export interface NewSheet {
  id: string;
  name: string;
  rows: readonly string[];
  cols: readonly string[];
  /** Tab position; the end when absent. */
  at?: number;
}

/** Adds a sheet with every map it will ever have. Call inside a transaction. */
export function createSheet(doc: Y.Doc, s: NewSheet): SheetMap {
  const m = new Y.Map<unknown>();
  m.set('name', s.name);
  const rows = new Y.Array<string>();
  rows.push([...s.rows]);
  const cols = new Y.Array<string>();
  cols.push([...s.cols]);
  m.set('rowOrder', rows);
  m.set('colOrder', cols);
  for (const k of ['heights', 'widths', 'hiddenRows', 'hiddenCols', 'rowStyles', 'colStyles', 'merges', 'cf', 'validation', 'filter', 'charts']) {
    m.set(k, new Y.Map());
  }
  m.set('frozenRows', 0);
  m.set('frozenCols', 0);
  sheetsOf(doc).set(s.id, m);
  const order = sheetOrderOf(doc);
  order.insert(Math.max(0, Math.min(s.at ?? order.length, order.length)), [s.id]);
  return m;
}

/**
 * The sheets in tab order: the order array without repeats or sheets that are gone, then any
 * sheet the array lost (two people moving one tab at once can leave it twice or not at all).
 */
export function sheetIdsInOrder(doc: Y.Doc): string[] {
  const sheets = sheetsOf(doc);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of sheetOrderOf(doc).toArray()) {
    if (!seen.has(id) && sheets.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  for (const id of [...sheets.keys()].sort()) if (!seen.has(id)) out.push(id);
  return out;
}

/** The first occurrence of each id. Two people moving the same row at once leave it twice. */
export function dedupe(ids: readonly string[]): { ids: string[]; repeats: boolean } {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return { ids: out, repeats: out.length !== ids.length };
}

// ── rectangles by id ────────────────────────────────────────────────────────

export interface Orders {
  rowOrder: readonly string[];
  colOrder: readonly string[];
  rowIndex(): Map<string, number>;
  colIndex(): Map<string, number>;
}

/** Today's indexes of a rectangle held by id, or null when a corner's line is gone. */
export function resolveRect(sheet: Orders, rect: IdRect): Rect | null {
  const ri = sheet.rowIndex();
  const ci = sheet.colIndex();
  const a = ri.get(rect.r1);
  const b = ri.get(rect.r2);
  const c = ci.get(rect.c1);
  const d = ci.get(rect.c2);
  if (a === undefined || b === undefined || c === undefined || d === undefined) return null;
  return { r1: Math.min(a, b), r2: Math.max(a, b), c1: Math.min(c, d), c2: Math.max(c, d) };
}

/** The ids at a rectangle's corners today, or null when it reaches past the sheet. */
export function toIdRect(sheet: Orders, rect: Rect): IdRect | null {
  const r1 = sheet.rowOrder[rect.r1];
  const r2 = sheet.rowOrder[rect.r2];
  const c1 = sheet.colOrder[rect.c1];
  const c2 = sheet.colOrder[rect.c2];
  return r1 && r2 && c1 && c2 ? { r1, c1, r2, c2 } : null;
}

// ── the registry of feature ranges ──────────────────────────────────────────

export interface RangeHolder {
  rect: IdRect;
  /** Write the moved rectangle, or null when every line under it went. */
  replace(next: IdRect | null): void;
}

export interface FeatureRanges {
  key: string;
  /** Each rectangle the feature keeps on the sheet `sheetId`, wherever the feature itself lives. */
  ranges(doc: Y.Doc, sheetId: string): Iterable<RangeHolder>;
}

const registry = new Map<string, FeatureRanges>();

/** Once per feature, at module load. A second registration under one key replaces the first. */
export function registerFeatureRanges(f: FeatureRanges): void {
  registry.set(f.key, f);
}

/**
 * Inside a delete's transaction, before the lines go: every feature's rectangle on the sheet
 * moves its corners off the deleted lines, to the nearest line that survives inside it, as the
 * engine moves a formula's range (`planDeleteRows`). A rectangle wholly inside the deleted
 * lines is replaced with null. `order` is the axis as it is before the delete.
 */
export function shrinkFeatureRanges(
  doc: Y.Doc,
  sheetId: string,
  axis: 'rows' | 'cols',
  order: readonly string[],
  index: number,
  count: number
): void {
  const last = index + count - 1;
  const gone = new Set(order.slice(index, last + 1));
  let pos: Map<string, number> | null = null;
  const at = (id: string) => {
    if (!pos) {
      pos = new Map();
      order.forEach((x, i) => pos!.set(x, i));
    }
    return pos.get(id);
  };
  for (const f of registry.values()) {
    for (const h of [...f.ranges(doc, sheetId)]) {
      const [ka, kb] = axis === 'rows' ? (['r1', 'r2'] as const) : (['c1', 'c2'] as const);
      const a = h.rect[ka];
      const b = h.rect[kb];
      if (!gone.has(a) && !gone.has(b)) continue;
      const x = at(a);
      const y = at(b);
      if (x === undefined || y === undefined) continue;
      const lo = Math.min(x, y);
      const hi = Math.max(x, y);
      if (lo >= index && hi <= last) {
        h.replace(null);
        continue;
      }
      const top = order[lo < index ? lo : last + 1]!;
      const bottom = order[hi > last ? hi : index - 1]!;
      const [na, nb] = x <= y ? [top, bottom] : [bottom, top];
      h.replace({ ...h.rect, [ka]: na, [kb]: nb });
    }
  }
}

/** The holders of every rectangle in one of a sheet's maps whose values are, or contain, IdRects. */
export function* mapRanges<T>(
  map: Y.Map<T> | Y.Map<unknown> | undefined,
  rects: (value: T) => IdRect[],
  rebuild: (value: T, next: (IdRect | null)[]) => T | null
): Iterable<RangeHolder> {
  if (!map) return;
  const m = map as Y.Map<T>;
  for (const [key, value] of m.entries()) {
    const list = rects(value);
    for (let i = 0; i < list.length; i++) {
      yield {
        rect: list[i]!,
        // Rewrites one rectangle of the value as it is in the map by then, so a value with
        // two rectangles that both move ends with both moved.
        replace(next: IdRect | null) {
          const now = m.get(key);
          if (now === undefined) return;
          const current: (IdRect | null)[] = rects(now);
          current[i] = next;
          const out = rebuild(now, current);
          if (out === null) m.delete(key);
          else m.set(key, out);
        }
      };
    }
  }
}

registerFeatureRanges({
  key: 'merges',
  ranges: (doc, sheetId) => {
    const sheet = sheetsOf(doc).get(sheetId);
    return mapRanges<IdRect>(
      sheet ? field(sheet, 'merges') : undefined,
      (r) => [r],
      // A merge left one cell wide and tall is no merge.
      (_r, next) => {
        const r = next[0];
        return r && !(r.r1 === r.r2 && r.c1 === r.c2) ? r : null;
      }
    );
  }
});
