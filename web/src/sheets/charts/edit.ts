/**
 * Making a chart and changing one: each function here is one model call, so each is one undoable
 * step and one frame to the room, and a person's drag or a pane's switch is never half-saved.
 *
 * `insertChart` is Insert > Charts: it reads the selection the way a person means it (series.ts),
 * stores a chart beside the data and selects it. The rest take a chart as the store holds it and write
 * the whole spec back, because a chart is one entry in a Yjs map and a field written alone would
 * have no history of its own.
 */

import { parseAddress, rectAddress } from '../grid/a1';
import type { Rect } from '../grid/types';
import type { GridSession } from '../grid';
import type { SheetModel } from '../model';
import { type IdRect, resolveRect, toIdRect } from '../model/structure';
import type { Toast } from '../../core/ui';
import { DEFAULT_H, DEFAULT_W } from './layout';
import { clampSize, defaultAnchor } from './place';
import { currentRegion, defaultTitle, detectLayout, readData } from './series';
import { type ChartEntry, chartStoreFor, viewReader } from './store';
import type { ChartOptions, ChartSpec, ChartType, Reader } from './types';

// ── a selection, to a block ─────────────────────────────────────────────────

const lineFilled = (reader: Reader, vertical: boolean, at: number, from: number, to: number): boolean => {
  for (let k = from; k <= to; k++) {
    const c = vertical ? reader.cell(k, at) : reader.cell(at, k);
    if (c && !c.error && c.v !== null && !(typeof c.v === 'string' && c.v.trim() === '')) return true;
  }
  return false;
};

/** The selection without its empty edge rows and columns, which a whole-column selection is mostly made of. */
export function trimToData(rect: Rect, reader: Reader, used: Rect | null): Rect | null {
  const r: Rect = { ...rect };
  if (used) {
    r.r2 = Math.min(r.r2, used.r2);
    r.c2 = Math.min(r.c2, used.c2);
  }
  while (r.r1 <= r.r2 && !lineFilled(reader, false, r.r1, r.c1, r.c2)) r.r1++;
  while (r.r2 >= r.r1 && !lineFilled(reader, false, r.r2, r.c1, r.c2)) r.r2--;
  while (r.c1 <= r.c2 && !lineFilled(reader, true, r.c1, r.r1, r.r2)) r.c1++;
  while (r.c2 >= r.c1 && !lineFilled(reader, true, r.c2, r.r1, r.r2)) r.c2--;
  return r.r1 <= r.r2 && r.c1 <= r.c2 ? r : null;
}

/** What Insert reads of the page. A test builds the little it needs. */
export interface InsertContext {
  model: SheetModel;
  sheetId: string;
  selection: () => { rect: Rect; active: { row: number; col: number } };
  session: Pick<GridSession, 'layer'>;
  notify: (toast: Toast) => void;
}

/**
 * Insert > Charts. A selection of one cell stands for the block around it; several cells for
 * themselves, less their empty edges. Nothing to plot is said once and nothing is made.
 * Answers the new chart's id.
 */
export function insertChart(c: InsertContext, type: ChartType, variant: { stacked?: boolean } = {}): string | null {
  const view = c.model.view(c.sheetId);
  const reader = viewReader(c.model, c.sheetId);
  const { rect } = c.selection();
  const single = rect.r1 === rect.r2 && rect.c1 === rect.c2;
  const raw = single ? currentRegion(reader, { row: rect.r1, col: rect.c1 }, { rows: view.rowCount(), cols: view.colCount() }) : rect;
  const region = trimToData(raw, reader, view.usedRange?.() ?? null);
  const layout = region ? detectLayout(region, reader, type) : null;
  const sh = c.model.engine.sheet(c.sheetId);
  if (!region || !layout || !sh) {
    c.notify({ text: 'Select cells that have numbers.' });
    return null;
  }
  const idRect = toIdRect(sh, region);
  if (!idRect) return null;

  const data = readData(region, reader, { type, ...layout });
  const size = clampSize(DEFAULT_W, DEFAULT_H);
  const store = chartStoreFor(c.model);
  const anchor = defaultAnchor(c.model, c.sheetId, region, size, c.session.layer?.layout() ?? null, store.chartsOn(c.sheetId).map((e) => e.spec.anchor));
  if (!anchor) return null;

  const options: ChartOptions = { seriesIn: layout.seriesIn, headers: layout.headers, labels: layout.labels };
  if (variant.stacked) options.stacked = true;
  const spec: ChartSpec = { type, sheet: c.sheetId, data: idRect, anchor, w: size.w, h: size.h, options };
  const title = defaultTitle(data, layout);
  if (title) spec.title = title;

  const id = c.model.setRule(c.sheetId, 'charts', null, spec);
  if (!id) return null;
  store.select(id);
  return id;
}

// ── a chart, changed ────────────────────────────────────────────────────────

