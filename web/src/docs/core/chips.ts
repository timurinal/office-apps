/**
 * Smart chips: a person, a date, and another document, as inline nodes.
 *
 * All three are atoms (the caret steps over them, Backspace deletes one whole) and all
 * three have a text form (chipText.ts), so a word count, find and a plain-text export read
 * them as the words they show.
 *
 *   mention    `{ id, label }`, the person's account id and name. Tiptap's own node, with its
 *              suggestion plugin replaced by this module's, because the picker offers
 *              more than people.
 *   dateChip   `{ date }`, `YYYY-MM-DD`, shown as "14 Oct 2026".
 *   docLink    `{ docId, kind, title }`. Shows the document's title as it is now when the
 *              reader can open it (docTitles.ts), and the title it had when it was linked
 *              when they cannot. Coloured as the app it points at: a Sheets link is green.
 *
 * What the `@` offers, and who is on the list, is picker.ts and people.ts. Opening a chip
 * is the host's: it listens for clicks on `[data-chip]` (overlays.tsx).
 */

import { Extension, mergeAttributes, Node, type Editor, type Range } from '@tiptap/core';
import Mention from '@tiptap/extension-mention';
import { PluginKey } from '@tiptap/pm/state';
import type { DocKind } from '@shared/api';
import { isDocKind } from '@shared/api';
import { chipText, isIsoDay } from './chipText';
import { ctxOf } from './env';
import { storageOf } from './storage';
import { documents } from '../../client';
import { knownTitle, loadTitle, subscribeTitle } from './docTitles';
import { combine, createPickerStore, dateItems, personItems, type PickerStore, type PickItem } from './picker';
import { fetchPeople, hasPeople, loadMentionables } from './people';

const ID = /^[A-Za-z0-9_-]{1,64}$/;

// ── the date ────────────────────────────────────────────────────────────────

export const dateChip = Node.create({
  name: 'dateChip',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      date: {
        default: null,
        parseHTML: (el: HTMLElement) => (isIsoDay(el.getAttribute('data-date')) ? el.getAttribute('data-date') : null),
        renderHTML: (attrs: Record<string, unknown>) => (isIsoDay(attrs.date) ? { 'data-date': attrs.date } : {})
      }
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-type="date-chip"]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return ['span', mergeAttributes({ 'data-type': 'date-chip', 'data-chip': 'date', class: 'oa-chip-date' }, HTMLAttributes), chipText('dateChip', node.attrs) ?? ''];
  },

  renderText({ node }) {
    return chipText('dateChip', node.attrs) ?? '';
  }
});

// ── a link to another document ──────────────────────────────────────────────

