/**
 * Suggestion mode: typing that proposes a change instead of making it.
 *
 * A suggestion is two marks and one block attribute, all in the Yjs document, so
 * they co-edit, survive a reload and travel with a version:
 *
 *   insertion   text someone proposes adding
 *   deletion    text someone proposes removing; it stays on the page, struck through
 *   suggest     on a paragraph, a break proposed before it (`split`) or proposed
 *               away (`join`); on a rule or an image, the whole node (`ins`, `del`)
 *
 * Each carries the suggestion's id, its author's id and name, and the time. Text
 * typed over a selection shares an id with what it replaces, which is how a card
 * comes to say "Replaced".
 *
 * Suggesting replaces the person's own transactions as they are dispatched
 * (`dispatchTransaction` below) with the suggestion they describe: what the
 * keystroke would insert goes in with an insertion mark, and what it would remove
 * stays and is marked as a deletion, except the person's own insertions, which
 * deleting really deletes. Nothing that stays is removed and put back, so Yjs sees
 * a format change and every character keeps its identity: a comment anchored in
 * struck text stays where it was.
 *
 * Only replacements are suggestions: typing, deleting, Enter and paste. Formatting,
 * lists and anything else that is not a plain replacement is refused in this mode,
 * and so is typing in code, which cannot carry a mark. Suggested formatting is out
 * of scope; Editing is where formatting changes.
 *
 * Remote changes, undo and redo (which arrive through y-tiptap) and the accept and
 * reject commands (which carry `SKIP`) pass through untouched.
 */

import { Extension, Mark, mergeAttributes } from '@tiptap/core';
import { Fragment, Slice, type Mark as PMMark, type MarkType, type Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state';
import { ReplaceStep } from '@tiptap/pm/transform';
import { ySyncPluginKey } from '@tiptap/y-tiptap';

export interface Author {
  id: string;
  name: string;
}

export interface SuggestionAttrs {
  id: string;
  authorId: string;
  authorName: string;
  /** Unix milliseconds. */
  at: number;
}

export type BlockChange = 'split' | 'join' | 'ins' | 'del';

export interface BlockSuggestion extends SuggestionAttrs {
  kind: BlockChange;
}

export type Markup = 'all' | 'none';

export interface SuggestState {
  /** The editing mode's id. Only `suggesting` rewrites anything. */
  mode: string;
  author: Author | null;
  /** `none` shows the page as if every suggestion were accepted, read-only. */
  markup: Markup;
}

export const suggestKey = new PluginKey<SuggestState>('suggest');

/** Meta on a transaction this file made itself, which it must not rewrite. */
export const SKIP = 'suggest/skip';

/** Why a change could not be made a suggestion. */
export type Refusal = 'format' | 'code';

const TEXTBLOCKS = ['paragraph', 'heading', 'codeBlock'];
const LEAF_BLOCKS = ['horizontalRule', 'image', 'pageBreak', 'tableOfContents'];

// ── the marks ────────────────────────────────────────────────────────────────

const markAttributes = {
  id: {
    default: null,
    parseHTML: (el: HTMLElement) => el.getAttribute('data-suggestion'),
    renderHTML: (a: Record<string, unknown>) => ({ 'data-suggestion': a.id })
  },
  authorId: {
    default: null,
    parseHTML: (el: HTMLElement) => el.getAttribute('data-author-id'),
    renderHTML: (a: Record<string, unknown>) => ({ 'data-author-id': a.authorId })
  },
  authorName: {
    default: '',
    parseHTML: (el: HTMLElement) => el.getAttribute('data-author') ?? '',
    renderHTML: (a: Record<string, unknown>) => ({ 'data-author': a.authorName })
  },
  at: {
    default: 0,
    parseHTML: (el: HTMLElement) => Number(el.getAttribute('data-at')) || 0,
    renderHTML: (a: Record<string, unknown>) => ({ 'data-at': String(a.at) })
  }
};

// Neither is inclusive: typing at the edge of someone's suggestion in Editing does
// not join it. In Suggesting the rewrite marks new text itself.
export const Insertion = Mark.create({
  name: 'insertion',
  inclusive: false,
  addAttributes: () => markAttributes,
  // Above StarterKit's strike and underline, which read `<del>` and `<ins>` too.
  parseHTML: () => [{ tag: 'ins[data-suggestion]', priority: 60 }],
  renderHTML: ({ HTMLAttributes }) => ['ins', mergeAttributes(HTMLAttributes, { class: 'oa-ins' }), 0]
});

export const Deletion = Mark.create({
  name: 'deletion',
  inclusive: false,
  addAttributes: () => markAttributes,
  parseHTML: () => [{ tag: 'del[data-suggestion]', priority: 60 }],
  renderHTML: ({ HTMLAttributes }) => ['del', mergeAttributes(HTMLAttributes, { class: 'oa-del' }), 0]
});

// ── reading them ─────────────────────────────────────────────────────────────

const KINDS: readonly BlockChange[] = ['split', 'join', 'ins', 'del'];

/** A block's suggestion, or null. Checked, because it arrives from other people. */
export function blockOf(node: PMNode): BlockSuggestion | null {
  const v = node.attrs.suggest as Partial<BlockSuggestion> | null | undefined;
  if (!v || typeof v !== 'object' || typeof v.id !== 'string' || !KINDS.includes(v.kind as BlockChange)) return null;
  return {
    kind: v.kind as BlockChange,
    id: v.id,
    authorId: typeof v.authorId === 'string' ? v.authorId : '',
    authorName: typeof v.authorName === 'string' ? v.authorName : '',
    at: typeof v.at === 'number' ? v.at : 0
  };
}

const attrsOf = (m: PMMark): SuggestionAttrs => m.attrs as SuggestionAttrs;

export function isRemote(tr: Transaction): boolean {
  const meta = tr.getMeta(ySyncPluginKey) as { isChangeOrigin?: boolean } | undefined;
  return meta?.isChangeOrigin === true;
}

export function newSuggestionId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return `s${Array.from(bytes, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 12)}`;
}

