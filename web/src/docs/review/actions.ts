/**
 * What the Review tab's buttons, the Ctrl+K box, the margin and the pane all do, in one
 * place, so a card and a ribbon button that say the same thing do the same thing.
 */

import type { Editor } from '@tiptap/core';
import { captureSelection } from '../anchors';
import { viewOf } from '../core/hooks';
import type { DocsContext } from '../modules/types';
import { motionOff } from '../../motion';
import { highlightKey } from './highlights';
import { reviewStore, suggestionKey, threadKey } from './store';
import type { Suggestion } from './suggest';

/** The composer's own highlight: `t:draft`, never a server id. */
export const DRAFT_ID = 'draft';
export const DRAFT_KEY = threadKey(DRAFT_ID);

/** Take the selection as a new comment's anchor and open the composer. */
export function startComment(ctx: DocsContext): boolean {
  const editor = ctx.editor;
  if (!ctx.can.comment || !editor) return false;
  const draft = captureSelection(editor);
  if (!draft) {
    ctx.notify({ text: 'Select some text first.' });
    return true;
  }
  const store = reviewStore(ctx.meta.id);
  store.setDraft(draft);
  store.setActive(DRAFT_KEY);
  // Beside the page when there is room for it, in the pane when there is not.
  if (!store.get().margin) ctx.panes.open('comments');
  return true;
}

export interface Stop {
  key: string;
  from: number;
  to: number;
}

/** Each open thread drawn in the page, where it starts, in page order. */
export function threadStops(editor: Editor): Stop[] {
  const decos = highlightKey.getState(editor.state)?.decos;
  if (!decos) return [];
  const by = new Map<string, Stop>();
  for (const d of decos.find()) {
    const id = (d.spec as { thread?: string }).thread;
    if (!id || id === DRAFT_ID) continue;
    const s = by.get(id);
    if (!s) by.set(id, { key: threadKey(id), from: d.from, to: d.to });
    else {
      s.from = Math.min(s.from, d.from);
      s.to = Math.max(s.to, d.to);
    }
  }
  return [...by.values()].sort((a, b) => a.from - b.from);
}

const suggestionStops = (list: readonly Suggestion[]): Stop[] => list.map((s) => ({ key: suggestionKey(s.id), from: s.from, to: s.to }));

/** Bring position `pos` into view in the stage, about a third of the way down, if it is not on screen. */
export function reveal(editor: Editor, pos: number): void {
  const view = viewOf(editor);
  if (!view) return;
  const stage = view.dom.closest<HTMLElement>('.oa-stage');
  let top: number;
  try {
    top = view.coordsAtPos(Math.min(pos, view.state.doc.content.size)).top;
  } catch {
    return;
  }
  if (!stage) return;
  const r = stage.getBoundingClientRect();
  const shellTop = parseFloat(getComputedStyle(stage).paddingTop) || 0;
  if (top > r.top + shellTop && top < r.bottom - 80) return;
  stage.scrollBy({ top: top - (r.top + r.height / 3), behavior: motionOff() ? 'auto' : 'smooth' });
}

/** Make a card the active one and show its text: the caret goes to its start. */
export function focusStop(ctx: DocsContext, stop: Stop, { caret = true }: { caret?: boolean } = {}): void {
  const editor = ctx.editor;
  reviewStore(ctx.meta.id).setActive(stop.key);
  if (!editor || editor.isDestroyed) return;
  if (caret) editor.chain().setTextSelection(stop.from).run();
  reveal(editor, stop.from);
}

/** The next or previous change, or comment, from the active card or the caret; it wraps. */
export function step(ctx: DocsContext, what: 'change' | 'comment', dir: 1 | -1): void {
  const editor = ctx.editor;
  if (!editor) return;
  const store = reviewStore(ctx.meta.id);
  const stops = what === 'change' ? suggestionStops(store.get().suggestions) : threadStops(editor);
  if (!stops.length) return;
  const current = stops.find((s) => s.key === store.get().active);
  const at = current ? current.from : editor.state.selection.from;
  const next =
    dir > 0
      ? (stops.find((s) => s.from > at) ?? stops[0]!)
      : ([...stops].reverse().find((s) => s.from < at) ?? stops[stops.length - 1]!);
  focusStop(ctx, next);
  editor.commands.focus(undefined, { scrollIntoView: false });
}

/** The change a single Accept or Reject is about: the active card's, or the one at the caret. */
export function currentSuggestion(ctx: DocsContext): Suggestion | null {
  const snap = reviewStore(ctx.meta.id).get();
  const list = snap.suggestions;
  if (!list.length) return null;
  if (snap.active?.startsWith('s:')) {
    const hit = list.find((s) => suggestionKey(s.id) === snap.active);
    if (hit) return hit;
  }
  const pos = ctx.editor?.state.selection.from;
  if (pos === undefined) return null;
  return list.find((s) => s.from <= pos && pos <= s.to) ?? null;
}

export const hasSuggestions = (ctx: DocsContext): boolean => reviewStore(ctx.meta.id).get().suggestions.length > 0;

/** Accept or reject one change (`id`, or the current one), or with `all` every change. */
export function decide(ctx: DocsContext, accept: boolean, target: string | 'all' | null = null): void {
  const editor = ctx.editor;
  if (!editor || !ctx.can.suggest) return;
  if (target === 'all') {
    if (accept) editor.commands.acceptAllSuggestions();
    else editor.commands.rejectAllSuggestions();
    return;
  }
  const id = target ?? currentSuggestion(ctx)?.id;
  if (!id) return;
  if (accept) editor.commands.acceptSuggestion(id);
  else editor.commands.rejectSuggestion(id);
}
