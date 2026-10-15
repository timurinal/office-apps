import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommentThread } from '@shared/api';
import { ApiError } from '../../api';
import type { AnchorDraft } from '../anchors';
import type { Suggestion } from './suggest';

const api = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  reply: vi.fn(),
  resolve: vi.fn(),
  edit: vi.fn(),
  removeMessage: vi.fn(),
  removeThread: vi.fn()
}));
vi.mock('../../client', () => ({ comments: api }));

const { createReviewStore, drawnId, isTemp, suggestionKey, threadKey } = await import('./store');

const ADA = { id: 'u_ada', name: 'Ada Lovelace' };
const DRAFT: AnchorDraft = { relpos: 'AAA=', relposEnd: 'AAE=', quote: 'the quick fox' };

/** A promise the test settles by hand, to see the page before and after the server answers. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

const thread = (id: string, over: Partial<CommentThread> = {}): CommentThread => ({
  id,
  anchor: { kind: 'docs', ...DRAFT },
  resolved: false,
  resolvedById: null,
  resolvedAt: null,
  messages: [{ id: `${id}_m0`, authorId: ADA.id, authorName: ADA.name, body: 'First', mentions: [], createdAt: 1, editedAt: null }],
  createdAt: 1,
  ...over
});

const suggestion = (id: string, from = 1): Suggestion => ({
  id,
  authorId: 'u_ben',
  authorName: 'Ben',
  at: 0,
  from,
  to: from + 3,
  inserted: 'abc',
  deleted: '',
  breaks: 0,
  joins: 0,
  nodesAdded: 0,
  nodesRemoved: 0
});

/** A store already holding `threads`, as after its first load. */
async function loaded(threads: CommentThread[]) {
  api.list.mockResolvedValueOnce({ threads });
  const store = createReviewStore('doc_1');
  const errors: string[] = [];
  store.onError = (t) => errors.push(t);
  await store.load();
  return { store, errors };
}

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
});
afterEach(() => vi.useRealTimers());

describe('posting a comment', () => {
  it('draws the thread in the same call, then takes the server’s id without changing its drawn key', async () => {
    const { store } = await loaded([]);
    const answer = deferred<CommentThread>();
    api.create.mockReturnValueOnce(answer.promise);
    store.setDraft(DRAFT);

    const key = store.create(DRAFT, 'Hello @ben', ['u_ben'], ADA);

    // Before any promise settles.
    const temp = store.get().threads![0]!;
    expect(isTemp(temp.id)).toBe(true);
    expect(key).toBe(threadKey(temp.id));
    expect(store.get().active).toBe(key);
    expect(store.get().draft).toBeNull();
    expect(temp.messages[0]).toMatchObject({ body: 'Hello @ben', authorName: 'Ada Lovelace' });
    expect(api.create).toHaveBeenCalledWith('doc_1', { anchor: { kind: 'docs', ...DRAFT }, body: 'Hello @ben', mentions: ['u_ben'] });

    answer.resolve(thread('th_real'));
    await flush();
    expect(store.get().threads!.map((t) => t.id)).toEqual(['th_real']);
    expect(store.get().active).toBe(threadKey('th_real'));
    expect(drawnId('th_real')).toBe(temp.id);
  });

  it('sends no mentions field when nobody was mentioned', async () => {
    const { store } = await loaded([]);
    api.create.mockResolvedValueOnce(thread('th_x'));
    store.create(DRAFT, 'Plain', [], ADA);
    expect(api.create.mock.calls[0]![1]).toEqual({ anchor: { kind: 'docs', ...DRAFT }, body: 'Plain' });
  });

  it('takes the thread back on refusal, gives the draft back and says why', async () => {
    const { store, errors } = await loaded([]);
    api.create.mockRejectedValueOnce(new ApiError(403, 'forbidden', 'You can’t comment on this.'));
    store.create(DRAFT, 'Hello', [], ADA);
    expect(store.get().threads).toHaveLength(1);
    await flush();
    expect(store.get().threads).toEqual([]);
    expect(store.get().draft).toEqual(DRAFT);
    expect(store.get().active).toBeNull();
    expect(errors).toEqual(['You can’t comment on this.']);
  });

  it('keeps a temporary thread through a load that does not know it yet', async () => {
    const { store } = await loaded([thread('th_1')]);
    api.create.mockReturnValueOnce(new Promise(() => {}));
    store.create(DRAFT, 'Hello', [], ADA);
    api.list.mockResolvedValueOnce({ threads: [thread('th_1')] });
    await store.load();
    expect(store.get().threads!.map((t) => isTemp(t.id))).toEqual([false, true]);
  });
});