/** The suggestion mark of `type` beside `pos` on either side, if it is `author`'s. */
function ownBeside(doc: PMNode, pos: number, type: MarkType, author: Author, side: -1 | 1): SuggestionAttrs | null {
  if (pos < 0 || pos > doc.content.size) return null;
  const $p = doc.resolve(pos);
  const node = side < 0 ? $p.nodeBefore : $p.nodeAfter;
  const m = node?.isText ? type.isInSet(node.marks) : undefined;
  return m && attrsOf(m).authorId === author.id ? attrsOf(m) : null;
}

/** The author's own suggested break, when `pos` is the start of the paragraph it made. */
function ownBreakAt(doc: PMNode, pos: number, author: Author): SuggestionAttrs | null {
  const $p = doc.resolve(pos);
  if ($p.parentOffset !== 0 || !$p.parent.isTextblock) return null;
  const b = blockOf($p.parent);
  return b?.kind === 'split' && b.authorId === author.id ? b : null;
}

/** The end of the textblock's content before the block that starts at `pos`, or null. */
export function prevTextblockEnd(doc: PMNode, pos: number): number | null {
  let at = pos;
  for (;;) {
    const $a = doc.resolve(at);
    const before = $a.nodeBefore;
    if (before) {
      let node: PMNode = before;
      let end = at;
      while (!node.isTextblock) {
        if (node.isLeaf || !node.lastChild) return null;
        end -= 1;
        node = node.lastChild;
      }
      return end - 1;
    }
    if ($a.depth === 0) return null;
    at = $a.before();
  }
}

// ── the rewrite ──────────────────────────────────────────────────────────────

interface Range {
  from: number;
  to: number;
}

/** Containers a suggestion may open or close: an Enter in a list makes a list item. */
const ITEMS = ['listItem', 'taskItem'];

