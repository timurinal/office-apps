/**
 * The Sheets client model: the only copy of the cells in the page (the engine holds them), the
 * owner of the structure document, and the page's end of shared/cells.ts.
 *
 * ── Steps ───────────────────────────────────────────────────────────────────
 * Everything a person does is one step: one undoable unit, and one `ops` frame carrying the
 * step's structure change (Yjs) and its cell writes together, under one seq at the room. A step
 * applies at once (structure in Yjs transactions with the origin `LOCAL`, which the mirror
 * follows into the engine; cells straight into the engine), recalculates once, and queues its
 * frame. Every local Yjs update is collected as it happens and goes in the next frame, so the
 * room sees every transaction of this client, in order, and the provider broadcasts none of
 * them (source.ts).
 *
 * ── The two rules that make last-write-wins safe (S1) ───────────────────────
 *   · Deleting a row deletes no cells. They are orphans, kept by the engine and the room, and
 *     an undo (the same ids back) brings them back with any edit that raced the delete.
 *   · A remote write to a cell this client has written and the room has not acknowledged is
 *     ignored: the room applies ours after it, so ours is what everyone will have. `unacked`
 *     names each such cell with the step that wrote it last.
 *
 * And from the join protocol (shared/cells.ts): after connecting, every frame waits until the
 * snapshot's last part; the snapshot replaces every cell not unacknowledged, the held remotes
 * past its seq apply, and the rest are dropped. Only then does the outbox go, in order. While
 * offline, steps queue in the outbox, each frame already built, and go on the next join.
 *
 * ── Undo ────────────────────────────────────────────────────────────────────
 * Per client, as in every collaborative editor: an undo reverts this person's step, not
 * whatever happened last. A step's structure is one Yjs `UndoManager` item, scoped to the
 * `LOCAL` origin, so it never undoes someone else's insert; its cells are the values each
 * cell had before the step, recorded as the step wrote them. An undo writes those back where
 * the cell still holds what this step wrote, and leaves a cell somebody else has since changed.
 * The UndoManager keeps no stack of its own: each entry holds its item, and an undo puts that
 * one item on the manager's stack for the length of the call.
 */

import * as Y from 'yjs';
import type { Awareness } from 'y-protocols/awareness';
import { LIMITS } from '@shared/api';
import { CELL_LIMITS, type CellOp, type CellsFrame, type StoredCell, cellWeight, opsFrame, parseStoredCell, utf8Length } from '@shared/cells';
import type { RoomStatus, StopReason } from '../../docs/room';
import {
  type CellContent,
  Engine,
  type EngineOptions,
  type ErrorCode,
  type Growth,
  MAX_COLS,
  MAX_ROWS,
  type Scalar,
  type SortKey,
  errorFromLiteral,
  isDateFormat
} from '../engine';
import type { Axis } from '../engine/sheet';
import type { Cellpos, Rect } from '../grid/types';
import { type SelectionState, SheetView, type ViewHost } from './adapter';
import { type CfRule, type ChartSpec, FILTER_RANGE, type FilterCriterion, type ValidationRule, filterKey } from './features';
import { type FitCell, type Measure, defaultMeasure, fitHeight, fitWidth } from './measure';
import { type ChangeKind, Mirror, type MirrorHost } from './mirror';
import { type OwnClip, type PastedCell, r1c1ToA1, readClipboard } from './paste';
import { REMOTE, type SheetConnection, type SheetEvents, type SheetFile, type SheetSource, type SourceFeatures } from './source';
import {
  DEFAULT_COL_WIDTH,
  DEFAULT_ROW_HEIGHT,
  type IdRect,
  type StoredName,
  NEW_SHEET_COLS,
  NEW_SHEET_ROWS,
  createSheet,
  field,
  nameKey,
  namesOf,
  newId,
  newIds,
  part,
  resolveRect,
  sheetIdsInOrder,
  sheetOrderOf,
  sheetsOf,
  shrinkFeatureRanges,
  stylesOf,
  toIdRect
} from './structure';
import { type StoredStyle, StyleBook, cleanStyle, dropIdleNulls, internStyle, patchStyle, resetting } from './styles';

/** The origin of this client's own structure changes; the UndoManager tracks it. */
export const LOCAL = Symbol('sheets-local');
/** Deleting the later copies of a line two moves left twice: shared, and never undone. */
const FIXUP = Symbol('sheets-fixup');

/**
 * The room's cap on one frame (`MAX_FRAME_BYTES`, worker/lib/room-protocol.ts, which the page
 * cannot import), less room for the frame's own header and the step's Yjs.
 */
const FRAME_BUDGET = 4 * 1024 * 1024 - 256 * 1024;
/** What one new row or column id costs the structure document, encoded: a type byte, a length, 8 characters. */
const BYTES_PER_LINE = 10;
const UNDO_DEPTH = 100;
/** Measure the structure document again once this much has been added to it since. */
const REMEASURE_BYTES = 256 * 1024;

export type NoticeKind = 'read-only' | 'too-large' | 'formula' | 'validation' | 'refused' | 'size';

export interface ModelNotice {
  kind: NoticeKind;
  /** One sentence for the person, in the product's voice. */
  message: string;
  /** For a formula that does not read: where in the text. */
  at?: number;
}

/** A join in progress: the snapshot's parts as they arrive, and the frames to apply over it. */
interface Join {
  seq: number;
  cells: CellOp[];
  held: CellsFrame[];
  /** How many parts the snapshot has, once the first has come; and how many have. */
  parts: number;
  got: number;
  /** The snapshot is being applied, in slices; the share of its cells done. */
  applying: boolean;
  applied: number;
}

/**
 * A first snapshot with more cells than this is applied in slices that give the page back between them, so a tab
 * opening a sheet of 400,000 cells does not hold the main thread for most of a second (the engine taking its cells
 * was one task of 880 ms). Smaller ones, and every join after the first, are applied at once.
 */
const SLICE_FROM_CELLS = 20_000;
/** Cells applied between two looks at the clock, and how long a slice may run before the page is given back. */
const SLICE_CHECK = 500;
const SLICE_MS = 8;

/** Let the page run (input, paint, other tabs' frames) and come back. */
const toMainThread = (): Promise<void> =>
  new Promise((done) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      done();
    };
    channel.port2.postMessage(0);
  });

export interface ModelStatus {
  connection: RoomStatus;
  /** The room's state has arrived. */
  synced: boolean;
  /** The cells have arrived: the first snapshot, or the file. */
  loaded: boolean;
  /** How far the cells are: 0 to 1 while they are coming and being taken in; null before the room has begun and once they are here. */
  progress: number | null;
  /** `saving` while steps wait for the room, `offline` while they wait for a connection. */
  save: 'saved' | 'saving' | 'offline';
  /** Steps not yet acknowledged. */
  pending: number;
  /** Non-empty cells, those on deleted rows included, as the room counts them. */
  cells: number;
  cellLimit: number;
  /** The same cells' ids and content in bytes (`cellWeight`), as the room weighs them. */
  cellBytes: number;
  cellBytesLimit: number;
  /** About how large the structure document is, encoded. */
  structureBytes: number;
  structureLimit: number;
  /** Past `CELL_LIMITS.cellsWarn`, `LIMITS.docStateWarnBytes`, or as near the byte cap as `cellsWarn` is to its. */
  warn: boolean;
  readOnly: boolean;
  stopped: StopReason | null;
}

export interface SheetInfo {
  id: string;
  name: string;
  /** The tab's colour; null for none. */
  color: string | null;
  hidden: boolean;
}

export interface SheetModelOptions {
  /** A viewer's or commenter's page: every step is refused with a notice. */
  readOnly?: boolean;
  engine?: EngineOptions;
  /** Autofit's measure; a canvas where there is one. */
  measure?: Measure;
  /** Who this is, for other people's view of this selection. */
  user?: { name: string; color: string };
  /** Milliseconds between two selections sent to the room. */
  selectionEveryMs?: number;
  onRoleChanged?: () => void;
  checkAccess?: () => Promise<'ok' | 'no-access' | 'signed-out'>;
}

class Refusal extends Error {
  constructor(readonly notice: ModelNotice) {
    super(notice.message);
  }
}

const refuse = (kind: NoticeKind, message: string): Refusal => new Refusal({ kind, message });

const MESSAGES = {
  readOnly: 'You can view this spreadsheet, not edit it.',
  cells: `A spreadsheet holds at most ${CELL_LIMITS.cellsPerDocument.toLocaleString('en-GB')} cells.`,
  frame: 'That changes too many cells at once.',
  structure: 'This spreadsheet is at its size limit.',
  grid: 'That reaches past the edge of the sheet.',
  text: `A cell holds at most ${CELL_LIMITS.textChars.toLocaleString('en-GB')} characters.`,
  formula: `A formula can be at most ${CELL_LIMITS.formulaChars.toLocaleString('en-GB')} characters long.`,
  validation: 'That value is not allowed in this cell.',
  validationWarn: 'That value is not one this cell expects.',
  lastRow: 'A sheet needs at least one row.',
  lastCol: 'A sheet needs at least one column.',
  lastSheet: 'A spreadsheet needs at least one visible sheet.',
  sortMerged: 'Unmerge the cells to sort them.',
  sheetName: 'A sheet name needs 1 to 31 characters, none of them : \\ / ? * [ ].'
} as const;

export const cellKey = (sheet: string, row: string, col: string): string => `${sheet}\u0000${row}\u0000${col}`;

function splitKey(k: string): [string, string, string] {
  const [s, r, c] = k.split('\u0000');
  return [s!, r!, c!];
}

function contentOf(c: StoredCell | null | undefined): CellContent | null {
  if (!c) return null;
  const out: CellContent = {};
  if (c.v !== undefined) out.v = c.v;
  if (c.e !== undefined) out.e = c.e as ErrorCode;
  if (c.f !== undefined) out.f = c.f;
  return out.v !== undefined || out.e !== undefined || out.f !== undefined ? out : null;
}

function withStyle(content: CellContent | null, s: string | undefined): StoredCell | null {
  const out: StoredCell = {};
  if (content?.v !== undefined) out.v = content.v;
  if (content?.e !== undefined) out.e = content.e;
  if (content?.f !== undefined) out.f = content.f;
  if (s !== undefined) out.s = s;
  return out.v !== undefined || out.e !== undefined || out.f !== undefined || out.s !== undefined ? out : null;
}

function sameCell(a: StoredCell | null, b: StoredCell | null): boolean {
  if (!a || !b) return !a === !b;
  return a.v === b.v && a.e === b.e && a.f === b.f && a.s === b.s;
}

function valueOf(c: CellContent | null): Scalar {
  if (!c) return null;
  if (c.e !== undefined) return errorFromLiteral(c.e) ?? null;
  return c.v ?? null;
}

interface Touch {
  before: StoredCell | null;
  after: StoredCell | null;
}

class Step {
  /** The last write to each cell, in the order of last writes, for the frame. */
  readonly writes = new Map<string, CellOp>();
  /** Each cell's value before the step and after it, for the undo. */
  readonly touched = new Map<string, Touch>();
}

