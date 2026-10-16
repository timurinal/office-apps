/**
 * A document's new title, from its room to whatever on the page shows it.
 *
 * The room announces a rename (`RoomNotice` `title`, worker/lib/room-protocol.ts)
 * to every socket. The socket belongs to the editor's source, but the title is
 * shown by `useDocument`'s meta: the header and the tab. They meet here, by
 * document id, so no editor has to carry it between them.
 */

type Listener = (title: string) => void;

const listeners = new Map<string, Set<Listener>>();

export function publishTitle(documentId: string, title: string): void {
  for (const fn of listeners.get(documentId) ?? []) fn(title);
}

/** Hear `documentId`'s new titles. Returns the unsubscribe. */
export function onTitle(documentId: string, fn: Listener): () => void {
  let set = listeners.get(documentId);
  if (!set) listeners.set(documentId, (set = new Set()));
  set.add(fn);
  return () => {
    set.delete(fn);
    if (!set.size && listeners.get(documentId) === set) listeners.delete(documentId);
  };
}
