/**
 * One sheet's view state: the selection, the edit in progress, the clipboard marker and where
 * the pane was scrolled to. It is a small external store, so the grid and the formula bar
 * (two components, in different parts of the page) read and write the same thing and neither
 * has to own the other.
 *
 * The host makes one per sheet (`useGridSession`) and gives it to both. The grid binds the
 * data and the intent callback to it on every render, so a session outlives the model's
 * adapter objects and keeps a sheet's selection and scroll for when its tab comes back.
 *
 * Every method that changes something says so by emitting; React reads `rev` through
 * `useSyncExternalStore`. Nothing here touches the DOM: the pieces that need it (focus,
 * scroll) are asked of the host binding.
 */

import { useRef, useSyncExternalStore } from 'react';
import { MergeIndex } from './merges';
import { GridLayout } from './geometry';
import type { GridLayer } from './layer';
import {
  advance,
  cell,
  clampSel,
  navigate,
  sameCell,
  sameRect,
  selectAll,
  selRect,
  single,
  wholeCols,
  wholeRows,
  type Mods,
  type NavCtx,
  type SelState
} from './selection';
import {
  insertAtSelection,
  nextPoint,
  pointTo,
  setSelection,
  setText,
  startEdit,
  switchField,
  toggleMode,
  canPointNow,
  editKey,
  type Dir,
  type EditKey,
  type EditAction,
  type EditState,
  type Move
} from './edit';
import type { ClipMark } from './clipboard';
import { applyCompletion, completionAt, cycleAbsolute, scanRefs, type RefToken } from './refs';
import type { Cellpos, GridData, GridIntent, Rect } from './types';

export interface SessionHost {
  data: GridData;
  onIntent(intent: GridIntent): void;
  /** The data's own read-only flag or the host's. */
  readOnly(): boolean;
  /** Told when something tried to edit a read-only sheet. */
  onReadOnlyEdit?(): void;
  /** The latest layout, for page keys and for what the viewport can show. */
  layout(): GridLayout | null;
  /** Put the keyboard back on the grid. */
  focusGrid(): void;
}

export interface Suggestions {
  /** Where the word being completed starts. */
  from: number;
  prefix: string;
  items: readonly { label: string; detail?: string; kind: 'function' | 'name' }[];
}

const SUGGEST_MAX = 8;

export type StartHow = 'type' | 'f2' | 'enter' | 'dblclick' | 'bar' | 'fx';

let sessionSeq = 0;

export class GridSession {
  /** Names this session in the page, so the editor can tell the formula bar that belongs to it. */
  readonly id = `sg${++sessionSeq}`;
  private host: SessionHost | null = null;
  private listeners = new Set<() => void>();
  private lastSent: { rect: Rect; active: Cellpos } | null = null;
  private mergeFor = -1;
  private mergeIdx = new MergeIndex([]);
  private refsFor: string | null = null;
  private refsOf: RefToken[] = [];

  /** Bumped by every change; the value a store subscriber reads. */
  rev = 0;
  sel: SelState = single(cell(0, 0));
  edit: EditState | null = null;
  clip: ClipMark | null = null;
  /** Native scroll positions, kept for when the sheet's tab returns. */
  scroll = { x: 0, y: 0 };
  /** A request to bring a cell into view, served by the grid. */
  reveal: { seq: number; at: Cellpos } | null = null;
  /** What a thing over the grid follows the cells with (layer.ts); set by the grid while it is mounted. */
  layer: GridLayer | null = null;