describe('replying, resolving and editing', () => {
  it('shows a reply at once and takes it back when refused', async () => {
    const { store, errors } = await loaded([thread('th_1')]);
    const answer = deferred<CommentThread>();
    api.reply.mockReturnValueOnce(answer.promise);
    store.reply('th_1', 'Agreed', [], ADA);
    expect(store.get().threads![0]!.messages.map((m) => m.body)).toEqual(['First', 'Agreed']);
    answer.reject(new Error('network'));
    await flush();
    expect(store.get().threads![0]!.messages.map((m) => m.body)).toEqual(['First']);
    expect(errors).toEqual(['Could not send that.']);
  });

  it('takes the server’s copy of a reply when it answers', async () => {
    const { store } = await loaded([thread('th_1')]);
    const saved = thread('th_1');
    saved.messages.push({ id: 'm_real', authorId: ADA.id, authorName: ADA.name, body: 'Agreed', mentions: [], createdAt: 2, editedAt: null });
    api.reply.mockResolvedValueOnce(saved);
    store.reply('th_1', 'Agreed', [], ADA);
    await flush();
    expect(store.get().threads![0]!.messages.map((m) => m.id)).toEqual(['th_1_m0', 'm_real']);
  });

  it('resolves at once, lets go of the active card, and reopens on refusal', async () => {
    const { store, errors } = await loaded([thread('th_1')]);
    store.setActive(threadKey('th_1'));
    api.resolve.mockRejectedValueOnce(new Error('nope'));
    store.resolve('th_1', true, ADA);
    expect(store.get().threads![0]).toMatchObject({ resolved: true, resolvedById: ADA.id });
    expect(store.get().active).toBeNull();
    await flush();
    expect(store.get().threads![0]).toMatchObject({ resolved: false, resolvedById: null, resolvedAt: null });
    expect(errors).toEqual(['Could not resolve that.']);
  });

  it('puts an edited message back as it was when refused', async () => {
    const { store } = await loaded([thread('th_1')]);
    api.edit.mockRejectedValueOnce(new Error('nope'));
    store.edit('th_1', 'th_1_m0', 'Changed', []);
    expect(store.get().threads![0]!.messages[0]!.body).toBe('Changed');
    await flush();
    expect(store.get().threads![0]!.messages[0]).toMatchObject({ body: 'First', editedAt: null });
  });

  it('refuses to reply to a thread the server has not named yet', async () => {
    const { store } = await loaded([]);
    api.create.mockReturnValueOnce(new Promise(() => {}));
    const key = store.create(DRAFT, 'Hello', [], ADA);
    store.reply(key.slice(2), 'Too soon', [], ADA);
    expect(api.reply).not.toHaveBeenCalled();
  });
});

