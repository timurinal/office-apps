/**
 * Other people's carets, names and selections, for Docs and for Slides' text: drawn in layers
 * beside the editor's root (layer.ts), never inside the text.
 *
 * y-tiptap's cursor plugin, and Tiptap's CollaborationCaret on top of it, draw a caret as a widget
 * decoration inside the paragraph. That splits the text node it sits in, so with someone's caret
 * at "he|llo" the browser's spell checker reads "he" and "llo" and underlines the second. Here
 * nothing is added to the editable text at all.
 *
 * The room hears the same awareness fields as before, so an older client and this one still see
 * each other: `user` {name, color}, and `cursor` {anchor, head} as relative positions in the
 * fragment. What this client publishes is y-tiptap's own rule, copied: the selection while the
 * editor has focus, null when it loses it, and null when it closes.
 *
 * What is drawn is measured once a frame at most, never in the keystroke itself: after a
 * transaction, a change in the room, a resize of the editor, a font arriving, and Docs' pages
 * being laid out again (`LAYOUT_EVENT`, which moves the text without a transaction).
 */

import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorState } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { absolutePositionToRelativePosition, relativePositionToAbsolutePosition, ySyncPluginKey, type SyncPluginState } from '@tiptap/y-tiptap';
import type { Awareness } from 'y-protocols/awareness';
import * as Y from 'yjs';
import { readUser } from '../presence';
import { CaretLayer, type CaretDraw } from './layer';
import './carets.css';

/** Dispatched on an editor's root when its text moved without a transaction (Docs' pagination). */
export const LAYOUT_EVENT = 'oa-layout';

export interface CaretsOptions {
  /** The room. Null draws and publishes nothing (a local file, a version). */
  awareness: Awareness | null;
  /** This person, written to `user` when the editor opens. Slides writes it itself. */
  user?: { name: string; color: string } | null;
  /** Whose carets this editor draws: Slides draws only the people typing in this box. */
  accept?: ((state: Record<string, unknown>) => boolean) | null;
}

interface Cursor {
  anchor: unknown;
  head: unknown;
}

const key = new PluginKey('remoteCarets');

function cursorOf(state: Record<string, unknown> | undefined): Cursor | null {
  const c = state?.cursor as Cursor | null | undefined;
  return c && typeof c === 'object' && c.anchor != null && c.head != null ? c : null;
}

/** A relative position from the room, in this editor's document, or null when it is in another fragment. */
function toAbsolute(y: SyncPluginState, rel: unknown): number | null {
  try {
    return relativePositionToAbsolutePosition(y.doc, y.type, Y.createRelativePositionFromJSON(rel), y.binding.mapping);
  } catch {
    return null;
  }
}

class CaretsView {
  private readonly layer = new CaretLayer();
  private readonly awareness: Awareness;
  private frame = 0;
  /** Someone else in the room has a caret: without one, nothing is ever measured. */
  private others = false;
  /** Since the last drawing, text came from the room: the carets it moved glide. */
  private remoteEdit = false;
  /** Each person's cursor as last drawn, to tell their move from ours. */
  private last = new Map<number, string>();
  private resize: ResizeObserver | null = null;

  constructor(
    private readonly view: EditorView,
    private readonly o: CaretsOptions & { awareness: Awareness }
  ) {
    this.awareness = o.awareness;
    if (o.user) this.awareness.setLocalStateField('user', o.user);
    this.awareness.on('change', this.onAwareness);
    view.dom.addEventListener('focusin', this.publish);
    view.dom.addEventListener('focusout', this.publish);
    view.dom.addEventListener(LAYOUT_EVENT, this.schedule);
    if (typeof ResizeObserver === 'function') {
      this.resize = new ResizeObserver(this.schedule);
      this.resize.observe(view.dom);
    }
    document.fonts?.addEventListener?.('loadingdone', this.schedule);
    document.addEventListener('scroll', this.onScroll, { capture: true, passive: true });
    this.others = this.anyOthers();
    this.schedule();
  }

  update(view: EditorView, prev: EditorState): void {
    this.publish();
    if (view.state.doc !== prev.doc && ySyncPluginKey.getState(view.state)?.isChangeOrigin) this.remoteEdit = true;
    this.schedule();
  }

