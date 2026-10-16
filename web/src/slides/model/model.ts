/**
 * The Slides client model: the one object the editor and every module read a deck through and
 * change it with. It owns nothing but a `Y.Doc` (ydoc.ts says its layout), so the same model runs
 * on a room's document, a local file's, a version's preview and a test's.
 *
 * ── Steps ───────────────────────────────────────────────────────────────────
 * Every change a person makes is one step: one Yjs transaction with a `StepOrigin`, and one undo
 * entry. A step checks everything first (the role, `DECK_LIMITS`, the 3 MiB state cap) and is
 * refused with a notice before it writes anything, so a refused step leaves no half of itself in
 * the room. Steps return what they made (an id, ids) or null when refused.
 *
 * ── What two people leave ───────────────────────────────────────────────────
 * Readers take the first occurrence of an id in `order`, `z` and a group's `kids` (ydoc.ts). The
 * repeats a concurrent move leaves are removed by this client's next step, in a transaction of
 * its own that undo does not track (`FIXUP`), as Sheets' `fixRepeats` does. A viewer never writes.
 *
 * ── Undo ────────────────────────────────────────────────────────────────────
 * One `Y.UndoManager` over `deck`, `order` and `slides`, tracking `StepOrigin` and the text
 * binding's origin (`ySyncPluginKey`): a text box being typed in is bound without an undo manager
 * of its own (editor/textExtensions.ts) and its Ctrl+Z calls `undo()` here, so the canvas and every text box
 * are one history. Typing merges into one entry while it is under `TYPING_MERGE_MS` apart; a step
 * always starts and ends an entry. It never undoes somebody else's change.
 *
 * ── Re-rendering only what changed ──────────────────────────────────────────
 * `subscribe` hears one `DeckChange` per transaction, naming the slides it touched. Reads are
 * cached and keep their identity until their slide changes (`slide(id)`), so a React component
 * that holds one slide re-renders when that slide does, and not when another does.
 *
 * Pure: no DOM.
 */

import { ySyncPluginKey } from '@tiptap/y-tiptap';
import * as Y from 'yjs';
import { LIMITS } from '@shared/api';
import {
  DECK_LIMITS,
  SLIDE_WIDTH,
  type Aspect,
  type DeckJSON,
  type ElementJSON,
  type LayoutJSON,
  type MasterJSON,
  type Placeholder,
  type PlaceholderType,
  type SlideJSON,
  type TextDoc,
  type ThemeJSON,
  type Transition,
  type Fill
} from './deck';
import { emptyText, isEmptyText, TextInvalid } from './schema';
import { inheritedStyle, layoutById, layoutPlaceholder, type Design, type ResolvedStyle } from './styles';
import {
  checkElements,
  countElements,
  DeckInvalid,
  deckMapOf,
  elsOf,
  fragmentAt,
  freshId,
  heightOf,
  kidsOf,
  orderOf,
  readDesign,
  readElementFields,
  readOrder,
  readSlide,
  slidesOf,
  writeElement,
  writeSlide,
  writeText,
  zOf
} from './ydoc';

// ── origins ─────────────────────────────────────────────────────────────────

/** The origin of a step's transaction. The undo manager tracks the class, so every step is undoable. */
export class StepOrigin {
  constructor(readonly name: string) {}
}

/** Repairs and the first fragment of a box's text: never an undo entry of their own. */
export const FIXUP = Symbol('slides-fixup');

/** Keystrokes closer together than this are one undo entry. */
export const TYPING_MERGE_MS = 500;

/** Placeholder types a new slide does not copy from its layout: a footer is something a person turns on. */
export const FOOTER_TYPES: ReadonlySet<PlaceholderType> = new Set(['dt', 'ftr', 'sldNum']);

// ── notices ─────────────────────────────────────────────────────────────────

export type NoticeKind = 'read-only' | 'limit' | 'too-large' | 'invalid';

export interface ModelNotice {
  kind: NoticeKind;
  /** One sentence for the person, in the product's voice. */
  message: string;
}

export const MESSAGES = {
  readOnly: 'You can view this presentation, not edit it.',
  slides: `A presentation holds at most ${DECK_LIMITS.slides} slides.`,
  elements: `A slide holds at most ${DECK_LIMITS.elementsPerSlide} objects.`,
  depth: `Groups can be nested at most ${DECK_LIMITS.groupDepth} deep.`,
  size: 'This presentation is at its size limit.',
  lastSlide: 'A presentation needs at least one slide.',
  invalid: 'That cannot go on a slide.'
} as const;

class Refusal extends Error {
  constructor(readonly notice: ModelNotice) {
    super(notice.message);
  }
}

const refuse = (kind: NoticeKind, message: string): Refusal => new Refusal({ kind, message });

/** Re-measure the encoded state after this much has been added since the last measure. */
const REMEASURE_BYTES = 256 * 1024;

// ── types ───────────────────────────────────────────────────────────────────

export interface DeckChange {
  /** A slide added, removed or moved. */
  order: boolean;
  /** The size, theme, master or layouts. */
  design: boolean;
  /** Slides whose own content changed (their elements, text, notes, background, layout). */
  slides: ReadonlySet<string>;
  /** This client's change: a step, an undo, typing. */
  local: boolean;
}

export interface SlideModelOptions {
  /** A viewer's page: every step is refused with a notice, and nothing is ever written. */
  readOnly?: boolean;
}

type Fields<T> = { [K in Exclude<keyof T, 'id' | 'type' | 'text' | 'rows' | 'children'>]?: T[K] | null };

/** A change to an element's own fields. `null` removes one; `undefined` leaves it. */
export type ElementPatch = Partial<
  Fields<Extract<ElementJSON, { type: 'shape' }>> &
    Fields<Extract<ElementJSON, { type: 'image' }>> &
    Fields<Extract<ElementJSON, { type: 'line' }>> &
    Fields<Extract<ElementJSON, { type: 'table' }>> &
    Fields<Extract<ElementJSON, { type: 'chart' }>> &
    Fields<Extract<ElementJSON, { type: 'group' }>>
>;

export interface SlidePatch {
  bg?: Fill | null;
  hidden?: boolean;
  showMaster?: boolean | null;
  transition?: Transition | null;
}

export type ZMove = 'front' | 'back' | 'forward' | 'backward';

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Where an element sits: its JSON and the group that holds it (null on the slide itself). */
export interface Located {
  el: ElementJSON;
  parent: string | null;
}

const STRUCTURAL = new Set(['id', 'type', 'text', 'rows', 'kids', 'children']);