export const docLink = Node.create({
  name: 'docLink',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      docId: {
        default: null,
        parseHTML: (el: HTMLElement) => {
          const v = el.getAttribute('data-doc-id');
          return v && ID.test(v) ? v : null;
        },
        renderHTML: (attrs: Record<string, unknown>) => (typeof attrs.docId === 'string' && ID.test(attrs.docId) ? { 'data-doc-id': attrs.docId } : {})
      },
      kind: {
        default: 'docs',
        parseHTML: (el: HTMLElement) => (isDocKind(el.getAttribute('data-kind')) ? el.getAttribute('data-kind') : 'docs'),
        renderHTML: (attrs: Record<string, unknown>) => ({ 'data-kind': isDocKind(attrs.kind) ? attrs.kind : 'docs' })
      },
      title: {
        default: '',
        parseHTML: (el: HTMLElement) => (el.getAttribute('data-title') ?? el.textContent ?? '').slice(0, 200),
        renderHTML: (attrs: Record<string, unknown>) => ({ 'data-title': String(attrs.title ?? '').slice(0, 200) })
      }
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-type="doc-link"]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const kind = isDocKind(node.attrs.kind) ? node.attrs.kind : 'docs';
    return ['span', mergeAttributes({ 'data-type': 'doc-link', 'data-chip': 'doc', 'data-app': kind, class: 'oa-chip-doc' }, HTMLAttributes), String(node.attrs.title ?? '')];
  },

  renderText({ node }) {
    return chipText('docLink', node.attrs) ?? '';
  },

  // The title is live, so the DOM is not just `renderHTML`: it asks for the current one
  // and redraws when it arrives, without touching the document.
  addNodeView() {
    return ({ node: first }) => {
      const dom = document.createElement('span');
      let node = first;
      let off: (() => void) | null = null;

      const draw = () => {
        const id = String(node.attrs.docId ?? '');
        const kind: DocKind = isDocKind(node.attrs.kind) ? node.attrs.kind : 'docs';
        const live = id ? knownTitle(id) : undefined;
        dom.className = 'oa-chip-doc';
        dom.dataset.type = 'doc-link';
        dom.dataset.chip = 'doc';
        dom.dataset.docId = id;
        // Where a click goes is where the document is now, which may not be the app it was in
        // when it was linked.
        dom.dataset.kind = live ? live.kind : kind;
        dom.setAttribute('role', 'link');
        // A link the reader cannot open keeps the title it was made with and says so.
        dom.dataset.state = live === null ? 'unavailable' : 'ok';
        dom.dataset.app = live ? live.kind : kind;
        dom.title = live === null ? 'You cannot open this document.' : '';
        dom.textContent = live ? live.title : String(node.attrs.title ?? '');
      };

      const watch = () => {
        off?.();
        off = null;
        const id = String(node.attrs.docId ?? '');
        if (!id) return;
        off = subscribeTitle(id, draw);
        if (knownTitle(id) === undefined) void loadTitle(id).catch(() => undefined);
      };

      draw();
      watch();
      return {
        dom,
        update(next) {
          if (next.type !== node.type) return false;
          const moved = next.attrs.docId !== node.attrs.docId;
          node = next;
          draw();
          if (moved) watch();
          return true;
        },
        destroy() {
          off?.();
        }
      };
    };
  }
});

// ── the people, and the picker ──────────────────────────────────────────────

interface ChipStorage {
  picker: PickerStore;
  /** What arrives after the first rows, for the query last asked about: the people the server
   *  matched, and the documents found. The people already known and the dates are shown at
   *  once, and not kept waiting for either. */
  late: { query: string; people: PickItem[] | null; docs: PickItem[] };
  timer: ReturnType<typeof setTimeout> | undefined;
}

export const pickerOf = (editor: Editor): PickerStore => storageOf<ChipStorage>(editor, 'oaChips').picker;

/** Holds the picker's store: the suggestion plugin writes it and the overlay reads it. */
export const chipHost = Extension.create<unknown, ChipStorage>({
  name: 'oaChips',
  addStorage() {
    return { picker: createPickerStore(), late: { query: '', people: null, docs: [] }, timer: undefined };
  }
});

const chipsOf = (editor: Editor): ChipStorage => storageOf<ChipStorage>(editor, 'oaChips');

/**
 * The picker's rows for `query`: the people (the server's match once it has come, else those
 * already known), the dates, and the documents found. Everything is in `rest` except what
 * came late.
 */
const withLate = (editor: Editor, rest: readonly PickItem[], query: string): PickItem[] => {
  const { late } = chipsOf(editor);
  const same = late.query === query;
  return combine(
    same && late.people ? late.people : rest.filter((i) => i.kind === 'person'),
    rest.filter((i) => i.kind === 'date'),
    same ? late.docs : []
  );
};

/** Put what has just arrived on screen, if the picker is still on the query it was for. */
function showLate(editor: Editor, query: string): void {
  const store = pickerOf(editor);
  if (store.get().open && store.get().query === query) store.set({ items: withLate(editor, store.get().items, query) });
}

const suggestionKey = new PluginKey('oaChipPicker');

function insertChip(editor: Editor, range: Range, item: PickItem): void {
  // The `@` and what was typed after it are replaced; a space follows so typing carries on.
  const after = editor.state.selection.$to.nodeAfter?.text;
  const to = after?.startsWith(' ') ? range.to + 1 : range.to;
  const node =
    item.kind === 'person'
      ? { type: 'mention', attrs: { id: item.id, label: item.label } }
      : item.kind === 'date'
        ? { type: 'dateChip', attrs: { date: item.date } }
        : { type: 'docLink', attrs: { docId: item.docId, kind: item.docKind, title: item.label } };
  editor
    .chain()
    .focus()
    .insertContentAt({ from: range.from, to }, [node, { type: 'text', text: ' ' }])
    .run();
}

