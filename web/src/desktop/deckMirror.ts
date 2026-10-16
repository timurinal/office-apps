/**
 * The audience's window of a presenter's view, fed from the presenter's window.
 *
 * Upstream of a room, the audience window connects to the deck itself. Here the deck is in the
 * presenter's window only, so that window serves it on a BroadcastChannel named for itself: the
 * whole deck and its pictures to a window that asks, then each change as it happens. The audience
 * window's address carries the presenter's window id (`?w=`), which names the channel.
 */

import * as Y from 'yjs';
import { isPictureId, isPictureMime, type PictureStore, type StoredPicture } from './pictures';

export type MirrorMessage =
  | { t: 'want' }
  | { t: 'deck'; id: string; title: string; update: Uint8Array; pictures: StoredPicture[] }
  | { t: 'update'; update: Uint8Array }
  | { t: 'picture'; picture: StoredPicture };

export const mirrorChannel = (windowId: string): string => `oa.desktop.deck.${windowId}`;

const bytes = (v: unknown): v is Uint8Array => v instanceof Uint8Array;
const picture = (v: unknown): v is StoredPicture => {
  const p = v as StoredPicture | null;
  return !!p && isPictureId(p.id) && isPictureMime(p.mime) && typeof p.name === 'string' && bytes(p.bytes);
};

/** A message from the channel, or null for anything that is not one: any page of this origin can post to it. */
export function parseMirror(data: unknown): MirrorMessage | null {
  const m = data as Record<string, unknown> | null;
  if (!m || typeof m !== 'object') return null;
  switch (m.t) {
    case 'want':
      return { t: 'want' };
    case 'deck':
      if (typeof m.id !== 'string' || typeof m.title !== 'string' || !bytes(m.update) || !Array.isArray(m.pictures)) return null;
      return { t: 'deck', id: m.id, title: m.title, update: m.update, pictures: m.pictures.filter(picture) };
    case 'update':
      return bytes(m.update) ? { t: 'update', update: m.update } : null;
    case 'picture':
      return picture(m.picture) ? { t: 'picture', picture: m.picture } : null;
    default:
      return null;
  }
}

/** The presenter's side: answer a window that asks, and pass on every change. Returns the way to stop. */
export function serveDeck(windowId: string, deck: { id: string; doc: Y.Doc; pictures: PictureStore; title: () => string }): () => void {
  if (typeof BroadcastChannel === 'undefined' || !windowId) return () => undefined;
  const channel = new BroadcastChannel(mirrorChannel(windowId));
  const post = (m: MirrorMessage) => channel.postMessage(m);
  channel.onmessage = (e: MessageEvent) => {
    if (parseMirror(e.data)?.t !== 'want') return;
    post({ t: 'deck', id: deck.id, title: deck.title(), update: Y.encodeStateAsUpdate(deck.doc), pictures: deck.pictures.list() });
  };
  const onUpdate = (update: Uint8Array) => post({ t: 'update', update });
  deck.doc.on('update', onUpdate);
  const offPicture = deck.pictures.onAdd((p) => post({ t: 'picture', picture: p }));
  return () => {
    deck.doc.off('update', onUpdate);
    offPicture();
    channel.close();
  };
}

export interface Followed {
  id: string;
  title: string;
  doc: Y.Doc;
  pictures: StoredPicture[];
}

/**
 * The audience's side: ask for the deck, then keep its `doc` in step with the presenter's. `deck`
 * is called once, when the deck has come; `picture` for each one added after.
 */
export function followDeck(windowId: string, on: { deck: (d: Followed) => void; picture: (p: StoredPicture) => void }): () => void {
  const channel = new BroadcastChannel(mirrorChannel(windowId));
  let doc: Y.Doc | null = null;
  const early: Uint8Array[] = [];
  channel.onmessage = (e: MessageEvent) => {
    const m = parseMirror(e.data);
    if (!m) return;
    if (m.t === 'deck' && !doc) {
      doc = new Y.Doc();
      Y.applyUpdate(doc, m.update);
      for (const u of early) Y.applyUpdate(doc, u);
      early.length = 0;
      on.deck({ id: m.id, title: m.title, doc, pictures: m.pictures });
    } else if (m.t === 'update') {
      if (doc) Y.applyUpdate(doc, m.update);
      else early.push(m.update);
    } else if (m.t === 'picture') on.picture(m.picture);
  };
  channel.postMessage({ t: 'want' } satisfies MirrorMessage);
  return () => channel.close();
}
