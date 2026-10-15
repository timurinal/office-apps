/**
 * One document's comments, shared by everything that shows them: the cards in the
 * margin, the pane, the highlights in the page and the count on the header's button.
 *
 * Threads live in D1, not in the Yjs document, so they are fetched. Every change a
 * person makes is drawn at once and sent after: a post, a reply, a resolve, an edit
 * or a delete answers in the frame it was asked in, and a refusal puts back exactly
 * what it changed and says why. A temporary thread (`tmp:` id) takes the server's id
 * when the server answers.
 *
 * Other people's changes arrive three ways: a nudge over the room's awareness when
 * someone in the room writes (review/live.ts), a look when the tab comes back, and
 * a slow poll for anything else.
 */

import { useEffect, useSyncExternalStore } from 'react';
import type { CommentMessage, CommentThread } from '@shared/api';
import { errorText } from '../../api';
import { comments as api } from '../../client';
import type { AnchorDraft } from '../anchors';
import type { Markup, Suggestion } from './suggest';

/** Who is writing: a signed-in person, or a link guest (`id` null). */
export interface Writer {
  id: string | null;
  name: string;
}

export interface ReviewSnapshot {
  /** Null until the first answer. */
  threads: CommentThread[] | null;
  error: string | null;
  /** The card in focus: `t:<thread id>` or `s:<suggestion id>`. */
  active: string | null;
  /** The selection a new comment will attach to, while it is being written. */
  draft: AnchorDraft | null;
  /** The page's suggestions, in page order. Read from the editor, not the server. */
  suggestions: Suggestion[];
  markup: Markup;
  /** Whether the cards are beside the page; when they are not, the pane is where they go. */
  margin: boolean;
}

export const threadKey = (id: string) => `t:${id}`;
export const suggestionKey = (id: string) => `s:${id}`;
export const isTemp = (id: string) => id.startsWith('tmp:');

const POLL_MS = 20_000;
const EMPTY: ReviewSnapshot = { threads: null, error: null, active: null, draft: null, suggestions: [], markup: 'all', margin: false };

/** Two lists of suggestions that would draw the same cards. */
const sameSuggestions = (a: readonly Suggestion[], b: readonly Suggestion[]) =>
  a.length === b.length &&
  a.every((x, i) => {
    const y = b[i]!;
    return x.id === y.id && x.inserted === y.inserted && x.deleted === y.deleted && x.breaks === y.breaks && x.joins === y.joins && x.nodesAdded === y.nodesAdded && x.nodesRemoved === y.nodesRemoved && x.from === y.from;
  });

export interface ReviewStore {
  get: () => ReviewSnapshot;
  subscribe: (cb: () => void) => () => void;
  /** Keep it loaded and polling while something shows it. Returns the release. */
  retain: () => () => void;
  load: () => Promise<void>;
  setActive: (key: string | null) => void;
  setDraft: (draft: AnchorDraft | null) => void;
  setSuggestions: (list: Suggestion[]) => void;
  setMarkup: (markup: Markup) => void;
  setMargin: (on: boolean) => void;
  /** Returns the new thread's key, temporary until the server answers. */
  create: (draft: AnchorDraft, body: string, mentions: string[], by: Writer) => string;
  reply: (threadId: string, body: string, mentions: string[], by: Writer) => void;
  resolve: (threadId: string, resolved: boolean, by: Writer) => void;
  edit: (threadId: string, messageId: string, body: string, mentions: string[]) => void;
  /** A message, or with `messageId` null (or the first message's id) the whole thread. */
  remove: (threadId: string, messageId: string | null) => void;
  /** Told why a change was refused. */
  onError: ((text: string) => void) | null;
  /** Told when this person's change has been saved, so the room can be nudged. */
  onSaved: (() => void) | null;
}

let tempSeq = 0;
const tempId = () => `tmp:${++tempSeq}`;

// A thread posted here keeps the id it was drawn with as its React key, so its card is
// the same element before and after the server names it, and does not blink.
const drawnAs = new Map<string, string>();
/** The id a thread was first drawn with: its temporary id if it was posted here, else its own. */
export const drawnId = (id: string): string => drawnAs.get(id) ?? id;
const nowSeconds = () => Math.floor(Date.now() / 1000);