/**
 * Whether a slice is made only of what a suggestion can describe: text and inline
 * nodes, paragraphs, list items, and the block leaves above. A table, a quote or a
 * whole list cannot be put back as a mark, so a change that adds or removes one is
 * not offered as a suggestion.
 */
function describable(slice: Slice): boolean {
  let ok = true;
  slice.content.descendants((node) => {
    if (!ok) return false;
    if (node.isInline) return false;
    if (node.isTextblock || (node.isBlock && node.isLeaf)) ok = 'suggest' in node.attrs;
    else ok = ITEMS.includes(node.type.name);
    return ok;
  });
  return ok;
}

/**
 * Where the textblock at `pos` would join: the end of the textblock before it, or
 * null where there is none or the join would cross a table cell.
 */
export function joinTarget(doc: PMNode, pos: number): number | null {
  const end = prevTextblockEnd(doc, pos);
  if (end === null) return null;
  const $a = doc.resolve(end);
  const $b = doc.resolve(pos + 1);
  const shared = $a.sharedDepth(pos + 1);
  for (const $p of [$a, $b]) {
    for (let d = shared + 1; d < $p.depth; d++) {
      const spec = $p.node(d).type.spec;
      if (spec.isolating || spec.tableRole) return null;
    }
  }
  return end;
}

/** Join the textblock at `pos` onto the one before it. False when it cannot. */
function joinAt(tr: Transaction, pos: number): boolean {
  const end = joinTarget(tr.doc, pos);
  if (end === null) return false;
  tr.delete(end, pos + 1);
  return true;
}

/** Whether a node can carry the mark: text and other inline nodes. */
const inline = (node: PMNode) => node.isInline;

/**
 * A step y-tiptap writes to Yjs as a plain text diff. A transaction made only of
 * these is synced by comparing strings, which keeps every unchanged character; any
 * other step makes it track characters through the steps instead, which is slower.
 */
function isTextReplacement(step: ReplaceStep, doc: PMNode): boolean {
  if (step.slice.openStart > 0 || step.slice.openEnd > 0) return false;
  let text = true;
  step.slice.content.forEach((n) => (text &&= n.isText));
  const $from = doc.resolve(step.from);
  return text && $from.parent.isTextblock && $from.sameParent(doc.resolve(step.to));
}

/** `slice` with every inline node marked as `mark` and every new block as `block(kind)`. Null where a mark cannot go. */
function markSlice(slice: Slice, mark: PMMark, block: (kind: BlockChange) => BlockSuggestion, openParent: PMNode): Slice | null {
  const { insertion: ins, deletion: del } = openParent.type.schema.marks;
  let ok = true;
  const walk = (fragment: Fragment, parent: PMNode['type'], depth: number, leftEdge: boolean): Fragment => {
    const out: PMNode[] = [];
    fragment.forEach((node, _offset, index) => {
      if (node.isInline) {
        const kept = node.marks.filter((m) => m.type !== ins && m.type !== del);
        const marks = mark.addToSet(kept);
        if (!parent.allowsMarkType(mark.type) || !mark.isInSet(marks)) ok = false;
        out.push(node.mark(marks));
        return;
      }
      // The first node along the slice's open start is the block it is typed into, not a new one.
      const open = leftEdge && index === 0 && depth < slice.openStart;
      const attrs =
        !open && 'suggest' in node.attrs && (node.isTextblock || node.isLeaf)
          ? { ...node.attrs, suggest: block(node.isTextblock ? 'split' : 'ins') }
          : node.attrs;
      out.push(node.type.create(attrs, walk(node.content, node.type, depth + 1, leftEdge && index === 0), node.marks));
    });
    return Fragment.from(out);
  };
  const content = walk(slice.content, openParent.type, 0, true);
  return ok ? new Slice(content, slice.openStart, slice.openEnd) : null;
}

type Mapper = (pos: number) => number;

