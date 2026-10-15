/**
 * Nothing starts on the click that could have started earlier.
 *
 * Opening a document warm is budgeted at 500ms, and most of that is two things the
 * page can start before it is asked: the editor's code, and the document's metadata.
 *
 *   hover or focus on a card   the editor's chunk, which is by far the larger
 *   press on a card            the metadata too (`GET /documents/:id`)
 *   Home going idle            the editor's chunk, for the first card of the day
 *
 * The metadata is held for a short time and handed to `useDocument` once; the open
 * is recorded by that request, which is why it waits for a press and not a hover.
 * A hover over a card is not a decision to read it.
 */

import type { DocKind, DocumentMeta } from '@shared/api';
import { documents } from '../client';

const TTL_MS = 30_000;

interface Held {
  at: number;
  promise: Promise<DocumentMeta>;
}

const held = new Map<string, Held>();

/** Start fetching a document's metadata, once, for `useDocument` to pick up. */
export function prefetchDocument(id: string, now = Date.now()): void {
  const have = held.get(id);
  if (have && now - have.at < TTL_MS) return;
  const promise = documents.get(id);
  // A failed prefetch is nobody's answer: the page asks again for itself.
  promise.catch(() => held.delete(id));
  held.set(id, { at: now, promise });
}

/** The prefetched metadata, if there is a fresh one, and never twice. */
export function takePrefetched(id: string, now = Date.now()): Promise<DocumentMeta> | null {
  const have = held.get(id);
  held.delete(id);
  return have && now - have.at < TTL_MS ? have.promise : null;
}

const editorAsked = new Set<DocKind>();
const editorHere = new Set<DocKind>();

/** Whether a kind's editor code has arrived, not only been asked for. */
export const editorIsLoaded = (kind: DocKind = 'docs'): boolean => editorHere.has(kind);

/**
 * Load a kind's editor code. Slides has no editor yet, so there is nothing to load for it. A new
 * spreadsheet's blank seed rides along for Sheets: it is built in the page, on the press.
 */
export function prefetchEditor(kind: DocKind = 'docs'): void {
  if (kind === 'slides' || editorAsked.has(kind)) return;
  editorAsked.add(kind);
  // The same module the route lazy-loads, so this fills the same chunk.
  const loads = kind === 'docs' ? [import('../docs/DocsPage')] : [import('../sheets/SheetsPage'), import('../sheets/blank')];
  void Promise.all(loads).then(
    () => {
      editorHere.add(kind);
    },
    () => {
      editorAsked.delete(kind);
    }
  );
}

/**
 * Run `fn` when the browser has nothing better to do, but not before `afterMs`: a
 * prefetch that starts the moment the page does competes with what the page itself is
 * waiting for, which on a slow connection is the very thing it was meant to be faster
 * than. `timeoutMs` is how long it may wait for idleness after that.
 */
export function whenIdle(fn: () => void, afterMs = 0, timeoutMs = 2000): () => void {
  let cancel = () => undefined as void;
  const start = setTimeout(() => {
    if (typeof requestIdleCallback === 'function') {
      const id = requestIdleCallback(fn, { timeout: timeoutMs });
      cancel = () => cancelIdleCallback(id);
    } else {
      const id = setTimeout(fn, 200);
      cancel = () => clearTimeout(id);
    }
  }, afterMs);
  return () => {
    clearTimeout(start);
    cancel();
  };
}

/** For tests. */
export function resetPrefetch(): void {
  held.clear();
  editorAsked.clear();
  editorHere.clear();
}
