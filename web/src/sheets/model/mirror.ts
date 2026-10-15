/**
 * The engine follows the structure document. Every change to it, the model's own or anyone
 * else's, reaches the engine the same way: an observer on the Yjs types, after the transaction,
 * which makes the same insert, delete, order, sheet or name change in the engine. The model
 * never calls the engine's structure methods itself, so there is one path, and a remote insert
 * is mirrored by the code that mirrors a local one.
 *
 * ── Orders ──────────────────────────────────────────────────────────────────
 * A row or column order's change arrives as a delta against the array as it was before the
 * transaction, which is what the engine holds, so the delta is replayed as it reads: retain,
 * delete, insert. That keeps orphans and revivals exact (a deleted row's cells are set aside,
 * an undo's same ids bring them back) and costs nothing per untouched row.
 *
 * Two people moving one row at once each delete it and insert it somewhere: the array then
 * holds its id twice. The engine cannot hold an id twice (it would be two rows sharing cells),
 * so such an axis is mirrored whole and without the repeats, keeping the first (`dedupe`), and
 * named in `repeats` until the array is clean again. The model then deletes the later copies
 * from the document (`SheetModel`'s fix-up), and every client deletes the same items, because
 * every client sees the items in one order: the first copy is never anyone's later one.
 */

import type * as Y from 'yjs';
import type { Axis, Engine } from '../engine';
import { type SheetMap, type StoredName, dedupe, field, namesOf, sheetOrderOf, sheetsOf } from './structure';

/** What changed, for the views: they redraw, and drop what they cached about it. */
export type ChangeKind = 'sheets' | 'order' | 'layout' | 'styles' | 'rules' | 'names';

export interface MirrorHost {
  readonly engine: Engine;
  /** A sheet is now in the engine: its cells set aside earlier go back. */
  sheetAdded(id: string): void;
  /** A sheet is about to leave the engine, and its cells with it: set them aside. */
  sheetRemoving(id: string): void;
  changed(sheetId: string | null, kind: ChangeKind): void;
}

const KINDS: Record<string, ChangeKind> = {
  heights: 'layout',
  widths: 'layout',
  hiddenRows: 'layout',
  hiddenCols: 'layout',
  merges: 'layout',
  rowStyles: 'styles',
  colStyles: 'styles',
  cf: 'rules',
  validation: 'rules',
  filter: 'rules',
  charts: 'rules'
};

const orderKey = (axis: Axis) => (axis === 'rows' ? 'rowOrder' : 'colOrder');
const tagOf = (sheetId: string, axis: Axis) => `${sheetId}\u0000${axis}`;

export class Mirror {
  /** `sheet\0axis` of each order that holds an id twice, mirrored without the repeats. */
  readonly repeats = new Set<string>();
  private stopFn: (() => void) | null = null;

  constructor(
    private readonly doc: Y.Doc,
    private readonly host: MirrorHost
  ) {}

  /** Mirrors what the document holds now, then follows it. */
  start(): void {
    if (this.stopFn) return;
    const sheets = sheetsOf(this.doc);
    for (const id of sheets.keys()) this.addSheet(id);
    for (const n of namesOf(this.doc).values()) this.host.engine.setName(n.name, n.scope, n.f);
    const onSheets = (events: Y.YEvent<Y.AbstractType<unknown>>[]) => this.onSheets(events);
    const onNames = (e: Y.YMapEvent<StoredName>) => this.onNames(e);
    const onOrder = () => this.host.changed(null, 'sheets');
    sheets.observeDeep(onSheets);
    namesOf(this.doc).observe(onNames);
    sheetOrderOf(this.doc).observe(onOrder);
    this.stopFn = () => {
      sheets.unobserveDeep(onSheets);
      namesOf(this.doc).unobserve(onNames);
      sheetOrderOf(this.doc).unobserve(onOrder);
    };
  }

  stop(): void {
    this.stopFn?.();
    this.stopFn = null;
  }

  /** Each axis named in `repeats`, as [sheet id, axis]. */
  repeated(): [string, Axis][] {
    return [...this.repeats].map((t) => {
      const [s, a] = t.split('\u0000') as [string, Axis];
      return [s, a];
    });
  }

  private orderOf(map: SheetMap, axis: Axis): string[] {
    const arr = field(map, orderKey(axis));
    return arr ? arr.toArray() : [];
  }