/**
 * The suggestion `tr` describes, as a new transaction from `state`. `tr` is the
 * person's own change and is not dispatched: everything it removed is still in the
 * new one, struck through, so no character that stays is ever deleted and put back.
 * That matters to Yjs, which would give the put-back text new identities and lose
 * every comment anchored in it.
 */
export function rewrite(
  tr: Transaction,
  state: EditorState,
  author: Author,
  now: number
): { ok: true; tr: Transaction } | { ok: false; reason: Refusal } {
  const ins = state.schema.marks.insertion;
  const del = state.schema.marks.deletion;
  if (!ins || !del) return { ok: true, tr };
  if (!tr.steps.every((s) => s instanceof ReplaceStep)) return { ok: false, reason: 'format' };
  const steps = tr.steps as ReplaceStep[];
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]!;
    if (!describable(step.slice) || !describable(tr.docs[i]!.slice(step.from, step.to))) return { ok: false, reason: 'format' };
  }
  const textOnly = steps.every((s, i) => isTextReplacement(s, tr.docs[i]!));

  const out = state.tr;
  let attrs: SuggestionAttrs | null = null;
  const fresh = (): SuggestionAttrs => ({ id: newSuggestionId(), authorId: author.id, authorName: author.name, at: now });
  const block = (kind: BlockChange): BlockSuggestion => ({ ...attrs!, kind });

  // Where a position of the person's document after step i is in `out`.
  let map: Mapper = (p) => p;
  let struckFrom = 0;
  let insertedAt = 0;
  let insertedEnd = 0;

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]!;
    const size = step.slice.size;
    const a = map(step.from);
    const b = step.to > step.from ? Math.max(a, map(step.to)) : a;

    // One id for the whole change. Typing on from your own suggestion carries it on.
    attrs ??=
      (size > 0 ? (ownBeside(out.doc, b, ins, author, -1) ?? ownBeside(out.doc, b, ins, author, 1) ?? ownBreakAt(out.doc, b, author)) : null) ??
      ownBeside(out.doc, a, del, author, -1) ??
      ownBeside(out.doc, b, del, author, 1) ??
      fresh();

    const before = out.steps.length;
    if (b > a && !strike(out, a, b, attrs, block, author, textOnly)) return { ok: false, reason: 'code' };
    const at = out.mapping.slice(before).map(b, 1);
    let added = 0;
    if (size > 0) {
      const slice = markSlice(step.slice, ins.create(attrs), block, out.doc.resolve(at).parent);
      if (!slice) return { ok: false, reason: 'code' };
      const n = out.steps.length;
      out.replace(at, at, slice);
      if (out.steps.length > n) {
        const last = out.steps[out.steps.length - 1];
        added = last instanceof ReplaceStep ? last.slice.size : size;
      }
    }

    const stepMap = out.mapping.slice(before);
    const prev = map;
    const from = step.from;
    const removed = step.to - step.from;
    map = (p) => {
      if (p < from) return stepMap.map(prev(p), -1);
      if (p <= from + size) return at + Math.min(p - from, added);
      return stepMap.map(prev(p - size + removed), 1);
    };
    struckFrom = stepMap.map(a, -1);
    insertedAt = at;
    insertedEnd = at + added;
  }

  // Where the caret goes: Backspace leaves it before what it struck, Delete after it.
  const only = steps.length === 1 ? steps[0]! : null;
  const sel = state.selection;
  let anchor: number;
  let head: number;
  if (only && only.slice.size === 0 && only.to > only.from) {
    const backward = sel.empty && sel.head === only.to;
    anchor = head = backward ? struckFrom : insertedAt;
  } else if (tr.selectionSet || tr.docChanged) {
    anchor = map(tr.selection.anchor);
    head = map(tr.selection.head);
  } else {
    anchor = head = insertedEnd;
  }
  const size = out.doc.content.size;
  const clamp = (n: number) => Math.max(0, Math.min(n, size));
  out.setSelection(
    anchor === head
      ? TextSelection.near(out.doc.resolve(clamp(head)), head === struckFrom ? -1 : 1)
      : TextSelection.between(out.doc.resolve(clamp(anchor)), out.doc.resolve(clamp(head)))
  );

  // The keystroke's own meta (a paste, an input type, a composition) travels with it.
  const meta = (tr as unknown as { meta: Record<string, unknown> }).meta;
  for (const key in meta) out.setMeta(key, meta[key]);
  out.setTime(tr.time);
  if (tr.storedMarksSet) out.setStoredMarks(tr.storedMarks);
  if (tr.scrolledIntoView) out.scrollIntoView();
  return { ok: true, tr: out };
}

