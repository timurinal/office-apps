/**
 * The nodes the page view adds to the document, and the fields of a header.
 *
 *   pageBreak         a block. The only page boundary that is content: every other one is
 *                     where this reader's fonts put it, and is never written.
 *   footnote          an inline atom whose content is the note's text. The text lives in the
 *                     body, so it co-edits, undoes and copies with its reference. A nested
 *                     editor (FootnoteView) edits it where it is shown: at the foot of its
 *                     page in print layout, and in a list of notes after the body in web
 *                     layout. It is numbered by its place in the document.
 *   tableOfContents   a block atom holding a snapshot of the headings (`entries`, JSON
 *                     text). "Update table" takes a new snapshot; page numbers are read
 *                     from the layout each time it is drawn, so they are never stale.
 *   pageField         headers and footers only: page, pages, date or title.
 *
 * The node views register themselves per editor view so the page chrome (chrome.ts) can
 * place notes and number them after each layout, without a transaction.
 */

import { Extension, Node, canInsertNode, mergeAttributes, type CommandProps, type Editor } from '@tiptap/core';
import { baseKeymap, toggleMark } from '@tiptap/pm/commands';
import { keymap } from '@tiptap/pm/keymap';
import type { Node as PMNode, Schema } from '@tiptap/pm/model';
import { EditorState, NodeSelection, TextSelection, type Command as PMCommand, type Transaction } from '@tiptap/pm/state';
import { StepMap } from '@tiptap/pm/transform';
import { EditorView, type NodeView } from '@tiptap/pm/view';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    pageView: {
      /** A page break at the caret, splitting the paragraph it is in. */
      setPageBreak: () => ReturnType;
      /** A footnote at the caret, with the caret put in its text. */
      insertFootnote: () => ReturnType;
      insertTableOfContents: () => ReturnType;
      /** Take a new snapshot of the headings into every table of contents. */
      updateTableOfContents: () => ReturnType;
    };
  }
}

// ── registries ──────────────────────────────────────────────────────────────

const footnotes = new WeakMap<EditorView, Set<FootnoteView>>();
const tocs = new WeakMap<EditorView, Set<TocView>>();

const add = <T>(map: WeakMap<EditorView, Set<T>>, view: EditorView, item: T) => {
  let set = map.get(view);
  if (!set) map.set(view, (set = new Set()));
  set.add(item);
};

/** The footnotes in a view, in document order. */
export function footnoteViews(view: EditorView): FootnoteView[] {
  const set = footnotes.get(view);
  if (!set || set.size === 0) return [];
  const out: { v: FootnoteView; pos: number }[] = [];
  for (const v of set) {
    const pos = v.pos();
    if (pos !== null) out.push({ v, pos });
  }
  return out.sort((a, b) => a.pos - b.pos).map((x) => x.v);
}

export function tocViews(view: EditorView): TocView[] {
  return [...(tocs.get(view) ?? [])];
}

/**
 * Insert a block at the selection the way a horizontal rule is, with a paragraph after it at
 * the end. It works on the command's own transaction (`chain` and `state` from the props):
 * a chain started from the editor would dispatch on its own, and the caller would then
 * dispatch a transaction made from the state before it.
 */
function insertBlock({ state, chain }: Pick<CommandProps, 'state' | 'chain'>, node: PMNode, select: 'after' | 'node' = 'after'): boolean {
  if (!canInsertNode(state, node.type)) return false;
  return chain()
    .insertContent(node.toJSON())
    .command(({ tr, dispatch }) => {
      if (!dispatch) return true;
      const { $to } = tr.selection;
      if (select === 'after' && $to.nodeAfter?.isTextblock) tr.setSelection(TextSelection.create(tr.doc, $to.pos + 1));
      else if (!$to.nodeAfter) {
        const para = state.schema.nodes.paragraph?.create();
        if (para) {
          const at = $to.end();
          tr.insert(at, para);
          tr.setSelection(TextSelection.create(tr.doc, at + 1));
        }
      }
      tr.scrollIntoView();
      return true;
    })
    .run();
}

// ── page break ──────────────────────────────────────────────────────────────

export const PageBreak = Node.create({
  name: 'pageBreak',
  group: 'block',
  atom: true,
  selectable: true,
  parseHTML: () => [{ tag: 'div[data-page-break]' }],
  renderHTML: ({ HTMLAttributes }) => [
    'div',
    mergeAttributes(HTMLAttributes, { 'data-page-break': '', class: 'pg-break', style: 'break-after: page' })
  ],
  addCommands() {
    return {
      setPageBreak:
        () =>
        (props) =>
          insertBlock(props, this.type.create())
    };
  }
});