interface UndoEntry {
  item: Y.UndoManager['undoStack'][number] | null;
  cells: Map<string, Touch>;
}

interface Outgoing {
  clientSeq: number;
  bytes: Uint8Array;
  keys: string[];
}

type StepKind = 'edit' | 'undo' | 'redo' | 'fix';

export class SheetModel implements MirrorHost, ViewHost {
  readonly engine: Engine;
  readonly doc: Y.Doc;
  readonly awareness: Awareness | null;
  readonly book: StyleBook;
  readonly features: SourceFeatures;
  readonly clipDoc: string;
  version = 0;
  /** Formulas drawn as their text, for this viewer only: never stored, never sent (`setShowFormulas`). */
  showFormulas = false;

  private readonly conn: SheetConnection;
  private readonly mirror: Mirror;
  private readonly um: Y.UndoManager;
  private readonly measure: Measure;
  private readonly listeners = new Set<() => void>();
  /** Sheets whose cells, formats, order, layout or rules changed since the last bump; `dirtyAll` when it is not one sheet. */
  private readonly dirty = new Set<string>();
  private dirtyAll = false;
  private readonly dataListeners = new Set<(sheets: ReadonlySet<string> | null) => void>();
  private readonly noticeListeners = new Set<(n: ModelNotice) => void>();
  private readonly views = new Map<string, SheetView>();
  /** sheet → column → row → the cell's own style id. Orphans' and removed sheets' included. */
  private readonly styleIds = new Map<string, Map<string, Map<string, string>>>();
  /** The contents of sheets the engine does not have: removed ones, and cells that came first. */
  private readonly parked = new Map<string, Map<string, CellContent>>();
  private cellCount = 0;
  private cellBytes = 0;
  private pending: Uint8Array[] = [];
  private current: Step | null = null;
  private depth = 0;
  private settleDue = false;
  private clientSeq = 0;
  private readonly outbox: Outgoing[] = [];
  private readonly unacked = new Map<string, number>();
  private undoStack: UndoEntry[] = [];
  private redoStack: UndoEntry[] = [];
  private joined = false;
  private join: Join | null = null;
  /** The last seq whose cells this client holds. */
  private seq = 0;
  private connection: RoomStatus = 'connecting';
  private synced = false;
  private loaded = false;
  private stopped: StopReason | null = null;
  private readOnlyFlag: boolean;
  private bytesMeasured = 0;
  private bytesSince = 0;
  private statusCache: ModelStatus | null = null;
  private statusAt = -1;
  private selTimer: ReturnType<typeof setTimeout> | null = null;
  private selNext: SelectionState | null = null;
  private selSent: SelectionState | null = null;
  private destroyed = false;

  constructor(
    readonly source: SheetSource,
    private readonly opts: SheetModelOptions = {}
  ) {
    this.engine = new Engine(opts.engine);
    this.readOnlyFlag = opts.readOnly ?? false;
    this.features = source.features;
    this.measure = opts.measure ?? defaultMeasure();
    this.clipDoc = source.kind === 'cloud' ? source.id : `local-${newId()}`;
    this.engine.onTouch = (s, r, c) => {
      this.views.get(s)?.touch(r, c);
      this.dirty.add(s);
    };
    const events: SheetEvents = {
      onStatus: (s) => this.onStatus(s),
      onSynced: (b) => {
        this.synced = b;
        this.bump();
      },
      onStop: (r) => {
        this.stopped = r;
        this.joined = false;
        this.join = null;
        this.bump();
      },
      onNotice: (n) => this.notify({ kind: 'size', message: 'This spreadsheet is nearly at its size limit.', at: n.bytes }),
      onRoleChanged: () => opts.onRoleChanged?.(),
      checkAccess: () => opts.checkAccess?.() ?? Promise.resolve('ok' as const),
      onFrame: (f) => this.onFrame(f)
    };
    this.conn = source.connect(events);
    this.doc = this.conn.doc;
    this.awareness = this.conn.awareness;
    this.book = new StyleBook(this.doc);
    this.doc.on('update', this.onUpdate);
    this.um = new Y.UndoManager([sheetOrderOf(this.doc), sheetsOf(this.doc), namesOf(this.doc)], {
      trackedOrigins: new Set([LOCAL]),
      // Every transaction of one step is one item; a step starts a new one (stopCapturing).
      captureTimeout: Number.MAX_SAFE_INTEGER
    });
    stylesOf(this.doc).observe(this.onStyles);
    this.mirror = new Mirror(this.doc, this);
    this.operate(() => this.mirror.start());
    this.bytesMeasured = Y.encodeStateAsUpdate(this.doc).length;
    if (this.awareness) {
      if (opts.user) this.awareness.setLocalStateField('user', opts.user);
      this.awareness.on('change', this.onAwareness);
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.selTimer) clearTimeout(this.selTimer);
    this.awareness?.off('change', this.onAwareness);
    this.mirror.stop();
    stylesOf(this.doc).unobserve(this.onStyles);
    this.doc.off('update', this.onUpdate);
    this.um.destroy();
    this.engine.onTouch = null;
    this.conn.destroy();
    this.listeners.clear();
    this.dataListeners.clear();
    this.noticeListeners.clear();
  }

  // ── reading ───────────────────────────────────────────────────────────────

  /** The grid's view of one sheet; the same object for the life of the model. */
  view(sheetId: string): SheetView {
    let v = this.views.get(sheetId);
    if (!v) this.views.set(sheetId, (v = new SheetView(this, sheetId)));
    return v;
  }

  /** Every sheet, in tab order, hidden ones included. */
  sheets(): SheetInfo[] {
    const all = sheetsOf(this.doc);
    return sheetIdsInOrder(this.doc).map((id) => {
      const m = all.get(id)!;
      const name = field(m, 'name');
      const tab = field(m, 'tab');
      return { id, name: typeof name === 'string' ? name : id, color: typeof tab === 'string' ? tab : null, hidden: field(m, 'hidden') === true };
    });
  }

  /** The cell as stored: content and its own style id, wherever it is. */
  stored(sheet: string, row: string, col: string): StoredCell | null {
    const content = this.engine.sheet(sheet)
      ? this.engine.storedContent(sheet, row, col)
      : (this.parked.get(sheet)?.get(`${row}\u0000${col}`) ?? null);
    return withStyle(content, this.styleId(sheet, row, col));
  }

  styleId(sheet: string, row: string, col: string): string | undefined {
    return this.styleIds.get(sheet)?.get(col)?.get(row);
  }

  styled(sheetId: string): ReadonlyMap<string, ReadonlyMap<string, string>> | undefined {
    return this.styleIds.get(sheetId);
  }

  isReadOnly(): boolean {
    return this.readOnlyFlag || this.stopped !== null;
  }

  setReadOnly(readOnly: boolean): void {
    this.readOnlyFlag = readOnly;
    this.bump();
  }

  /** Draw each formula as its text instead of its value. A view setting: it is not a step and nobody else sees it. */
  setShowFormulas(on: boolean): void {
    if (this.showFormulas === on) return;
    this.showFormulas = on;
    for (const v of this.views.values()) v.changed('styles');
    this.bump();
  }