/**
 * Mark [from, to) of `tr` as deleted, except the author's own insertions and breaks,
 * which are removed. False where a deletion mark cannot go (code).
 */
function strike(
  tr: Transaction,
  from: number,
  to: number,
  attrs: SuggestionAttrs,
  block: (kind: BlockChange) => BlockSuggestion,
  author: Author,
  textOnly: boolean
): boolean {
  const { insertion: ins, deletion: del } = tr.doc.type.schema.marks;
  if (!ins || !del) return true;
  const mark = del.create(attrs);
  const goes: Range[] = [];
  const joins: number[] = [];
  const marks: { from: number; to: number; node: PMNode; at: number }[] = [];
  const blocks: { pos: number; value: BlockSuggestion }[] = [];
  let ok = true;

  tr.doc.nodesBetween(from, to, (node, pos, parent) => {
    if (inline(node)) {
      const a = Math.max(pos, from);
      const b = Math.min(pos + node.nodeSize, to);
      if (b <= a) return false;
      const own = ins.isInSet(node.marks);
      if (own && attrsOf(own).authorId === author.id) goes.push({ from: a, to: b });
      else if (!del.isInSet(node.marks)) {
        if (!parent?.type.allowsMarkType(del) || !mark.isInSet(mark.addToSet(node.marks))) ok = false;
        marks.push({ from: a, to: b, node, at: pos });
      }
      return false;
    }
    // A block whose opening is inside the range: the break before it, or the whole leaf.
    if (pos >= from && pos < to && 'suggest' in node.attrs) {
      const b = blockOf(node);
      if (node.isTextblock) {
        if (b?.kind === 'split' && b.authorId === author.id) joins.push(pos);
        else if (!b && joinTarget(tr.doc, pos) !== null) blocks.push({ pos, value: block('join') });
      } else if (node.isLeaf) {
        if (b?.kind === 'ins' && b.authorId === author.id) goes.push({ from: pos, to: pos + node.nodeSize });
        else if (!b) blocks.push({ pos, value: block('del') });
      }
    }
    return true;
  });
  if (!ok) return false;

  // Size-preserving first, so the positions above stay true until the removals.
  for (const m of marks) {
    if (textOnly && m.node.isText) {
      const piece = m.node.cut(m.from - m.at, m.to - m.at);
      tr.replaceWith(m.from, m.to, piece.mark(mark.addToSet(piece.marks)));
    } else tr.addMark(m.from, m.to, mark);
  }
  for (const b of blocks) tr.setNodeAttribute(b.pos, 'suggest', b.value);
  const since = tr.steps.length;
  const ops = [
    ...goes.map((g) => ({ pos: g.from, run: () => tr.delete(tr.mapping.slice(since).map(g.from, 1), tr.mapping.slice(since).map(g.to, -1)) })),
    ...joins.map((j) => ({ pos: j, run: () => joinAt(tr, tr.mapping.slice(since).map(j, 1)) }))
  ];
  ops.sort((x, y) => y.pos - x.pos).forEach((o) => o.run());
  return true;
}

// ── accepting and rejecting ──────────────────────────────────────────────────