describe('deleting', () => {
  it('removes the thread at once and keeps it gone through a load that still lists it', async () => {
    const { store } = await loaded([thread('th_1'), thread('th_2')]);
    const answer = deferred<void>();
    api.removeThread.mockReturnValueOnce(answer.promise);
    store.remove('th_1', null);
    expect(store.get().threads!.map((t) => t.id)).toEqual(['th_2']);

    // A load that started after the delete was sent but answers with the old world.
    api.list.mockResolvedValueOnce({ threads: [thread('th_1'), thread('th_2')] });
    await store.load();
    expect(store.get().threads!.map((t) => t.id)).toEqual(['th_2']);

    answer.resolve();
    await flush();
    expect(store.get().threads!.map((t) => t.id)).toEqual(['th_2']);
  });

  it('puts a refused delete back where it was', async () => {
    const { store, errors } = await loaded([thread('th_1'), thread('th_2'), thread('th_3')]);
    api.removeThread.mockRejectedValueOnce(new Error('nope'));
    store.remove('th_2', 'th_2_m0');
    expect(store.get().threads!.map((t) => t.id)).toEqual(['th_1', 'th_3']);
    await flush();
    expect(store.get().threads!.map((t) => t.id)).toEqual(['th_1', 'th_2', 'th_3']);
    expect(errors).toEqual(['Could not delete that.']);
  });

  it('deletes one reply, not the thread, when it is not the first message', async () => {
    const t = thread('th_1');
    t.messages.push({ id: 'm_2', authorId: ADA.id, authorName: ADA.name, body: 'Reply', mentions: [], createdAt: 2, editedAt: null });
    const { store } = await loaded([t]);
    api.removeMessage.mockResolvedValueOnce(undefined);
    store.remove('th_1', 'm_2');
    expect(api.removeMessage).toHaveBeenCalledWith('doc_1', 'th_1', 'm_2');
    expect(api.removeThread).not.toHaveBeenCalled();
    expect(store.get().threads![0]!.messages.map((m) => m.id)).toEqual(['th_1_m0']);
  });
});

describe('loading', () => {
  it('drops an answer that was asked for before a write finished, and asks again', async () => {
    const { store } = await loaded([thread('th_1')]);
    const stale = deferred<{ threads: CommentThread[] }>();
    api.list.mockReturnValueOnce(stale.promise);
    const loading = store.load();

    api.resolve.mockResolvedValueOnce(thread('th_1', { resolved: true, resolvedById: ADA.id, resolvedAt: 5 }));
    store.resolve('th_1', true, ADA);
    await flush();

    api.list.mockResolvedValueOnce({ threads: [thread('th_1', { resolved: true, resolvedById: ADA.id, resolvedAt: 5 })] });
    stale.resolve({ threads: [thread('th_1')] });
    await loading;
    await flush();
    expect(store.get().threads![0]!.resolved).toBe(true);
    expect(api.list).toHaveBeenCalledTimes(3);
  });

  it('keeps a thread’s local version while a change to it is in flight', async () => {
    const { store } = await loaded([thread('th_1')]);
    api.resolve.mockReturnValueOnce(new Promise(() => {}));
    store.resolve('th_1', true, ADA);
    api.list.mockResolvedValueOnce({ threads: [thread('th_1')] });
    await store.load();
    expect(store.get().threads![0]!.resolved).toBe(true);
  });

  it('says it could not load only when there is nothing to show', async () => {
    api.list.mockRejectedValueOnce(new Error('offline'));
    const store = createReviewStore('doc_1');
    await store.load();
    expect(store.get().error).toBe('Could not load the comments.');

    api.list.mockResolvedValueOnce({ threads: [] });
    await store.load();
    expect(store.get().error).toBeNull();
    api.list.mockRejectedValueOnce(new Error('offline'));
    await store.load();
    expect(store.get().error).toBeNull();
  });
});

describe('suggestions', () => {
  it('does not tell anyone when the same cards would be drawn', async () => {
    const { store } = await loaded([]);
    const seen = vi.fn();
    store.subscribe(seen);
    store.setSuggestions([suggestion('s1')]);
    store.setSuggestions([suggestion('s1')]);
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it('lets go of an active suggestion that was accepted or rejected elsewhere', async () => {
    const { store } = await loaded([]);
    store.setSuggestions([suggestion('s1'), suggestion('s2', 9)]);
    store.setActive(suggestionKey('s2'));
    store.setSuggestions([suggestion('s1')]);
    expect(store.get().active).toBeNull();
  });

  it('keeps an active thread when the suggestions change', async () => {
    const { store } = await loaded([thread('th_1')]);
    store.setActive(threadKey('th_1'));
    store.setSuggestions([]);
    store.setSuggestions([suggestion('s1')]);
    expect(store.get().active).toBe(threadKey('th_1'));
  });
});
