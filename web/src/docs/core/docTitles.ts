/**
 * The live title of a document a chip points at.
 *
 * A link to another document is stored with the title it had when it was made, and shows
 * the title it has now when the reader can open it: ask once per document (the answer is
 * kept for a minute and shared by every chip that points there), a few at a time, so a
 * document full of links does not open with a burst of requests. Asked with `?peek=1`
 * (shared/api.ts `PATHS.documentPeek`), which is a read that is not an open, so a link
 * in a document does not put its target in the reader's Recent.
 *
 * What the reader cannot open (no access, deleted) answers `null`, and the chip keeps the
 * stored title and says it is unavailable. A network failure is not an answer: nothing is
 * kept, and the next chip to ask asks again.
 */

import { PATHS, type DocKind, type DocumentMeta } from '@shared/api';
import { ApiError, get } from '../../api';

export interface DocInfo {
  title: string;
  kind: DocKind;
}

export type Fetcher = (id: string) => Promise<DocInfo | null>;

export const fetchInfo: Fetcher = async (id) => {
  try {
    const meta = await get<DocumentMeta>(PATHS.documentPeek(id));
    return { title: meta.title, kind: meta.kind };
  } catch (err) {
    if (err instanceof ApiError && (err.status === 401 || err.status === 403 || err.status === 404)) return null;
    throw err;
  }
};

const TTL_MS = 60_000;
const PARALLEL = 4;

interface Entry {
  at: number;
  info: DocInfo | null;
}

const known = new Map<string, Entry>();
const asking = new Map<string, Promise<DocInfo | null>>();
const listeners = new Map<string, Set<() => void>>();
const queue: Array<() => void> = [];
let running = 0;
let fetcher: Fetcher = fetchInfo;

/** For tests. */
export function resetTitles(use: Fetcher = fetchInfo): void {
  known.clear();
  asking.clear();
  listeners.clear();
  queue.length = 0;
  running = 0;
  fetcher = use;
}

/** What is known now: the answer, `null` for "cannot open", `undefined` for "not asked yet". */
export function knownTitle(id: string, now = Date.now()): DocInfo | null | undefined {
  const e = known.get(id);
  return e && now - e.at < TTL_MS ? e.info : undefined;
}

function pump(): void {
  while (running < PARALLEL && queue.length > 0) {
    running += 1;
    queue.shift()!();
  }
}

/** Ask for a title, once. Resolves with the answer, and tells every chip waiting on it. */
export function loadTitle(id: string): Promise<DocInfo | null> {
  const have = knownTitle(id);
  if (have !== undefined) return Promise.resolve(have);
  const pending = asking.get(id);
  if (pending) return pending;

  const p = new Promise<DocInfo | null>((resolve, reject) => {
    queue.push(() => {
      fetcher(id)
        .then((info) => {
          known.set(id, { at: Date.now(), info });
          listeners.get(id)?.forEach((cb) => cb());
          resolve(info);
        }, reject)
        .finally(() => {
          asking.delete(id);
          running -= 1;
          pump();
        });
    });
    pump();
  });
  asking.set(id, p);
  // A failed ask is nobody's answer; the chip that asked keeps what it has.
  p.catch(() => undefined);
  return p;
}

/** Call back when the answer for `id` changes. */
export function subscribeTitle(id: string, cb: () => void): () => void {
  let set = listeners.get(id);
  if (!set) listeners.set(id, (set = new Set()));
  set.add(cb);
  return () => {
    set.delete(cb);
    if (set.size === 0) listeners.delete(id);
  };
}