/**
 * Accept or reject one suggestion (`id`), or all of them (`null`), in `tr`.
 * Returns how many suggestions it settled.
 */
export function settle(tr: Transaction, accept: boolean, id: string | null): number {
  const { insertion: ins, deletion: del } = tr.doc.type.schema.marks;
  if (!ins || !del) return 0;
  const ids = new Set<string>();
  const ops: { from: number; to: number; join: boolean }[] = [];
  const wanted = (a: { id: string }) => id === null || a.id === id;

  tr.doc.descendants((node, pos) => {
    if (inline(node)) {
      const end = pos + node.nodeSize;
      const i = ins.isInSet(node.marks);
      if (i && wanted(attrsOf(i))) {
        ids.add(attrsOf(i).id);
        if (accept) tr.removeMark(pos, end, i);
        else ops.push({ from: pos, to: end, join: false });
      }
      const d = del.isInSet(node.marks);
      if (d && wanted(attrsOf(d))) {
        ids.add(attrsOf(d).id);
        if (accept) ops.push({ from: pos, to: end, join: false });
        else tr.removeMark(pos, end, d);
      }
      return false;
    }
    const b = blockOf(node);
    if (b && wanted(b)) {
      ids.add(b.id);
      const dropNode = (b.kind === 'ins' && !accept) || (b.kind === 'del' && accept);
      const dropBreak = (b.kind === 'split' && !accept) || (b.kind === 'join' && accept);
      if (dropNode) ops.push({ from: pos, to: pos + node.nodeSize, join: false });
      else {
        tr.setNodeAttribute(pos, 'suggest', null);
        if (dropBreak) ops.push({ from: pos, to: pos, join: true });
      }
    }
    return true;
  });

  const since = tr.steps.length;
  for (const op of ops.sort((a, b) => b.from - a.from || Number(a.join) - Number(b.join))) {
    const map = tr.mapping.slice(since);
    if (op.join) joinAt(tr, map.map(op.from, 1));
    else {
      const from = map.map(op.from, 1);
      const to = map.map(op.to, -1);
      if (to > from) tr.delete(from, to);
    }
  }
  tr.setMeta(SKIP, true);
  return ids.size;
}

// ── listing them ─────────────────────────────────────────────────────────────

export interface Suggestion extends SuggestionAttrs {
  inserted: string;
  deleted: string;
  /** Paragraph breaks it adds, and removes. */
  breaks: number;
  joins: number;
  /** Pictures, rules and other objects it adds, and removes. */
  nodesAdded: number;
  nodesRemoved: number;
  /** Where it starts and ends in the page now. */
  from: number;
  to: number;
}

/** Every suggestion in the document, in the order they appear. */
export function collectSuggestions(doc: PMNode): Suggestion[] {
  const { insertion: ins, deletion: del } = doc.type.schema.marks;
  if (!ins || !del) return [];
  const by = new Map<string, Suggestion & { lastBlock: { ins: number; del: number } }>();
  let blockPos = -1;

  const get = (a: SuggestionAttrs, from: number, to: number) => {
    let s = by.get(a.id);
    if (!s) {
      s = {
        id: a.id,
        authorId: a.authorId,
        authorName: a.authorName,
        at: a.at,
        inserted: '',
        deleted: '',
        breaks: 0,
        joins: 0,
        nodesAdded: 0,
        nodesRemoved: 0,
        from,
        to,
        lastBlock: { ins: -1, del: -1 }
      };
      by.set(a.id, s);
    }
    s.from = Math.min(s.from, from);
    s.to = Math.max(s.to, to);
    return s;
  };

  doc.descendants((node, pos) => {
    if (node.isInline) {
      const end = pos + node.nodeSize;
      const text = node.isText ? (node.text ?? '') : node.type.spec.leafText?.(node) ?? (node.type.name === 'hardBreak' ? ' ' : '');
      for (const [type, key] of [
        [ins, 'ins'],
        [del, 'del']
      ] as const) {
        const m = type.isInSet(node.marks);
        if (!m) continue;
        const s = get(attrsOf(m), pos, end);
        const field = key === 'ins' ? 'inserted' : 'deleted';
        // Text from two paragraphs reads as two runs, not one word.
        const gap = s[field] && s.lastBlock[key] !== blockPos ? ' ' : '';
        s[field] += gap + text;
        if (!node.isText) s[key === 'ins' ? 'nodesAdded' : 'nodesRemoved']++;
        s.lastBlock[key] = blockPos;
      }
      return false;
    }
    if (node.isTextblock) blockPos = pos;
    const b = blockOf(node);
    if (b) {
      const s = get(b, pos, pos + 1);
      if (b.kind === 'split') s.breaks++;
      else if (b.kind === 'join') s.joins++;
      else if (b.kind === 'ins') s.nodesAdded++;
      else s.nodesRemoved++;
    }
    return true;
  });

  return [...by.values()]
    .map(({ lastBlock: _, ...s }) => s)
    .sort((a, b) => a.from - b.from);
}