export function createReviewStore(documentId: string): ReviewStore {
  let snap: ReviewSnapshot = EMPTY;
  const listeners = new Set<() => void>();
  // Threads with a change in flight keep their local version through a poll; threads
  // being deleted stay gone.
  const pending = new Map<string, number>();
  const gone = new Set<string>();
  // A load that started before a write finished may describe the world before it.
  let writes = 0;
  let holders = 0;
  let timer: ReturnType<typeof setInterval> | null = null;

  const set = (patch: Partial<ReviewSnapshot>) => {
    snap = { ...snap, ...patch };
    for (const cb of [...listeners]) cb();
  };
  const threads = () => snap.threads ?? [];
  const replace = (id: string, next: CommentThread | null) =>
    set({ threads: next ? threads().map((t) => (t.id === id ? next : t)) : threads().filter((t) => t.id !== id) });

  const hold = (id: string) => pending.set(id, (pending.get(id) ?? 0) + 1);
  const release = (id: string) => {
    const n = (pending.get(id) ?? 1) - 1;
    if (n > 0) pending.set(id, n);
    else pending.delete(id);
  };

  /** Run `call` for thread `id`; on refusal, `undo` and say why. */
  const write = <T>(id: string, call: () => Promise<T>, done: (value: T) => void, undo: () => void, fallback: string) => {
    hold(id);
    writes++;
    call()
      .then((value) => {
        release(id);
        writes++;
        done(value);
        store.onSaved?.();
      })
      .catch((err: unknown) => {
        release(id);
        writes++;
        undo();
        store.onError?.(errorText(err, fallback));
      });
  };

  const load = async () => {
    const before = writes;
    try {
      const list = (await api.list(documentId)).threads;
      if (writes !== before) {
        // Something changed while it was asked; ask again for the world after it.
        if (!pending.size) void load();
        return;
      }
      const local = new Map(threads().map((t) => [t.id, t]));
      const merged = list.filter((t) => !gone.has(t.id)).map((t) => (pending.has(t.id) ? (local.get(t.id) ?? t) : t));
      const temps = threads().filter((t) => isTemp(t.id));
      set({ threads: [...merged, ...temps], error: null });
    } catch (err) {
      if (snap.threads === null) set({ error: errorText(err, 'Could not load the comments.') });
    }
  };

  const onVisible = () => {
    if (document.visibilityState === 'visible') void load();
  };

  const store: ReviewStore = {
    get: () => snap,
    subscribe: (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    retain: () => {
      holders++;
      if (holders === 1) {
        void load();
        timer = setInterval(() => document.visibilityState === 'visible' && void load(), POLL_MS);
        document.addEventListener('visibilitychange', onVisible);
      }
      let released = false;
      return () => {
        if (released) return;
        released = true;
        holders--;
        if (holders === 0) {
          if (timer) clearInterval(timer);
          timer = null;
          document.removeEventListener('visibilitychange', onVisible);
        }
      };
    },
    load,
    setActive: (key) => key !== snap.active && set({ active: key }),
    setDraft: (draft) => set({ draft }),
    setSuggestions: (list) => {
      if (sameSuggestions(list, snap.suggestions)) return;
      const active = snap.active?.startsWith('s:') && !list.some((x) => suggestionKey(x.id) === snap.active) ? null : snap.active;
      set({ suggestions: list, active });
    },
    setMarkup: (markup) => markup !== snap.markup && set({ markup }),
    setMargin: (on) => on !== snap.margin && set({ margin: on }),

    create: (draft, body, mentions, by) => {
      const id = tempId();
      const at = nowSeconds();
      const thread: CommentThread = {
        id,
        anchor: { kind: 'docs', ...draft },
        resolved: false,
        resolvedById: null,
        resolvedAt: null,
        messages: [{ id: `${id}:0`, authorId: by.id, authorName: by.name, body, mentions, createdAt: at, editedAt: null }],
        createdAt: at
      };
      set({ threads: [...threads(), thread], draft: null, active: threadKey(id) });
      write(
        id,
        () => api.create(documentId, { anchor: thread.anchor, body, ...(mentions.length ? { mentions } : {}) }),
        (saved) => {
          drawnAs.set(saved.id, id);
          replace(id, saved);
          if (snap.active === threadKey(id)) set({ active: threadKey(saved.id) });
        },
        () => {
          replace(id, null);
          // The words are not lost: the draft comes back to be sent again.
          set({ draft, ...(snap.active === threadKey(id) ? { active: null } : {}) });
        },
        'Could not post that.'
      );
      return threadKey(id);
    },

    reply: (threadId, body, mentions, by) => {
      const before = threads().find((t) => t.id === threadId);
      if (!before || isTemp(threadId)) return;
      const message: CommentMessage = { id: tempId(), authorId: by.id, authorName: by.name, body, mentions, createdAt: nowSeconds(), editedAt: null };
      replace(threadId, { ...before, messages: [...before.messages, message] });
      write(
        threadId,
        () => api.reply(documentId, threadId, { body, ...(mentions.length ? { mentions } : {}) }),
        (saved) => replace(threadId, saved),
        () => {
          const now = threads().find((t) => t.id === threadId);
          if (now) replace(threadId, { ...now, messages: now.messages.filter((m) => m.id !== message.id) });
        },
        'Could not send that.'
      );
    },

    resolve: (threadId, resolved, by) => {
      const before = threads().find((t) => t.id === threadId);
      if (!before || isTemp(threadId)) return;
      replace(threadId, { ...before, resolved, resolvedById: resolved ? by.id : null, resolvedAt: resolved ? nowSeconds() : null });
      if (resolved && snap.active === threadKey(threadId)) set({ active: null });
      write(
        threadId,
        () => api.resolve(documentId, threadId, resolved),
        (saved) => replace(threadId, saved),
        () => {
          const now = threads().find((t) => t.id === threadId);
          if (now) replace(threadId, { ...now, resolved: before.resolved, resolvedById: before.resolvedById, resolvedAt: before.resolvedAt });
        },
        resolved ? 'Could not resolve that.' : 'Could not reopen that.'
      );
    },

    edit: (threadId, messageId, body, mentions) => {
      const before = threads().find((t) => t.id === threadId);
      const old = before?.messages.find((m) => m.id === messageId);
      if (!before || !old || isTemp(threadId)) return;
      const patch = (t: CommentThread, m: Partial<CommentMessage>) => ({ ...t, messages: t.messages.map((x) => (x.id === messageId ? { ...x, ...m } : x)) });
      replace(threadId, patch(before, { body, mentions, editedAt: nowSeconds() }));
      write(
        threadId,
        () => api.edit(documentId, threadId, messageId, { body, mentions }),
        (saved) => replace(threadId, saved),
        () => {
          const now = threads().find((t) => t.id === threadId);
          if (now) replace(threadId, patch(now, { body: old.body, mentions: old.mentions, editedAt: old.editedAt }));
        },
        'Could not save that.'
      );
    },

    remove: (threadId, messageId) => {
      const list = threads();
      const index = list.findIndex((t) => t.id === threadId);
      const before = list[index];
      if (!before || isTemp(threadId)) return;
      const whole = messageId === null || before.messages[0]?.id === messageId;
      if (whole) {
        gone.add(threadId);
        replace(threadId, null);
        if (snap.active === threadKey(threadId)) set({ active: null });
      } else replace(threadId, { ...before, messages: before.messages.filter((m) => m.id !== messageId) });
      write(
        threadId,
        () => (whole ? api.removeThread(documentId, threadId) : api.removeMessage(documentId, threadId, messageId!)),
        () => gone.delete(threadId),
        () => {
          gone.delete(threadId);
          const now = threads();
          if (whole) set({ threads: [...now.slice(0, index), before, ...now.slice(index)] });
          else {
            const t = now.find((x) => x.id === threadId);
            if (t) replace(threadId, { ...t, messages: before.messages.filter((m) => m.id === messageId || t.messages.some((x) => x.id === m.id)) });
          }
        },
        'Could not delete that.'
      );
    },

    onError: null,
    onSaved: null
  };
  return store;
}

const stores = new Map<string, ReviewStore>();

/** The store for a document, the same one for every caller. */
export function reviewStore(documentId: string): ReviewStore {
  let s = stores.get(documentId);
  if (!s) {
    s = createReviewStore(documentId);
    stores.set(documentId, s);
  }
  return s;
}

/** Forget every store: a test, or signing out. */
export function resetReviewStores(): void {
  stores.clear();
}

const NO_STORE: ReviewStore = createReviewStore('');

/** The snapshot, re-read when it changes. Keeps the store loaded while `enabled`. */
export function useReview(documentId: string, enabled: boolean): { store: ReviewStore; snap: ReviewSnapshot } {
  const store = enabled ? reviewStore(documentId) : NO_STORE;
  useEffect(() => (enabled ? store.retain() : undefined), [store, enabled]);
  const snap = useSyncExternalStore(store.subscribe, store.get, () => EMPTY);
  return { store, snap };
}

const openCount = (snap: ReviewSnapshot): number => (snap.threads ? snap.threads.filter((t) => !t.resolved).length : 0);

/**
 * How many threads are open, for the header's button. Re-renders only when the number
 * moves, so the editor around it is not redrawn for a card being focused.
 */
export function useOpenThreads(documentId: string, enabled: boolean): number {
  const store = enabled ? reviewStore(documentId) : NO_STORE;
  useEffect(() => (enabled ? store.retain() : undefined), [store, enabled]);
  return useSyncExternalStore(store.subscribe, () => openCount(store.get()), () => 0);
}
