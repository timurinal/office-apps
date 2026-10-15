/**
 * Formats: one table per workbook, keyed by content.
 *
 * A cell, a row or a column names a format by id: `s` on a stored cell, `rowStyles` and
 * `colStyles` in the structure. The id is a hash of the format's canonical JSON, so two people
 * who make the same format at once write the same entry, and a format is stored once however
 * many cells wear it. An entry is never changed or removed: a cell that drops a format leaves
 * it for every other cell that wears it, and an undo that brings the format back finds it.
 *
 * What a cell looks like is its column's format, then its row's, then its own, field by field
 * (`effective`). A layer may say `null` for a field: "the default here, whatever is
 * underneath". That is how clearing the formats of one cell in a coloured row works without
 * touching the row.
 */

import type * as Y from 'yjs';
import type { BorderSide, CellStyle } from '../grid/types';
import { stylesOf } from './structure';

export type StoredStyle = { [K in keyof CellStyle]?: CellStyle[K] | null };

const KEYS = [
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

const BORDERS = new Set<string>(['borderTop', 'borderRight', 'borderBottom', 'borderLeft']);

function cleanBorder(b: BorderSide): BorderSide {
  return b.color ? { line: b.line, color: b.color } : { line: b.line };
}

/** The same format always in the same shape: fields in one order, nothing undefined. */
export function canonical(style: StoredStyle): StoredStyle {
  const out: Record<string, unknown> = {};
  for (const k of KEYS) {
    const v = style[k];
    if (v === undefined) continue;
    out[k] = v !== null && BORDERS.has(k) ? cleanBorder(v as BorderSide) : v;
  }
  return out as StoredStyle;
}

/** cyrb53: 53 bits of a string, for an id; not for anything secret. */
function hash53(s: string, seed = 0): number {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/** The table's key for a canonical JSON. */
export function styleKey(json: string): string {
  return `y${hash53(json).toString(36)}`;
}

/**
 * The id of a format, writing it to the table when it is new. Call inside the step's
 * transaction. A hash that is taken by a different format (it will not happen, but the cost of
 * it happening is a cell wearing someone else's format) moves to the next free suffix, which
 * every client computes the same from the same table.
 */
export function internStyle(doc: Y.Doc, style: StoredStyle): string {
  const c = canonical(style);
  const json = JSON.stringify(c);
  const table = stylesOf(doc);
  const base = styleKey(json);
  for (let i = 0; ; i++) {
    const id = i === 0 ? base : `${base}-${i}`;
    const have = table.get(id);
    if (have === undefined) {
      table.set(id, c);
      return id;
    }
    if (JSON.stringify(canonical(have)) === json) return id;
  }
}

const LINES = new Set(['thin', 'medium', 'thick', 'dashed', 'dotted', 'double']);
const H = new Set(['general', 'left', 'center', 'right']);
const V = new Set(['top', 'middle', 'bottom']);
const shortText = (x: unknown, max: number): x is string => typeof x === 'string' && x.length > 0 && x.length <= max;

/**
 * A format from outside (a clipboard, a file), with every field checked for its type and
 * length and everything else dropped, so what reaches the table is only ever a format.
 */
export function cleanStyle(raw: unknown): StoredStyle {
  if (typeof raw !== 'object' || raw === null) return {};
  const r = raw as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of KEYS) {
    const v = r[k];
    if (v === undefined) continue;
    if (v === null) out[k] = null;
    else if (k === 'bold' || k === 'italic' || k === 'underline' || k === 'strike' || k === 'wrap') {
      if (typeof v === 'boolean') out[k] = v;
    } else if (k === 'size') {
      if (typeof v === 'number' && v >= 1 && v <= 409) out[k] = Math.round(v * 2) / 2;
    } else if (k === 'indent') {
      if (typeof v === 'number' && v >= 0 && v <= 15) out[k] = Math.round(v);
    } else if (k === 'h') {
      if (typeof v === 'string' && H.has(v)) out[k] = v;
    } else if (k === 'v') {
      if (typeof v === 'string' && V.has(v)) out[k] = v;
    } else if (k === 'font' || k === 'color' || k === 'fill') {
      if (shortText(v, 64)) out[k] = v;
    } else if (k === 'numFmt') {
      if (shortText(v, 255)) out[k] = v;
    } else if (BORDERS.has(k)) {
      const b = v as { line?: unknown; color?: unknown };
      if (typeof b === 'object' && typeof b.line === 'string' && LINES.has(b.line)) {
        out[k] = shortText(b.color, 64) ? { line: b.line, color: b.color } : { line: b.line };
      }
    }
  }
  return out as StoredStyle;
}

/** `base` with `patch` laid over it; undefined in the patch leaves a field as it was. */
export function patchStyle(base: StoredStyle | undefined, patch: StoredStyle): StoredStyle {
  const out: Record<string, unknown> = { ...(base ?? {}) };
  for (const k of KEYS) if (patch[k] !== undefined) out[k] = patch[k];
  return out as StoredStyle;
}

/**
 * A format without its nulls where nothing underneath says otherwise. A null is "the default here,
 * whatever is underneath", and means something only above a layer that sets the field; anywhere
 * else it is a field that was switched off, so keeping it would leave a format behind on a cell
 * that looks like it has none.
 */
export function dropIdleNulls(style: StoredStyle, under: CellStyle | undefined): StoredStyle {
  const out: Record<string, unknown> = {};
  for (const k of KEYS) {
    const v = style[k];
    if (v === undefined) continue;
    if (v === null && under?.[k] === undefined) continue;
    out[k] = v;
  }
  return out as StoredStyle;
}

/** A format with every field that `over` sets reset to the default, for clearing one cell in a formatted row. */
export function resetting(over: StoredStyle): StoredStyle {
  const out: Record<string, null> = {};
  for (const k of KEYS) if (over[k] !== undefined && over[k] !== null) out[k] = null;
  return out as StoredStyle;
}

export const EMPTY_STYLE: CellStyle = Object.freeze({}) as CellStyle;

/**
 * What cells look like, interned: two cells that look the same get the same object, so the
 * grid may compare them by identity. Entries never change, so a cache by the three ids is never
 * wrong, except when a cell names a format whose entry has not arrived yet; `stylesChanged`
 * drops the cache for that.
 */
export class StyleBook {
  private readonly byLayers = new Map<string, CellStyle>();
  private readonly byJson = new Map<string, CellStyle>();

  constructor(private readonly doc: Y.Doc) {}

  get(id: string | undefined): StoredStyle | undefined {
    return id === undefined ? undefined : stylesOf(this.doc).get(id);
  }

  /** Column, then row, then the cell's own, field by field; null means the default. */
  effective(col: string | undefined, row: string | undefined, cell: string | undefined): CellStyle {
    if (col === undefined && row === undefined && cell === undefined) return EMPTY_STYLE;
    const key = `${col ?? ''}|${row ?? ''}|${cell ?? ''}`;
    const hit = this.byLayers.get(key);
    if (hit) return hit;
    const merged: Record<string, unknown> = {};
    for (const layer of [this.get(col), this.get(row), this.get(cell)]) {
      if (!layer) continue;
      for (const k of KEYS) if (layer[k] !== undefined) merged[k] = layer[k];
    }
    for (const k of Object.keys(merged)) if (merged[k] === null) delete merged[k];
    const json = JSON.stringify(canonical(merged as StoredStyle));
    let style = this.byJson.get(json);
    if (!style) {
      style = json === '{}' ? EMPTY_STYLE : (Object.freeze(canonical(merged as StoredStyle)) as CellStyle);
      this.byJson.set(json, style);
    }
    this.byLayers.set(key, style);
    return style;
  }

  stylesChanged(): void {
    this.byLayers.clear();
  }
}