/** A pasted slice without suggestions: deleted text is left out, inserted text is plain. */
export function cleanSlice(slice: Slice): Slice {
  const clean = (fragment: Fragment): Fragment => {
    const out: PMNode[] = [];
    fragment.forEach((node) => {
      if (node.isText) {
        if (node.marks.some((m) => m.type.name === 'deletion')) return;
        out.push(node.mark(node.marks.filter((m) => m.type.name !== 'insertion')));
        return;
      }
      const attrs = 'suggest' in node.attrs && node.attrs.suggest !== null ? { ...node.attrs, suggest: null } : node.attrs;
      out.push(node.type.create(attrs, clean(node.content), node.marks));
    });
    return Fragment.from(out);
  };
  return new Slice(clean(slice.content), slice.openStart, slice.openEnd);
}

// A surrogate pair is one character, not two halves.
const isHigh = (c: number) => c >= 0xd800 && c <= 0xdbff;
const isLow = (c: number) => c >= 0xdc00 && c <= 0xdfff;
const charLength = (two: string) => (two.length === 2 && isHigh(two.charCodeAt(0)) && isLow(two.charCodeAt(1)) ? 2 : 1);

// ── the extension ────────────────────────────────────────────────────────────

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    suggestions: {
      /** Change the mode, the author or the markup shown. */
      setSuggestState: (state: Partial<SuggestState>) => ReturnType;
      acceptSuggestion: (id: string) => ReturnType;
      rejectSuggestion: (id: string) => ReturnType;
      acceptAllSuggestions: () => ReturnType;
      rejectAllSuggestions: () => ReturnType;
    };
  }
}

export interface SuggestionsStorage {
  /** Told when a change in Suggesting could not be made a suggestion. */
  onRefused: ((reason: Refusal) => void) | null;
}

const INITIAL: SuggestState = { mode: 'editing', author: null, markup: 'all' };

