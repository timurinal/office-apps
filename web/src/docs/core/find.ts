/**
 * Find and replace.
 *
 * The matches are a plugin's state and are drawn as decorations, so nothing about a search
 * is in the document, and a person searching does not make a change other people see.
 * The bar (FindBar, overlays.tsx) only reads the state and sends it messages.
 *
 * ── Matching ────────────────────────────────────────────────────────────────
 * A textblock is searched as one string, so a phrase that crosses a bold word is found.
 * What is not text (a mention, a picture, a date chip) is a placeholder character no query
 * contains, so a match never spans one. Match case and whole word are flags; the query is
 * always literal, never a pattern.
 *
 * ── Cost ────────────────────────────────────────────────────────────────────
 * Searching runs only while the bar is open and has a query: every transaction then
 * re-scans the document (a 50-page one is a few milliseconds) so the highlights follow
 * what other people type. With the bar closed the plugin does nothing at all on a
 * keystroke.
 *
 * ── Replace all ─────────────────────────────────────────────────────────────
 * One transaction, from the last match to the first so earlier positions do not move: one
 * undo step, and one update on the wire.
 */

import { Extension, type Editor, type Range } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { yUndoPluginKey } from '@tiptap/y-tiptap';

export interface FindOptions {
  query: string;
  replace: string;
  matchCase: boolean;
  wholeWord: boolean;
}

export interface FindState extends FindOptions {
  open: boolean;
  /** The replace row is showing (Ctrl+H, or opened from the ribbon's Replace). */
  showReplace: boolean;
  matches: Range[];
  /** Index into `matches`, or -1 when there are none. */
  current: number;
  decos: DecorationSet;
}

export const findKey = new PluginKey<FindState>('oaFind');

const EMPTY: FindState = {
  query: '',
  replace: '',
  matchCase: false,
  wholeWord: false,
  open: false,
  showReplace: false,
  matches: [],
  current: -1,
  decos: DecorationSet.empty
};

/** Past this many the highlights are not drawn; the count and stepping still work. */
const MAX_DECORATED = 3000;

// ── matching ────────────────────────────────────────────────────────────────

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Letters and digits in any script, and the underscore: what a word is made of. */
const WORD_CHAR = /[\p{L}\p{N}_]/u;

/** Every match of `opts.query` in the document, in order, as document positions. */
export function findMatches(doc: PMNode, opts: Pick<FindOptions, 'query' | 'matchCase' | 'wholeWord'>): Range[] {
  if (!opts.query) return [];
  const re = new RegExp(escapeRegExp(opts.query), opts.matchCase ? 'gu' : 'giu');
  const out: Range[] = [];

  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    // One string per block, and where each of its characters is in the document.
    let text = '';
    const at: number[] = [];
    node.forEach((child, offset) => {
      const start = pos + 1 + offset;
      if (child.isText) {
        const t = child.text ?? '';
        for (let i = 0; i < t.length; i++) at.push(start + i);
        text += t;
      } else {
        // A placeholder: it holds a place in the string and matches nothing.
        at.push(start);
        text += '\ufffc';
      }
    });
    re.lastIndex = 0;
    for (let m = re.exec(text); m; m = re.exec(text)) {
      const end = m.index + m[0].length;
      // A whole word is checked here and not in the pattern: lookbehind is newer than the
      // browsers this has to run in, and a failed check just moves one character on.
      if (opts.wholeWord && (WORD_CHAR.test(text[m.index - 1] ?? '') || WORD_CHAR.test(text[end] ?? ''))) {
        re.lastIndex = m.index + 1;
        continue;
      }
      const from = at[m.index];
      const last = at[end - 1];
      if (from !== undefined && last !== undefined) out.push({ from, to: last + 1 });
      if (m[0].length === 0) re.lastIndex += 1;
    }
    return false;
  });
  return out;
}

// ── the plugin ──────────────────────────────────────────────────────────────

type Meta =
  | { type: 'open'; replace: boolean; query?: string }
  | { type: 'close' }
  | { type: 'set'; patch: Partial<FindOptions> }
  | { type: 'goto'; index: number };

function decorate(doc: PMNode, matches: Range[], current: number): DecorationSet {
  if (matches.length === 0 || matches.length > MAX_DECORATED) return DecorationSet.empty;
  return DecorationSet.create(
    doc,
    matches.map((m, i) => Decoration.inline(m.from, m.to, { class: i === current ? 'oa-find oa-find-current' : 'oa-find' }))
  );
}