/** A table's columns and row heights scaled to a new box, as the Format pane's `resizeTable` does. */
function scaleTable(map: Y.Map<unknown>, el: Extract<ElementJSON, { type: 'table' }>, w: number, h: number): void {
  const cw = el.cols.reduce((a, b) => a + b, 0);
  const rh = el.rows.reduce((a, r) => a + r.h, 0);
  if (w !== el.w && cw > 0) map.set('cols', el.cols.map((c) => Math.round(((c * w) / cw) * 100) / 100));
  const rows = map.get('rows');
  if (h !== el.h && rh > 0 && rows instanceof Y.Array) {
    rows.forEach((row, i) => {
      if (row instanceof Y.Map && el.rows[i]) row.set('h', Math.round(((el.rows[i]!.h * h) / rh) * 100) / 100);
    });
  }
}
const GEOMETRY = ['x', 'y', 'w', 'h'] as const;

const placeholderFamily = (t: PlaceholderType): string => (t === 'ctrTitle' ? 'title' : t === 'subTitle' ? 'body' : t);

/** The axis-aligned box a rotated element covers. */
export function boundsOf(e: Box & { rot?: number }): Box {
  const rot = (((e.rot ?? 0) % 360) + 360) % 360;
  if (!rot) return { x: e.x, y: e.y, w: e.w, h: e.h };
  const r = (rot * Math.PI) / 180;
  const c = Math.abs(Math.cos(r));
  const s = Math.abs(Math.sin(r));
  const w = e.w * c + e.h * s;
  const h = e.w * s + e.h * c;
  return { x: e.x + e.w / 2 - w / 2, y: e.y + e.h / 2 - h / 2, w, h };
}

export function unionOf(boxes: readonly Box[]): Box | null {
  if (!boxes.length) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const b of boxes) {
    x0 = Math.min(x0, b.x);
    y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + b.w);
    y1 = Math.max(y1, b.y + b.h);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** A copy without any id, its group's children included: what a paste writes, so every id is new. */
export function withoutIds(el: ElementJSON): ElementJSON {
  const { id: _id, ...rest } = el;
  if (rest.type === 'group') return { ...rest, children: rest.children.map(withoutIds) } as ElementJSON;
  return rest as ElementJSON;
}

/** The copy of a layout's placeholders a new slide gets: no footers, no prompt, an empty body to type in. */
export function placeholderCopies(layout: LayoutJSON | undefined): ElementJSON[] {
  const out: ElementJSON[] = [];
  for (const el of layout?.elements ?? []) {
    if (!el.ph || FOOTER_TYPES.has(el.ph.type)) continue;
    const copy = withoutIds(el);
    if (copy.type === 'shape') copy.text = emptyText();
    out.push(copy);
  }
  return out;
}

const jsonBytes = (v: unknown): number => JSON.stringify(v ?? null).length;

// ── the model ───────────────────────────────────────────────────────────────

export class SlideModel {
  readonly doc: Y.Doc;
  readonly undoManager: Y.UndoManager;
  private readOnly: boolean;
  private destroyed = false;

  private listeners = new Set<(c: DeckChange) => void>();
  private noticeListeners = new Set<(n: ModelNotice) => void>();
  private restoreListeners = new Set<(context: unknown, kind: 'undo' | 'redo') => void>();
  private undoContext: (() => unknown) | null = null;

  private _version = 0;
  private slideVersions = new Map<string, number>();

  // What the current transaction changed, flushed after it.
  private pendingOrder = false;
  private pendingDesign = false;
  private pendingSlides = new Set<string>();

  // Caches, dropped by what changes them.
  private orderCache: string[] | null = null;
  private designCache: (Design & { size: Aspect }) | null = null;
  private slideCache = new Map<string, SlideJSON>();
  private indexCache = new Map<string, Map<string, Located>>();
  private elCache = new Map<string, Map<string, ElementJSON>>();

  // Where repeats may be.
  private orderDirty = true;
  private repeatsDirty = new Set<string>();

  private bytesMeasured: number;
  private bytesSince = 0;

  constructor(doc: Y.Doc, options: SlideModelOptions = {}) {
    this.doc = doc;
    this.readOnly = options.readOnly ?? false;
    this.undoManager = new Y.UndoManager([deckMapOf(doc), orderOf(doc), slidesOf(doc)], {
      trackedOrigins: new Set<unknown>([StepOrigin, ySyncPluginKey]),
      captureTimeout: TYPING_MERGE_MS,
      // The text binding marks a transaction that is not a person's edit (a schema repair) so.
      captureTransaction: (tr) => tr.meta.get('addToHistory') !== false
    });
    this.undoManager.on('stack-item-added', (e) => {
      if (this.undoContext && !e.stackItem.meta.has('context')) e.stackItem.meta.set('context', this.undoContext());
    });
    this.undoManager.on('stack-item-popped', (e) => {
      const ctx: unknown = e.stackItem.meta.get('context');
      for (const l of this.restoreListeners) l(ctx, e.type);
    });
    for (const id of slidesOf(doc).keys()) this.repeatsDirty.add(id);
    deckMapOf(doc).observe(this.onDeck);
    orderOf(doc).observe(this.onOrder);
    slidesOf(doc).observeDeep(this.onSlides);
    doc.on('afterTransaction', this.onAfter);
    doc.on('update', this.onUpdate);
    this.bytesMeasured = Y.encodeStateAsUpdate(doc).byteLength;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    deckMapOf(this.doc).unobserve(this.onDeck);
    orderOf(this.doc).unobserve(this.onOrder);
    slidesOf(this.doc).unobserveDeep(this.onSlides);
    this.doc.off('afterTransaction', this.onAfter);
    this.doc.off('update', this.onUpdate);
    this.undoManager.destroy();
    this.listeners.clear();
    this.noticeListeners.clear();
    this.restoreListeners.clear();
  }

  // ── listening ─────────────────────────────────────────────────────────────

  /** Bumped by every change: what `useSyncExternalStore` compares. */
  get version(): number {
    return this._version;
  }

  /** Bumped by every change to one slide. 0 for a slide that never changed since the model opened. */
  slideVersion(id: string): number {
    return this.slideVersions.get(id) ?? 0;
  }

