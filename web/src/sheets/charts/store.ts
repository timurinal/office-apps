/**
 * The charts of one workbook, read from the model and kept current.
 *
 * A chart is stored in its sheet's `charts` map (model/features.ts) and holds ranges as ids; what
 * it draws is read from the cells. This store is the join: for each chart it keeps the stored spec
 * and the data read from the range, and it says so only when one of them changed.
 *
 *   · It listens to `model.onDataChanged`, not to `subscribe`, so another person's cursor never
 *     reaches it, and only the charts whose data sheet changed read their cells again.
 *   · A chart whose data is unchanged after a re-read keeps its entry, so the card that draws it is
 *     not rendered: an edit outside a chart's ranges costs that chart one read and no render.
 *   · One store per model (`chartStoreFor`), attached to it while anything listens.
 *
 * The store also holds which chart is selected: the card, the pane and the keyboard all read it,
 * and it is nobody's but this page's, so it is not saved and not shared.
 */

import { useSyncExternalStore } from 'react';
import type { GridCell } from '../grid/types';
import type { SheetModel } from '../model';
import { type SheetMap, field, resolveRect, sheetIdsInOrder, sheetsOf } from '../model/structure';
import { readData } from './series';
import type { Cell, ChartData, ChartSpec, Reader } from './types';

export interface ChartEntry {
  id: string;
  /** The sheet the chart sits on. */
  host: string;
  spec: ChartSpec;
  /** Null when its range no longer resolves. */
  data: ChartData | null;
}

/** A sheet's cells as a chart reads them: through the same view the grid draws, so a chart shows what a cell shows. */
export function viewReader(model: SheetModel, sheetId: string): Reader {
  const view = model.view(sheetId);
  return {
    cell(r, c): Cell | null {
      const g: GridCell | null = view.cell(r, c);
      if (!g) return null;
      const fmt = g.style.numFmt;
      switch (g.kind) {
        case 'number':
          return { v: g.value ?? Number.NaN, text: g.text, ...(fmt ? { fmt } : {}) };
        case 'text':
          return { v: g.text, text: g.text };
        case 'boolean':
          return { v: g.text === 'TRUE', text: g.text };
        case 'error':
          return { v: null, text: g.text, error: true };
        default:
          return null;
      }
    },
    rowHidden: (r) => view.rowHeight(r) === 0,
    colHidden: (c) => view.colWidth(c) === 0
  };
}

/** What a chart's range holds today, read as its options say. Null when the range is gone. */
export function readChart(model: SheetModel, spec: ChartSpec): ChartData | null {
  const sh = model.engine.sheet(spec.sheet);
  const rect = sh ? resolveRect(sh, spec.data) : null;
  if (!rect) return null;
  const o = spec.options ?? {};
  return readData(rect, viewReader(model, spec.sheet), { type: spec.type, seriesIn: o.seriesIn ?? 'cols', headers: o.headers ?? true, labels: o.labels ?? true });
}

const sameList = <T>(a: readonly T[], b: readonly T[]): boolean => a.length === b.length && a.every((v, i) => Object.is(v, b[i]));

export function sameData(a: ChartData | null, b: ChartData | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.every !== b.every || a.total !== b.total || a.xDate !== b.xDate || a.xFmt !== b.xFmt) return false;
  if (!sameList(a.labels, b.labels)) return false;
  if ((a.x === null) !== (b.x === null) || (a.x && b.x && !sameList(a.x, b.x))) return false;
  if (a.series.length !== b.series.length) return false;
  return a.series.every((s, i) => s.name === b.series[i]!.name && s.fmt === b.series[i]!.fmt && sameList(s.values, b.series[i]!.values));
}

export class ChartStore {
  private entries = new Map<string, ChartEntry>();
  private hosts = new Map<string, readonly ChartEntry[]>();
  private listeners = new Set<() => void>();
  private off: (() => void) | null = null;
  private fresh = false;
  /** Bumped by every change; what a component reads to know to look again. */
  version = 0;
  selected: string | null = null;

  constructor(readonly model: SheetModel) {}

  /** For `useSyncExternalStore`. Attaches to the model while anyone is listening. */
  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    if (!this.off) {
      this.off = this.model.onDataChanged((dirty) => this.refresh(dirty));
      this.refresh(null);
    }
    return () => {
      this.listeners.delete(cb);
      if (this.listeners.size === 0) {
        this.off?.();
        this.off = null;
        // Not attached, so not kept up to date: the next listener starts from a read.
        this.fresh = false;
      }
    };
  };

  getVersion = (): number => this.version;

  /** The charts on a sheet, in the order they were made (the map's order); the same array until one changes. */
  chartsOn(host: string): readonly ChartEntry[] {
    this.ensureFresh();
    return this.hosts.get(host) ?? NONE;
  }

  get(id: string): ChartEntry | undefined {
    this.ensureFresh();
    return this.entries.get(id);
  }

  select(id: string | null): void {
    if (this.selected === id) return;
    this.selected = id;
    this.emit();
  }

  /**
   * Reads the charts if nothing is keeping them current: nobody has yet (a first render), or nobody
   * is listening (a command asking, while no page is mounted), so what it answers is never stale.
   */
  ensureFresh(): void {
    if (!this.fresh || !this.off) this.refresh(null);
  }

  private emit(): void {
    this.version++;
    for (const l of [...this.listeners]) l();
  }

  /**
   * Reads what changed. `dirty` is the sheets whose cells did (null: any of them); a chart reads its
   * range again when its data sheet is one of them, or when its stored spec is not the one it has.
   */
  refresh(dirty: ReadonlySet<string> | null): void {
    this.fresh = true;
    const doc = this.model.doc;
    const seen = new Set<string>();
    const touched = new Set<string>();
    for (const host of sheetIdsInOrder(doc)) {
      const map: SheetMap | undefined = sheetsOf(doc).get(host);
      const charts = map ? field(map, 'charts') : undefined;
      if (!charts) continue;
      for (const [id, raw] of charts.entries()) {
        const spec = raw as ChartSpec;
        seen.add(id);
        const prev = this.entries.get(id);
        const sameSpec = prev !== undefined && prev.spec === spec && prev.host === host;
        if (sameSpec && dirty !== null && !dirty.has(spec.sheet)) continue;
        const data = readChart(this.model, spec);
        if (sameSpec && sameData(prev.data, data)) continue;
        this.entries.set(id, { id, host, spec, data });
        touched.add(host);
        if (prev && prev.host !== host) touched.add(prev.host);
      }
    }
    for (const [id, e] of this.entries) {
      if (seen.has(id)) continue;
      this.entries.delete(id);
      touched.add(e.host);
      if (this.selected === id) this.selected = null;
    }
    if (touched.size === 0) return;
    for (const host of touched) {
      const list = [...this.entries.values()].filter((e) => e.host === host);
      if (list.length) this.hosts.set(host, list);
      else this.hosts.delete(host);
    }
    this.emit();
  }
}

const NONE: readonly ChartEntry[] = [];

const stores = new WeakMap<SheetModel, ChartStore>();

/** The workbook's charts. */
export function chartStoreFor(model: SheetModel): ChartStore {
  let s = stores.get(model);
  if (!s) stores.set(model, (s = new ChartStore(model)));
  return s;
}

/** The store, re-rendering the caller when a chart or the selection changes. */
export function useChartStore(model: SheetModel): ChartStore {
  const store = chartStoreFor(model);
  store.ensureFresh();
  useSyncExternalStore(store.subscribe, store.getVersion, store.getVersion);
  return store;
}