// ── footnote ────────────────────────────────────────────────────────────────

export class FootnoteView implements NodeView {
  dom: HTMLElement;
  /** The note as it is printed: its number and its text. The chrome puts it on a page. */
  entry: HTMLElement;
  node: PMNode;
  readonly inner: EditorView;
  private readonly num: HTMLElement;
  private editable: boolean;

  constructor(
    node: PMNode,
    private readonly outer: EditorView,
    private readonly getPos: () => number | undefined,
    private readonly editor: Editor
  ) {
    this.node = node;
    this.dom = document.createElement('sup');
    this.dom.className = 'pg-fn-ref';
    this.dom.setAttribute('data-footnote', '');
    this.dom.addEventListener('dblclick', (e) => {
      e.preventDefault();
      this.focus();
    });

    this.entry = document.createElement('div');
    this.entry.className = 'pg-note';
    this.num = document.createElement('span');
    this.num.className = 'pg-note-n';
    this.num.setAttribute('aria-hidden', 'true');
    const text = document.createElement('div');
    text.className = 'pg-note-text';
    this.entry.appendChild(this.num);
    this.entry.appendChild(text);

    this.editable = outer.editable;
    const schema = outer.state.schema;
    this.inner = new EditorView(text, {
      state: EditorState.create({ doc: node, plugins: [keymap(this.keys(schema)), keymap(baseKeymap)] }),
      dispatchTransaction: (tr) => this.dispatchInner(tr),
      editable: () => this.outer.editable,
      attributes: { class: 'pg-note-body', role: 'textbox', 'aria-label': 'Footnote' }
    });
    add(footnotes, outer, this);
  }

  pos(): number | null {
    const p = this.getPos();
    return typeof p === 'number' ? p : null;
  }

  setNumber(n: number): void {
    const s = String(n);
    if (this.dom.textContent !== s) this.dom.textContent = s;
    if (this.num.textContent !== s) this.num.textContent = s;
  }

  /** Follow the outer editor into or out of read-only. */
  sync(): void {
    if (this.editable !== this.outer.editable) {
      this.editable = this.outer.editable;
      this.inner.setProps({});
    }
  }

  focus(): void {
    this.entry.scrollIntoView({ block: 'nearest' });
    this.inner.focus();
    const end = this.inner.state.doc.content.size;
    this.inner.dispatch(this.inner.state.tr.setSelection(TextSelection.create(this.inner.state.doc, end)));
  }

  private keys(schema: Schema): Record<string, PMCommand> {
    const leave: PMCommand = () => {
      const pos = this.pos();
      if (pos === null) return false;
      this.outer.focus();
      const after = pos + this.node.nodeSize;
      this.outer.dispatch(this.outer.state.tr.setSelection(TextSelection.create(this.outer.state.doc, after)).scrollIntoView());
      return true;
    };
    const mark = (name: string): PMCommand => {
      const type = schema.marks[name];
      return type ? toggleMark(type) : () => false;
    };
    return {
      'Mod-z': () => this.editor.commands.undo(),
      'Mod-y': () => this.editor.commands.redo(),
      'Shift-Mod-z': () => this.editor.commands.redo(),
      'Mod-b': mark('bold'),
      'Mod-i': mark('italic'),
      'Mod-u': mark('underline'),
      Enter: leave,
      Escape: leave
    };
  }

  /** The inner editor's steps go to the outer document, at this node's place. */
  private dispatchInner(tr: Transaction): void {
    const { state, transactions } = this.inner.state.applyTransaction(tr);
    this.inner.updateState(state);
    if (tr.getMeta('fromOutside')) return;
    const pos = this.pos();
    if (pos === null) return;
    const outerTr = this.outer.state.tr;
    const offset = StepMap.offset(pos + 1);
    for (const t of transactions) for (const step of t.steps) {
      const mapped = step.map(offset);
      if (mapped) outerTr.step(mapped);
    }
    if (outerTr.docChanged) this.outer.dispatch(outerTr);
  }

