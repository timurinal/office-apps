/**
 * The deck's Yjs layout, and the conversions between it and `DeckJSON`.
 *
 * deck.ts states the layout; this file is the only code that knows it. Everything else reads a
 * deck through `SlideModel` (model.ts) or through `yToDeck`, and makes one through `deckToY`.
 *
 *   deck     Y.Map    v · size · theme · master · layouts       plain values, last write wins
 *   order    Y.Array  slide ids
 *   slides   Y.Map    id → Y.Map { layout, bg?, hidden?, showMaster?, transition?, notes: XmlFragment,
 *                                  z: Y.Array<id>, els: Y.Map<id → Y.Map> }
 *
 * An element's map holds each `ElementJSON` field as its own key, except:
 *   - `id`        is the key it is filed under in `els`, and not stored again;
 *   - `text`      a Y.XmlFragment in the slide text schema;
 *   - `rows`      a table's rows: Y.Array<Y.Map { h, cells: Y.Array<Y.Map { text: XmlFragment,
 *                 fill?, rowSpan?, colSpan?, merged?, anchor? } > }>, so two people typing in two
 *                 cells both land, as two people moving and resizing one shape do;
 *   - `children`  a group's are elements of the same `els`, listed back to front in its
 *                 `kids: Y.Array<id>`, and absent from the slide's `z`.
 *
 * ── Reading what two people left ────────────────────────────────────────────
 * A move is a delete and an insert, so two people moving one slide, or one element in `z`, leave
 * it twice. Readers take the **first** occurrence. An element is drawn in the first place the
 * walk meets it: `z` back to front, a group's kids where the group is met. So an element both in
 * `z` and in a group's `kids` (one person grouped it while another moved it) is drawn once, and
 * the next step removes the other occurrence (`repeats`). An id with no entry is skipped.
 *
 * Pure: no DOM, so `deckToY` runs in a Web Worker for an import, as docs/seed.ts does.
 */

import { prosemirrorToYXmlFragment, yXmlFragmentToProsemirrorJSON } from '@tiptap/y-tiptap';
import * as Y from 'yjs';
import { LIMITS } from '@shared/api';
import {
  DECK_LIMITS,
  SLIDE_HEIGHT,
  type Aspect,
  type AssetRef,
  type DeckJSON,
  type ElementJSON,
  type LayoutJSON,
  type MasterJSON,
  type SlideJSON,
  type TableCell,
  type TextDoc,
  type TextNode,
  type ThemeJSON
} from './deck';
import { newId } from './ids';
import { emptyText, textNode } from './schema';

// ── names ───────────────────────────────────────────────────────────────────

export const deckMapOf = (doc: Y.Doc): Y.Map<unknown> => doc.getMap('deck');
export const orderOf = (doc: Y.Doc): Y.Array<string> => doc.getArray<string>('order');
export const slidesOf = (doc: Y.Doc): Y.Map<Y.Map<unknown>> => doc.getMap<Y.Map<unknown>>('slides');

export const zOf = (slide: Y.Map<unknown>): Y.Array<string> | null => {
  const z = slide.get('z');
  return z instanceof Y.Array ? (z as Y.Array<string>) : null;
};
export const elsOf = (slide: Y.Map<unknown>): Y.Map<Y.Map<unknown>> | null => {
  const els = slide.get('els');
  return els instanceof Y.Map ? (els as Y.Map<Y.Map<unknown>>) : null;
};
export const kidsOf = (el: Y.Map<unknown>): Y.Array<string> | null => {
  const k = el.get('kids');
  return k instanceof Y.Array ? (k as Y.Array<string>) : null;
};
export const fragmentAt = (m: Y.Map<unknown>, key: string): Y.XmlFragment | null => {
  const f = m.get(key);
  return f instanceof Y.XmlFragment ? f : null;
};

/** Keys of an element map that are not plain values. */
const STRUCTURAL = new Set(['text', 'rows', 'kids', 'children', 'id']);

// ── errors ──────────────────────────────────────────────────────────────────

/** A deck that breaks a rule of deck.ts: past a limit, a picture not yet uploaded, text the schema refuses. */
export class DeckInvalid extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DeckInvalid';
  }
}

export class DeckTooLarge extends Error {
  constructor(readonly bytes: number) {
    super('That presentation is too large.');
    this.name = 'DeckTooLarge';
  }
}

// ── fallbacks, for a deck that is missing its design ────────────────────────

