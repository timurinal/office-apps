// @vitest-environment happy-dom
import type { Editor } from '@tiptap/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { captureSelection, type DocsAnchor } from '../anchors';
import { docOf, makeEditor, p, rangeOf, select } from '../core/testing';
import type { DocsContext } from '../modules/types';
import { currentSuggestion, decide, DRAFT_ID, DRAFT_KEY, startComment, step, threadStops } from './actions';
import { describe as describeChange, mentionAt, mentionIds, tokenFor } from './cards';
import { highlightKey, setHighlights } from './highlights';
import { resetReviewStores, reviewStore, suggestionKey, threadKey } from './store';
import { collectSuggestions, type Suggestion } from './suggest';

const cleanups: (() => void)[] = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
  resetReviewStores();
});

async function editorWith(...paragraphs: string[]): Promise<Editor> {
  const t = makeEditor(docOf(...paragraphs.map((x) => p(x))));
  cleanups.push(t.destroy);
  // The binding the anchors are read through arrives a tick after the editor.
  await new Promise((r) => setTimeout(r, 0));
  return t.editor;
}

/** The context a ribbon button or a card is handed, with what these tests look at. */
function contextFor(editor: Editor, can: Partial<DocsContext['can']> = {}) {
  const notify = vi.fn();
  const open = vi.fn();
  const ctx = {
    editor,
    meta: { id: 'doc_review' },
    can: { comment: true, comments: true, suggest: true, ...can },
    mode: 'editing',
    panes: { open, toggle: vi.fn(), close: vi.fn(), isOpen: () => false },
    notify
  } as unknown as DocsContext;
  return { ctx, notify, open, store: reviewStore('doc_review') };
}

const anchorOn = (editor: Editor, needle: string): DocsAnchor => {
  select(editor, needle);
  return { kind: 'docs', ...captureSelection(editor)! };
};

const drawn = (editor: Editor) =>
  (highlightKey.getState(editor.state)?.decos.find() ?? []).map((d) => ({
    thread: (d.spec as { thread?: string }).thread,
    text: editor.state.doc.textBetween(d.from, d.to)
  }));

describe('the @ picker’s text', () => {
  it('finds the word being typed after an @', () => {
    expect(mentionAt('Ask @be', 7)).toEqual({ start: 4, query: 'be' });
    expect(mentionAt('@', 1)).toEqual({ start: 0, query: '' });
  });

  it('ignores an @ inside a word, or one the caret has moved past', () => {
    expect(mentionAt('ada@example', 11)).toBeNull();
    expect(mentionAt('Ask @ben now', 12)).toBeNull();
  });

  it('writes a person by handle, or by name without one', () => {
    expect(tokenFor({ userId: 'u1', name: 'Ben Okoro', handle: 'ben', avatarUrl: null })).toBe('@ben');
    expect(tokenFor({ userId: 'u1', name: 'Ben Okoro', handle: null, avatarUrl: null })).toBe('@Ben Okoro');
  });

  it('sends only the people whose token is still in the text, once each', () => {
    const picked = [
      { userId: 'u_ben', token: '@ben' },
      { userId: 'u_cy', token: '@cy' },
      { userId: 'u_ben', token: '@ben' }
    ];
    expect(mentionIds('Thanks @ben', picked)).toEqual(['u_ben']);
  });
});

describe('what a change card says', () => {
  const s = (over: Partial<Suggestion>): Suggestion => ({
    id: 's1',
    authorId: 'u',
    authorName: 'U',
    at: 0,
    from: 1,
    to: 2,
    inserted: '',
    deleted: '',
    breaks: 0,
    joins: 0,
    nodesAdded: 0,
    nodesRemoved: 0,
    ...over
  });

  it('names replacements, insertions, deletions and breaks', () => {
    expect(describeChange(s({ inserted: 'small', deleted: 'big' }))).toEqual({ verb: 'Replaced', rest: '“big” with “small”' });
    expect(describeChange(s({ inserted: ' quietly' }))).toEqual({ verb: 'Inserted', rest: '“quietly”' });
    expect(describeChange(s({ inserted: ' ' }))).toEqual({ verb: 'Inserted', rest: 'a space' });
    expect(describeChange(s({ deleted: 'very ' }))).toEqual({ verb: 'Deleted', rest: '“very”' });
    expect(describeChange(s({ breaks: 1 }))).toEqual({ verb: 'Inserted', rest: 'a paragraph break' });
    expect(describeChange(s({ joins: 1 }))).toEqual({ verb: 'Joined', rest: 'two paragraphs' });
  });
});

describe('highlights', () => {
  it('draws a thread over its text, and follows the text as it moves', async () => {
    const e = await editorWith('One two three four.');
    const anchor = anchorOn(e, 'three');
    e.view.dispatch(setHighlights(e.state.tr, { threads: [{ id: 'th_1', anchor }] }));
    expect(drawn(e)).toEqual([{ thread: 'th_1', text: 'three' }]);

    e.commands.insertContentAt(1, 'Zero ');
    expect(drawn(e)).toEqual([{ thread: 'th_1', text: 'three' }]);
  });

  it('marks the active thread', async () => {
    const e = await editorWith('One two three.');
    const anchor = anchorOn(e, 'two');
    e.view.dispatch(setHighlights(e.state.tr, { threads: [{ id: 'th_1', anchor }], active: threadKey('th_1') }));
    expect(e.view.dom.querySelector('.oa-anc.is-active')?.textContent).toBe('two');
  });

  it('draws nothing for a thread whose text has been deleted', async () => {
    // Not "One two three.": Yjs is handed a text diff, and that one keeps two's "t" as three's.
    const e = await editorWith('One two, three.');
    const anchor = anchorOn(e, 'two');
    e.commands.deleteRange(rangeOf(e, 'two'));
    e.view.dispatch(setHighlights(e.state.tr, { threads: [{ id: 'th_1', anchor }] }));
    expect(drawn(e)).toEqual([]);
  });

  it('is no part of the document', async () => {
    const e = await editorWith('One two three.');
    const before = JSON.stringify(e.getJSON());
    e.view.dispatch(setHighlights(e.state.tr, { threads: [{ id: 'th_1', anchor: anchorOn(e, 'two') }] }));
    expect(JSON.stringify(e.getJSON())).toBe(before);
  });
});