  update(node: PMNode): boolean {
    if (!node.sameMarkup(this.node)) return false;
    this.node = node;
    const state = this.inner.state;
    const start = node.content.findDiffStart(state.doc.content);
    if (start !== null && start !== undefined) {
      const ends = node.content.findDiffEnd(state.doc.content);
      if (ends) {
        let { a: endA, b: endB } = ends;
        const overlap = start - Math.min(endA, endB);
        if (overlap > 0) {
          endA += overlap;
          endB += overlap;
        }
        this.inner.dispatch(state.tr.replace(start, endB, node.slice(start, endA)).setMeta('fromOutside', true));
      }
    }
    return true;
  }

  selectNode(): void {
    this.dom.classList.add('ProseMirror-selectednode');
    this.entry.classList.add('pg-note-on');
  }

  deselectNode(): void {
    this.dom.classList.remove('ProseMirror-selectednode');
    this.entry.classList.remove('pg-note-on');
  }

  stopEvent(): boolean {
    return false;
  }

  ignoreMutation(): boolean {
    return true;
  }

  destroy(): void {
    this.inner.destroy();
    this.entry.remove();
    footnotes.get(this.outer)?.delete(this);
  }
}

export const Footnote = Node.create({
  name: 'footnote',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  content: 'text*',
  parseHTML: () => [{ tag: 'sup[data-footnote]' }],
  renderHTML: ({ HTMLAttributes }) => ['sup', mergeAttributes(HTMLAttributes, { 'data-footnote': '' }), 0],
  addNodeView() {
    return ({ node, view, getPos, editor }) => new FootnoteView(node, view, getPos, editor);
  },
  addCommands() {
    return {
      insertFootnote:
        () =>
        ({ state, tr, dispatch, view }) => {
          if (!canInsertNode(state, this.type)) return false;
          if (dispatch) {
            const at = tr.selection.to;
            tr.insert(at, this.type.create());
            tr.setSelection(NodeSelection.create(tr.doc, at));
            // The note's own editor exists once the view has drawn the node and the chrome has
            // placed it, which is after this transaction: focus it then.
            queueMicrotask(() =>
              requestAnimationFrame(() => {
                const fv = footnoteViews(view).find((v) => v.pos() === at);
                fv?.focus();
              })
            );
          }
          return true;
        }
    };
  }
});

/**
 * Ctrl+Enter for a page break and Ctrl+Alt+F for a footnote, as in Word. An extension of
 * its own so it can take precedence over StarterKit's hard break, which also wants
 * Ctrl+Enter; a node's priority would also move it ahead of the paragraph in the schema.
 */
export const PageKeys = Extension.create({
  name: 'pageKeys',
  priority: 1000,
  addKeyboardShortcuts() {
    return {
      'Mod-Enter': () => this.editor.commands.setPageBreak(),
      'Mod-Alt-f': () => this.editor.commands.insertFootnote()
    };
  }
});

// ── table of contents ───────────────────────────────────────────────────────

export interface TocEntry {
  level: number;
  text: string;
}

/** Headings 1 to 3, in document order, as Word's default table has them. */
export function headingsOf(doc: PMNode): (TocEntry & { pos: number })[] {
  const out: (TocEntry & { pos: number })[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === 'heading') {
      const level = Number(node.attrs.level) || 1;
      const text = node.textContent.trim();
      if (level <= 3 && text) out.push({ level, text, pos });
      return false;
    }
    return node.isBlock && !node.isTextblock;
  });
  return out;
}

export function parseEntries(raw: unknown): TocEntry[] {
  if (typeof raw !== 'string') return [];
  try {
    const v = JSON.parse(raw) as unknown;
    if (!Array.isArray(v)) return [];
    return v
      .filter((e): e is TocEntry => !!e && typeof e === 'object' && typeof (e as TocEntry).text === 'string')
      .map((e) => ({ level: Math.min(3, Math.max(1, Number(e.level) || 1)), text: e.text.slice(0, 500) }))
      .slice(0, 500);
  } catch {
    return [];
  }
}

export const serialiseEntries = (entries: readonly TocEntry[]): string =>
  JSON.stringify(entries.map((e) => ({ level: e.level, text: e.text })));

/**
 * Each entry's heading, in order: the first heading after the last match with the same
 * level and text. An entry whose heading has gone has none until the table is updated.
 */
export function matchEntries(entries: readonly TocEntry[], headings: readonly (TocEntry & { pos: number })[]): (number | null)[] {
  const out: (number | null)[] = [];
  let from = 0;
  for (const e of entries) {
    let found: number | null = null;
    for (let k = from; k < headings.length; k++) {
      const h = headings[k]!;
      if (h.level === e.level && h.text === e.text) {
        found = h.pos;
        from = k + 1;
        break;
      }
    }
    out.push(found);
  }
  return out;
}