  /**
   * Several calls as one step: one undo entry and one frame. A button that does two things (merge
   * and centre, a border on every side of every cell, Replace all) makes its calls inside this, and
   * each joins the step instead of starting its own. A refusal stops the rest and keeps what was
   * done, as it does inside any step. Undefined when the whole step was refused.
   */
  batch<T>(fn: () => T): T | undefined {
    return this.step(() => fn());
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  status(): ModelStatus {
    if (this.statusCache && this.statusAt === this.version) return this.statusCache;
    const bytes = this.structureBytes();
    const pending = this.outbox.length;
    this.statusAt = this.version;
    return (this.statusCache = {
      connection: this.connection,
      synced: this.synced,
      loaded: this.loaded,
      progress: this.loaded || !this.join ? null : this.join.parts === 0 ? 0 : this.join.applying ? 0.8 + 0.2 * this.join.applied : (0.8 * this.join.got) / this.join.parts,
      save: pending === 0 ? 'saved' : this.joined ? 'saving' : 'offline',
      pending,
      cells: this.cellCount,
      cellLimit: CELL_LIMITS.cellsPerDocument,
      cellBytes: this.cellBytes,
      cellBytesLimit: CELL_LIMITS.bytesPerDocument,
      structureBytes: bytes,
      structureLimit: LIMITS.docStateMaxBytes,
      warn:
        this.cellCount > CELL_LIMITS.cellsWarn ||
        this.cellBytes > CELL_LIMITS.bytesPerDocument * (CELL_LIMITS.cellsWarn / CELL_LIMITS.cellsPerDocument) ||
        bytes > LIMITS.docStateWarnBytes,
      readOnly: this.isReadOnly(),
      stopped: this.stopped
    });
  }

  /** A sheet's conditional formats or validation rules with their ids, as stored: rectangles by id. */
  rules(sheetId: string, kind: 'cf'): { id: string; rule: CfRule }[];
  rules(sheetId: string, kind: 'validation'): { id: string; rule: ValidationRule }[];
  rules(sheetId: string, kind: 'cf' | 'validation'): { id: string; rule: CfRule | ValidationRule }[] {
    const map = sheetsOf(this.doc).get(sheetId);
    const rules = map ? field(map, kind) : undefined;
    return rules ? [...rules.entries()].map(([id, rule]) => ({ id, rule: rule as CfRule | ValidationRule })) : [];
  }

  /** The block a sheet's filter covers, by id, with its header row at the top; null when there is no filter. */
  filterRange(sheetId: string): IdRect | null {
    const map = sheetsOf(this.doc).get(sheetId);
    return ((map ? field(map, 'filter')?.get(FILTER_RANGE) : undefined) as IdRect | undefined) ?? null;
  }

  /** What one column of the filter is told to keep, or null when that column has no criterion. */
  filterCriterion(sheetId: string, col: number): FilterCriterion | null {
    const map = sheetsOf(this.doc).get(sheetId);
    const colId = this.engine.sheet(sheetId)?.colOrder[col];
    return ((map && colId ? field(map, 'filter')?.get(filterKey(colId)) : undefined) as FilterCriterion | undefined) ?? null;
  }

  /** Called after every change anything here answers; returns the way to stop. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Called after a change, with the sheets whose cells, formats, order, layout or rules changed since
   * the last call, or null when it was every sheet's (a format, a rename). Somebody else's cursor is
   * no change: what draws from cells (a chart) listens here and not to `subscribe`, which hears it.
   */
  onDataChanged(listener: (sheets: ReadonlySet<string> | null) => void): () => void {
    this.dataListeners.add(listener);
    return () => this.dataListeners.delete(listener);
  }

  /** Called with each refusal and each room notice. */
  onNotice(listener: (n: ModelNotice) => void): () => void {
    this.noticeListeners.add(listener);
    return () => this.noticeListeners.delete(listener);
  }

  /** The workbook as a file holds it (source.ts `SheetFile`): what the desktop saves. */
  export(): SheetFile {
    const cells: CellOp[] = [];
    for (const [sheet, row, col] of this.allCells()) {
      const content = this.stored(sheet, row, col);
      if (content) cells.push({ sheet, row, col, content });
    }
    return { state: Y.encodeStateAsUpdate(this.doc), cells };
  }

  // ── plumbing ──────────────────────────────────────────────────────────────

  private readonly onUpdate = (update: Uint8Array, origin: unknown): void => {
    this.bytesSince += update.length;
    if (origin !== REMOTE) this.pending.push(update);
  };

  private readonly onStyles = (): void => {
    // A cell may name a format before the format's entry arrives.
    this.book.stylesChanged();
    for (const v of this.views.values()) v.changed('styles');
    this.changed(null, 'styles');
  };

  private readonly onAwareness = (_c: unknown, origin: unknown): void => {
    if (origin !== 'local') this.bump();
  };

  private bump(): void {
    this.version++;
    if (this.dirtyAll || this.dirty.size > 0) {
      const sheets = this.dirtyAll ? null : new Set(this.dirty);
      this.dirty.clear();
      this.dirtyAll = false;
      for (const l of [...this.dataListeners]) l(sheets);
    }
    for (const l of [...this.listeners]) l();
  }

  private notify(n: ModelNotice): void {
    for (const l of [...this.noticeListeners]) l(n);
  }

  /** Runs `fn` as one change; at the end, one recalculation, the fix-up if any, and one bump. */
  private operate(fn: () => void): void {
    this.depth++;
    try {
      fn();
    } finally {
      this.depth--;
    }
    if (this.depth === 0) this.settle();
  }

  private settle(): void {
    this.settleDue = false;
    this.engine.recalc();
    if (this.mirror.repeats.size && !this.isReadOnly() && !this.current) this.step(() => undefined, 'fix');
    else this.bump();
  }

  // MirrorHost

  sheetAdded(id: string): void {
    const parked = this.parked.get(id);
    if (parked) {
      this.parked.delete(id);
      for (const [k, content] of parked) {
        const [row, col] = k.split('\u0000') as [string, string];
        this.engine.setCell(id, row, col, content);
      }
    }
    this.views.get(id)?.changed('sheets');
  }

  sheetRemoving(id: string): void {
    const parked = new Map<string, CellContent>();
    this.engine.eachCell(id, (row, col, content) => parked.set(`${row}\u0000${col}`, content));
    if (parked.size) this.parked.set(id, parked);
  }

  changed(sheetId: string | null, kind: ChangeKind): void {
    if (sheetId === null) {
      this.dirtyAll = true;
      for (const v of this.views.values()) v.changed(kind);
    } else {
      this.dirty.add(sheetId);
      this.views.get(sheetId)?.changed(kind);
    }
    // A change from outside any step or frame is the provider's sync: settle it now.
    if (this.depth === 0 && !this.settleDue) {
      this.settleDue = true;
      queueMicrotask(() => {
        if (this.settleDue && !this.destroyed) this.settle();
      });
    }
  }

  private has(sheet: string, row: string, col: string): boolean {
    if (this.styleId(sheet, row, col) !== undefined) return true;
    return this.engine.sheet(sheet)
      ? this.engine.storedContent(sheet, row, col) !== null
      : this.parked.get(sheet)?.has(`${row}\u0000${col}`) === true;
  }

  /** The one way a cell changes here, from any source: engine or parking, its style, the count. */
  private applyCell(sheet: string, row: string, col: string, c: StoredCell | null): void {
    const had = this.has(sheet, row, col);
    if (had) this.cellBytes -= weigh(sheet, row, col, this.stored(sheet, row, col));
    const content = contentOf(c);
    if (this.engine.sheet(sheet)) this.engine.setCell(sheet, row, col, content);
    else {
      const k = `${row}\u0000${col}`;
      let p = this.parked.get(sheet);
      if (content) {
        if (!p) this.parked.set(sheet, (p = new Map()));
        p.set(k, content);
      } else p?.delete(k);
    }
    const s = c?.s;
    let bySheet = this.styleIds.get(sheet);
    if (s !== undefined) {
      if (!bySheet) this.styleIds.set(sheet, (bySheet = new Map()));
      let byCol = bySheet.get(col);
      if (!byCol) bySheet.set(col, (byCol = new Map()));
      byCol.set(row, s);
    } else {
      const byCol = bySheet?.get(col);
      if (byCol?.delete(row) && byCol.size === 0) bySheet!.delete(col);
    }
    const has = content !== null || s !== undefined;
    if (has) this.cellBytes += weigh(sheet, row, col, withStyle(content, s));
    if (has !== had) {
      this.cellCount += has ? 1 : -1;
      this.views.get(sheet)?.shapeChanged();
    }
    this.views.get(sheet)?.touch(row, col);
  }

  /** Every cell held, by id: live, orphaned, parked, or a format alone. */
  private allCells(): [string, string, string][] {
    const seen = new Set<string>();
    const out: [string, string, string][] = [];
    const add = (s: string, r: string, c: string) => {
      const k = cellKey(s, r, c);
      if (seen.has(k)) return;
      seen.add(k);
      out.push([s, r, c]);
    };
    for (const id of this.engine.sheetIds()) this.engine.eachCell(id, (r, c) => add(id, r, c));
    for (const [id, cells] of this.parked) for (const k of cells.keys()) add(id, ...(k.split('\u0000') as [string, string]));
    for (const [id, cols] of this.styleIds) for (const [c, rows] of cols) for (const r of rows.keys()) add(id, r, c);
    return out;
  }

  private structureBytes(): number {
    if (this.bytesSince > REMEASURE_BYTES) {
      this.bytesMeasured = Y.encodeStateAsUpdate(this.doc).length;
      this.bytesSince = 0;
    }
    return this.bytesMeasured + this.bytesSince;
  }

  private checkStructure(adding: number): void {
    if (this.structureBytes() + adding <= LIMITS.docStateMaxBytes) return;
    // The running estimate counts every update, deletes included; measure before refusing.
    this.bytesMeasured = Y.encodeStateAsUpdate(this.doc).length;
    this.bytesSince = 0;
    if (this.bytesMeasured + adding > LIMITS.docStateMaxBytes) throw refuse('too-large', MESSAGES.structure);
  }

  // ── the room ──────────────────────────────────────────────────────────────

  private onStatus(s: RoomStatus): void {
    this.connection = s;
    this.joined = false;
    // A new connection starts a new join: everything waits for its snapshot.
    this.join = s === 'connected' ? { seq: 0, cells: [], held: [], parts: 0, got: 0, applying: false, applied: 0 } : null;
    this.bump();
  }

  private onFrame(f: CellsFrame): void {
    if (this.destroyed || f.type === 'ops') return;
    if (!this.joined) {
      const j = this.join;
      if (!j) return;
      if (f.type === 'snapshot') {
        // The last part has come and the cells are being taken in: a second snapshot is not sent, and is not read.
        if (j.applying) return;
        for (const c of f.cells) j.cells.push(c);
        j.seq = f.seq;
        j.parts = f.parts;
        j.got = f.part + 1;
        if (f.part === f.parts - 1) this.completeJoin(j);
        else this.bump();
      } else j.held.push(f);
      return;
    }
    // One snapshot per connection; a second (a step 1 sent again) is not sent, and is ignored.
    if (f.type === 'snapshot') return;
    this.operate(() => (f.type === 'ack' ? this.onAck(f) : this.applyRemote(f)));
  }

  private completeJoin(j: Join): void {
    // The first join of a big sheet holds nothing yet, so there is nothing to remove or compare: its cells can go
    // in a slice at a time. Frames that arrive meanwhile are held, as they were while the parts came.
    if (j.cells.length > SLICE_FROM_CELLS && this.cellCount === 0 && this.parked.size === 0) {
      j.applying = true;
      this.bump();
      void this.applyInSlices(j);
      return;
    }
    this.join = null;
    this.operate(() => {
      this.applySnapshot(j.cells);
      this.finishJoin(j);
    });
  }

  /** What follows the snapshot: its seq, the frames held over it in order, and the steps not yet acknowledged. */
  private finishJoin(j: Join): void {
    this.seq = j.seq;
    for (const f of j.held) {
      if (f.type === 'ack') this.onAck(f);
      else if (f.type === 'remote') this.applyRemote(f);
    }
    this.joined = true;
    this.loaded = true;
    for (const o of this.outbox) if (!this.conn.send(o.bytes)) break;
  }

  private async applyInSlices(j: Join): Promise<void> {
    const cells = j.cells;
    let i = 0;
    let slices = 0;
    while (i < cells.length) {
      const until = performance.now() + SLICE_MS;
      do {
        const stop = Math.min(cells.length, i + SLICE_CHECK);
        for (; i < stop; i++) {
          const op = cells[i]!;
          if (!this.unacked.has(cellKey(op.sheet, op.row, op.col))) this.applyCell(op.sheet, op.row, op.col, op.content);
        }
      } while (i < cells.length && performance.now() < until);
      j.applied = i / cells.length;
      if (++slices % 10 === 0) this.bump();
      await toMainThread();
      // A reconnect began a new join, or the page went: what is half applied is replaced by the next snapshot, and
      // a model that is gone has no one to tell.
      if (this.destroyed || this.join !== j) return;
    }
    this.join = null;
    this.operate(() => this.finishJoin(j));
  }

  private applySnapshot(cells: readonly CellOp[]): void {
    const incoming = new Map<string, CellOp>();
    for (const op of cells) incoming.set(cellKey(op.sheet, op.row, op.col), op);
    for (const [sheet, row, col] of this.allCells()) {
      const k = cellKey(sheet, row, col);
      if (!incoming.has(k) && !this.unacked.has(k)) this.applyCell(sheet, row, col, null);
    }
    for (const [k, op] of incoming) {
      if (this.unacked.has(k)) continue;
      if (sameCell(this.stored(op.sheet, op.row, op.col), op.content)) continue;
      this.applyCell(op.sheet, op.row, op.col, op.content);
    }
  }

  private applyRemote(f: Extract<CellsFrame, { type: 'remote' }>): void {
    // A step the snapshot already holds (its Yjs came in the sync step 2).
    if (f.seq <= this.seq) return;
    this.seq = f.seq;
    if (f.yjs.length > 0) Y.applyUpdate(this.doc, f.yjs, REMOTE);
    for (const op of f.cells) {
      if (this.unacked.has(cellKey(op.sheet, op.row, op.col))) continue;
      this.applyCell(op.sheet, op.row, op.col, op.content);
    }
  }

  private onAck(f: Extract<CellsFrame, { type: 'ack' }>): void {
    const i = this.outbox.findIndex((o) => o.clientSeq === f.clientSeq);
    if (i < 0) return;
    const [o] = this.outbox.splice(i, 1);
    for (const k of o!.keys) if (this.unacked.get(k) === o!.clientSeq) this.unacked.delete(k);
    // Steps before ours were sent to us before the ack, on the same socket.
    this.seq = Math.max(this.seq, f.seq);
  }

  // ── steps ─────────────────────────────────────────────────────────────────

  /** One step: applied now, one frame, one undo entry. Undefined when refused. */
  private step<T>(fn: (s: Step) => T, kind: StepKind = 'edit'): T | undefined {
    if (this.current) return fn(this.current);
    if (this.isReadOnly()) {
      if (kind !== 'fix') this.notify({ kind: 'read-only', message: MESSAGES.readOnly });
      return undefined;
    }
    const s = new Step();
    this.current = s;
    this.depth++;
    this.um.stopCapturing();
    let out: T | undefined;
    let failure: unknown = null;
    try {
      // Positions are what the person sees: an axis must not hold an id twice when a step reads it.
      this.fixRepeats();
      out = fn(s);
    } catch (e) {
      if (e instanceof Refusal) this.notify(e.notice);
      else failure = e;
      out = undefined;
    } finally {
      // Whatever the step did is applied and must be shared, refused half or not.
      this.fixRepeats();
      this.engine.recalc();
      this.current = null;
      this.finish(s, kind);
      this.depth--;
      this.settleDue = false;
      this.bump();
    }
    if (failure) throw failure;
    return out;
  }

  private finish(s: Step, kind: StepKind): void {
    const um = this.um;
    let item: UndoEntry['item'] = null;
    if (kind === 'undo') item = um.redoStack.pop() ?? null;
    else item = um.undoStack.pop() ?? null;
    um.undoStack = [];
    um.redoStack = [];
    const p = this.pending;
    this.pending = [];
    const yjs = p.length === 0 ? new Uint8Array(0) : p.length === 1 ? p[0]! : Y.mergeUpdates(p);
    const cells = [...s.writes.values()];
    if (yjs.length === 0 && cells.length === 0) return;
    if (kind !== 'fix' && (item || s.touched.size)) {
      const entry: UndoEntry = { item, cells: s.touched };
      if (kind === 'undo') this.redoStack.push(entry);
      else {
        this.undoStack.push(entry);
        if (this.undoStack.length > UNDO_DEPTH) this.forget(this.undoStack.shift()!);
        if (kind === 'edit') {
          for (const e of this.redoStack) this.forget(e);
          this.redoStack = [];
        }
      }
    }
    const clientSeq = ++this.clientSeq;
    const keys = [...s.writes.keys()];
    for (const k of keys) this.unacked.set(k, clientSeq);
    const bytes = opsFrame(clientSeq, yjs, cells);
    this.outbox.push({ clientSeq, bytes, keys });
    if (this.joined) this.conn.send(bytes);
  }

  /** A Yjs change of this step. */
  private tx(fn: () => void): void {
    this.doc.transact(fn, LOCAL);
  }

  private intern(style: StoredStyle): string | undefined {
    if (Object.keys(style).length === 0) return undefined;
    let id = '';
    this.doc.transact(() => {
      id = internStyle(this.doc, style);
    }, LOCAL);
    return id;
  }

  private write(s: Step, op: CellOp): void {
    const k = cellKey(op.sheet, op.row, op.col);
    let t = s.touched.get(k);
    if (!t) s.touched.set(k, (t = { before: this.stored(op.sheet, op.row, op.col), after: null }));
    const content = op.content && Object.keys(op.content).length ? op.content : null;
    this.applyCell(op.sheet, op.row, op.col, content);
    t.after = content;
    s.writes.delete(k);
    s.writes.set(k, { sheet: op.sheet, row: op.row, col: op.col, content });
  }

  /** Refuses a batch of writes that would break a cap, before any of it is applied. */
  private checkOps(s: Step, ops: readonly CellOp[]): void {
    if (s.writes.size + ops.length > CELL_LIMITS.opsPerFrame) throw refuse('too-large', MESSAGES.frame);
    let frame = 0;
    let delta = 0;
    let weight = 0;
    for (const op of ops) {
      const now = op.content && Object.keys(op.content).length > 0 ? weigh(op.sheet, op.row, op.col, op.content) : 0;
      const had = this.has(op.sheet, op.row, op.col);
      frame += now + 8;
      delta += (now ? 1 : 0) - (had ? 1 : 0);
      weight += now - (had ? weigh(op.sheet, op.row, op.col, this.stored(op.sheet, op.row, op.col)) : 0);
    }
    if (frame > FRAME_BUDGET) throw refuse('too-large', MESSAGES.frame);
    if (delta > 0 && this.cellCount + delta > CELL_LIMITS.cellsPerDocument) throw refuse('too-large', MESSAGES.cells);
    if (weight > 0 && this.cellBytes + weight > CELL_LIMITS.bytesPerDocument) throw refuse('too-large', MESSAGES.cells);
  }

  private writeAll(s: Step, ops: readonly CellOp[]): void {
    this.checkOps(s, ops);
    for (const op of ops) this.write(s, op);
  }

  /** Deletes the later copies of every line two moves left twice. Every client deletes the same items. */
  private fixRepeats(): void {
    if (!this.mirror.repeats.size || this.isReadOnly()) return;
    const sheets = sheetsOf(this.doc);
    this.doc.transact(() => {
      for (const [sheetId, axis] of this.mirror.repeated()) {
        const map = sheets.get(sheetId);
        const arr = map ? field(map, axis === 'rows' ? 'rowOrder' : 'colOrder') : undefined;
        if (!arr) continue;
        const seen = new Set<string>();
        const later: number[] = [];
        arr.toArray().forEach((id, i) => (seen.has(id) ? later.push(i) : seen.add(id)));
        for (let i = later.length - 1; i >= 0; i--) arr.delete(later[i]!, 1);
      }
    }, FIXUP);
  }

  // ── helpers over a sheet ──────────────────────────────────────────────────

  private sheetOf(id: string) {
    const sh = this.engine.sheet(id);
    const map = sheetsOf(this.doc).get(id);
    if (!sh || !map) throw new Error(`No sheet ${id}`);
    return { sh, map };
  }

  /** Grows sheets to at least the sizes asked, in this step. */
  private grow(sheets: readonly Growth[]): void {
    let lines = 0;
    for (const g of sheets) {
      const sh = this.engine.sheet(g.sheetId);
      if (!sh) continue;
      if (g.rows > MAX_ROWS || g.cols > MAX_COLS) throw refuse('refused', MESSAGES.grid);
      lines += Math.max(0, g.rows - sh.rowOrder.length) + Math.max(0, g.cols - sh.colOrder.length);
    }
    if (lines === 0) return;
    this.checkStructure(lines * BYTES_PER_LINE);
    this.tx(() => {
      for (const g of sheets) {
        const sh = this.engine.sheet(g.sheetId);
        const map = sheetsOf(this.doc).get(g.sheetId);
        if (!sh || !map) continue;
        const rows = g.rows - sh.rowOrder.length;
        const cols = g.cols - sh.colOrder.length;
        if (rows > 0) part(map, 'rowOrder').push(newIds(rows));
        if (cols > 0) part(map, 'colOrder').push(newIds(cols));
      }
    });
  }

  private growTo(sheetId: string, rows: number, cols: number): void {
    const sh = this.engine.sheet(sheetId);
    if (!sh) return;
    if (rows > sh.rowOrder.length || cols > sh.colOrder.length) {
      this.grow([{ sheetId, rows: Math.max(rows, sh.rowOrder.length), cols: Math.max(cols, sh.colOrder.length) }]);
    }
  }

  /** The ids at a position, after growing to reach it. */
  private at(sheetId: string, row: number, col: number): [string, string] {
    const sh = this.engine.sheet(sheetId)!;
    return [sh.rowOrder[row]!, sh.colOrder[col]!];
  }

  /** Each cell with content in a rectangle, by ids. Reads only the cells there are. */
  private eachContent(sheetId: string, rect: Rect, visit: (rowId: string, colId: string) => void): void {
    const sh = this.engine.sheet(sheetId);
    if (!sh) return;
    const ri = sh.rowIndex();
    for (let c = rect.c1; c <= Math.min(rect.c2, sh.colOrder.length - 1); c++) {
      const colId = sh.colOrder[c]!;
      const col = sh.cols.get(colId);
      if (!col) continue;
      for (const rowId of col.keys()) {
        const r = ri.get(rowId);
        if (r !== undefined && r >= rect.r1 && r <= rect.r2) visit(rowId, colId);
      }
    }
  }

  /** Each cell with a format of its own in a rectangle. */
  private eachStyled(sheetId: string, rect: Rect, visit: (rowId: string, colId: string, s: string) => void): void {
    const sh = this.engine.sheet(sheetId);
    const cols = this.styleIds.get(sheetId);
    if (!sh || !cols) return;
    const ri = sh.rowIndex();
    for (let c = rect.c1; c <= Math.min(rect.c2, sh.colOrder.length - 1); c++) {
      const colId = sh.colOrder[c]!;
      const col = cols.get(colId);
      if (!col) continue;
      for (const [rowId, s] of col) {
        const r = ri.get(rowId);
        if (r !== undefined && r >= rect.r1 && r <= rect.r2) visit(rowId, colId, s);
      }
    }
  }

  /** Whether a typed number's format should replace the format the cell shows. */
  private wantsFormat(sheetId: string, rowId: string, colId: string, format: string): boolean {
    const map = sheetsOf(this.doc).get(sheetId);
    const now = this.book.effective(
      map ? field(map, 'colStyles')?.get(colId) : undefined,
      map ? field(map, 'rowStyles')?.get(rowId) : undefined,
      this.styleId(sheetId, rowId, colId)
    ).numFmt;
    if (!now || /^general$/i.test(now)) return true;
    const pct = (f: string) => /%/.test(f.replace(/"[^"]*"/g, ''));
    return isDateFormat(format) !== isDateFormat(now) || pct(format) !== pct(now);
  }

  // ── cells ─────────────────────────────────────────────────────────────────

  /** What a person typed into a cell. False when it was refused. */
  input(sheetId: string, at: Cellpos, text: string): boolean {
    return (
      this.step((s) => {
        const formula = text.startsWith('=') && text.length > 1;
        if (formula && text.length > CELL_LIMITS.formulaChars) throw refuse('too-large', MESSAGES.formula);
        if (!formula && text.length > CELL_LIMITS.textChars) throw refuse('too-large', MESSAGES.text);
        this.growTo(sheetId, at.row + 1, at.col + 1);
        let r = this.engine.contentFromInput(sheetId, text);
        if (r.kind === 'grow') {
          this.grow(r.sheets);
          r = this.engine.contentFromInput(sheetId, text);
        }
        if (r.kind === 'error') throw new Refusal({ kind: 'formula', message: r.message, at: r.at });
        if (r.kind !== 'content') return false;
        const [rowId, colId] = this.at(sheetId, at.row, at.col);
        const content = r.content;
        if (content && content.f === undefined) {
          const check = this.view(sheetId).features()?.passes(at.row, at.col, valueOf(content), false);
          if (check && !check.ok) {
            // A stop rule refuses the value; a warning rule keeps it and says so.
            if (check.rule.strict) throw refuse('validation', check.rule.message || MESSAGES.validation);
            this.notify({ kind: 'validation', message: check.rule.message || MESSAGES.validationWarn });
          }
        }
        let style = this.styleId(sheetId, rowId, colId);
        if (r.format && this.wantsFormat(sheetId, rowId, colId, r.format)) {
          style = this.intern(patchStyle(this.book.get(style), { numFmt: r.format }));
        }
        this.writeAll(s, [{ sheet: sheetId, row: rowId, col: colId, content: withStyle(content, style) }]);
        return true;
      }) ?? false
    );
  }

  /** Delete over a selection: contents go, formats stay. */
  clear(sheetId: string, rect: Rect): void {
    this.step((s) => {
      const ops: CellOp[] = [];
      this.eachContent(sheetId, rect, (row, col) => {
        ops.push({ sheet: sheetId, row, col, content: withStyle(null, this.styleId(sheetId, row, col)) });
      });
      this.writeAll(s, ops);
    });
  }

  paste(sheetId: string, at: Cellpos, text: string, html?: string, cut?: Rect): void {
    const p = readClipboard(text, html);
    this.step((s) => {
      if (p.own && p.own.doc === this.clipDoc && this.engine.sheet(p.own.sheet) && this.pasteOwn(s, sheetId, at, p.own, cut)) return;
      this.pasteTable(s, sheetId, at, p.rows, p.styled);
    });
  }

  /** Our own copy: stored formulas, shifted as a copy or kept as a cut moves them. False to paste the table instead. */
  private pasteOwn(s: Step, sheetId: string, at: Cellpos, clip: OwnClip, cut?: Rect): boolean {
    const h = clip.cells.length;
    const w = Math.max(0, ...clip.cells.map((r) => r.length));
    if (h === 0 || w === 0) return true;
    if (h * w > CELL_LIMITS.opsPerFrame) throw refuse('too-large', MESSAGES.frame);
    // Read as anything from outside is read: each cell checked, unknown fields dropped.
    const contents: (CellContent | null)[][] = [];
    const styles: (StoredStyle | undefined)[][] = [];
    for (const row of clip.cells) {
      const line: (CellContent | null)[] = [];
      const st: (StoredStyle | undefined)[] = [];
      for (let j = 0; j < w; j++) {
        const cell = row[j];
        const parsed = cell?.c ? contentOf(checkCell(cell.c)) : null;
        line.push(parsed);
        st.push(cell?.st ? cleanStyle(cell.st) : undefined);
      }
      contents.push(line);
      styles.push(st);
    }
    const from = this.engine.sheet(clip.sheet)!;
    const moving =
      !!cut && cut.r2 - cut.r1 + 1 === h && cut.c2 - cut.c1 + 1 === w && cut.r2 < from.rowOrder.length && cut.c2 < from.colOrder.length;
    let written: (CellContent | null)[][];
    if (moving) written = contents;
    else {
      const source = { sheetId: clip.sheet, r1: clip.r1, c1: clip.c1, cells: contents };
      let res;
      try {
        res = this.engine.paste(source, sheetId, at.row, at.col);
        if (res.kind === 'grow') {
          this.grow(res.sheets);
          res = this.engine.paste(source, sheetId, at.row, at.col);
        }
      } catch {
        return false;
      }
      if (res.kind !== 'cells') return false;
      written = [];
      for (let i = 0; i < h; i++) written.push(res.cells.slice(i * w, i * w + w).map((c) => c.content));
    }
    this.growTo(sheetId, at.row + h, at.col + w);
    const ops: CellOp[] = [];
    const target = new Set<string>();
    const move = moving ? { sheetId: clip.sheet, rect: cut!, toSheetId: sheetId, dr: at.row - cut!.r1, dc: at.col - cut!.c1 } : null;
    for (let i = 0; i < h; i++) {
      for (let j = 0; j < w; j++) {
        const [row, col] = this.at(sheetId, at.row + i, at.col + j);
        target.add(cellKey(sheetId, row, col));
        const st = styles[i]![j];
        let content = written[i]![j] ?? null;
        if (move && content?.f !== undefined) {
          const f = this.engine.movedFormula(content.f, clip.sheet, move, sheetId);
          if (f !== null) content = { ...content, f };
        }
        ops.push({ sheet: sheetId, row, col, content: withStyle(content, st ? this.intern(st) : undefined) });
      }
    }
    if (move) {
      // A cut empties where it came from, except where the paste just wrote.
      const source = new Set<string>();
      for (let i = 0; i < h; i++) {
        for (let j = 0; j < w; j++) {
          const row = from.rowOrder[move.rect.r1 + i]!;
          const col = from.colOrder[move.rect.c1 + j]!;
          const k = cellKey(clip.sheet, row, col);
          source.add(k);
          if (!target.has(k) && this.has(clip.sheet, row, col)) ops.push({ sheet: clip.sheet, row, col, content: null });
        }
      }
      // And every formula that read the cells reads them where they are now, as in Excel.
      for (const id of this.engine.sheetIds()) {
        const sh = this.engine.sheet(id)!;
        for (const [col, cells] of sh.cols) {
          for (const [row, cell] of cells) {
            const f = cell.content.f;
            if (f === undefined) continue;
            const k = cellKey(id, row, col);
            if (source.has(k) || target.has(k)) continue;
            const next = this.engine.movedFormula(f, id, move);
            if (next !== null) ops.push({ sheet: id, row, col, content: withStyle({ ...cell.content, f: next }, this.styleId(id, row, col)) });
          }
        }
      }
      const names = namesOf(this.doc);
      const host = sheetIdsInOrder(this.doc)[0]!;
      const renamed: [string, StoredName][] = [];
      for (const [k, n] of names.entries()) {
        const f = this.engine.movedFormula(n.f, n.scope ?? host, move);
        if (f !== null) renamed.push([k, { ...n, f }]);
      }
      this.checkOps(s, ops);
      if (renamed.length) this.tx(() => renamed.forEach(([k, n]) => names.set(k, n)));
    }
    this.writeAll(s, ops);
    return true;
  }

  private pasteTable(s: Step, sheetId: string, at: Cellpos, rows: (PastedCell | null)[][], styled: boolean): void {
    const h = rows.length;
    const w = Math.max(0, ...rows.map((r) => r.length));
    if (h === 0 || w === 0) return;
    if (h * w > CELL_LIMITS.opsPerFrame) throw refuse('too-large', MESSAGES.frame);
    this.growTo(sheetId, at.row + h, at.col + w);
    const ops: CellOp[] = [];
    const spans: Rect[] = [];
    for (let i = 0; i < h; i++) {
      for (let j = 0; j < w; j++) {
        const cell = rows[i]![j] ?? null;
        const r = at.row + i;
        const c = at.col + j;
        let content: CellContent | null = null;
        let format: string | undefined;
        if (cell) {
          const a1 = cell.r1c1 ? r1c1ToA1(cell.r1c1, r, c) : null;
          if (a1) content = this.typed(sheetId, a1)?.content ?? null;
          if (!content && cell.value !== undefined) content = { v: cell.value };
          if (!content && cell.text !== '') {
            const t = this.typed(sheetId, cell.text);
            content = t ? t.content : { v: cell.text };
            format = t?.format;
          }
          if (content?.v !== undefined && typeof content.v === 'string' && content.v.length > CELL_LIMITS.textChars) {
            content = { v: content.v.slice(0, CELL_LIMITS.textChars) };
          }
          if ((cell.rowSpan ?? 1) > 1 || (cell.colSpan ?? 1) > 1) {
            spans.push({ r1: r, c1: c, r2: r + (cell.rowSpan ?? 1) - 1, c2: c + (cell.colSpan ?? 1) - 1 });
          }
        }
        const [row, col] = this.at(sheetId, r, c);
        let style: string | undefined;
        if (styled) {
          const st = cell?.style ? cleanStyle(cell.style) : {};
          if (format && st.numFmt === undefined) st.numFmt = format;
          style = this.intern(st);
        } else {
          style = this.styleId(sheetId, row, col);
          if (format && this.wantsFormat(sheetId, row, col, format)) style = this.intern(patchStyle(this.book.get(style), { numFmt: format }));
        }
        ops.push({ sheet: sheetId, row, col, content: withStyle(content, style) });
      }
    }
    this.writeAll(s, ops);
    if (spans.length) for (const r of spans) this.mergeIn(sheetId, r);
  }

  /** Text read as if typed, growing for a formula that reaches past the edge. Null for a formula that does not read. */
  private typed(sheetId: string, text: string): { content: CellContent | null; format?: string } | null {
    if (text.length > CELL_LIMITS.formulaChars && text.startsWith('=')) return null;
    let r = this.engine.contentFromInput(sheetId, text);
    if (r.kind === 'grow') {
      this.grow(r.sheets);
      r = this.engine.contentFromInput(sheetId, text);
    }
    if (r.kind !== 'content') return null;
    return r.format ? { content: r.content, format: r.format } : { content: r.content };
  }

  /** The fill handle: series where the source is a run of numbers or a date, copies otherwise. */
  fill(sheetId: string, source: Rect, target: Rect): void {
    this.step((s) => {
      const n = (target.r2 - target.r1 + 1) * (target.c2 - target.c1 + 1);
      if (n > CELL_LIMITS.opsPerFrame) throw refuse('too-large', MESSAGES.frame);
      this.growTo(sheetId, target.r2 + 1, target.c2 + 1);
      let res = this.engine.fill(sheetId, source, target);
      if (res.kind === 'grow') {
        this.grow(res.sheets);
        res = this.engine.fill(sheetId, source, target);
      }
      if (res.kind !== 'cells') return;
      const vertical = target.r1 < source.r1 || target.r2 > source.r2;
      const ops = new Map<string, CellOp>();
      for (const w of res.cells) ops.set(`${w.rowId}\u0000${w.colId}`, { sheet: sheetId, row: w.rowId, col: w.colId, content: w.content });
      const sh = this.engine.sheet(sheetId)!;
      // A run of two or more numbers continues its line; one date counts on by days.
      const lines = vertical ? [source.c1, source.c2] : [source.r1, source.r2];
      for (let k = lines[0]!; k <= lines[1]!; k++) {
        const ids: [string, string][] = [];
        const len = vertical ? source.r2 - source.r1 + 1 : source.c2 - source.c1 + 1;
        for (let i = 0; i < len; i++) ids.push(vertical ? [sh.rowOrder[source.r1 + i]!, sh.colOrder[k]!] : [sh.rowOrder[k]!, sh.colOrder[source.c1 + i]!]);
        const xs = ids.map(([r, c]) => sh.cell(r, c)?.content);
        if (!xs.every((x) => x && x.f === undefined && typeof x.v === 'number')) continue;
        const ys = xs.map((x) => x!.v as number);
        let next: (step: number) => number;
        if (ys.length >= 2) {
          const mx = (ys.length - 1) / 2;
          const my = ys.reduce((a, b) => a + b, 0) / ys.length;
          let num = 0;
          let den = 0;
          ys.forEach((y, i) => {
            num += (i - mx) * (y - my);
            den += (i - mx) ** 2;
          });
          const slope = den ? num / den : 0;
          next = (i) => my + slope * (i - mx);
        } else {
          const fmt = this.view(sheetId).cell(vertical ? source.r1 : k, vertical ? k : source.c1)?.style.numFmt;
          if (!isDateFormat(fmt)) continue;
          next = (i) => ys[0]! + i;
        }
        const from = vertical ? target.r1 : target.c1;
        const to = vertical ? target.r2 : target.c2;
        const start = vertical ? source.r1 : source.c1;
        for (let p = from; p <= to; p++) {
          if (p >= start && p < start + len) continue;
          const [row, col] = vertical ? [sh.rowOrder[p]!, sh.colOrder[k]!] : [sh.rowOrder[k]!, sh.colOrder[p]!];
          const v = Number(next(p - start).toPrecision(15));
          ops.set(`${row}\u0000${col}`, { sheet: sheetId, row, col, content: { v } });
        }
      }
      // Formats repeat as the contents do.
      const h = source.r2 - source.r1 + 1;
      const wd = source.c2 - source.c1 + 1;
      const mod = (a: number, m: number) => ((a % m) + m) % m;
      const out: CellOp[] = [];
      for (let r = target.r1; r <= target.r2; r++) {
        for (let c = target.c1; c <= target.c2; c++) {
          if (r >= source.r1 && r <= source.r2 && c >= source.c1 && c <= source.c2) continue;
          const [row, col] = [sh.rowOrder[r]!, sh.colOrder[c]!];
          const st = this.styleId(sheetId, sh.rowOrder[source.r1 + mod(r - source.r1, h)]!, sh.colOrder[source.c1 + mod(c - source.c1, wd)]!);
          const op = ops.get(`${row}\u0000${col}`);
          const content = op ? contentOf(op.content) : null;
          if (!op && st === undefined && !this.has(sheetId, row, col)) continue;
          out.push({ sheet: sheetId, row, col, content: withStyle(content, st) });
        }
      }
      this.writeAll(s, out);
    });
  }

  // ── sizes ─────────────────────────────────────────────────────────────────

  /** A header edge dragged: `size` in CSS px at 100%; 0 hides. */
  resize(sheetId: string, axis: 'row' | 'col', from: number, to: number, size: number): void {
    this.step(() => {
      const { sh, map } = this.sheetOf(sheetId);
      const ids = (axis === 'row' ? sh.rowOrder : sh.colOrder).slice(Math.min(from, to), Math.max(from, to) + 1);
      const sizes = part(map, axis === 'row' ? 'heights' : 'widths');
      const hidden = part(map, axis === 'row' ? 'hiddenRows' : 'hiddenCols');
      const def = axis === 'row' ? DEFAULT_ROW_HEIGHT : DEFAULT_COL_WIDTH;
      const px = Math.round(size);
      this.tx(() => {
        for (const id of ids) {
          if (px <= 0) {
            if (!hidden.has(id)) hidden.set(id, true);
            continue;
          }
          if (hidden.has(id)) hidden.delete(id);
          if (px === def) {
            if (sizes.has(id)) sizes.delete(id);
          } else if (sizes.get(id) !== px) sizes.set(id, Math.min(px, axis === 'row' ? 2000 : 5000));
        }
      });
    });
  }

  /** A header edge double-clicked: each line fits what is in it. */
  autofit(sheetId: string, axis: 'row' | 'col', from: number, to: number): void {
    this.step(() => {
      const { sh, map } = this.sheetOf(sheetId);
      const view = this.view(sheetId);
      const lo = Math.min(from, to);
      const hi = Math.max(from, to);
      const sizes = part(map, axis === 'row' ? 'heights' : 'widths');
      const def = axis === 'row' ? DEFAULT_ROW_HEIGHT : DEFAULT_COL_WIDTH;
      const fits: [string, number][] = [];
      for (let i = lo; i <= hi; i++) {
        if (axis === 'col') {
          const colId = sh.colOrder[i];
          if (!colId) continue;
          const cells: FitCell[] = [];
          const ri = sh.rowIndex();
          for (const rowId of sh.cols.get(colId)?.keys() ?? []) {
            const r = ri.get(rowId);
            const c = r === undefined ? null : view.cell(r, i);
            if (c && !c.style.wrap) cells.push(c);
          }
          fits.push([colId, fitWidth(cells, this.measure)]);
        } else {
          const rowId = sh.rowOrder[i];
          if (!rowId) continue;
          const cells: (FitCell & { width: number })[] = [];
          for (let c = 0; c < sh.colOrder.length; c++) {
            if (!sh.cols.get(sh.colOrder[c]!)?.has(rowId)) continue;
            const cell = view.cell(i, c);
            if (cell) cells.push({ text: cell.text, style: cell.style, width: view.colWidth(c) });
          }
          fits.push([rowId, fitHeight(cells, this.measure)]);
        }
      }
      this.tx(() => {
        for (const [id, px] of fits) {
          if (px === def) {
            if (sizes.has(id)) sizes.delete(id);
          } else if (sizes.get(id) !== px) sizes.set(id, px);
        }
      });
    });
  }

  // ── rows and columns ──────────────────────────────────────────────────────

  insertRows(sheetId: string, at: number, count: number): void {
    this.insertLines(sheetId, 'rows', at, count);
  }

  insertCols(sheetId: string, at: number, count: number): void {
    this.insertLines(sheetId, 'cols', at, count);
  }

  private insertLines(sheetId: string, axis: Axis, at: number, count: number): void {
    this.step(() => {
      const { sh, map } = this.sheetOf(sheetId);
      const order = sh.order(axis);
      if (count <= 0) return;
      if (order.length + count > (axis === 'rows' ? MAX_ROWS : MAX_COLS)) throw refuse('refused', MESSAGES.grid);
      this.checkStructure(count * BYTES_PER_LINE);
      const ids = newIds(count);
      this.tx(() => part(map, axis === 'rows' ? 'rowOrder' : 'colOrder').insert(Math.max(0, Math.min(at, order.length)), ids));
    });
  }

  deleteRows(sheetId: string, at: number, count: number): void {
    this.deleteLines(sheetId, 'rows', at, count);
  }

  deleteCols(sheetId: string, at: number, count: number): void {
    this.deleteLines(sheetId, 'cols', at, count);
  }

  /**
   * One step: the range ends that sat on the deleted lines move off them (formulas, names, and
   * every feature's rectangle), then the lines go. Their cells stay, as orphans.
   */
  private deleteLines(sheetId: string, axis: Axis, at: number, count: number): void {
    this.step((s) => {
      const { sh, map } = this.sheetOf(sheetId);
      const order = [...sh.order(axis)];
      const n = Math.max(0, Math.min(count, order.length - at));
      if (n <= 0) return;
      if (n >= order.length) throw refuse('refused', axis === 'rows' ? MESSAGES.lastRow : MESSAGES.lastCol);
      const plan = axis === 'rows' ? this.engine.planDeleteRows(sheetId, at, n) : this.engine.planDeleteCols(sheetId, at, n);
      const ops: CellOp[] = plan.cells.map((w) => ({
        sheet: w.sheetId,
        row: w.rowId,
        col: w.colId,
        content: withStyle(w.content, this.styleId(w.sheetId, w.rowId, w.colId))
      }));
      this.checkOps(s, ops);
      this.tx(() => {
        shrinkFeatureRanges(this.doc, sheetId, axis, order, at, n);
        const names = namesOf(this.doc);
        for (const nw of plan.names) {
          const stored = nw.scope === undefined ? { name: nw.name, f: nw.formula } : { name: nw.name, scope: nw.scope, f: nw.formula };
          names.set(nameKey(nw.name, nw.scope), stored);
        }
        part(map, axis === 'rows' ? 'rowOrder' : 'colOrder').delete(at, n);
      });
      for (const op of ops) this.write(s, op);
    });
  }

  /**
   * Whole rows or columns dragged: `to` is where the first moved line is afterwards. The ids
   * move, so every formula, format and rule goes with them.
   */
  move(sheetId: string, axis: 'row' | 'col', from: number, to: number, count: number): void {
    this.step(() => {
      const { sh, map } = this.sheetOf(sheetId);
      const order = axis === 'row' ? sh.rowOrder : sh.colOrder;
      if (count <= 0 || from === to || from < 0 || from + count > order.length) return;
      const dest = Math.max(0, Math.min(to, order.length - count));
      const ids = order.slice(from, from + count);
      this.tx(() => {
        const arr = part(map, axis === 'row' ? 'rowOrder' : 'colOrder');
        arr.delete(from, count);
        arr.insert(dest, ids);
      });
    });
  }

  /** Hide or show whole rows or columns. */
  hide(sheetId: string, axis: 'row' | 'col', from: number, to: number, hidden: boolean): void {
    this.step(() => {
      const { sh, map } = this.sheetOf(sheetId);
      const ids = (axis === 'row' ? sh.rowOrder : sh.colOrder).slice(Math.min(from, to), Math.max(from, to) + 1);
      const m = part(map, axis === 'row' ? 'hiddenRows' : 'hiddenCols');
      this.tx(() => {
        for (const id of ids) {
          if (hidden && !m.has(id)) m.set(id, true);
          else if (!hidden && m.has(id)) m.delete(id);
        }
      });
    });
  }

  freeze(sheetId: string, rows: number, cols: number): void {
    this.step(() => {
      const { sh, map } = this.sheetOf(sheetId);
      this.tx(() => {
        map.set('frozenRows', Math.max(0, Math.min(rows, sh.rowOrder.length - 1)));
        map.set('frozenCols', Math.max(0, Math.min(cols, sh.colOrder.length - 1)));
      });
    });
  }

  /** As Excel and Google Sheets: the contents move and the rows stay (engine `sort`). */
  sort(sheetId: string, rect: Rect, keys: SortKey[], opts: { header?: boolean } = {}): void {
    this.step((s) => {
      const { sh, map } = this.sheetOf(sheetId);
      const r: Rect = { ...rect, r1: rect.r1 + (opts.header ? 1 : 0), r2: Math.min(rect.r2, sh.rowOrder.length - 1) };
      if (r.r2 <= r.r1 || keys.length === 0) return;
      for (const m of field(map, 'merges')?.values() ?? []) {
        const x = resolveRect(sh, m as IdRect);
        if (x && x.r1 <= r.r2 && x.r2 >= r.r1 && x.c1 <= r.c2 && x.c2 >= r.c1) throw refuse('refused', MESSAGES.sortMerged);
      }
      let res = this.engine.sort(sheetId, r, keys);
      if (res.kind === 'grow') {
        this.grow(res.sheets);
        res = this.engine.sort(sheetId, r, keys);
      }
      if (res.kind !== 'cells') return;
      // Each moved cell's final state: the engine's content, and the format from where it came.
      const next = new Map<string, CellOp>();
      for (const w of res.cells) next.set(`${w.rowId}\u0000${w.colId}`, { sheet: sheetId, row: w.rowId, col: w.colId, content: w.content });
      const ops: CellOp[] = [];
      for (let i = 0; i < res.from.length; i++) {
        const to = r.r1 + i;
        const src = res.from[i]!;
        if (src === to) continue;
        const rowId = sh.rowOrder[to]!;
        for (let c = r.c1; c <= r.c2; c++) {
          const colId = sh.colOrder[c];
          if (!colId) continue;
          const k = `${rowId}\u0000${colId}`;
          const style = this.styleId(sheetId, sh.rowOrder[src]!, colId);
          const op = next.get(k);
          if (!op && style === this.styleId(sheetId, rowId, colId)) continue;
          const content = op ? contentOf(op.content) : this.engine.storedContent(sheetId, rowId, colId);
          ops.push({ sheet: sheetId, row: rowId, col: colId, content: withStyle(content, style) });
        }
      }
      this.writeAll(s, ops);
    });
  }

  // ── merges ────────────────────────────────────────────────────────────────

  merge(sheetId: string, rect: Rect): void {
    this.step((s) => {
      if (rect.r1 === rect.r2 && rect.c1 === rect.c2) return;
      // As Excel: the top-left cell keeps its content, the others are emptied.
      const ops: CellOp[] = [];
      this.eachContent(sheetId, rect, (row, col) => {
        const [r0, c0] = this.at(sheetId, rect.r1, rect.c1);
        if (row !== r0 || col !== c0) ops.push({ sheet: sheetId, row, col, content: withStyle(null, this.styleId(sheetId, row, col)) });
      });
      this.writeAll(s, ops);
      this.mergeIn(sheetId, rect);
    });
  }

  private mergeIn(sheetId: string, rect: Rect): void {
    const { sh, map } = this.sheetOf(sheetId);
    const id = toIdRect(sh, rect);
    if (!id) return;
    const merges = part(map, 'merges');
    this.tx(() => {
      for (const [k, m] of [...merges.entries()]) {
        const x = resolveRect(sh, m);
        if (!x || (x.r1 <= rect.r2 && x.r2 >= rect.r1 && x.c1 <= rect.c2 && x.c2 >= rect.c1)) merges.delete(k);
      }
      merges.set(newId(), id);
    });
  }

  unmerge(sheetId: string, rect: Rect): void {
    this.step(() => {
      const { sh, map } = this.sheetOf(sheetId);
      const merges = part(map, 'merges');
      this.tx(() => {
        for (const [k, m] of [...merges.entries()]) {
          const x = resolveRect(sh, m);
          if (!x || (x.r1 <= rect.r2 && x.r2 >= rect.r1 && x.c1 <= rect.c2 && x.c2 >= rect.c1)) merges.delete(k);
        }
      });
    });
  }

  // ── formats ───────────────────────────────────────────────────────────────

  /**
   * A format laid over a selection. Whole columns take it as the column's format and whole rows
   * as the row's, so it reaches cells nobody has typed in yet; a cell with a format of its own
   * there takes the same fields, so the new format shows everywhere it was asked for.
   */
  setStyle(sheetId: string, rect: Rect, patch: StoredStyle): void {
    this.step((s) => {
      const { sh, map } = this.sheetOf(sheetId);
      const clean = cleanStyle(patch);
      const wholeCols = rect.r1 <= 0 && rect.r2 >= sh.rowOrder.length - 1;
      const wholeRows = !wholeCols && rect.c1 <= 0 && rect.c2 >= sh.colOrder.length - 1;
      const ops: CellOp[] = [];
      const colStyles = part(map, 'colStyles');
      const rowStyles = part(map, 'rowStyles');
      const restyle = (row: string, col: string, own: string | undefined) => {
        const under = this.book.effective(colStyles.get(col), rowStyles.get(row), undefined);
        const next = this.intern(dropIdleNulls(patchStyle(this.book.get(own), clean), under));
        if (next !== own) ops.push({ sheet: sheetId, row, col, content: withStyle(this.engine.storedContent(sheetId, row, col), next) });
      };
      if (wholeCols || wholeRows) {
        const lines = wholeCols ? sh.colOrder.slice(rect.c1, rect.c2 + 1) : sh.rowOrder.slice(rect.r1, rect.r2 + 1);
        const layer = part(map, wholeCols ? 'colStyles' : 'rowStyles');
        // A column's format is the lowest layer, so a null in it is only ever a field switched off.
        const next = (id: string) => {
          const patched = patchStyle(this.book.get(layer.get(id)), clean);
          return this.intern(wholeCols ? dropIdleNulls(patched, undefined) : patched);
        };
        const ids = lines.map((id) => [id, next(id)] as const);
        this.tx(() => {
          for (const [id, style] of ids) {
            if (style === undefined) layer.delete(id);
            else if (layer.get(id) !== style) layer.set(id, style);
          }
        });
        this.eachStyled(sheetId, rect, (row, col, own) => restyle(row, col, own));
        // The other layer, where it sets one of these fields, would hide the new format.
        const other = part(map, wholeCols ? 'rowStyles' : 'colStyles');
        const keys = Object.keys(clean) as (keyof StoredStyle)[];
        const index = wholeCols ? sh.rowIndex() : sh.colIndex();
        for (const [id, sid] of other.entries()) {
          const st = this.book.get(sid);
          if (!st || !keys.some((k) => st[k] !== undefined && st[k] !== null) || !index.has(id)) continue;
          for (const line of lines) {
            const [row, col] = wholeCols ? [id, line] : [line, id];
            if (this.styleId(sheetId, row, col) === undefined) restyle(row, col, undefined);
          }
        }
      } else {
        const r2 = Math.min(rect.r2, sh.rowOrder.length - 1);
        const c2 = Math.min(rect.c2, sh.colOrder.length - 1);
        if ((r2 - rect.r1 + 1) * (c2 - rect.c1 + 1) > CELL_LIMITS.opsPerFrame) throw refuse('too-large', MESSAGES.frame);
        for (let r = rect.r1; r <= r2; r++) {
          for (let c = rect.c1; c <= c2; c++) {
            const row = sh.rowOrder[r]!;
            const col = sh.colOrder[c]!;
            restyle(row, col, this.styleId(sheetId, row, col));
          }
        }
      }
      this.writeAll(s, ops);
    });
  }

  /** Back to the sheet's default look, contents untouched. */
  clearFormats(sheetId: string, rect: Rect): void {
    this.step((s) => {
      const { sh, map } = this.sheetOf(sheetId);
      const wholeCols = rect.r1 <= 0 && rect.r2 >= sh.rowOrder.length - 1;
      const wholeRows = rect.c1 <= 0 && rect.c2 >= sh.colOrder.length - 1;
      const rowStyles = part(map, 'rowStyles');
      const colStyles = part(map, 'colStyles');
      this.tx(() => {
        if (wholeCols) for (const id of sh.colOrder.slice(rect.c1, rect.c2 + 1)) if (colStyles.has(id)) colStyles.delete(id);
        if (wholeRows) for (const id of sh.rowOrder.slice(rect.r1, rect.r2 + 1)) if (rowStyles.has(id)) rowStyles.delete(id);
      });
      const ops: CellOp[] = [];
      this.eachStyled(sheetId, rect, (row, col) => {
        ops.push({ sheet: sheetId, row, col, content: withStyle(this.engine.storedContent(sheetId, row, col), undefined) });
      });
      // A cell under a row's or column's format that stays needs a format saying "the default here".
      const r2 = Math.min(rect.r2, sh.rowOrder.length - 1);
      const c2 = Math.min(rect.c2, sh.colOrder.length - 1);
      const layered: [string, string, StoredStyle][] = [];
      const rowIds = new Set(sh.rowOrder.slice(rect.r1, r2 + 1));
      const colIds = new Set(sh.colOrder.slice(rect.c1, c2 + 1));
      for (const [rowId, sid] of rowStyles.entries()) {
        if (!rowIds.has(rowId)) continue;
        for (const colId of colIds) layered.push([rowId, colId, this.book.get(sid) ?? {}]);
      }
      for (const [colId, sid] of colStyles.entries()) {
        if (!colIds.has(colId)) continue;
        for (const rowId of rowIds) layered.push([rowId, colId, this.book.get(sid) ?? {}]);
      }
      if (layered.length > CELL_LIMITS.opsPerFrame) throw refuse('too-large', MESSAGES.frame);
      const reset = new Map<string, StoredStyle>();
      for (const [rowId, colId, st] of layered) {
        const k = `${rowId}\u0000${colId}`;
        reset.set(k, { ...(reset.get(k) ?? {}), ...resetting(st) });
      }
      const byKey = new Map<string, CellOp>(ops.map((o) => [`${o.row}\u0000${o.col}`, o]));
      for (const [k, st] of reset) {
        const [row, col] = k.split('\u0000') as [string, string];
        byKey.set(k, { sheet: sheetId, row, col, content: withStyle(this.engine.storedContent(sheetId, row, col), this.intern(st)) });
      }
      this.writeAll(s, [...byKey.values()]);
    });
  }

  // ── sheets ────────────────────────────────────────────────────────────────

  private checkName(name: string, except?: string): string {
    const n = name.trim();
    if (!n || n.length > 31 || /[:\\/?*[\]]/.test(n) || n.startsWith("'") || n.endsWith("'")) throw refuse('refused', MESSAGES.sheetName);
    for (const s of this.sheets()) {
      if (s.id !== except && s.name.toLowerCase() === n.toLowerCase()) throw refuse('refused', `There is already a sheet called ${n}.`);
    }
    return n;
  }

  private nextName(base = 'Sheet'): string {
    const taken = new Set(this.sheets().map((s) => s.name.toLowerCase()));
    for (let i = 1; ; i++) if (!taken.has(`${base}${i}`.toLowerCase())) return `${base}${i}`;
  }

  /** A new sheet of 1,000 rows and 26 columns. Its id, or undefined when refused. */
  addSheet(name?: string, at?: number): string | undefined {
    return this.step(() => {
      const n = this.checkName(name ?? this.nextName());
      this.checkStructure((NEW_SHEET_ROWS + NEW_SHEET_COLS) * BYTES_PER_LINE + 512);
      const id = newId();
      this.tx(() => createSheet(this.doc, at === undefined ? { id, name: n, rows: newIds(NEW_SHEET_ROWS), cols: newIds(NEW_SHEET_COLS) } : { id, name: n, rows: newIds(NEW_SHEET_ROWS), cols: newIds(NEW_SHEET_COLS), at }));
      return id;
    });
  }

  /** A copy beside the original: its contents, formats, sizes and merges, under new ids. */
  duplicateSheet(id: string): string | undefined {
    return this.step((s) => {
      const { sh, map } = this.sheetOf(id);
      const base = String(field(map, 'name') ?? 'Sheet');
      let name = '';
      for (let i = 2; ; i++) {
        name = `${base.slice(0, 31 - ` (${i})`.length)} (${i})`;
        if (!this.sheets().some((x) => x.name.toLowerCase() === name.toLowerCase())) break;
      }
      const rows = sh.rowOrder.length;
      const cols = sh.colOrder.length;
      this.checkStructure((rows + cols) * BYTES_PER_LINE + 1024);
      const nid = newId();
      const rowIds = newIds(rows);
      const colIds = newIds(cols);
      const rmap = new Map(sh.rowOrder.map((r, i) => [r, rowIds[i]!] as const));
      const cmap = new Map(sh.colOrder.map((c, i) => [c, colIds[i]!] as const));
      const at = sheetOrderOf(this.doc).toArray().indexOf(id) + 1;
      this.tx(() => {
        const m = createSheet(this.doc, { id: nid, name, rows: rowIds, cols: colIds, at });
        const copyMap = <T>(key: 'heights' | 'widths' | 'hiddenRows' | 'hiddenCols' | 'rowStyles' | 'colStyles', ids: Map<string, string>) => {
          const from = part(map, key) as unknown as Y.Map<T>;
          const to = part(m, key) as unknown as Y.Map<T>;
          for (const [k, v] of from.entries()) {
            const nk = ids.get(k);
            if (nk) to.set(nk, v);
          }
        };
        copyMap('heights', rmap);
        copyMap('hiddenRows', rmap);
        copyMap('rowStyles', rmap);
        copyMap('widths', cmap);
        copyMap('hiddenCols', cmap);
        copyMap('colStyles', cmap);
        for (const r of part(map, 'merges').values()) {
          const [r1, r2, c1, c2] = [rmap.get(r.r1), rmap.get(r.r2), cmap.get(r.c1), cmap.get(r.c2)];
          if (r1 && r2 && c1 && c2) part(m, 'merges').set(newId(), { r1, r2, c1, c2 });
        }
        m.set('frozenRows', field(map, 'frozenRows') ?? 0);
        m.set('frozenCols', field(map, 'frozenCols') ?? 0);
        const tab = field(map, 'tab');
        if (typeof tab === 'string') m.set('tab', tab);
      });
      const used = this.view(id).usedRange();
      if (used) {
        const res = this.engine.paste(this.engine.copy(id, used), nid, 0, 0);
        if (res.kind === 'cells') {
          const ops: CellOp[] = res.cells.map((w) => {
            const src = [sh.rowOrder[rowIds.indexOf(w.rowId)]!, sh.colOrder[colIds.indexOf(w.colId)]!] as const;
            return { sheet: nid, row: w.rowId, col: w.colId, content: withStyle(w.content, this.styleId(id, src[0], src[1])) };
          });
          const covered = new Set(ops.map((o) => `${o.row}\u0000${o.col}`));
          this.eachStyled(id, used, (row, col, st) => {
            const nr = rmap.get(row)!;
            const nc = cmap.get(col)!;
            if (!covered.has(`${nr}\u0000${nc}`)) ops.push({ sheet: nid, row: nr, col: nc, content: { s: st } });
          });
          this.writeAll(
            s,
            ops.filter((o) => o.content !== null)
          );
        }
      }
      return nid;
    });
  }

  /** Its cells stay in the room, as a deleted row's do, for the undo. */
  removeSheet(id: string): void {
    this.step(() => {
      const visible = this.sheets().filter((x) => !x.hidden && x.id !== id);
      if (visible.length === 0) throw refuse('refused', MESSAGES.lastSheet);
      this.tx(() => {
        sheetsOf(this.doc).delete(id);
        const order = sheetOrderOf(this.doc);
        const arr = order.toArray();
        for (let i = arr.length - 1; i >= 0; i--) if (arr[i] === id) order.delete(i, 1);
      });
    });
  }

  renameSheet(id: string, name: string): void {
    this.step(() => {
      const { map } = this.sheetOf(id);
      const n = this.checkName(name, id);
      if (field(map, 'name') !== n) this.tx(() => map.set('name', n));
    });
  }

  /** `to` is the sheet's index among all sheets, hidden ones counted, once it has moved. */
  moveSheet(id: string, to: number): void {
    this.step(() => {
      const ids = sheetIdsInOrder(this.doc).filter((x) => x !== id);
      ids.splice(Math.max(0, Math.min(to, ids.length)), 0, id);
      this.tx(() => {
        const order = sheetOrderOf(this.doc);
        const now = order.toArray();
        // Only this sheet moves, so two people moving different sheets both keep their move.
        for (let i = now.length - 1; i >= 0; i--) if (now[i] === id) order.delete(i, 1);
        const after = ids.slice(0, ids.indexOf(id));
        const rest = order.toArray();
        let pos = 0;
        for (let i = 0; i < rest.length; i++) if (after.includes(rest[i]!)) pos = i + 1;
        order.insert(pos, [id]);
      });
    });
  }

  setTabColor(id: string, color: string | null): void {
    this.step(() => {
      const { map } = this.sheetOf(id);
      this.tx(() => (color ? map.set('tab', color.slice(0, 64)) : map.delete('tab')));
    });
  }

  setSheetHidden(id: string, hidden: boolean): void {
    this.step(() => {
      const { map } = this.sheetOf(id);
      if (hidden && !this.sheets().some((x) => !x.hidden && x.id !== id)) throw refuse('refused', MESSAGES.lastSheet);
      this.tx(() => (hidden ? map.set('hidden', true) : map.delete('hidden')));
    });
  }

  // ── names ─────────────────────────────────────────────────────────────────

  /** Defines a name from A1 text (`=Sheet1!$A$1:$B$4`, or a constant). `scope` is a sheet id for a sheet's own name. */
  setName(name: string, text: string, scope?: string): boolean {
    return (
      this.step(() => {
        const host = scope ?? sheetIdsInOrder(this.doc)[0];
        let r = this.engine.nameFromInput(name, scope, text, host);
        if (r.kind === 'grow') {
          this.grow(r.sheets);
          r = this.engine.nameFromInput(name, scope, text, host);
        }
        if (r.kind === 'error') throw new Refusal({ kind: 'formula', message: r.message, at: r.at });
        if (r.kind !== 'content' || !r.content?.f) return false;
        const f = r.content.f;
        this.tx(() => namesOf(this.doc).set(nameKey(name, scope), scope === undefined ? { name, f } : { name, scope, f }));
        return true;
      }) ?? false
    );
  }

  removeName(name: string, scope?: string): void {
    this.step(() => this.tx(() => namesOf(this.doc).delete(nameKey(name, scope))));
  }

  // ── rules ─────────────────────────────────────────────────────────────────

  /** Adds or replaces (with `id`) a rule or a chart; null removes it. Answers the id. */
  setRule(sheetId: string, kind: 'cf', id: string | null, rule: CfRule | null): string | undefined;
  setRule(sheetId: string, kind: 'validation', id: string | null, rule: ValidationRule | null): string | undefined;
  setRule(sheetId: string, kind: 'charts', id: string | null, rule: ChartSpec | null): string | undefined;
  setRule(sheetId: string, kind: 'cf' | 'validation' | 'charts', id: string | null, rule: unknown): string | undefined {
    return this.step(() => {
      const { map } = this.sheetOf(sheetId);
      const key = id ?? newId();
      this.tx(() => (rule === null ? part(map, kind).delete(key) : part(map, kind).set(key, rule)));
      return key;
    });
  }

  /** Puts a filter on a block (its top row the header), or with null removes it and its criteria. */
  setFilter(sheetId: string, rect: Rect | null): void {
    this.step(() => {
      const { sh, map } = this.sheetOf(sheetId);
      const filter = part(map, 'filter');
      const id = rect ? toIdRect(sh, rect) : null;
      this.tx(() => {
        for (const k of [...filter.keys()]) filter.delete(k);
        if (id) filter.set(FILTER_RANGE, id);
      });
    });
  }

  setFilterCriterion(sheetId: string, col: number, criterion: FilterCriterion | null): void {
    this.step(() => {
      const { sh, map } = this.sheetOf(sheetId);
      const colId = sh.colOrder[col];
      if (!colId) return;
      const filter = part(map, 'filter');
      this.tx(() => (criterion ? filter.set(filterKey(colId), criterion) : filter.delete(filterKey(colId))));
    });
  }

  // ── undo ──────────────────────────────────────────────────────────────────

  undo(): boolean {
    return this.history('undo');
  }

  redo(): boolean {
    return this.history('redo');
  }

  private history(kind: 'undo' | 'redo'): boolean {
    const stack = kind === 'undo' ? this.undoStack : this.redoStack;
    if (stack.length === 0) return false;
    if (this.isReadOnly()) {
      this.notify({ kind: 'read-only', message: MESSAGES.readOnly });
      return false;
    }
    const entry = stack.pop()!;
    this.step((s) => this.revert(s, entry, kind), kind);
    return true;
  }

  /**
   * An entry nobody can reach any more: the Yjs items it deleted may be collected. The
   * UndoManager keeps every item a tracked step deletes, so that an undo can bring it back.
   */
  private forget(entry: UndoEntry): void {
    if (!entry.item) return;
    this.um.undoStack = [entry.item];
    this.um.redoStack = [];
    this.um.clear(true, false);
  }

  private revert(s: Step, entry: UndoEntry, kind: 'undo' | 'redo'): void {
    if (entry.item) {
      this.um.undoStack = kind === 'undo' ? [entry.item] : [];
      this.um.redoStack = kind === 'redo' ? [entry.item] : [];
      if (kind === 'undo') this.um.undo();
      else this.um.redo();
    }
    // A cell somebody has changed since keeps their change.
    const ops: CellOp[] = [];
    for (const [k, t] of entry.cells) {
      const [sheet, row, col] = splitKey(k);
      if (sameCell(this.stored(sheet, row, col), t.after)) ops.push({ sheet, row, col, content: t.before });
    }
    this.writeAll(s, ops);
  }

  // ── presence ──────────────────────────────────────────────────────────────

  /** The person's selection, for other people's outlines. Sent at most every 100 ms, the last always. */
  select(sheetId: string, rect: Rect, active: Cellpos): void {
    const aw = this.awareness;
    const sh = this.engine.sheet(sheetId);
    if (!aw || !sh) return;
    const id = (o: string[], i: number) => o[Math.max(0, Math.min(i, o.length - 1))] ?? '';
    this.selNext = {
      sheet: sheetId,
      r1: id(sh.rowOrder, rect.r1),
      c1: id(sh.colOrder, rect.c1),
      r2: id(sh.rowOrder, rect.r2),
      c2: id(sh.colOrder, rect.c2),
      ar: id(sh.rowOrder, active.row),
      ac: id(sh.colOrder, active.col)
    };
    if (this.selTimer) return;
    this.sendSelection();
    this.selTimer = setTimeout(() => {
      this.selTimer = null;
      if (this.selNext !== this.selSent) this.sendSelection();
    }, this.opts.selectionEveryMs ?? 100);
  }

  private sendSelection(): void {
    if (!this.awareness || !this.selNext || this.destroyed) return;
    this.selSent = this.selNext;
    this.awareness.setLocalStateField('sel', this.selNext);
  }
}

/** A stored cell from a clipboard, checked as the room checks one, without its format. */
function checkCell(c: StoredCell): StoredCell | null {
  const { s: _s, ...rest } = c;
  return parseStoredCell(JSON.stringify(rest));
}

/** A cell's `cellWeight`: its ids and its content's JSON, as the room stores it. */
function weigh(sheet: string, row: string, col: string, c: StoredCell | null): number {
  return c ? cellWeight(sheet, row, col, utf8Length(JSON.stringify(c))) : 0;
}