export const Suggestions = Extension.create<Record<string, never>, SuggestionsStorage>({
  name: 'suggestions',

  addStorage: () => ({ onRefused: null }),

  addExtensions: () => [Insertion, Deletion],

  addGlobalAttributes() {
    return [
      {
        types: [...TEXTBLOCKS, ...LEAF_BLOCKS],
        attributes: {
          suggest: {
            default: null,
            // A paragraph split in Editing is not a second suggestion.
            keepOnSplit: false,
            // Read back from the page's own DOM, so ProseMirror re-reading a typed
            // paragraph keeps it. A paste drops it (`cleanSlice`).
            parseHTML: (el: HTMLElement) => {
              const raw = el.getAttribute('data-suggest-attrs');
              if (!raw) return null;
              try {
                return JSON.parse(raw) as unknown;
              } catch {
                return null;
              }
            },
            renderHTML: (attrs: Record<string, unknown>) => {
              const v = attrs.suggest as BlockSuggestion | null;
              return v && typeof v === 'object'
                ? { 'data-suggest': v.kind, 'data-suggestion': v.id, 'data-suggest-attrs': JSON.stringify(v) }
                : {};
            }
          }
        }
      }
    ];
  },

  addProseMirrorPlugins() {
    return [
      new Plugin<SuggestState>({
        key: suggestKey,
        state: {
          init: () => INITIAL,
          apply: (tr, value) => {
            const meta = tr.getMeta(suggestKey) as Partial<SuggestState> | undefined;
            return meta ? { ...value, ...meta } : value;
          }
        },
        props: {
          attributes: (state) => {
            const s = suggestKey.getState(state) ?? INITIAL;
            return { 'data-markup': s.markup, 'data-suggesting': s.mode === 'suggesting' ? 'true' : 'false' };
          },
          // As if everything were accepted is a view of the page, not a place to type.
          editable: (state) => (suggestKey.getState(state) ?? INITIAL).markup !== 'none',
          transformPasted: (slice) => cleanSlice(slice)
        }
      })
    ];
  },

  // A character deleted with an empty selection is otherwise left to the browser, and
  // read back from the page: between two identical letters that reading can name the
  // wrong one, which in Suggesting would strike the wrong one. So it is done here.
  addKeyboardShortcuts() {
    const char = (forward: boolean) => () => {
      const { state, view } = this.editor;
      const s = suggestKey.getState(state);
      const sel = state.selection;
      if (s?.mode !== 'suggesting' || !sel.empty || !(sel instanceof TextSelection)) return false;
      const $c = sel.$cursor;
      if (!$c || !$c.parent.isTextblock) return false;
      const offset = $c.parentOffset;
      if (forward ? offset >= $c.parent.content.size : offset === 0) return false;
      const size = $c.parent.content.size;
      const step = charLength(
        forward ? $c.parent.textBetween(offset, Math.min(offset + 2, size), undefined, '\ufffc') : $c.parent.textBetween(Math.max(0, offset - 2), offset, undefined, '\ufffc')
      );
      const from = forward ? $c.pos : $c.pos - step;
      const to = forward ? $c.pos + step : $c.pos;
      view.dispatch(state.tr.delete(from, to).scrollIntoView());
      return true;
    };
    return { Backspace: char(false), Delete: char(true) };
  },

  dispatchTransaction({ transaction, next }) {
    const state = this.editor.state;
    const s = suggestKey.getState(state);
    if (!s || s.mode !== 'suggesting' || !s.author || !transaction.docChanged || transaction.getMeta(SKIP) || isRemote(transaction)) {
      next(transaction);
      return;
    }
    const result = rewrite(transaction, state, s.author, Date.now());
    if (result.ok) {
      next(result.tr);
      return;
    }
    this.storage.onRefused?.(result.reason);
    // An empty transaction still redraws: a keystroke the browser already put on
    // the page is taken back off it.
    next(state.tr);
  },

  addCommands() {
    return {
      setSuggestState:
        (patch) =>
        ({ tr, dispatch }) => {
          // The same stored marks, set again: the ribbon re-reads its controls on that, and
          // the markup control has to show what it just chose.
          if (dispatch) tr.setMeta(suggestKey, patch).setMeta('addToHistory', false).setStoredMarks(tr.storedMarks);
          return true;
        },
      acceptSuggestion:
        (id) =>
        ({ tr, dispatch }) =>
          dispatch ? settle(tr, true, id) > 0 : true,
      rejectSuggestion:
        (id) =>
        ({ tr, dispatch }) =>
          dispatch ? settle(tr, false, id) > 0 : true,
      acceptAllSuggestions:
        () =>
        ({ tr, dispatch }) =>
          dispatch ? settle(tr, true, null) > 0 : true,
      rejectAllSuggestions:
        () =>
        ({ tr, dispatch }) =>
          dispatch ? settle(tr, false, null) > 0 : true
    };
  }
});