/** A spacer the layout asks a table of contents to draw before one of its rows. */
export interface TocPart {
  row: number;
  /** CSS height, the desk between sheets included (decorations.ts, heightCss). */
  height: string;
}

export class TocView implements NodeView {
  dom: HTMLElement;
  node: PMNode;
  private list: HTMLElement;
  /** What the rows were built from: the entries, which of them have a heading, and the page spacers. */
  private shape = '';
  private nums: HTMLElement[] = [];
  private parsed: { raw: unknown; entries: TocEntry[] } = { raw: null, entries: [] };

  constructor(
    node: PMNode,
    private readonly view: EditorView,
    private readonly pageOf: (pos: number) => number | null,
    private readonly partsOf: (pos: number) => readonly TocPart[],
    private readonly getPos: () => number | undefined
  ) {
    this.node = node;
    this.dom = document.createElement('div');
    this.dom.className = 'pg-toc';
    this.dom.setAttribute('data-toc', '');
    this.dom.contentEditable = 'false';
    const title = document.createElement('div');
    title.className = 'pg-toc-title';
    title.textContent = 'Contents';
    this.list = document.createElement('div');
    this.list.className = 'pg-toc-list';
    this.dom.appendChild(title);
    this.dom.appendChild(this.list);
    this.dom.addEventListener('mousedown', (e) => {
      const row = (e.target as HTMLElement).closest<HTMLElement>('[data-linked]');
      if (!row) return;
      e.preventDefault();
      // The heading is found at the click, not kept on the row: positions move with every keystroke.
      const at = matchEntries(this.entries(), headingsOf(this.view.state.doc))[Number(row.dataset.i)];
      if (at === null || at === undefined) return;
      const doc = this.view.state.doc;
      const tr = this.view.state.tr.setSelection(TextSelection.near(doc.resolve(Math.min(at + 1, doc.content.size))));
      this.view.dispatch(tr.scrollIntoView());
      this.view.focus();
    });
    add(tocs, view, this);
    this.refresh();
  }

  private entries(): TocEntry[] {
    const raw = this.node.attrs.entries as unknown;
    if (this.parsed.raw !== raw) this.parsed = { raw, entries: parseEntries(raw) };
    return this.parsed.entries;
  }

  /**
   * Redraw from the entries and the current layout. Runs after every layout pass, so it
   * rebuilds the rows only when what they are made of changes, and otherwise rewrites the
   * page numbers that moved.
   */
  refresh(): void {
    const entries = this.entries();
    const at = matchEntries(entries, headingsOf(this.view.state.doc));
    // A table longer than a page splits between rows, as a paragraph does between lines: the
    // layout measures the rows marked data-pg-part and says where the next page starts.
    const pos = this.getPos();
    const parts = pos === undefined ? [] : this.partsOf(pos);
    const shape = JSON.stringify([this.node.attrs.entries, at.map((p) => p !== null), parts]);
    if (shape !== this.shape) {
      this.shape = shape;
      this.build(entries, at, parts);
    }
    at.forEach((p, i) => {
      const page = p === null ? null : this.pageOf(p);
      const text = page === null ? '' : String(page + 1);
      const num = this.nums[i];
      if (num && num.textContent !== text) num.textContent = text;
    });
  }

  private build(entries: readonly TocEntry[], at: readonly (number | null)[], parts: readonly TocPart[]): void {
    this.nums = [];
    if (!entries.length) {
      this.list.replaceChildren(Object.assign(document.createElement('div'), { className: 'pg-toc-empty', textContent: 'No headings yet.' }));
      return;
    }
    const before = new Map(parts.map((p) => [p.row, p.height]));
    this.list.replaceChildren(
      ...entries.flatMap((e, i) => {
        const row = document.createElement('div');
        row.className = 'pg-toc-row';
        row.dataset.level = String(e.level);
        row.dataset.pgPart = '';
        row.dataset.i = String(i);
        if (at[i] !== null && at[i] !== undefined) row.dataset.linked = '';
        const label = document.createElement('span');
        label.className = 'pg-toc-text';
        label.textContent = e.text;
        const leader = document.createElement('span');
        leader.className = 'pg-toc-leader';
        const num = document.createElement('span');
        num.className = 'pg-toc-page';
        this.nums.push(num);
        row.appendChild(label);
        row.appendChild(leader);
        row.appendChild(num);
        const h = before.get(i);
        if (h === undefined) return [row];
        const sp = document.createElement('div');
        sp.className = 'pg-sp pg-sp-part';
        sp.style.height = h;
        sp.setAttribute('aria-hidden', 'true');
        return [sp, row];
      })
    );
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.refresh();
    return true;
  }