export const FALLBACK_THEME: ThemeJSON = {
  id: 'fallback',
  name: 'Office',
  colors: {
    dk1: '#000000',
    lt1: '#ffffff',
    dk2: '#44546a',
    lt2: '#e7e6e6',
    accent1: '#4472c4',
    accent2: '#ed7d31',
    accent3: '#a5a5a5',
    accent4: '#ffc000',
    accent5: '#5b9bd5',
    accent6: '#70ad47',
    hlink: '#0563c1'
  },
  fonts: { major: 'Inter', minor: 'Inter' }
};

export const FALLBACK_MASTER: MasterJSON = {
  bg: { kind: 'solid', color: { theme: 'lt1' } },
  elements: [],
  styles: {
    title: { fontSize: 44, color: { theme: 'dk1' } },
    body: [{ fontSize: 28 }, { fontSize: 24 }, { fontSize: 20 }, { fontSize: 18 }, { fontSize: 18 }],
    other: { fontSize: 18 }
  }
};

const ASPECTS = new Set<Aspect>(['16:9', '4:3', '16:10']);
export const aspectOf = (v: unknown): Aspect => (typeof v === 'string' && ASPECTS.has(v as Aspect) ? (v as Aspect) : '16:9');
export const heightOf = (a: Aspect): number => SLIDE_HEIGHT[a];

// ── text ────────────────────────────────────────────────────────────────────

/** Replace a fragment's content with `doc`, as the few edits that differ (it diffs, so a cursor elsewhere survives). */
export function writeText(frag: Y.XmlFragment, doc: TextDoc): void {
  prosemirrorToYXmlFragment(textNode(doc), frag);
}

/** A node without the empty and null attributes the binding reads back: `{ type: 'bold' }`, not `{ type: 'bold', attrs: {} }`. */
function compact<T extends { attrs?: Record<string, unknown> }>(node: T): T {
  if (!node.attrs) return node;
  const attrs = Object.fromEntries(Object.entries(node.attrs).filter(([, v]) => v !== null && v !== undefined));
  const { attrs: _drop, ...rest } = node;
  return (Object.keys(attrs).length ? { ...rest, attrs } : rest) as T;
}

function compactNode(n: TextNode): TextNode {
  const out = compact(n);
  if (out.marks) out.marks = out.marks.map(compact);
  if (out.content) out.content = out.content.map(compactNode);
  return out;
}

export function readText(frag: Y.XmlFragment): TextDoc {
  const json = yXmlFragmentToProsemirrorJSON(frag) as TextDoc;
  return json.content && json.content.length > 0 ? (compactNode(json as unknown as TextNode) as unknown as TextDoc) : emptyText();
}

/** A new fragment holding `doc`, filed under `key` of `map`. The map must be in a document. */
function putText(map: Y.Map<unknown>, key: string, doc: TextDoc): Y.XmlFragment {
  const frag = new Y.XmlFragment();
  map.set(key, frag);
  writeText(frag, doc);
  return frag;
}

// ── writing ─────────────────────────────────────────────────────────────────

export interface WriteOptions {
  /**
   * Keep a picture's `data` and `mime` when it has no asset id yet. Only for a scratch document
   * that never reaches a room (a converter's own check). A room accepts asset ids only.
   */
  allowInlineAssets?: boolean;
}

function checkAsset(ref: unknown, opts: WriteOptions): AssetRef {
  const r = (ref ?? {}) as AssetRef;
  if (typeof r.id === 'string' && r.id) return { id: r.id };
  if (opts.allowInlineAssets && typeof r.data === 'string') return { ...(r.mime ? { mime: r.mime } : {}), data: r.data };
  throw new DeckInvalid('A picture in this presentation has not been uploaded.');
}

function checkGeometry(el: ElementJSON): void {
  for (const k of ['x', 'y', 'w', 'h'] as const) {
    if (typeof el[k] !== 'number' || !Number.isFinite(el[k])) throw new DeckInvalid(`An element's ${k} is not a number.`);
  }
}

/** How many elements an element is, its group's children included. */
export function countElements(els: readonly ElementJSON[]): number {
  let n = 0;
  for (const e of els) n += 1 + (e.type === 'group' ? countElements(e.children ?? []) : 0);
  return n;
}

function groupDepth(els: readonly ElementJSON[]): number {
  let d = 0;
  for (const e of els) if (e.type === 'group') d = Math.max(d, 1 + groupDepth(e.children ?? []));
  return d;
}

function tableCells(el: ElementJSON): number {
  return el.type === 'table' ? el.rows.reduce((n, r) => n + (r.cells?.length ?? 0), 0) : 0;
}

