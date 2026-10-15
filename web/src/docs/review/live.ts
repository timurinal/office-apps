/**
 * Comments, near-live, over the room's awareness.
 *
 * Comments are saved over HTTP to D1, not sent through the room, so nobody else hears of a
 * new one until they ask. The room already relays awareness (carets and names) from every
 * socket in it, commenters included, so a saved change bumps a number in this person's
 * awareness state, and everyone else who sees the number move asks again. It carries
 * nothing but the number: a comment's words never pass through the room.
 *
 * Without a room (a local file, a locked document) there is nothing to nudge, and the store's
 * own poll is all there is.
 */

import type { Editor } from '@tiptap/core';
import type { Awareness } from 'y-protocols/awareness';
import type { ReviewStore } from './store';

const FIELD = 'review';

/** How long after a nudge it is said again; the room's awareness budget refills in well under this. */
const AGAIN_MS = 1000;

/** The room's awareness, which the caret extension was given, or null where there is none. */
export function awarenessOf(editor: Editor | null): Awareness | null {
  if (!editor) return null;
  const caret = editor.extensionManager.extensions.find((e) => e.name === 'collaborationCaret');
  const provider = (caret?.options as { provider?: { awareness?: Awareness } } | undefined)?.provider;
  return provider?.awareness ?? null;
}

/** Nudge the room when this person saves, and look again when someone else does. */
export function linkRoom(store: ReviewStore, awareness: Awareness): () => void {
  // Each person's number, as last seen. Kept when they drop out: someone who comes back
  // (either side's socket reconnected) with a different number wrote while we were apart.
  const seen = new Map<number, unknown>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let again: ReturnType<typeof setTimeout> | undefined;

  // Counted on from what is already in the state, not from zero: a link made again for the
  // same room (a new editor) must not send a number the others have already seen.
  const nudge = () => {
    const now = (awareness.getLocalState() as Record<string, unknown> | null)?.[FIELD];
    awareness.setLocalStateField(FIELD, (typeof now === 'number' ? now : 0) + 1);
    // The room drops a socket's awareness frames past a budget, and the stock provider spends
    // that budget relaying everyone else's carets back to it, so while someone types fast the
    // frame with the number can be lost. The same state, sent again once the budget is back,
    // is no change to anyone who heard it the first time.
    clearTimeout(again);
    again = setTimeout(() => {
      const state = awareness.getLocalState();
      if (state) awareness.setLocalState(state);
    }, AGAIN_MS);
  };
  store.onSaved = nudge;

  const onChange = ({ added, updated }: { added: number[]; updated: number[]; removed: number[] }) => {
    let moved = false;
    for (const id of [...added, ...updated]) {
      if (id === awareness.clientID) continue;
      const v = (awareness.getStates().get(id) as Record<string, unknown> | undefined)?.[FIELD];
      // Someone arriving for the first time with a number wrote before we loaded; only a
      // change is news.
      if (seen.has(id) && seen.get(id) !== v && v !== undefined) moved = true;
      seen.set(id, v);
    }
    if (!moved) return;
    clearTimeout(timer);
    // A burst of saves (a reply typed and sent twice) is one look.
    timer = setTimeout(() => void store.load(), 150);
  };
  for (const [id, state] of awareness.getStates()) if (id !== awareness.clientID) seen.set(id, (state as Record<string, unknown>)[FIELD]);
  awareness.on('change', onChange);

  return () => {
    awareness.off('change', onChange);
    clearTimeout(timer);
    clearTimeout(again);
    if (store.onSaved === nudge) store.onSaved = null;
  };
}