  stopEvent(e: Event): boolean {
    return e.type === 'mousedown' && !!(e.target as HTMLElement).closest?.('[data-linked]');
  }

  ignoreMutation(): boolean {
    return true;
  }

  destroy(): void {
    tocs.get(this.view)?.delete(this);
  }
}

export interface TableOfContentsOptions {
  /** The page a position is on, or null in web layout. Set by the pagination extension. */
  pageOf: (view: EditorView, pos: number) => number | null;
  /** Where the table at `pos` starts a new page. Set by the pagination extension. */
  partsOf: (view: EditorView, pos: number) => readonly TocPart[];
}

export const TableOfContents = Node.create<TableOfContentsOptions>({
  name: 'tableOfContents',
  group: 'block',
  atom: true,
  selectable: true,
  addOptions: () => ({ pageOf: () => null, partsOf: () => [] }),
  addAttributes: () => ({
    entries: {
      default: '[]',
      parseHTML: (el) => serialiseEntries(parseEntries(el.getAttribute('data-entries'))),
      renderHTML: (attrs) => ({ 'data-entries': serialiseEntries(parseEntries(attrs.entries)) })
    }
  }),
  parseHTML: () => [{ tag: 'div[data-toc]' }],
  renderHTML({ node, HTMLAttributes }) {
    // Outside the editor (a copy, an export) the table is its text.
    const rows = parseEntries(node.attrs.entries).map((e): [string, Record<string, string>, string] => ['p', { 'data-level': String(e.level) }, e.text]);
    return ['div', mergeAttributes(HTMLAttributes, { 'data-toc': '' }), ['p', {}, 'Contents'], ...rows];
  },
  addNodeView() {
    return ({ node, view, getPos }) =>
      new TocView(
        node,
        view,
        (pos) => this.options.pageOf(view, pos),
        (pos) => this.options.partsOf(view, pos),
        () => (typeof getPos === 'function' ? getPos() : undefined)
      );
  },
  addCommands() {
    return {
      insertTableOfContents:
        () =>
        (props) =>
          insertBlock(props, this.type.create({ entries: serialiseEntries(headingsOf(props.state.doc)) })),
      updateTableOfContents:
        () =>
        ({ state, tr, dispatch }) => {
          const entries = serialiseEntries(headingsOf(state.doc));
          let found = false;
          state.doc.descendants((node, pos) => {
            if (node.type === this.type) {
              found = true;
              if (node.attrs.entries !== entries && dispatch) tr.setNodeMarkup(pos, undefined, { ...node.attrs, entries });
              return false;
            }
            return node.isBlock && !node.isTextblock;
          });
          return found;
        }
    };
  }
});

// ── header and footer fields ────────────────────────────────────────────────

export type FieldKind = 'page' | 'pages' | 'date' | 'title';
export const FIELD_KINDS: readonly FieldKind[] = ['page', 'pages', 'date', 'title'];

export interface PageFieldOptions {
  /** What a field shows in the header being edited. The static copies are filled by the chrome. */
  resolve: (kind: FieldKind) => string;
}

export const PageField = Node.create<PageFieldOptions>({
  name: 'pageField',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addOptions: () => ({ resolve: (kind: FieldKind) => (kind === 'page' || kind === 'pages' ? '#' : kind) }),
  addAttributes: () => ({
    kind: {
      default: 'page',
      parseHTML: (el) => {
        const k = el.getAttribute('data-field');
        return FIELD_KINDS.includes(k as FieldKind) ? k : 'page';
      },
      renderHTML: (attrs) => ({ 'data-field': attrs.kind })
    }
  }),
  parseHTML: () => [{ tag: 'span[data-field]' }],
  renderHTML: ({ HTMLAttributes }) => ['span', mergeAttributes(HTMLAttributes, { class: 'pg-field' }), '#'],
  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement('span');
      dom.className = 'pg-field pg-field-live';
      dom.setAttribute('data-field', String(node.attrs.kind));
      dom.textContent = this.options.resolve(node.attrs.kind as FieldKind);
      return { dom };
    };
  }
});