/**
 * What the picker cannot have at once, looked for once typing pauses and added when it
 * arrives: the people the server matches for the typed letters (the first eight are all the
 * list holds, and a document can have more), and documents by title from the reader's own
 * list, never the one being edited and never one in the trash.
 */
function findLate(editor: Editor, query: string, signal: AbortSignal): void {
  const s = chipsOf(editor);
  clearTimeout(s.timer);
  const q = query.trim();
  s.late = { query, people: null, docs: [] };
  if (!q) return;
  const ctx = ctxOf(editor);
  s.timer = setTimeout(() => {
    if (signal.aborted || editor.isDestroyed) return;
    if (ctx && hasPeople(ctx)) {
      fetchPeople(ctx.meta.id, q)
        .then((found) => {
          if (signal.aborted || editor.isDestroyed || s.late.query !== query) return;
          s.late.people = personItems(found, '');
          showLate(editor, query);
        })
        .catch(() => undefined);
    }
    if (q.length >= 2) {
      const here = ctx?.meta.id;
      documents
        .list({ view: 'recent', q, limit: 6 })
        .then((res) => {
          if (signal.aborted || editor.isDestroyed || s.late.query !== query) return;
          s.late.docs = res.documents
            .filter((d) => d.id !== here && !d.trashedAt)
            .slice(0, 5)
            .map((d) => ({ kind: 'doc', docId: d.id, docKind: d.kind, label: d.title, detail: '' }) satisfies PickItem);
          showLate(editor, query);
        })
        .catch(() => undefined);
    }
  }, 150);
}

/** Tiptap's mention, with the `@` menu below in place of its own: the menu offers people,
 *  dates and documents, and any of them is inserted by `command`. */
export const mentionNode = Mention.configure({
  HTMLAttributes: { class: 'mention', 'data-chip': 'person' },
  renderText: ({ node }) => `@${String(node.attrs.label ?? '')}`,
  suggestion: {
    char: '@',
    pluginKey: suggestionKey,
    // `a@b.com` is an address, not a mention: only a space, a bracket or the start opens it.
    allowedPrefixes: [' ', '(', '['],
    allowSpaces: false,

    items: async ({ editor, query, signal }) => {
      const ctx = ctxOf(editor);
      // The first `@` waits for the people; after that they are kept.
      const people = ctx ? await loadMentionables(ctx) : [];
      findLate(editor, query, signal);
      return withLate(editor, combine(personItems(people, query), dateItems(query), []), query);
    },

    command: ({ editor, range, props }) => insertChip(editor, range, props as PickItem),

    // A person who can only read has nothing to put in: the page is not editable, and the
    // suggestion plugin never runs. This also keeps another person's typing from opening
    // a picker here.
    shouldShow: ({ editor }) => editor.isEditable,

    render: () => {
      let editor: Editor | null = null;
      return {
        onStart: (props) => {
          editor = props.editor;
          pickerOf(props.editor).set({
            open: true,
            items: withLate(props.editor, props.items as PickItem[], props.query),
            index: 0,
            query: props.query,
            loading: props.loading,
            rect: props.clientRect ?? null,
            choose: (item) => props.command(item as never)
          });
        },
        onUpdate: (props) => {
          const store = pickerOf(props.editor);
          const items = withLate(props.editor, props.items as PickItem[], props.query);
          store.set({
            items,
            query: props.query,
            loading: props.loading,
            rect: props.clientRect ?? null,
            choose: (item) => props.command(item as never),
            index: Math.min(store.get().index, Math.max(0, items.length - 1))
          });
        },
        onKeyDown: ({ event }) => {
          if (!editor) return false;
          const store = pickerOf(editor);
          const s = store.get();
          if (!s.open) return false;
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            store.move(event.key === 'ArrowDown' ? 1 : -1);
            return true;
          }
          if (event.key === 'Enter' || event.key === 'Tab') {
            const item = s.items[s.index];
            if (!item) return false;
            s.choose(item);
            return true;
          }
          return false;
        },
        onExit: () => {
          if (editor) pickerOf(editor).set({ open: false, items: [], index: 0, rect: null, loading: false });
        }
      };
    }
  }
});