export const findExtension = Extension.create({
  name: 'oaFind',

  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin<FindState>({
        key: findKey,
        state: {
          init: () => EMPTY,
          apply(tr, prev) {
            const meta = tr.getMeta(findKey) as Meta | undefined;
            if (!meta && !(prev.open && prev.query && tr.docChanged)) return prev;

            let s = prev;
            if (meta?.type === 'close') return { ...EMPTY, query: prev.query, replace: prev.replace, matchCase: prev.matchCase, wholeWord: prev.wholeWord };
            if (meta?.type === 'open') s = { ...s, open: true, showReplace: meta.replace || (prev.open && prev.showReplace), query: meta.query ?? s.query };
            if (meta?.type === 'set') s = { ...s, ...meta.patch };
            if (meta?.type === 'goto') {
              const current = s.matches.length === 0 ? -1 : ((meta.index % s.matches.length) + s.matches.length) % s.matches.length;
              return { ...s, current, decos: decorate(tr.doc, s.matches, current) };
            }

            const matches = s.open ? findMatches(tr.doc, s) : [];
            let current = -1;
            if (matches.length > 0) {
              if (meta) {
                // A new search starts at the first match at or after the caret.
                const from = tr.selection.from;
                const i = matches.findIndex((m) => m.from >= from);
                current = i === -1 ? 0 : i;
              } else {
                current = Math.min(Math.max(prev.current, 0), matches.length - 1);
              }
            }
            return { ...s, matches, current, decos: decorate(tr.doc, matches, current) };
          }
        },
        props: {
          decorations: (state) => findKey.getState(state)?.decos ?? DecorationSet.empty,
          handleKeyDown: (_view, event) => {
            const mod = event.ctrlKey || event.metaKey;
            if (!mod || event.altKey) return false;
            const k = event.key.toLowerCase();
            if (k !== 'f' && !(k === 'h' && !event.shiftKey)) return false;
            // A reader can search but has nothing to replace with.
            openFind(editor, { replace: k === 'h' && editor.isEditable });
            event.preventDefault();
            return true;
          }
        }
      })
    ];
  }
});

// ── what the bar and the ribbon call ────────────────────────────────────────

export const findState = (editor: Editor): FindState => findKey.getState(editor.state) ?? EMPTY;

function dispatch(editor: Editor, meta: Meta): void {
  editor.view.dispatch(editor.state.tr.setMeta(findKey, meta).setMeta('addToHistory', false));
}

/** A short, single-line selection is what Ctrl+F starts from, as in every other editor. */
function selectedQuery(editor: Editor): string | undefined {
  const { from, to, empty } = editor.state.selection;
  if (empty || to - from > 100) return undefined;
  const text = editor.state.doc.textBetween(from, to, '\n');
  return text && !text.includes('\n') ? text : undefined;
}

export function openFind(editor: Editor, opts: { replace?: boolean } = {}): void {
  const q = selectedQuery(editor);
  dispatch(editor, { type: 'open', replace: opts.replace ?? false, ...(q ? { query: q } : {}) });
  // A bar that is already open takes the caret back (FindBar listens).
  editor.view.dom.dispatchEvent(new CustomEvent('oa-find-focus'));
}

export const closeFind = (editor: Editor): void => dispatch(editor, { type: 'close' });

export const setFind = (editor: Editor, patch: Partial<FindOptions>): void => dispatch(editor, { type: 'set', patch });

/** Go to match `index`: select it and scroll to it. */
export function gotoMatch(editor: Editor, index: number): void {
  const s = findState(editor);
  const m = s.matches[index];
  if (!m) return;
  editor.view.dispatch(
    editor.state.tr
      .setMeta(findKey, { type: 'goto', index } satisfies Meta)
      .setSelection(TextSelection.create(editor.state.doc, m.from, m.to))
      .scrollIntoView()
      .setMeta('addToHistory', false)
  );
}

/** Move to the match `by` away from the current one. */
export function stepFind(editor: Editor, by: 1 | -1): void {
  const s = findState(editor);
  if (s.matches.length === 0) return;
  const n = s.matches.length;
  gotoMatch(editor, s.current === -1 ? (by === 1 ? 0 : n - 1) : (s.current + by + n) % n);
}

/** Replace the current match, then move to the next one after it. */
export function replaceCurrent(editor: Editor): boolean {
  const s = findState(editor);
  const m = s.matches[s.current];
  if (!editor.isEditable || !m) return false;
  // A step remembers the selection it was made from, and undo puts that back
  // (core/undoSelection.ts): select the match first, so undoing a Replace selects
  // the word again, and make the Replace a step of its own, as in Word.
  editor.view.dispatch(
    editor.state.tr.setSelection(TextSelection.create(editor.state.doc, m.from, m.to)).setMeta('addToHistory', false)
  );
  yUndoPluginKey.getState(editor.state)?.undoManager.stopCapturing();
  editor.view.dispatch(editor.state.tr.insertText(s.replace, m.from, m.to));
  // The search has re-run on the change. What comes next is the first match past the
  // replacement, which is not the same index when the replacement itself matches.
  const after = m.from + s.replace.length;
  const next = findState(editor).matches.findIndex((x) => x.from >= after);
  const count = findState(editor).matches.length;
  if (count > 0) gotoMatch(editor, next === -1 ? 0 : next);
  return true;
}

/** Replace every match, as one transaction. Answers how many. */
export function replaceAll(editor: Editor): number {
  const s = findState(editor);
  if (!editor.isEditable || s.matches.length === 0) return 0;
  const tr = editor.state.tr;
  for (let i = s.matches.length - 1; i >= 0; i--) {
    const m = s.matches[i]!;
    tr.insertText(s.replace, m.from, m.to);
  }
  editor.view.dispatch(tr);
  return s.matches.length;
}
