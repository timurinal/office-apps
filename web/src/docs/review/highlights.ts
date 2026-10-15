/**
 * Commented text, highlighted in the page, and the page telling the cards what was clicked.
 *
 * The highlights are decorations, not marks: a comment lives in D1 and is not part of the
 * document, so nobody's comment changes the text everybody edits, and a commenter (whose
 * Yjs updates the room refuses) can still have their comment drawn. Each thread's range
 * is resolved from its stored Yjs positions when the threads change or someone else's
 * edit arrives, and otherwise follows the text through the transaction's mapping, which
 * is what keeps typing cheap.
 *
 * A click on a highlight, or on a suggestion, makes its card the active one; Ctrl+Alt+M
 * starts a comment on the selection. Both are told to the host through the extension's
 * storage, which is per editor.
 */

import { Extension } from '@tiptap/core';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { relativePositionToAbsolutePosition, ySyncPluginKey } from '@tiptap/y-tiptap';
import type * as Y from 'yjs';
import { decodeRelativePosition, type DocsAnchor } from '../anchors';
import { isRemote } from './suggest';

export interface HighlightThread {
  id: string;
  anchor: DocsAnchor;
}

interface HighlightState {
  threads: readonly HighlightThread[];
  /** `t:<thread id>`, `s:<suggestion id>` or null. */
  active: string | null;
  decos: DecorationSet;
}

export const highlightKey = new PluginKey<HighlightState>('commentHighlights');

export interface HighlightsStorage {
  onActivate: ((key: string | null, via: 'click') => void) | null;
  onComment: (() => boolean) | null;
}

interface SyncState {
  binding?: { mapping: Map<Y.AbstractType<unknown>, unknown> } | null;
  doc?: Y.Doc;
  type?: Y.XmlFragment;
}

/** Where a thread's text is in `state`, or null when it is gone or the binding is not up yet. */
export function rangeOf(state: EditorState, anchor: DocsAnchor): { from: number; to: number } | null {
  const sync = ySyncPluginKey.getState(state) as SyncState | undefined;
  if (!sync?.binding || !sync.doc || !sync.type) return null;
  const at = (b64: string | undefined): number | null => {
    const rp = b64 ? decodeRelativePosition(b64) : null;
    if (!rp) return null;
    try {
      return relativePositionToAbsolutePosition(sync.doc!, sync.type!, rp, sync.binding!.mapping as never);
    } catch {
      return null;
    }
  };
  const a = at(anchor.relpos);
  if (a === null) return null;
  const b = anchor.relposEnd ? (at(anchor.relposEnd) ?? a) : a;
  const size = state.doc.content.size;
  const from = Math.min(a, b, size);
  const to = Math.min(Math.max(a, b), size);
  return to > from ? { from, to } : null;
}

/** Where a suggestion's text is, as the ranges its marks and blocks cover. */
function suggestionRanges(state: EditorState, id: string): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = [];
  state.doc.descendants((node, pos) => {
    if (node.isInline) {
      if (node.marks.some((m) => (m.type.name === 'insertion' || m.type.name === 'deletion') && m.attrs.id === id)) {
        const last = out[out.length - 1];
        if (last && last.to === pos) last.to = pos + node.nodeSize;
        else out.push({ from: pos, to: pos + node.nodeSize });
      }
      return false;
    }
    return true;
  });
  return out;
}

function build(state: EditorState, threads: readonly HighlightThread[], active: string | null): DecorationSet {
  const decos: Decoration[] = [];
  for (const t of threads) {
    const r = rangeOf(state, t.anchor);
    if (!r) continue;
    const on = active === `t:${t.id}`;
    decos.push(Decoration.inline(r.from, r.to, { class: on ? 'oa-anc is-active' : 'oa-anc', 'data-thread': t.id }, { thread: t.id }));
  }
  if (active?.startsWith('s:')) {
    for (const r of suggestionRanges(state, active.slice(2))) decos.push(Decoration.inline(r.from, r.to, { class: 'oa-sugg-active' }));
  }
  return DecorationSet.create(state.doc, decos);
}

/** Set the threads drawn and the active card. */
export function setHighlights(tr: Transaction, patch: { threads?: readonly HighlightThread[]; active?: string | null }): Transaction {
  return tr.setMeta(highlightKey, patch).setMeta('addToHistory', false);
}

export const Highlights = Extension.create<Record<string, never>, HighlightsStorage>({
  name: 'commentHighlights',

  addStorage: () => ({ onActivate: null, onComment: null }),

  addKeyboardShortcuts() {
    return { 'Mod-Alt-m': () => this.storage.onComment?.() ?? false };
  },

  addProseMirrorPlugins() {
    const storage = this.storage;
    return [
      new Plugin<HighlightState>({
        key: highlightKey,
        state: {
          init: () => ({ threads: [], active: null, decos: DecorationSet.empty }),
          apply: (tr, prev, _old, state) => {
            const meta = tr.getMeta(highlightKey) as { threads?: readonly HighlightThread[]; active?: string | null } | undefined;
            const sync = tr.getMeta(ySyncPluginKey) as { binding?: unknown } | undefined;
            if (meta || isRemote(tr) || sync?.binding) {
              const threads = meta?.threads ?? prev.threads;
              const active = meta && 'active' in meta ? (meta.active ?? null) : prev.active;
              if (!threads.length && !active) return { threads, active, decos: DecorationSet.empty };
              return { threads, active, decos: build(state, threads, active) };
            }
            if (!tr.docChanged || prev.decos === DecorationSet.empty) return prev;
            return { ...prev, decos: prev.decos.map(tr.mapping, tr.doc) };
          }
        },
        props: {
          decorations: (state) => highlightKey.getState(state)?.decos,
          handleClick: (view, pos) => {
            const s = highlightKey.getState(view.state);
            const hit = s?.decos.find(pos, pos, (spec: { thread?: string }) => !!spec.thread)[0];
            const thread = (hit?.spec as { thread?: string } | undefined)?.thread;
            if (thread) {
              storage.onActivate?.(`t:${thread}`, 'click');
              return false;
            }
            const $pos = view.state.doc.resolve(pos);
            const marks = [...$pos.marks(), ...($pos.nodeAfter?.marks ?? [])];
            const sugg = marks.find((m) => m.type.name === 'insertion' || m.type.name === 'deletion');
            storage.onActivate?.(sugg ? `s:${String(sugg.attrs.id)}` : null, 'click');
            // The caret still goes where the click was.
            return false;
          }
        }
      })
    ];
  }
});