  setLayer(layer: GridLayer | null): void {
    if (this.layer === layer) return;
    this.layer = layer;
    this.emit();
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getRev = (): number => this.rev;

  private emit(): void {
    this.rev++;
    for (const fn of [...this.listeners]) fn();
  }

  bind(host: SessionHost): void {
    this.host = host;
    // A grid that shrank under a selection: keep it inside, and say so.
    const rows = host.data.rowCount();
    const cols = host.data.colCount();
    const c = clampSel(this.sel, rows, cols);
    if (!sameCell(c.anchor, this.sel.anchor) || !sameCell(c.head, this.sel.head) || !sameCell(c.active, this.sel.active)) {
      this.sel = c;
      this.sendSelect();
    }
  }

  /** Put the keyboard back on the grid. */
  focusGrid(): void {
    this.host?.focusGrid();
  }

  /** The layout last drawn, for a menu that opens beside a cell (`cellBox` is in the scroller's own pixels). */
  layout(): GridLayout | null {
    return this.host?.layout() ?? null;
  }

  get data(): GridData | null {
    return this.host?.data ?? null;
  }

  readOnly(): boolean {
    return this.host?.readOnly() ?? true;
  }

  merges(): MergeIndex {
    const d = this.host?.data;
    if (!d) return this.mergeIdx;
    if (this.mergeFor !== d.version) {
      this.mergeIdx = new MergeIndex(d.merges());
      this.mergeFor = d.version;
    }
    return this.mergeIdx;
  }

  /** The selected rectangle, merged areas included. */
  rect(): Rect {
    return selRect(this.sel, this.merges().all);
  }

  navCtx(): NavCtx {
    const host = this.host!;
    const d = host.data;
    const m = this.merges();
    return {
      rows: d.rowCount(),
      cols: d.colCount(),
      frozen: d.frozen(),
      hidden: (axis, i) => (axis === 'row' ? d.rowHeight(i) : d.colWidth(i)) === 0,
      mergeAt: (r, c) => m.at(r, c),
      isEmpty: (r, c) => {
        const x = d.cell(r, c);
        return !x || x.text === '';
      },
      pageSize: (axis, from, dir) => {
        const L = host.layout();
        if (!L) return 20;
        const a = axis === 'row' ? L.rows : L.cols;
        const room = axis === 'row' ? L.paneH : L.paneW;
        let used = 0;
        let n = 0;
        for (let i = from + dir; i >= 0 && i < a.count && used < room && n < 10_000; i += dir) {
          used += a.size(i);
          if (used <= room) n++;
        }
        return Math.max(1, n);
      },
      usedEnd: () => {
        if (!d.usedRange) return null;
        const u = d.usedRange();
        return u ? cell(u.r2, u.c2) : cell(0, 0);
      }
    };
  }

  // ── selection ─────────────────────────────────────────────────────────────

  /** What the model is told: the rectangle and the cell inside it, when either changed. */
  private sendSelect(): void {
    if (!this.host) return;
    const rect = this.rect();
    const active = this.sel.active;
    const last = this.lastSent;
    if (last && sameRect(last.rect, rect) && sameCell(last.active, active)) return;
    this.lastSent = { rect, active };
    this.host.onIntent({ type: 'select', rect, active });
  }

  setSel(next: SelState, reveal = true): void {
    const prev = this.sel;
    this.sel = next;
    if (reveal) this.revealCell(next.active);
    this.emit();
    if (!sameCell(prev.anchor, next.anchor) || !sameCell(prev.head, next.head) || !sameCell(prev.active, next.active)) this.sendSelect();
  }

  revealCell(at: Cellpos): void {
    this.reveal = { seq: (this.reveal?.seq ?? 0) + 1, at };
  }

  /** A click: the cell, or with `extend` the rectangle from where the selection began. */
  selectCell(where: Cellpos, extend: boolean): void {
    // A hit test's answer carries a `kind`; an intent carries a position and nothing else.
    const at = cell(where.row, where.col);
    const merged = this.merges().at(at.row, at.col);
    const target = merged && !extend ? cell(merged.r1, merged.c1) : at;
    if (extend) this.setSel({ ...this.sel, head: target }, false);
    else this.setSel(single(target), false);
  }

  /** The head of a drag. */
  dragTo(where: Cellpos): void {
    const at = cell(where.row, where.col);
    if (sameCell(this.sel.head, at)) return;
    this.setSel({ ...this.sel, head: at }, false);
  }

  selectRect(r: Rect): void {
    this.setSel({ anchor: cell(r.r1, r.c1), head: cell(r.r2, r.c2), active: cell(r.r1, r.c1) });
  }

  selectRows(from: number, to: number): void {
    this.setSel(wholeRows(from, to, this.navCtx()), false);
  }

  selectCols(from: number, to: number): void {
    this.setSel(wholeCols(from, to, this.navCtx()), false);
  }

  selectEverything(): void {
    this.setSel(selectAll(this.navCtx()), false);
  }

  /** A navigation key. Returns the page move for the grid to scroll by, or false when the key is not one. */
  key(key: string, mods: Mods): { page?: { axis: 'row' | 'col'; dir: 1 | -1 } } | false {
    if (!this.host) return false;
    const r = navigate(this.sel, key, mods, this.navCtx(), this.merges().all);
    if (!r) return false;
    this.setSel(r.sel);
    return r.page ? { page: r.page } : {};
  }

  move(dir: 'down' | 'up' | 'right' | 'left'): void {
    if (!this.host) return;
    this.setSel(advance(this.sel, dir, this.navCtx(), this.merges().all));
  }

  // ── editing ───────────────────────────────────────────────────────────────

  /** Start editing the active cell. False, and nothing starts, where the sheet is read only. */
  beginEdit(how: StartHow, typed = ''): boolean {
    const host = this.host;
    if (!host || this.edit) return !!this.edit;
    if (host.readOnly()) {
      host.onReadOnlyEdit?.();
      return false;
    }
    const at = this.sel.active;
    const original = host.data.editText(at.row, at.col);
    if (how === 'type') this.edit = startEdit(at, original, { text: typed, mode: 'enter', focus: 'cell' });
    else if (how === 'fx') this.edit = startEdit(at, original, { text: '=', mode: 'enter', focus: 'bar' });
    else this.edit = startEdit(at, original, { mode: 'edit', focus: how === 'bar' ? 'bar' : 'cell' });
    this.revealCell(at);
    this.emit();
    return true;
  }

  input(text: string, selStart: number, selEnd: number, from: 'cell' | 'bar'): void {
    if (!this.edit) return;
    this.edit = setText(switchField(this.edit, from), text, selStart, selEnd);
    this.emit();
  }

  select(selStart: number, selEnd: number, from: 'cell' | 'bar', value?: string): void {
    // A key the session has already answered (an arrow that wrote an address) can raise this before
    // the textarea has the new text; the caret it reports is the old one, and not news.
    if (!this.edit || (value !== undefined && value !== this.edit.text)) return;
    const next = setSelection(switchField(this.edit, from), selStart, selEnd);
    if (next === this.edit) return;
    this.edit = next;
    this.emit();
  }

  /** Where the caret is in whichever field has it: the other follows. */
  focusField(from: 'cell' | 'bar'): void {
    if (!this.edit || this.edit.focus === from) return;
    this.edit = switchField(this.edit, from);
    this.emit();
  }

  commit(move: Move = 'none'): void {
    const host = this.host;
    const e = this.edit;
    if (!host || !e) return;
    this.edit = null;
    if (e.text !== e.original) host.onIntent({ type: 'input', at: e.at, text: e.text });
    if (move !== 'none') this.setSel(advance(this.sel, move, this.navCtx(), this.merges().all));
    else this.emit();
    host.focusGrid();
  }

  cancel(): void {
    if (!this.edit) return;
    this.edit = null;
    this.emit();
    this.host?.focusGrid();
  }

  /** The completion list for the word at the caret. */
  suggestions(): Suggestions | null {
    const e = this.edit;
    const d = this.host?.data;
    if (!e || !d || e.selStart !== e.selEnd) return null;
    const at = completionAt(e.text, e.selStart);
    if (!at || e.suggest.closedFor === at.prefix) return null;
    const items = d.completions(at.prefix).slice(0, SUGGEST_MAX);
    return items.length === 0 ? null : { from: at.from, prefix: at.prefix, items };
  }

  /** A key in either field while editing: applied if it means something here. True if it did. */
  editKeyDown(k: EditKey): boolean {
    const e = this.edit;
    if (!e) return false;
    const action = editKey(e, k, this.suggestions() !== null);
    if (!action) return false;
    this.apply(action);
    return true;
  }

  /** What a key did in the editor, applied. */
  apply(action: EditAction): void {
    const e = this.edit;
    const host = this.host;
    if (!e || !host) return;
    switch (action.type) {
      case 'commit':
        this.commit(action.move);
        return;
      case 'cancel':
        this.cancel();
        return;
      case 'newline':
        this.edit = insertAtSelection(e, '\n');
        break;
      case 'toggleMode':
        this.edit = toggleMode(e);
        break;
      case 'point': {
        const t = nextPoint(e, action.dir as Dir, action.extend, {
          rows: host.data.rowCount(),
          cols: host.data.colCount(),
          hidden: (axis, i) => (axis === 'row' ? host.data.rowHeight(i) : host.data.colWidth(i)) === 0
        });
        this.edit = pointTo(e, t.anchor, t.head);
        this.revealCell(t.head);
        break;
      }
      case 'suggest': {
        const s = this.suggestions();
        if (!s) return;
        const n = s.items.length;
        const index = (e.suggest.index + action.delta + n) % n;
        this.edit = { ...e, suggest: { ...e.suggest, index, navigated: true } };
        break;
      }
      case 'accept': {
        const s = this.suggestions();
        const item = s?.items[Math.max(0, Math.min(e.suggest.index, (s?.items.length ?? 1) - 1))];
        if (!s || !item) return;
        const done = applyCompletion(e.text, s.from, e.selStart, item.label, item.kind === 'function');
        this.edit = setText(e, done.text, done.caret, done.caret);
        break;
      }
      case 'closeSuggest': {
        const s = this.suggestions();
        if (s) this.edit = { ...e, suggest: { ...e.suggest, closedFor: s.prefix } };
        break;
      }
      case 'cycleAbsolute': {
        const done = cycleAbsolute(e.text, e.selEnd);
        if (!done) return;
        this.edit = setText(e, done.text, done.caret, done.caret);
        break;
      }
    }
    this.emit();
  }

  /** Accept a row of the completion list that was clicked. */
  acceptSuggestion(label: string, isFunction: boolean): void {
    const e = this.edit;
    const s = this.suggestions();
    if (!e || !s) return;
    const done = applyCompletion(e.text, s.from, e.selStart, label, isFunction);
    this.edit = setText(e, done.text, done.caret, done.caret);
    this.emit();
  }

  /** A click on a cell while a formula is being typed: true if it wrote an address, false if the click should end the edit. */
  pointClick(where: Cellpos, extend: boolean): boolean {
    const e = this.edit;
    if (!e || !canPointNow(e)) return false;
    const at = cell(where.row, where.col);
    this.edit = pointTo(e, extend && e.point ? e.point.anchor : at, at);
    this.emit();
    return true;
  }

  pointDrag(where: Cellpos): void {
    const e = this.edit;
    const at = cell(where.row, where.col);
    if (!e?.point || sameCell(e.point.head, at)) return;
    this.edit = pointTo(e, e.point.anchor, at);
    this.emit();
  }

  // ── what is shown ─────────────────────────────────────────────────────────

  /** The references to colour and outline: those in the edit, or in the active cell's own formula. */
  refs(): RefToken[] {
    const text = this.edit ? this.edit.text : this.host ? this.host.data.editText(this.sel.active.row, this.sel.active.col) : '';
    if (this.refsFor !== text) {
      this.refsFor = text;
      this.refsOf = scanRefs(text);
    }
    return this.refsOf;
  }

  setClip(mark: ClipMark | null): void {
    this.clip = mark;
    this.emit();
  }
}

/** The session for a sheet, made once and kept for as long as the host lives. */
export function useGridSession(key: string): GridSession {
  const all = useRef(new Map<string, GridSession>());
  let s = all.current.get(key);
  if (!s) {
    s = new GridSession();
    all.current.set(key, s);
  }
  return s;
}

/** Re-render when the session changes. */
export function useSession(session: GridSession): GridSession {
  useSyncExternalStore(session.subscribe, session.getRev, session.getRev);
  return session;
}