/** The checks a slide's elements must pass before any of them is written. */
export function checkElements(els: readonly ElementJSON[]): void {
  if (countElements(els) > DECK_LIMITS.elementsPerSlide) throw new DeckInvalid(`A slide holds at most ${DECK_LIMITS.elementsPerSlide} objects.`);
  if (groupDepth(els) > DECK_LIMITS.groupDepth) throw new DeckInvalid(`Groups can be nested at most ${DECK_LIMITS.groupDepth} deep.`);
  const walk = (list: readonly ElementJSON[]): void => {
    for (const e of list) {
      if (tableCells(e) > DECK_LIMITS.tableCells) throw new DeckInvalid(`A table holds at most ${DECK_LIMITS.tableCells.toLocaleString('en-GB')} cells.`);
      if (e.type === 'group') walk(e.children ?? []);
    }
  };
  walk(els);
}

function writeCell(cells: Y.Array<Y.Map<unknown>>, cell: TableCell): void {
  const m = new Y.Map<unknown>();
  cells.push([m]);
  for (const [k, v] of Object.entries(cell)) if (k !== 'text' && v !== undefined) m.set(k, v);
  putText(m, 'text', cell.text ?? emptyText());
}

/**
 * Writes one element (and a group's children) into `els`, and returns the id it was filed under:
 * its own when it has one that is free in `used`, a fresh one otherwise. `els` must be in a document.
 */
export function writeElement(els: Y.Map<Y.Map<unknown>>, el: ElementJSON, used: Set<string>, opts: WriteOptions = {}): string {
  checkGeometry(el);
  const id = el.id && !used.has(el.id) ? el.id : freshId(used);
  used.add(id);
  const map = new Y.Map<unknown>();
  els.set(id, map);
  for (const [k, v] of Object.entries(el)) {
    if (v === undefined || STRUCTURAL.has(k)) continue;
    if (k === 'asset') map.set(k, checkAsset(v, opts));
    else if (k === 'fill' && (v as { kind?: string }).kind === 'image') map.set(k, { ...(v as object), asset: checkAsset((v as { asset?: unknown }).asset, opts) });
    else map.set(k, v);
  }
  if (el.type === 'shape' && el.text) putText(map, 'text', el.text);
  if (el.type === 'table') {
    const rows = new Y.Array<Y.Map<unknown>>();
    map.set('rows', rows);
    for (const r of el.rows) {
      const row = new Y.Map<unknown>();
      rows.push([row]);
      row.set('h', r.h);
      const cells = new Y.Array<Y.Map<unknown>>();
      row.set('cells', cells);
      for (const c of r.cells) writeCell(cells, c);
    }
  }
  if (el.type === 'group') {
    const kids = new Y.Array<string>();
    map.set('kids', kids);
    const ids = (el.children ?? []).map((c) => writeElement(els, c, used, opts));
    kids.push(ids);
  }
  return id;
}

export function freshId(used: ReadonlySet<string>): string {
  let id = newId();
  while (used.has(id)) id = newId();
  return id;
}

/** Writes a slide into `slides` under `id`. The slides map must be in a document. */
export function writeSlide(slides: Y.Map<Y.Map<unknown>>, id: string, slide: SlideJSON, opts: WriteOptions = {}): Y.Map<unknown> {
  checkElements(slide.elements ?? []);
  const map = new Y.Map<unknown>();
  slides.set(id, map);
  map.set('layout', typeof slide.layout === 'string' ? slide.layout : 'blank');
  if (slide.bg) map.set('bg', slide.bg.kind === 'image' ? { ...slide.bg, asset: checkAsset(slide.bg.asset, opts) } : slide.bg);
  if (slide.hidden) map.set('hidden', true);
  if (slide.showMaster === false) map.set('showMaster', false);
  if (slide.transition) map.set('transition', slide.transition);
  putText(map, 'notes', slide.notes ?? emptyText());
  const els = new Y.Map<Y.Map<unknown>>();
  map.set('els', els);
  const z = new Y.Array<string>();
  map.set('z', z);
  const used = new Set<string>();
  z.push((slide.elements ?? []).map((el) => writeElement(els, el, used, opts)));
  return map;
}

/** Writes a whole deck into a document that is empty, as one transaction. */
export function writeDeck(doc: Y.Doc, deck: DeckJSON, opts: WriteOptions = {}, origin: unknown = null): string[] {
  if (deck.slides.length > DECK_LIMITS.slides) throw new DeckInvalid(`A presentation holds at most ${DECK_LIMITS.slides} slides.`);
  for (const s of deck.slides) checkElements(s.elements ?? []);
  const ids: string[] = [];
  doc.transact(() => {
    const meta = deckMapOf(doc);
    meta.set('v', 1);
    meta.set('size', aspectOf(deck.size));
    meta.set('theme', deck.theme);
    meta.set('master', deck.master);
    meta.set('layouts', deck.layouts);
    const slides = slidesOf(doc);
    const used = new Set<string>();
    for (const s of deck.slides) {
      const id = s.id && !used.has(s.id) ? s.id : freshId(used);
      used.add(id);
      writeSlide(slides, id, s, opts);
      ids.push(id);
    }
    orderOf(doc).push(ids);
  }, origin);
  return ids;
}