const write = (model: SheetModel, e: ChartEntry, spec: ChartSpec): void => void model.setRule(e.host, 'charts', e.id, spec);

/** The spec with `patch` laid over it; a key set to undefined is removed, so a stored chart never carries a blank. */
export function patched(spec: ChartSpec, patch: Partial<Omit<ChartSpec, 'options'>>): ChartSpec {
  const next: Record<string, unknown> = { ...spec, ...patch };
  for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
  return next as unknown as ChartSpec;
}

export function setOptions(spec: ChartSpec, patch: { [K in keyof ChartOptions]?: ChartOptions[K] | undefined }): ChartSpec {
  const options: Record<string, unknown> = { ...spec.options, ...patch };
  for (const k of Object.keys(options)) {
    const v = options[k];
    if (v === undefined || v === '' || (Array.isArray(v) && v.every((x) => x === ''))) delete options[k];
  }
  const next: ChartSpec = { ...spec };
  if (Object.keys(options).length > 0) next.options = options as ChartOptions;
  else delete next.options;
  return next;
}

export const setType = (model: SheetModel, e: ChartEntry, type: ChartType): void => write(model, e, patched(e.spec, { type }));

export const setTitle = (model: SheetModel, e: ChartEntry, title: string): void => write(model, e, patched(e.spec, { title: title.trim() === '' ? undefined : title }));

export const setChartOptions = (model: SheetModel, e: ChartEntry, patch: Parameters<typeof setOptions>[1]): void => write(model, e, setOptions(e.spec, patch));

/**
 * Series in rows or columns. The roles of the first row and the first column swap with it, so a
 * table that had its names on top and its categories down the side keeps both when turned.
 */
export function setSeriesIn(model: SheetModel, e: ChartEntry, seriesIn: 'cols' | 'rows'): void {
  const o = e.spec.options ?? {};
  if ((o.seriesIn ?? 'cols') === seriesIn) return;
  write(model, e, setOptions(e.spec, { seriesIn, headers: o.labels ?? true, labels: o.headers ?? true }));
}

/** Move and size in one step: a drag and a resize both end here. */
export function setBox(model: SheetModel, e: ChartEntry, box: { anchor: ChartSpec['anchor']; w: number; h: number }): void {
  const size = clampSize(box.w, box.h);
  write(model, e, { ...e.spec, anchor: box.anchor, w: size.w, h: size.h });
}

export const setData = (model: SheetModel, e: ChartEntry, sheet: string, data: IdRect): void => write(model, e, { ...e.spec, sheet, data });

export function deleteChart(model: SheetModel, e: ChartEntry): void {
  // The model answers nothing when it refused (a reader, a stopped room): the chart is still there, and still selected.
  if (model.setRule(e.host, 'charts', e.id, null) === undefined) return;
  const store = chartStoreFor(model);
  if (store.selected === e.id) store.select(null);
}

// ── the data range, as a person types it ────────────────────────────────────

const quoteName = (name: string): string => (/^[A-Za-z_][A-Za-z0-9_.]*$/.test(name) ? name : `'${name.replace(/'/g, "''")}'`);

/** `Costs!A1:C9`, or `A1:C9` when the data is on the sheet the chart sits on. Empty when the range is gone. */
export function rangeText(model: SheetModel, e: ChartEntry): string {
  const sh = model.engine.sheet(e.spec.sheet);
  const rect = sh ? resolveRect(sh, e.spec.data) : null;
  if (!rect) return '';
  const name = e.spec.sheet === e.host ? '' : `${quoteName(model.sheets().find((s) => s.id === e.spec.sheet)?.name ?? e.spec.sheet)}!`;
  return `${name}${rectAddress(rect)}`;
}

/**
 * A range as typed into the pane: `A1:C9` on the chart's own sheet, or `Sheet!A1:C9`, with the name
 * quoted when it has spaces. Null for anything that is not a block of this workbook.
 */
export function parseRange(model: SheetModel, e: ChartEntry, text: string): { sheet: string; data: IdRect } | null {
  const t = text.trim();
  const bang = t.lastIndexOf('!');
  let sheet = e.host;
  let address = t;
  if (bang >= 0) {
    const raw = t.slice(0, bang).trim();
    const name = raw.startsWith("'") && raw.endsWith("'") && raw.length >= 2 ? raw.slice(1, -1).replace(/''/g, "'") : raw;
    const found = model.sheets().find((s) => s.name.toLowerCase() === name.toLowerCase());
    if (!found) return null;
    sheet = found.id;
    address = t.slice(bang + 1);
  }
  const sh = model.engine.sheet(sheet);
  if (!sh) return null;
  const rect = parseAddress(address, sh.rowOrder.length, sh.colOrder.length);
  const data = rect ? toIdRect(sh, rect) : null;
  return data ? { sheet, data } : null;
}