  destroy(): void {
    const view = this.view;
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.awareness.off('change', this.onAwareness);
    view.dom.removeEventListener('focusin', this.publish);
    view.dom.removeEventListener('focusout', this.publish);
    view.dom.removeEventListener(LAYOUT_EVENT, this.schedule);
    this.resize?.disconnect();
    document.fonts?.removeEventListener?.('loadingdone', this.schedule);
    document.removeEventListener('scroll', this.onScroll, { capture: true });
    this.layer.destroy();
    // y-tiptap clears the cursor when its editor closes. Only when it is this editor's, so the
    // notes closing does not take the caret of the box being typed in with them.
    const mine = cursorOf(this.awareness.getLocalState() ?? undefined);
    const y = ySyncPluginKey.getState(view.state);
    if (mine && (!y?.binding || toAbsolute(y, mine.anchor) !== null)) this.awareness.setLocalStateField('cursor', null);
  }

  private anyOthers(): boolean {
    const self = this.awareness.clientID;
    for (const [id, state] of this.awareness.getStates()) if (id !== self && cursorOf(state)) return true;
    return false;
  }

  private onAwareness = ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }) => {
    const self = this.awareness.clientID;
    // This editor's own caret, published on every keystroke, is not anyone else's.
    if (![...added, ...updated, ...removed].some((id) => id !== self)) return;
    this.others = this.anyOthers();
    this.schedule();
  };

  private onScroll = () => {
    if (this.layer.culled) this.schedule();
  };

  private schedule = () => {
    if (this.frame || (!this.others && this.layer.empty)) return;
    this.frame = requestAnimationFrame(this.draw);
  };

  /** y-tiptap's `updateCursorInfo`: this person's selection while the editor has focus. */
  private publish = () => {
    const view = this.view;
    const y = ySyncPluginKey.getState(view.state);
    if (!y?.binding || y.binding.projectionError !== null) return;
    const current = cursorOf(this.awareness.getLocalState() ?? undefined);
    if (view.hasFocus()) {
      const { anchor: a, head: h } = view.state.selection;
      const anchor = absolutePositionToRelativePosition(a, y.type, y.binding.mapping);
      const head = absolutePositionToRelativePosition(h, y.type, y.binding.mapping);
      if (
        !current ||
        !Y.compareRelativePositions(Y.createRelativePositionFromJSON(current.anchor), anchor) ||
        !Y.compareRelativePositions(Y.createRelativePositionFromJSON(current.head), head)
      ) {
        this.awareness.setLocalStateField('cursor', { anchor, head });
      }
    } else if (current && toAbsolute(y, current.anchor) !== null) {
      this.awareness.setLocalStateField('cursor', null);
    }
  };

  private draw = () => {
    this.frame = 0;
    const view = this.view;
    if (view.isDestroyed) return;
    const list: CaretDraw[] = [];
    const seen = new Map<number, string>();
    const y = ySyncPluginKey.getState(view.state);
    // A version being shown, or a binding not yet filled, has no positions to draw at.
    if (y?.binding && y.doc && y.snapshot == null && y.prevSnapshot == null && y.binding.mapping.size > 0) {
      const self = this.awareness.clientID;
      const max = Math.max(view.state.doc.content.size - 1, 0);
      this.awareness.getStates().forEach((state, id) => {
        if (id === self) return;
        const cursor = cursorOf(state);
        if (!cursor || (this.o.accept && !this.o.accept(state))) return;
        const user = readUser(state);
        if (!user) return;
        const anchor = toAbsolute(y, cursor.anchor);
        const head = toAbsolute(y, cursor.head);
        if (anchor === null || head === null) return;
        const k = JSON.stringify(cursor);
        const was = this.last.get(id);
        seen.set(id, k);
        list.push({ id, ...user, anchor: Math.min(anchor, max), head: Math.min(head, max), glide: (was !== undefined && was !== k) || this.remoteEdit });
      });
    }
    this.last = seen;
    this.remoteEdit = false;
    this.layer.render(view, list);
  };
}

/** The ProseMirror plugin, for an editor that builds its own list (Slides' text). */
export function caretsPlugin(o: CaretsOptions & { awareness: Awareness }): Plugin {
  return new Plugin({ key, view: (view) => new CaretsView(view, o) });
}

/** The Tiptap extension (Docs). `awarenessOf` (docs/review/live.ts) finds the room through it. */
export const RemoteCarets = Extension.create<CaretsOptions>({
  name: 'remoteCarets',
  addOptions() {
    return { awareness: null, user: null, accept: null };
  },
  addProseMirrorPlugins() {
    const { awareness } = this.options;
    return awareness ? [caretsPlugin({ ...this.options, awareness })] : [];
  }
});