/**
 * A new deck's state: the update that a room applies as one `import:` edit, for a blank
 * presentation, a template or an imported file. Throws `DeckInvalid` for a deck that breaks a
 * rule, and `DeckTooLarge` for one over the room's cap, before anything is sent.
 */
export function deckToY(deck: DeckJSON, opts: WriteOptions = {}): Uint8Array {
  const doc = new Y.Doc();
  try {
    writeDeck(doc, deck, opts);
    const state = Y.encodeStateAsUpdate(doc);
    if (state.byteLength > LIMITS.docStateMaxBytes) throw new DeckTooLarge(state.byteLength);
    return state;
  } finally {
    doc.destroy();
  }
}

// ── reading ─────────────────────────────────────────────────────────────────

/** The ids in an array, first occurrences only, and only those `has` knows. */
export function firstOccurrences(ids: readonly string[], has: (id: string) => boolean): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (seen.has(id) || !has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/** A plain value of an element map, never one of the Yjs types it also holds. */
const plain = (v: unknown): boolean => !(v instanceof Y.AbstractType);

function readRows(rows: Y.Array<Y.Map<unknown>>): { h: number; cells: TableCell[] }[] {
  return rows.toArray().map((row) => {
    const cellsArr = row.get('cells');
    const cells = cellsArr instanceof Y.Array ? (cellsArr.toArray() as Y.Map<unknown>[]) : [];
    return {
      h: typeof row.get('h') === 'number' ? (row.get('h') as number) : 40,
      cells: cells.map((c) => {
        const out: Record<string, unknown> = {};
        for (const [k, v] of c.entries()) if (k !== 'text' && plain(v)) out[k] = v;
        const frag = fragmentAt(c, 'text');
        out.text = frag ? readText(frag) : emptyText();
        return out as unknown as TableCell;
      })
    };
  });
}

/** One element's own fields, without a group's children. */
export function readElementFields(id: string, map: Y.Map<unknown>): ElementJSON {
  const out: Record<string, unknown> = { id };
  for (const [k, v] of map.entries()) {
    if (STRUCTURAL.has(k)) continue;
    if (plain(v)) out[k] = v;
  }
  const text = fragmentAt(map, 'text');
  if (text) out.text = readText(text);
  const rows = map.get('rows');
  if (rows instanceof Y.Array) out.rows = readRows(rows as Y.Array<Y.Map<unknown>>);
  if (out.type === 'group') out.children = [];
  return out as unknown as ElementJSON;
}

/**
 * The tree a slide's `z` and its groups' `kids` draw, back to front, with each element in the
 * first place the walk meets it. `visit` sees each id once, with its depth (0 is the slide).
 */
export function walkTree(
  slide: Y.Map<unknown>,
  visit: (id: string, map: Y.Map<unknown>, depth: number, parent: string | null) => void
): void {
  const els = elsOf(slide);
  const z = zOf(slide);
  if (!els || !z) return;
  const seen = new Set<string>();
  const walk = (ids: readonly string[], depth: number, parent: string | null): void => {
    for (const id of ids) {
      if (seen.has(id)) continue;
      const map = els.get(id);
      if (!(map instanceof Y.Map)) continue;
      seen.add(id);
      visit(id, map, depth, parent);
      if (map.get('type') === 'group' && depth < DECK_LIMITS.groupDepth) {
        const kids = kidsOf(map);
        if (kids) walk(kids.toArray(), depth + 1, id);
      }
    }
  };
  walk(z.toArray(), 0, null);
}

/** A slide's elements as `ElementJSON`, back to front, groups holding their children. */
export function readElements(slide: Y.Map<unknown>, read: (id: string, map: Y.Map<unknown>) => ElementJSON = readElementFields): ElementJSON[] {
  const top: ElementJSON[] = [];
  const byId = new Map<string, ElementJSON>();
  walkTree(slide, (id, map, _depth, parent) => {
    const json = read(id, map);
    // A group's `children` is filled here, so a cached group is copied rather than written to.
    const node = json.type === 'group' ? ({ ...json, children: [] } as ElementJSON) : json;
    byId.set(id, node);
    const owner = parent ? byId.get(parent) : null;
    if (owner && owner.type === 'group') owner.children.push(node);
    else top.push(node);
  });
  return top;
}

export function readSlide(id: string, map: Y.Map<unknown>, read: (id: string, map: Y.Map<unknown>) => ElementJSON = readElementFields): SlideJSON {
  const out: SlideJSON = { id, layout: typeof map.get('layout') === 'string' ? (map.get('layout') as string) : 'blank', elements: readElements(map, read) };
  const bg = map.get('bg');
  if (bg && plain(bg)) out.bg = bg as SlideJSON['bg'];
  if (map.get('hidden') === true) out.hidden = true;
  if (map.get('showMaster') === false) out.showMaster = false;
  const tr = map.get('transition');
  if (tr && plain(tr)) out.transition = tr as SlideJSON['transition'];
  const notes = fragmentAt(map, 'notes');
  if (notes) out.notes = readText(notes);
  return out;
}

export function readDesign(doc: Y.Doc): { size: Aspect; theme: ThemeJSON; master: MasterJSON; layouts: LayoutJSON[] } {
  const m = deckMapOf(doc);
  const theme = m.get('theme') as ThemeJSON | undefined;
  const master = m.get('master') as MasterJSON | undefined;
  const layouts = m.get('layouts');
  return {
    size: aspectOf(m.get('size')),
    theme: theme && typeof theme === 'object' && theme.colors ? theme : FALLBACK_THEME,
    master: master && typeof master === 'object' && master.styles ? master : FALLBACK_MASTER,
    layouts: Array.isArray(layouts) ? (layouts as LayoutJSON[]) : []
  };
}

/** The slide ids in order: first occurrences, and only slides that exist. */
export function readOrder(doc: Y.Doc): string[] {
  const slides = slidesOf(doc);
  return firstOccurrences(orderOf(doc).toArray(), (id) => slides.get(id) instanceof Y.Map);
}

/** The whole deck as a plain value: what an export, a copy or the assistant reads. */
export function yToDeck(doc: Y.Doc): DeckJSON {
  const d = readDesign(doc);
  const slides = slidesOf(doc);
  return {
    v: 1,
    size: d.size,
    theme: d.theme,
    master: d.master,
    layouts: d.layouts,
    slides: readOrder(doc).map((id) => readSlide(id, slides.get(id)!))
  };
}

// ── pictures named by a placeholder ─────────────────────────────────────────

/** `value` with each `{ asset: { id } }` that `ids` names pointed at its new id, and how many were. */
function withAssetIds(value: unknown, ids: ReadonlyMap<string, string>): [unknown, number] {
  if (Array.isArray(value)) {
    let n = 0;
    const out = value.map((v) => {
      const [w, k] = withAssetIds(v, ids);
      n += k;
      return w;
    });
    return n ? [out, n] : [value, 0];
  }
  if (!value || typeof value !== 'object') return [value, 0];
  let n = 0;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    const id = k === 'asset' && v && typeof v === 'object' ? (v as AssetRef).id : undefined;
    const next = typeof id === 'string' ? ids.get(id) : undefined;
    if (next) {
      out[k] = { ...(v as AssetRef), id: next };
      n++;
    } else {
      const [w, c] = withAssetIds(v, ids);
      out[k] = w;
      n += c;
    }
  }
  return n ? [out, n] : [value, 0];
}

/**
 * Point every picture named by an id in `ids` at the id it maps to, in one transaction: the slides'
 * elements at any depth (a group's children, a table's cells), their backgrounds, and the master and
 * layouts. An import names its pictures by placeholders until they are uploaded (formats/importSlides.ts).
 * Answers how many references were changed; anything `ids` does not name is left as it was.
 */
export function replaceAssetIds(doc: Y.Doc, ids: ReadonlyMap<string, string>, origin: unknown = null): number {
  let count = 0;
  const walk = (type: unknown): void => {
    if (type instanceof Y.Map) {
      for (const [key, value] of [...(type as Y.Map<unknown>).entries()]) {
        if (value instanceof Y.AbstractType) {
          walk(value);
          continue;
        }
        // Read with its key: a picture element files its ref under `asset` itself.
        const [next, n] = withAssetIds({ [key]: value }, ids);
        if (!n) continue;
        type.set(key, (next as Record<string, unknown>)[key]);
        count += n;
      }
    } else if (type instanceof Y.Array) {
      for (const item of type.toArray()) if (item instanceof Y.AbstractType) walk(item);
    }
  };
  doc.transact(() => {
    walk(deckMapOf(doc));
    walk(slidesOf(doc));
  }, origin);
  return count;
}