describe('starting a comment', () => {
  it('asks for a selection when there is none', async () => {
    const e = await editorWith('Some text.');
    const { ctx, notify, store } = contextFor(e);
    e.commands.setTextSelection(2);
    expect(startComment(ctx)).toBe(true);
    expect(notify).toHaveBeenCalledWith({ text: 'Select some text first.' });
    expect(store.get().draft).toBeNull();
  });

  it('takes the selection, focuses the composer and opens the pane when there is no margin', async () => {
    const e = await editorWith('Some text.');
    const { ctx, open, store } = contextFor(e);
    select(e, 'text');
    expect(startComment(ctx)).toBe(true);
    expect(store.get().draft?.quote).toBe('text');
    expect(store.get().active).toBe(DRAFT_KEY);
    expect(open).toHaveBeenCalledWith('comments');
  });

  it('leaves the pane shut when the cards are beside the page', async () => {
    const e = await editorWith('Some text.');
    const { ctx, open, store } = contextFor(e);
    store.setMargin(true);
    select(e, 'text');
    startComment(ctx);
    expect(open).not.toHaveBeenCalled();
  });

  it('does nothing for someone who cannot comment', async () => {
    const e = await editorWith('Some text.');
    const { ctx, store } = contextFor(e, { comment: false });
    select(e, 'text');
    expect(startComment(ctx)).toBe(false);
    expect(store.get().draft).toBeNull();
  });
});

describe('moving between comments and changes', () => {
  it('goes to the next comment in page order, skips the composer, and wraps', async () => {
    const e = await editorWith('Alpha beta gamma delta.');
    const { ctx, store } = contextFor(e);
    const threads = [
      { id: 'th_late', anchor: anchorOn(e, 'delta') },
      { id: DRAFT_ID, anchor: anchorOn(e, 'beta') },
      { id: 'th_early', anchor: anchorOn(e, 'Alpha') }
    ];
    e.view.dispatch(setHighlights(e.state.tr, { threads }));
    expect(threadStops(e).map((s) => s.key)).toEqual([threadKey('th_early'), threadKey('th_late')]);

    e.commands.setTextSelection(rangeOf(e, 'beta').from);
    step(ctx, 'comment', 1);
    expect(store.get().active).toBe(threadKey('th_late'));
    expect(e.state.selection.from).toBe(rangeOf(e, 'delta').from);
    step(ctx, 'comment', 1);
    expect(store.get().active).toBe(threadKey('th_early'));
    step(ctx, 'comment', -1);
    expect(store.get().active).toBe(threadKey('th_late'));
  });

  it('goes through the changes the store lists', async () => {
    const e = await editorWith('The cat sat on the mat.');
    const { ctx, store } = contextFor(e);
    e.commands.setSuggestState({ mode: 'suggesting', author: { id: 'u_ada', name: 'Ada' } });
    e.commands.setTextSelection(rangeOf(e, 'cat').to);
    e.commands.insertContent('s');
    e.commands.setTextSelection(rangeOf(e, 'mat').to);
    e.commands.insertContent('s');
    store.setSuggestions(collectSuggestions(e.state.doc));
    const [first, second] = store.get().suggestions;
    expect(store.get().suggestions).toHaveLength(2);

    e.commands.setTextSelection(1);
    step(ctx, 'change', 1);
    expect(store.get().active).toBe(suggestionKey(first!.id));
    step(ctx, 'change', 1);
    expect(store.get().active).toBe(suggestionKey(second!.id));
    expect(currentSuggestion(ctx)?.id).toBe(second!.id);
  });
});

describe('accepting and rejecting', () => {
  async function twoChanges() {
    const e = await editorWith('The cat sat on the mat.');
    e.commands.setSuggestState({ mode: 'suggesting', author: { id: 'u_ada', name: 'Ada' } });
    e.commands.setTextSelection(rangeOf(e, 'cat').to);
    e.commands.insertContent('s');
    e.commands.setTextSelection(rangeOf(e, 'mat').to);
    e.commands.insertContent('s');
    e.commands.setSuggestState({ mode: 'editing' });
    return e;
  }

  it('decides the change at the caret when no card is active', async () => {
    const e = await twoChanges();
    const { ctx, store } = contextFor(e);
    store.setSuggestions(collectSuggestions(e.state.doc));
    e.commands.setTextSelection(rangeOf(e, 'mat').to + 1);
    decide(ctx, false);
    expect(e.getText()).toBe('The cats sat on the mat.');
  });

  it('decides every change at once', async () => {
    const e = await twoChanges();
    const { ctx } = contextFor(e);
    decide(ctx, true, 'all');
    expect(e.getText()).toBe('The cats sat on the mats.');
    expect(collectSuggestions(e.state.doc)).toEqual([]);
  });

  it('does nothing for someone who cannot suggest', async () => {
    const e = await twoChanges();
    const { ctx } = contextFor(e, { suggest: false });
    decide(ctx, true, 'all');
    expect(collectSuggestions(e.state.doc)).toHaveLength(2);
  });
});