  private addSheet(id: string): void {
    const map = sheetsOf(this.doc).get(id);
    if (!map) return;
    const engine = this.host.engine;
    if (engine.sheet(id)) this.removeSheet(id);
    const rows = dedupe(this.orderOf(map, 'rows'));
    const cols = dedupe(this.orderOf(map, 'cols'));
    const name = field(map, 'name');
    engine.addSheet(id, typeof name === 'string' ? name : id, rows.ids, cols.ids);
    this.mark(id, 'rows', rows.repeats);
    this.mark(id, 'cols', cols.repeats);
    this.host.sheetAdded(id);
  }

  private removeSheet(id: string): void {
    if (!this.host.engine.sheet(id)) return;
    this.host.sheetRemoving(id);
    this.host.engine.removeSheet(id);
    this.repeats.delete(tagOf(id, 'rows'));
    this.repeats.delete(tagOf(id, 'cols'));
  }

  private mark(sheetId: string, axis: Axis, repeats: boolean): void {
    if (repeats) this.repeats.add(tagOf(sheetId, axis));
    else this.repeats.delete(tagOf(sheetId, axis));
  }

  private onSheets(events: Y.YEvent<Y.AbstractType<unknown>>[]): void {
    // Yjs delivers these shallowest first, so a sheet that arrives is added (with its orders as
    // they end) before anything inside it, and a type made in the same transaction has no event.
    for (const e of events) {
      const path = e.path;
      if (path.length === 0) {
        for (const [key, change] of (e as Y.YMapEvent<SheetMap>).changes.keys) {
          if (change.action !== 'add') this.removeSheet(key);
          if (change.action !== 'delete') this.addSheet(key);
        }
        this.host.changed(null, 'sheets');
        continue;
      }
      const sheetId = String(path[0]);
      if (!this.host.engine.sheet(sheetId)) continue;
      if (path.length === 1) {
        const keys = (e as Y.YMapEvent<unknown>).keysChanged;
        const map = sheetsOf(this.doc).get(sheetId);
        if (keys.has('name') && map) {
          const name = field(map, 'name');
          if (typeof name === 'string') this.host.engine.renameSheet(sheetId, name);
        }
        const tabs = keys.has('name') || keys.has('tab') || keys.has('hidden');
        this.host.changed(tabs ? null : sheetId, tabs ? 'sheets' : 'layout');
        continue;
      }
      const key = String(path[1]);
      if (key === 'rowOrder' || key === 'colOrder') {
        this.replay(sheetId, key === 'rowOrder' ? 'rows' : 'cols', e as Y.YArrayEvent<string>);
      } else this.host.changed(sheetId, KINDS[key] ?? 'layout');
    }
  }

  private replay(sheetId: string, axis: Axis, e: Y.YArrayEvent<string>): void {
    const engine = this.host.engine;
    const tag = tagOf(sheetId, axis);
    const array = e.target as Y.Array<string>;
    let exact = !this.repeats.has(tag);
    if (exact) {
      try {
        let i = 0;
        for (const d of e.changes.delta) {
          if (d.retain !== undefined) i += d.retain;
          else if (d.delete !== undefined) {
            if (axis === 'rows') engine.deleteRows(sheetId, i, d.delete);
            else engine.deleteCols(sheetId, i, d.delete);
          } else if (Array.isArray(d.insert)) {
            const ids = d.insert as string[];
            if (axis === 'rows') engine.insertRows(sheetId, i, ids);
            else engine.insertCols(sheetId, i, ids);
            i += ids.length;
          }
        }
      } catch {
        // An insert of an id the axis already has: two moves of one line. Mirrored whole below.
        exact = false;
      }
    }
    if (!exact || engine.sheet(sheetId)!.order(axis).length !== array.length) {
      const { ids, repeats } = dedupe(array.toArray());
      engine.setOrder(sheetId, axis, ids);
      this.mark(sheetId, axis, repeats);
    }
    this.host.changed(sheetId, 'order');
  }

  private onNames(e: Y.YMapEvent<StoredName>): void {
    const names = namesOf(this.doc);
    for (const [key, change] of e.changes.keys) {
      const now = names.get(key);
      const old = change.oldValue as StoredName | undefined;
      if (old && (!now || now.name.toUpperCase() !== old.name.toUpperCase() || now.scope !== old.scope)) {
        this.host.engine.setName(old.name, old.scope, null);
      }
      if (now) this.host.engine.setName(now.name, now.scope, now.f);
    }
    this.host.changed(null, 'names');
  }
}