  subscribe(listener: (c: DeckChange) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onNotice(listener: (n: ModelNotice) => void): () => void {
    this.noticeListeners.add(listener);
    return () => this.noticeListeners.delete(listener);
  }

  /**
   * What the editor wants back when an entry is undone or redone (the slide and the selection).
   * `get` is called as each entry is made; `onRestore` hears it when the entry is popped.
   */
  setUndoContext(get: (() => unknown) | null): void {
    this.undoContext = get;
  }

  onRestore(listener: (context: unknown, kind: 'undo' | 'redo') => void): () => void {
    this.restoreListeners.add(listener);
    return () => this.restoreListeners.delete(listener);
  }

  get isReadOnly(): boolean {
    return this.readOnly;
  }

  setReadOnly(readOnly: boolean): void {
    if (this.readOnly === readOnly) return;
    this.readOnly = readOnly;
    this._version += 1;
    this.emit({ order: false, design: false, slides: new Set(), local: true });
  }

  private emit(c: DeckChange): void {
    for (const l of this.listeners) l(c);
  }

  private notice(n: ModelNotice): void {
    for (const l of this.noticeListeners) l(n);
  }

  private readonly onUpdate = (update: Uint8Array): void => {
    this.bytesSince += update.byteLength;
  };

  private readonly onDeck = (): void => {
    this.designCache = null;
    this.pendingDesign = true;
  };

  private readonly onOrder = (): void => {
    this.orderCache = null;
    this.orderDirty = true;
    this.pendingOrder = true;
  };

  private dirtySlide(id: string): void {
    this.slideCache.delete(id);
    this.indexCache.delete(id);
    this.pendingSlides.add(id);
  }

  private dirtyElement(slide: string, el: string): void {
    this.elCache.get(slide)?.delete(el);
  }

  private readonly onSlides = (events: Y.YEvent<Y.AbstractType<unknown>>[]): void => {
    for (const e of events) {
      const path = e.path;
      if (path.length === 0) {
        // A slide added or removed.
        for (const id of e.keys.keys()) {
          this.dirtySlide(id);
          this.elCache.delete(id);
          this.repeatsDirty.add(id);
        }
        this.orderCache = null;
        this.pendingOrder = true;
        continue;
      }
      const sid = String(path[0]);
      this.dirtySlide(sid);
      if (path.length === 1) {
        if (e.keys.has('z') || e.keys.has('els')) {
          this.elCache.delete(sid);
          this.repeatsDirty.add(sid);
        }
        continue;
      }
      if (path[1] === 'z') this.repeatsDirty.add(sid);
      else if (path[1] === 'els') {
        if (path.length === 2) for (const id of e.keys.keys()) this.dirtyElement(sid, id);
        else {
          this.dirtyElement(sid, String(path[2]));
          if (path[3] === 'kids' || e.keys.has('kids')) this.repeatsDirty.add(sid);
        }
      }
    }
  };

  private readonly onAfter = (tr: Y.Transaction): void => {
    if (!this.pendingOrder && !this.pendingDesign && this.pendingSlides.size === 0) return;
    const change: DeckChange = { order: this.pendingOrder, design: this.pendingDesign, slides: this.pendingSlides, local: tr.local };
    this.pendingOrder = false;
    this.pendingDesign = false;
    this.pendingSlides = new Set();
    this._version += 1;
    for (const id of change.slides) this.slideVersions.set(id, (this.slideVersions.get(id) ?? 0) + 1);
    this.emit(change);
  };

  // ── reading ───────────────────────────────────────────────────────────────

  /** The slide ids in order: first occurrences, and only slides that exist. */
  order(): readonly string[] {
    this.orderCache ??= readOrder(this.doc);
    return this.orderCache;
  }

  indexOf(id: string): number {
    return this.order().indexOf(id);
  }

  design(): Design & { size: Aspect } {
    this.designCache ??= readDesign(this.doc);
    return this.designCache;
  }

  get size(): Aspect {
    return this.design().size;
  }

  get width(): number {
    return SLIDE_WIDTH;
  }

  get height(): number {
    return heightOf(this.design().size);
  }

  layout(id: string): LayoutJSON | undefined {
    return layoutById(this.design(), id);
  }

  private slideMap(id: string): Y.Map<unknown> | null {
    const m = slidesOf(this.doc).get(id);
    return m instanceof Y.Map ? m : null;
  }

  /** One slide as a plain value. The same object until that slide changes. */
  slide(id: string): SlideJSON | null {
    const hit = this.slideCache.get(id);
    if (hit) return hit;
    const map = this.slideMap(id);
    if (!map) return null;
    let cache = this.elCache.get(id);
    if (!cache) this.elCache.set(id, (cache = new Map()));
    const els = cache;
    const read = (eid: string, m: Y.Map<unknown>): ElementJSON => {
      const c = els.get(eid);
      if (c) return c;
      const json = readElementFields(eid, m);
      els.set(eid, json);
      return json;
    };
    const slide = readSlide(id, map, read);
    this.slideCache.set(id, slide);
    return slide;
  }

  private index(slideId: string): Map<string, Located> {
    const hit = this.indexCache.get(slideId);
    if (hit) return hit;
    const out = new Map<string, Located>();
    const walk = (els: readonly ElementJSON[], parent: string | null): void => {
      for (const el of els) {
        if (el.id) out.set(el.id, { el, parent });
        if (el.type === 'group') walk(el.children, el.id ?? null);
      }
    };
    walk(this.slide(slideId)?.elements ?? [], null);
    this.indexCache.set(slideId, out);
    return out;
  }

  /** An element anywhere on a slide, a group's child included. */
  element(slideId: string, elId: string): ElementJSON | null {
    return this.index(slideId).get(elId)?.el ?? null;
  }

  /** The group holding an element, or null when it sits on the slide. */
  parentOf(slideId: string, elId: string): string | null {
    return this.index(slideId).get(elId)?.parent ?? null;
  }

  /** The outermost group holding an element, or the element: what a click on the canvas selects. */
  topOf(slideId: string, elId: string): string {
    let id = elId;
    let p = this.parentOf(slideId, id);
    while (p) {
      id = p;
      p = this.parentOf(slideId, id);
    }
    return id;
  }

  /** The style a paragraph at `level` inherits in this element (styles.ts). */
  styleAt(slideId: string, elId: string | null, level: number): ResolvedStyle {
    const slide = this.slide(slideId);
    const el = elId ? this.element(slideId, elId) : null;
    return inheritedStyle(this.design(), slide?.layout ?? 'blank', el?.ph ?? null, level);
  }

  /** The text fragment of a shape, for the text editor to bind. Null when it has none yet (`ensureText`). */
  textFragment(slideId: string, elId: string): Y.XmlFragment | null {
    const map = this.elMap(slideId, elId);
    return map ? fragmentAt(map, 'text') : null;
  }

  notesFragment(slideId: string): Y.XmlFragment | null {
    const map = this.slideMap(slideId);
    return map ? fragmentAt(map, 'notes') : null;
  }

  /** A table cell's text fragment. */
  cellFragment(slideId: string, elId: string, row: number, col: number): Y.XmlFragment | null {
    const rows = this.elMap(slideId, elId)?.get('rows');
    if (!(rows instanceof Y.Array)) return null;
    const r = rows.get(row);
    const cells = r instanceof Y.Map ? r.get('cells') : null;
    const c = cells instanceof Y.Array ? cells.get(col) : null;
    return c instanceof Y.Map ? fragmentAt(c, 'text') : null;
  }

  /** The whole deck as a plain value. */
  deck(): DeckJSON {
    const d = this.design();
    return {
      v: 1,
      size: d.size,
      theme: d.theme,
      master: d.master,
      layouts: [...d.layouts],
      slides: this.order().map((id) => this.slide(id)!)
    };
  }

  /** The encoded state's size, as measured or estimated. */
  bytes(): number {
    if (this.bytesSince > REMEASURE_BYTES) this.remeasure();
    return this.bytesMeasured + this.bytesSince;
  }

  /** Past `LIMITS.docStateWarnBytes`: the editor says so once. */
  nearLimit(): boolean {
    return this.bytes() >= LIMITS.docStateWarnBytes;
  }

  canUndo(): boolean {
    return !this.readOnly && this.undoManager.canUndo();
  }

  canRedo(): boolean {
    return !this.readOnly && this.undoManager.canRedo();
  }

  // ── undo ──────────────────────────────────────────────────────────────────

  undo(): boolean {
    if (this.readOnly) return false;
    this.fixRepeats();
    this.undoManager.stopCapturing();
    return this.undoManager.undo() !== null;
  }

  redo(): boolean {
    if (this.readOnly) return false;
    this.fixRepeats();
    return this.undoManager.redo() !== null;
  }

  /** Ends the current undo entry, so the next keystroke starts a new one (a box entered, a caret moved far). */
  breakTyping(): void {
    this.undoManager.stopCapturing();
  }

  // ── plumbing ──────────────────────────────────────────────────────────────

  private elMap(slideId: string, elId: string): Y.Map<unknown> | null {
    const slide = this.slideMap(slideId);
    const m = slide ? elsOf(slide)?.get(elId) : null;
    return m instanceof Y.Map ? m : null;
  }

  private remeasure(): void {
    this.bytesMeasured = Y.encodeStateAsUpdate(this.doc).byteLength;
    this.bytesSince = 0;
  }

  private checkSize(adding: number): void {
    if (this.bytes() + adding <= LIMITS.docStateMaxBytes) return;
    // The estimate counts every update, deletes included; measure before refusing.
    this.remeasure();
    if (this.bytesMeasured + adding > LIMITS.docStateMaxBytes) throw refuse('too-large', MESSAGES.size);
  }

  /**
   * One step: refused before it writes when it may not run, then one transaction with its own
   * origin between two `stopCapturing`s, so it is one undo entry and never merges with typing.
   * `check` runs before anything is written and throws a `Refusal`; `run` writes.
   */
  private step<T>(name: string, check: () => number, run: () => T): T | null {
    try {
      if (this.destroyed) return null;
      if (this.readOnly) throw refuse('read-only', MESSAGES.readOnly);
      this.fixRepeats();
      this.checkSize(check());
    } catch (e) {
      return this.refused(e);
    }
    this.undoManager.stopCapturing();
    let out!: T;
    this.doc.transact(() => {
      out = run();
    }, new StepOrigin(name));
    this.undoManager.stopCapturing();
    return out;
  }

  private refused(e: unknown): null {
    if (e instanceof Refusal) this.notice(e.notice);
    else if (e instanceof DeckInvalid) this.notice({ kind: 'limit', message: e.message });
    else if (e instanceof TextInvalid) this.notice({ kind: 'invalid', message: MESSAGES.invalid });
    else throw e;
    return null;
  }

  /**
   * Removes the repeats and the ids with no entry that concurrent moves left in `order`, `z` and
   * `kids`, keeping each first occurrence (the one readers already draw). Its own transaction,
   * untracked by undo, and never on a viewer's page.
   */
  fixRepeats(): void {
    if (this.readOnly || (!this.orderDirty && this.repeatsDirty.size === 0)) return;
    const slides = slidesOf(this.doc);
    const order = orderOf(this.doc);
    const cuts: [Y.Array<string>, number[]][] = [];
    if (this.orderDirty) {
      const seen = new Set<string>();
      const drop: number[] = [];
      order.toArray().forEach((id, i) => {
        if (seen.has(id) || !(slides.get(id) instanceof Y.Map)) drop.push(i);
        else seen.add(id);
      });
      if (drop.length) cuts.push([order, drop]);
    }
    for (const sid of this.repeatsDirty) {
      const slide = slides.get(sid);
      if (!(slide instanceof Y.Map)) continue;
      const els = elsOf(slide);
      const z = zOf(slide);
      if (!els || !z) continue;
      const seen = new Set<string>();
      const walk = (list: Y.Array<string>, depth: number): void => {
        const drop: number[] = [];
        list.toArray().forEach((id, i) => {
          const m = els.get(id);
          if (seen.has(id) || !(m instanceof Y.Map)) {
            drop.push(i);
            return;
          }
          seen.add(id);
          const kids = m.get('type') === 'group' ? kidsOf(m) : null;
          if (kids && depth < DECK_LIMITS.groupDepth) walk(kids, depth + 1);
        });
        if (drop.length) cuts.push([list, drop]);
      };
      walk(z, 0);
    }
    this.orderDirty = false;
    this.repeatsDirty.clear();
    if (!cuts.length) return;
    this.doc.transact(() => {
      for (const [list, drop] of cuts) for (let k = drop.length - 1; k >= 0; k--) list.delete(drop[k]!, 1);
    }, FIXUP);
  }

  /** The raw index in `list` of the clean position `at` of `clean` (the end when past it). */
  private static rawIndex(list: Y.Array<string>, clean: readonly string[], at: number): number {
    if (at >= clean.length) return list.length;
    const target = clean[Math.max(0, at)]!;
    const raw = list.toArray();
    const i = raw.indexOf(target);
    return i < 0 ? raw.length : i;
  }

  private static removeAll(list: Y.Array<string>, ids: ReadonlySet<string>): void {
    const raw = list.toArray();
    for (let i = raw.length - 1; i >= 0; i--) if (ids.has(raw[i]!)) list.delete(i, 1);
  }

  /** The list an element sits in: the slide's `z`, or its group's `kids`. */
  private listOf(slideId: string, elId: string): Y.Array<string> | null {
    const slide = this.slideMap(slideId);
    if (!slide) return null;
    const parent = this.parentOf(slideId, elId);
    if (!parent) return zOf(slide);
    const g = this.elMap(slideId, parent);
    return g ? kidsOf(g) : null;
  }

  private descendants(slideId: string, elId: string): string[] {
    const out: string[] = [];
    const el = this.element(slideId, elId);
    const walk = (e: ElementJSON): void => {
      if (e.type !== 'group') return;
      for (const c of e.children) {
        if (c.id) out.push(c.id);
        walk(c);
      }
    };
    if (el) walk(el);
    return out;
  }

  private countOn(slideId: string): number {
    return countElements(this.slide(slideId)?.elements ?? []);
  }

  // ── slide steps ───────────────────────────────────────────────────────────

  /** A new slide with a copy of `layoutId`'s placeholders, at `at` (the end by default). Its id. */
  addSlide(layoutId: string, at?: number): string | null {
    const layout = this.layout(layoutId);
    const elements = placeholderCopies(layout);
    return this.step(
      'add-slide',
      () => {
        if (this.order().length + 1 > DECK_LIMITS.slides) throw refuse('limit', MESSAGES.slides);
        return jsonBytes(elements) + 64;
      },
      () => this.insertSlides([{ layout: layout ? layoutId : 'blank', elements }], at ?? this.order().length)[0]!
    );
  }

  private insertSlides(slides: readonly SlideJSON[], at: number): string[] {
    const map = slidesOf(this.doc);
    const order = orderOf(this.doc);
    const used = new Set<string>([...map.keys()]);
    const ids = slides.map((s) => {
      const id = freshId(used);
      used.add(id);
      writeSlide(map, id, s);
      return id;
    });
    order.insert(SlideModel.rawIndex(order, this.order(), at), ids);
    return ids;
  }

  /** Copies of `ids`, in deck order, after the last of them. Their ids. */
  duplicateSlides(ids: readonly string[]): string[] | null {
    const order = this.order();
    const chosen = order.filter((id) => ids.includes(id));
    if (!chosen.length) return [];
    const copies = chosen.map((id) => this.slide(id)!);
    return this.step(
      'duplicate-slides',
      () => {
        if (order.length + copies.length > DECK_LIMITS.slides) throw refuse('limit', MESSAGES.slides);
        return jsonBytes(copies);
      },
      () => this.insertSlides(copies, order.indexOf(chosen[chosen.length - 1]!) + 1)
    );
  }

  /** Slides as plain values, from a clipboard, with new ids, at `at`. Their ids. */
  pasteSlides(slides: readonly SlideJSON[], at?: number): string[] | null {
    if (!slides.length) return [];
    return this.step(
      'paste-slides',
      () => {
        if (this.order().length + slides.length > DECK_LIMITS.slides) throw refuse('limit', MESSAGES.slides);
        for (const s of slides) checkElements(s.elements ?? []);
        return jsonBytes(slides);
      },
      () => this.insertSlides(slides.map(({ id: _id, ...s }) => s), at ?? this.order().length)
    );
  }

  deleteSlides(ids: readonly string[]): boolean {
    const gone = new Set(ids.filter((id) => this.slideMap(id)));
    if (!gone.size) return false;
    return (
      this.step(
        'delete-slides',
        () => {
          if (this.order().every((id) => gone.has(id))) throw refuse('limit', MESSAGES.lastSlide);
          return 0;
        },
        () => {
          SlideModel.removeAll(orderOf(this.doc), gone);
          for (const id of gone) slidesOf(this.doc).delete(id);
          return true;
        }
      ) ?? false
    );
  }

  /**
   * Moves `ids`, kept in deck order, so they sit together before the slide that is at `to` now
   * (the end when `to` is the length): what a drop between two thumbnails asks for.
   */
  moveSlides(ids: readonly string[], to: number): boolean {
    const order = this.order();
    const moving = order.filter((id) => ids.includes(id));
    if (!moving.length) return false;
    const set = new Set(moving);
    const k = order.slice(0, Math.max(0, Math.min(to, order.length))).filter((id) => !set.has(id)).length;
    const rest = order.filter((id) => !set.has(id));
    const next = [...rest.slice(0, k), ...moving, ...rest.slice(k)];
    if (next.every((id, i) => id === order[i])) return false;
    return (
      this.step(
        'move-slides',
        () => 0,
        () => {
          const list = orderOf(this.doc);
          SlideModel.removeAll(list, set);
          list.insert(SlideModel.rawIndex(list, rest, k), moving);
          return true;
        }
      ) ?? false
    );
  }

  setSlides(ids: readonly string[], patch: SlidePatch): boolean {
    const maps = ids.map((id) => this.slideMap(id)).filter((m): m is Y.Map<unknown> => !!m);
    if (!maps.length) return false;
    return (
      this.step(
        'set-slides',
        () => jsonBytes(patch) * maps.length,
        () => {
          for (const m of maps) {
            for (const [k, v] of Object.entries(patch)) {
              if (v === undefined) continue;
              if (v === null || (k === 'hidden' && v === false) || (k === 'showMaster' && v === true)) m.delete(k);
              else m.set(k, v);
            }
          }
          return true;
        }
      ) ?? false
    );
  }

  /** Replaces a slide's speaker notes. The notes area binds the fragment instead. */
  setNotes(slideId: string, notes: TextDoc): boolean {
    const frag = this.notesFragment(slideId);
    const slide = this.slideMap(slideId);
    if (!slide) return false;
    return (
      this.step(
        'set-notes',
        () => jsonBytes(notes),
        () => {
          if (frag) writeText(frag, notes);
          else {
            const f = new Y.XmlFragment();
            slide.set('notes', f);
            writeText(f, notes);
          }
          return true;
        }
      ) ?? false
    );
  }

  /**
   * Gives `ids` the layout `layoutId`. Each placeholder of the new layout takes the slide's
   * placeholder of the same type and index (else of the same kind: a title for a centred title,
   * content for a subtitle), keeping its text and taking the layout's position. A new layout's
   * placeholder that matches nothing is added empty; a slide's that matches nothing is kept when
   * it has text and removed when it has none.
   */
  setLayout(ids: readonly string[], layoutId: string): boolean {
    const to = this.layout(layoutId);
    const slides = ids.filter((id) => this.slideMap(id));
    if (!slides.length || !to) return false;
    return (
      this.step(
        'set-layout',
        () => {
          for (const id of slides) {
            const adds = placeholderCopies(to).length;
            if (this.countOn(id) + adds > DECK_LIMITS.elementsPerSlide) throw refuse('limit', MESSAGES.elements);
          }
          return jsonBytes(to.elements) * slides.length;
        },
        () => {
          for (const id of slides) {
            const from = this.layout(this.slide(id)!.layout);
            this.remap(id, from, to, 'layout');
            this.slideMap(id)!.set('layout', layoutId);
          }
          return true;
        }
      ) ?? false
    );
  }

  /**
   * Each slide's placeholders back where its own layout puts them, with the layout's text box
   * settings; a placeholder the layout has and the slide lost comes back empty, and an empty one
   * the layout does not have goes. Text is kept. PowerPoint's Reset.
   */
  resetSlides(ids: readonly string[]): boolean {
    const slides = ids.filter((id) => this.slideMap(id));
    if (!slides.length) return false;
    return (
      this.step(
        'reset-slides',
        () => {
          let bytes = 0;
          for (const id of slides) {
            const layout = this.layout(this.slide(id)!.layout);
            if (this.countOn(id) + placeholderCopies(layout).length > DECK_LIMITS.elementsPerSlide) throw refuse('limit', MESSAGES.elements);
            bytes += jsonBytes(layout?.elements ?? []);
          }
          return bytes;
        },
        () => {
          for (const id of slides) {
            const layout = this.layout(this.slide(id)!.layout);
            this.remap(id, layout, layout, 'layout');
          }
          return true;
        }
      ) ?? false
    );
  }

  /**
   * A new theme, master and layouts for the whole deck. Slides keep their layout ids (a layout
   * this design does not have becomes its first), their placeholders keep their text, and a
   * placeholder that sits where the old layout put it moves to where the new one does; one a
   * person moved stays.
   */
  setDesign(design: { theme: ThemeJSON; master: MasterJSON; layouts: LayoutJSON[] }): boolean {
    const old = this.design();
    return (
      this.step(
        'set-design',
        () => jsonBytes(design),
        () => {
          const meta = deckMapOf(this.doc);
          meta.set('theme', design.theme);
          meta.set('master', design.master);
          meta.set('layouts', design.layouts);
          const fallback = design.layouts.find((l) => l.id === 'titleContent') ?? design.layouts[0];
          for (const id of this.order()) {
            const slide = this.slide(id)!;
            const to = design.layouts.find((l) => l.id === slide.layout) ?? fallback;
            const from = old.layouts.find((l) => l.id === slide.layout);
            this.remap(id, from, to, 'design');
            if (to && to.id !== slide.layout) this.slideMap(id)!.set('layout', to.id);
          }
          return true;
        }
      ) ?? false
    );
  }

  private remap(slideId: string, from: LayoutJSON | undefined, to: LayoutJSON | undefined, mode: 'layout' | 'design'): void {
    const slide = this.slideMap(slideId)!;
    const els = elsOf(slide);
    const z = zOf(slide);
    if (!els || !z) return;
    const current = (this.slide(slideId)?.elements ?? []).filter((e) => e.ph && e.id) as (ElementJSON & { id: string; ph: Placeholder })[];
    const targets = (to?.elements ?? []).filter((e) => e.ph && !FOOTER_TYPES.has(e.ph.type)) as (ElementJSON & { ph: Placeholder })[];
    const used = new Set<string>();
    const pending: ElementJSON[] = [];
    for (const t of targets) {
      const m =
        current.find((c) => !used.has(c.id) && c.ph.type === t.ph.type && (c.ph.idx ?? null) === (t.ph.idx ?? null)) ??
        current.find((c) => !used.has(c.id) && placeholderFamily(c.ph.type) === placeholderFamily(t.ph.type));
      if (!m) {
        if (mode === 'layout') pending.push(placeholderCopies({ id: '', name: '', elements: [t] })[0]!);
        continue;
      }
      used.add(m.id);
      const map = els.get(m.id)!;
      const was = layoutPlaceholder(from, m.ph);
      const untouched = mode === 'layout' || (was && GEOMETRY.every((k) => Math.abs(was[k] - m[k]) < 0.5));
      if (JSON.stringify(m.ph) !== JSON.stringify(t.ph)) map.set('ph', t.ph);
      if (untouched) {
        for (const k of GEOMETRY) if (m[k] !== t[k]) map.set(k, t[k]);
        if (t.type === 'shape' && t.textBox) map.set('textBox', t.textBox);
      }
    }
    if (mode === 'layout') {
      const drop = new Set<string>();
      for (const c of current) {
        if (used.has(c.id)) continue;
        const empty = c.type === 'shape' ? isEmptyText(c.text) : c.type === 'group' ? false : c.type !== 'image';
        if (empty) drop.add(c.id);
      }
      if (drop.size) {
        SlideModel.removeAll(z, drop);
        for (const id of drop) els.delete(id);
      }
      if (pending.length) {
        const ids = new Set<string>(els.keys());
        z.push(pending.map((p) => writeElement(els, p, ids)));
      }
    }
  }

  // ── element steps ─────────────────────────────────────────────────────────

  /** One element, at `at` in the slide's back-to-front order (the front by default). Its id. */
  addElement(slideId: string, el: ElementJSON, at?: number): string | null {
    return this.addElements(slideId, [el], at)?.[0] ?? null;
  }

  /** Elements, given new ids, at `at` (the front by default): what a paste and an insert do. Their ids. */
  addElements(slideId: string, elements: readonly ElementJSON[], at?: number): string[] | null {
    const slide = this.slideMap(slideId);
    if (!slide || !elements.length) return slide ? [] : null;
    const fresh = elements.map((e) => {
      const copy = withoutIds(e);
      // A shape gets a body to type in when it is made, so its first keystroke is not a write of its own.
      if (copy.type === 'shape' && !copy.text) copy.text = emptyText();
      return copy;
    });
    return this.step(
      'add-elements',
      () => {
        checkElements(fresh);
        if (this.countOn(slideId) + countElements(fresh) > DECK_LIMITS.elementsPerSlide) throw refuse('limit', MESSAGES.elements);
        return jsonBytes(fresh);
      },
      () => {
        const els = elsOf(slide)!;
        const z = zOf(slide)!;
        const used = new Set<string>(els.keys());
        const ids = fresh.map((e) => writeElement(els, e, used));
        const clean = (this.slide(slideId)?.elements ?? []).map((e) => e.id!);
        z.insert(at === undefined ? z.length : SlideModel.rawIndex(z, clean, at), ids);
        return ids;
      }
    );
  }

  /** Pasted elements: `addElements`, named for the history. */
  pasteElements(slideId: string, elements: readonly ElementJSON[]): string[] | null {
    return this.addElements(slideId, elements);
  }

  /** Copies of elements on the same slide, offset by `dx`, `dy`, each in front of everything. Their ids. */
  duplicateElements(slideId: string, ids: readonly string[], dx = 0, dy = 0): string[] | null {
    const els = ids.map((id) => this.element(slideId, id)).filter((e): e is ElementJSON => !!e);
    return this.addElements(slideId, els.map((e) => (dx || dy ? translated(e, dx, dy) : e)));
  }

  /**
   * Changes elements' own fields, each in one transaction. A group's new box moves and scales
   * its children with it, as they are in slide coordinates.
   */
  updateElements(slideId: string, patches: readonly { id: string; patch: ElementPatch }[]): boolean {
    const work = patches
      .map(({ id, patch }) => ({ id, patch, map: this.elMap(slideId, id), el: this.element(slideId, id) }))
      .filter((p) => p.map && p.el);
    if (!work.length) return false;
    return (
      this.step(
        'update-elements',
        () => {
          for (const { patch } of work) {
            for (const k of GEOMETRY) {
              const v = (patch as Record<string, unknown>)[k];
              if (v !== undefined && (typeof v !== 'number' || !Number.isFinite(v))) throw refuse('invalid', MESSAGES.invalid);
            }
            const asset = (patch as { asset?: { id?: unknown } | null }).asset;
            if (asset && typeof asset.id !== 'string') throw refuse('invalid', MESSAGES.invalid);
          }
          return jsonBytes(patches);
        },
        () => {
          for (const { id, patch, map, el } of work) {
            if (el!.type === 'group') this.transformChildren(slideId, id, el!, patch);
            // A table is drawn from its columns and rows, so a new box scales them with it.
            if (el!.type === 'table' && patch.cols === undefined) scaleTable(map!, el!, patch.w ?? el!.w, patch.h ?? el!.h);
            for (const [k, v] of Object.entries(patch)) {
              if (v === undefined || STRUCTURAL.has(k)) continue;
              if (v === null) map!.delete(k);
              else map!.set(k, v);
            }
          }
          return true;
        }
      ) ?? false
    );
  }

  /** Moves elements by `dx`, `dy`. */
  moveElements(slideId: string, ids: readonly string[], dx: number, dy: number): boolean {
    if (!dx && !dy) return false;
    return this.updateElements(
      slideId,
      ids
        .map((id) => this.element(slideId, id))
        .filter((e): e is ElementJSON => !!e)
        .map((e) => ({ id: e.id!, patch: { x: e.x + dx, y: e.y + dy } }))
    );
  }

  private transformChildren(slideId: string, groupId: string, group: ElementJSON, patch: ElementPatch): void {
    const nx = patch.x ?? group.x;
    const ny = patch.y ?? group.y;
    const nw = patch.w ?? group.w;
    const nh = patch.h ?? group.h;
    if (nx === group.x && ny === group.y && nw === group.w && nh === group.h) return;
    const sx = group.w ? nw / group.w : 1;
    const sy = group.h ? nh / group.h : 1;
    for (const id of this.descendants(slideId, groupId)) {
      const c = this.element(slideId, id);
      const m = this.elMap(slideId, id);
      if (!c || !m) continue;
      m.set('x', nx + (c.x - group.x) * sx);
      m.set('y', ny + (c.y - group.y) * sy);
      if (sx !== 1) m.set('w', c.w * sx);
      if (sy !== 1) m.set('h', c.h * sy);
      if (c.type === 'table') scaleTable(m, c, c.w * sx, c.h * sy);
    }
  }

  /** Deletes elements, a group's children with it. A group left with no children goes too. */
  deleteElements(slideId: string, ids: readonly string[]): boolean {
    const slide = this.slideMap(slideId);
    const present = ids.filter((id) => this.element(slideId, id));
    if (!slide || !present.length) return false;
    return (
      this.step(
        'delete-elements',
        () => 0,
        () => {
          const els = elsOf(slide)!;
          const gone = new Set<string>();
          for (const id of present) {
            gone.add(id);
            for (const d of this.descendants(slideId, id)) gone.add(d);
          }
          // Groups emptied by this delete, innermost first.
          const parents = new Set(present.map((id) => this.parentOf(slideId, id)).filter((p): p is string => !!p));
          let grew = true;
          while (grew) {
            grew = false;
            for (const p of parents) {
              if (gone.has(p)) continue;
              const g = this.element(slideId, p);
              if (g?.type === 'group' && g.children.every((c) => gone.has(c.id!))) {
                gone.add(p);
                const pp = this.parentOf(slideId, p);
                if (pp) parents.add(pp);
                grew = true;
              }
            }
          }
          const lists = new Set<Y.Array<string>>();
          for (const id of gone) {
            const l = this.listOf(slideId, id);
            if (l) lists.add(l);
          }
          for (const l of lists) SlideModel.removeAll(l, gone);
          for (const id of gone) els.delete(id);
          return true;
        }
      ) ?? false
    );
  }

  /** Brings elements to the front or forward one, or sends them to the back or back one, among their siblings. */
  reorder(slideId: string, ids: readonly string[], how: ZMove): boolean {
    const byList = new Map<Y.Array<string>, Set<string>>();
    for (const id of ids) {
      if (!this.element(slideId, id)) continue;
      const l = this.listOf(slideId, id);
      if (!l) continue;
      if (!byList.has(l)) byList.set(l, new Set());
      byList.get(l)!.add(id);
    }
    const plans: [Y.Array<string>, Set<string>, string[]][] = [];
    for (const [list, moving] of byList) {
      const cur = list.toArray();
      const next = arranged(cur, moving, how);
      if (next.some((id, i) => id !== cur[i])) plans.push([list, moving, next]);
    }
    if (!plans.length) return false;
    return (
      this.step(
        'reorder',
        () => 0,
        () => {
          for (const [list, moving, next] of plans) {
            SlideModel.removeAll(list, moving);
            next.forEach((id, i) => {
              if (moving.has(id)) list.insert(i, [id]);
            });
          }
          return true;
        }
      ) ?? false
    );
  }

  /**
   * Groups siblings into one group, placed where the frontmost of them was. Elements in
   * different groups are grouped by the outermost ancestor each has on the slide. Its id.
   */
  group(slideId: string, ids: readonly string[]): string | null {
    const slide = this.slideMap(slideId);
    if (!slide) return null;
    const tops = [...new Set(ids.filter((id) => this.element(slideId, id)).map((id) => this.topOf(slideId, id)))];
    if (tops.length < 2) return null;
    const subtree = (id: string): number => {
      const e = this.element(slideId, id);
      return e?.type === 'group' ? 1 + Math.max(0, ...e.children.map((c) => subtree(c.id!))) : 0;
    };
    return this.step(
      'group',
      () => {
        if (1 + Math.max(...tops.map(subtree)) > DECK_LIMITS.groupDepth) throw refuse('limit', MESSAGES.depth);
        if (this.countOn(slideId) + 1 > DECK_LIMITS.elementsPerSlide) throw refuse('limit', MESSAGES.elements);
        return 128;
      },
      () => {
        const els = elsOf(slide)!;
        const z = zOf(slide)!;
        const zIds = z.toArray();
        const set = new Set(tops);
        const members = zIds.filter((id) => set.has(id));
        const box = unionOf(members.map((id) => boundsOf(this.element(slideId, id)!)))!;
        // Where the frontmost member was, among what stays.
        const at = zIds.slice(0, zIds.lastIndexOf(members[members.length - 1]!)).filter((id) => !set.has(id)).length;
        const id = freshId(new Set<string>(els.keys()));
        const g = new Y.Map<unknown>();
        els.set(id, g);
        g.set('type', 'group');
        for (const k of GEOMETRY) g.set(k, box[k]);
        const kids = new Y.Array<string>();
        g.set('kids', kids);
        kids.push(members);
        SlideModel.removeAll(z, set);
        z.insert(Math.min(at, z.length), [id]);
        return id;
      }
    );
  }

  /** Ungroups groups: their children take their place, turned with them. The children's ids. */
  ungroup(slideId: string, ids: readonly string[]): string[] | null {
    const slide = this.slideMap(slideId);
    const groups = ids.map((id) => this.element(slideId, id)).filter((e): e is ElementJSON & { type: 'group' } => e?.type === 'group');
    if (!slide || !groups.length) return null;
    return this.step(
      'ungroup',
      () => 0,
      () => {
        const els = elsOf(slide)!;
        const out: string[] = [];
        for (const g of groups) {
          const list = this.listOf(slideId, g.id!);
          if (!list) continue;
          const kids = g.children.map((c) => c.id!);
          const rot = g.rot ?? 0;
          if (rot) {
            const cx = g.x + g.w / 2;
            const cy = g.y + g.h / 2;
            const r = (rot * Math.PI) / 180;
            for (const c of g.children) {
              const ox = c.x + c.w / 2 - cx;
              const oy = c.y + c.h / 2 - cy;
              const dx = cx + ox * Math.cos(r) - oy * Math.sin(r) - (c.x + c.w / 2);
              const dy = cy + ox * Math.sin(r) + oy * Math.cos(r) - (c.y + c.h / 2);
              for (const id of [c.id!, ...this.descendants(slideId, c.id!)]) {
                const e = this.element(slideId, id)!;
                const m = els.get(id)!;
                m.set('x', e.x + dx);
                m.set('y', e.y + dy);
              }
              els.get(c.id!)!.set('rot', ((((c.rot ?? 0) + rot) % 360) + 360) % 360);
            }
          }
          const at = list.toArray().indexOf(g.id!);
          SlideModel.removeAll(list, new Set([g.id!]));
          list.insert(Math.max(0, Math.min(at, list.length)), kids);
          els.delete(g.id!);
          out.push(...kids);
        }
        return out;
      }
    );
  }

  /** Replaces a shape's text. The text editor binds the fragment instead; this is for a converter, the assistant and a test. */
  setText(slideId: string, elId: string, text: TextDoc): boolean {
    return this.setTexts(slideId, [{ id: elId, text }]);
  }

  /**
   * Replaces the text of several shapes in one step: formatting applied to the whole of each
   * selected box. Elements that are not shapes are skipped; false when none is.
   */
  setTexts(slideId: string, entries: readonly { id: string; text: TextDoc }[]): boolean {
    const maps = entries
      .map((e) => ({ map: this.elMap(slideId, e.id), text: e.text }))
      .filter((e): e is { map: Y.Map<unknown>; text: TextDoc } => e.map !== null && e.map.get('type') === 'shape');
    if (!maps.length) return false;
    return (
      this.step(
        'set-text',
        () => maps.reduce((n, e) => n + jsonBytes(e.text), 0),
        () => {
          for (const { map, text } of maps) {
            const frag = fragmentAt(map, 'text');
            if (frag) writeText(frag, text);
            else {
              const f = new Y.XmlFragment();
              map.set('text', f);
              writeText(f, text);
            }
          }
          return true;
        }
      ) ?? false
    );
  }

  /**
   * The shape's text fragment, made empty when it has none (a shape from an import, a layout's
   * decoration copied by hand). The making is not an undo entry. Null on a viewer's page.
   */
  ensureText(slideId: string, elId: string): Y.XmlFragment | null {
    const have = this.textFragment(slideId, elId);
    if (have) return have;
    const map = this.elMap(slideId, elId);
    if (!map || map.get('type') !== 'shape' || this.readOnly) return null;
    let frag: Y.XmlFragment | null = null;
    this.doc.transact(() => {
      frag = new Y.XmlFragment();
      map.set('text', frag);
      writeText(frag, emptyText());
    }, FIXUP);
    return frag;
  }

  /** The slide's notes fragment, made empty when it has none, as `ensureText` does. Null on a viewer's page. */
  ensureNotes(slideId: string): Y.XmlFragment | null {
    const have = this.notesFragment(slideId);
    if (have) return have;
    const map = this.slideMap(slideId);
    if (!map || this.readOnly) return null;
    let frag: Y.XmlFragment | null = null;
    this.doc.transact(() => {
      frag = new Y.XmlFragment();
      map.set('notes', frag);
      writeText(frag, emptyText());
    }, FIXUP);
    return frag;
  }
}

/** An element moved by `dx`, `dy`, a group's children with it. */
export function translated(e: ElementJSON, dx: number, dy: number): ElementJSON {
  const moved = { ...e, x: e.x + dx, y: e.y + dy } as ElementJSON;
  if (moved.type === 'group') moved.children = moved.children.map((c) => translated(c, dx, dy));
  return moved;
}

/** `list` with `moving` brought to the front, sent to the back, or one step either way. Unmoved ids keep their order. */
export function arranged(list: readonly string[], moving: ReadonlySet<string>, how: ZMove): string[] {
  const rest = list.filter((id) => !moving.has(id));
  const mine = list.filter((id) => moving.has(id));
  if (how === 'front') return [...rest, ...mine];
  if (how === 'back') return [...mine, ...rest];
  const out = [...list];
  if (how === 'forward') {
    for (let i = out.length - 2; i >= 0; i--) {
      if (moving.has(out[i]!) && !moving.has(out[i + 1]!)) [out[i], out[i + 1]] = [out[i + 1]!, out[i]!];
    }
  } else {
    for (let i = 1; i < out.length; i++) {
      if (moving.has(out[i]!) && !moving.has(out[i - 1]!)) [out[i], out[i - 1]] = [out[i - 1]!, out[i]!];
    }
  }
  return out;
}
