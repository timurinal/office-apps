/**
 * Home's list, kept so the page can paint before the network has answered.
 *
 * Opening Home warm is budgeted at 300ms, and the list is what the eye is waiting
 * for. So the last answer for each view is kept, in memory for the life of the page
 * and in `sessionStorage` for a reload of the tab, and Home draws from it at once,
 * then asks the server and replaces it. A stale list for a moment is a better
 * trade than a spinner: the shape is right, and a change lands over it.
 *
 * Only titles, owners and the like: what Home already shows. Nothing from a locked
 * document's content is, or could be, in a list. `sessionStorage` is per tab and
 * gone when it closes, and every read and write is guarded, since a private window
 * can refuse it.
 */

import type { ListDocumentsResponse } from '@shared/api';

const PREFIX = 'office.home.';
/** Older than this is not worth painting. */
const MAX_AGE_MS = 10 * 60_000;

interface Entry<T> {
  at: number;
  value: T;
}

const memory = new Map<string, Entry<unknown>>();

function storage(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

export function readCache<T>(key: string, now = Date.now()): T | null {
  const m = memory.get(key) as Entry<T> | undefined;
  if (m && now - m.at < MAX_AGE_MS) return m.value;
  try {
    const raw = storage()?.getItem(PREFIX + key);
    if (!raw) return null;
    const entry = JSON.parse(raw) as Entry<T>;
    if (typeof entry?.at !== 'number' || now - entry.at >= MAX_AGE_MS) return null;
    memory.set(key, entry);
    return entry.value;
  } catch {
    return null;
  }
}

export function writeCache<T>(key: string, value: T, now = Date.now()): void {
  const entry: Entry<T> = { at: now, value };
  memory.set(key, entry);
  try {
    storage()?.setItem(PREFIX + key, JSON.stringify(entry));
  } catch {
    // Full, or refused: the in-memory copy still serves this page.
  }
}

export function clearCache(): void {
  memory.clear();
  try {
    const s = storage();
    if (!s) return;
    for (const k of Object.keys(s)) if (k.startsWith(PREFIX)) s.removeItem(k);
  } catch {
    // Nothing to clear.
  }
}

/** The key for a list: its view and kind. A search is never cached. */
export const listKey = (view: string, kind: string): string => `list:${view}:${kind || 'all'}`;

export const readList = (view: string, kind: string): ListDocumentsResponse | null =>
  readCache<ListDocumentsResponse>(listKey(view, kind));

export const writeList = (view: string, kind: string, page: ListDocumentsResponse): void =>
  writeCache(listKey(view, kind), page);
