// @vitest-environment happy-dom
import { Editor } from '@tiptap/core';
import { yUndoPluginKey } from '@tiptap/y-tiptap';
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { captureSelection, resolveAnchor, type DocsAnchor } from '../anchors';
import { documentExtensions } from '../extensions';
import { docOf, h, makeEditor, p, rangeOf, select } from '../core/testing';
import { collectSuggestions, type Author, type Refusal, type SuggestionsStorage } from './suggest';

const ADA: Author = { id: 'u_ada', name: 'Ada Lovelace' };
const BEN: Author = { id: 'u_ben', name: 'Ben Okoro' };

interface Pair {
  a: Editor;
  b: Editor;
  destroy: () => void;
}

const cleanups: (() => void)[] = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});

/** Two people on one document: two editors over two Yjs documents that pass every update across. */
function pair(content: ReturnType<typeof docOf>): Pair {
  const first = makeEditor(content);
  const doc = new Y.Doc();
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(first.doc), 'remote');
  first.doc.on('update', (u: Uint8Array, origin: unknown) => origin !== 'remote' && Y.applyUpdate(doc, u, 'remote'));
  doc.on('update', (u: Uint8Array, origin: unknown) => origin !== 'remote' && Y.applyUpdate(first.doc, u, 'remote'));
  const element = document.body.appendChild(document.createElement('div'));
  const b = new Editor({ element, extensions: documentExtensions({ doc, awareness: null }), editable: true });
  const out = { a: first.editor, b, destroy: () => (b.destroy(), doc.destroy(), element.remove(), first.destroy()) };
  cleanups.push(out.destroy);
  return out;
}

function single(content: ReturnType<typeof docOf>): Editor {
  const t = makeEditor(content);
  cleanups.push(t.destroy);
  return t.editor;
}

const suggesting = (e: Editor, who: Author) => e.commands.setSuggestState({ mode: 'suggesting', author: who });

/** Type as the browser does: through the text-input handlers (input rules), then as plain text. */
function type(e: Editor, text: string): void {
  for (const ch of text) {
    const view = e.view;
    const { from, to } = view.state.selection;
    const deflt = () => view.state.tr.insertText(ch, from, to);
    if (!view.someProp('handleTextInput', (f) => f(view, from, to, ch, deflt))) view.dispatch(deflt());
  }
}

/** A key, through the view's handlers as a keystroke reaches them (`keyboardShortcut` replays steps instead). */
const press = (e: Editor, key: string, times = 1) => {
  for (let i = 0; i < times; i++) {
    const view = e.view;
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
    view.someProp('handleKeyDown', (f) => f(view, event));
  }
};

const caretAfter = (e: Editor, needle: string) => e.commands.setTextSelection(rangeOf(e, needle).to);
const caretBefore = (e: Editor, needle: string) => e.commands.setTextSelection(rangeOf(e, needle).from);

/** The page's text as a reader with all markup sees it: `[+inserted+]`, `[-deleted-]`, `¶` for a block change. */
function markup(e: Editor): string {
  const out: string[] = [];
  e.state.doc.forEach((block) => {
    let line = block.attrs.suggest ? `¶${(block.attrs.suggest as { kind: string }).kind} ` : '';
    block.descendants((node) => {
      if (!node.isText) return true;
      const names = node.marks.map((m) => m.type.name);
      const t = node.text ?? '';
      line += names.includes('deletion') ? `[-${t}-]` : names.includes('insertion') ? `[+${t}+]` : t;
      return false;
    });
    out.push(line);
  });
  return out.join(' | ');
}

const refusals = (e: Editor): Refusal[] => {
  const seen: Refusal[] = [];
  (e.storage as unknown as { suggestions: SuggestionsStorage }).suggestions.onRefused = (r) => seen.push(r);
  return seen;
};

describe('typing in Suggesting', () => {
  it('marks what is typed as an insertion with an id, an author and a time', () => {
    const e = single(docOf(p('The cat sat.')));
    suggesting(e, ADA);
    caretAfter(e, 'cat');
    type(e, ' quietly');

    expect(e.getText()).toBe('The cat quietly sat.');
    expect(markup(e)).toBe('The cat[+ quietly+] sat.');
    const [s] = collectSuggestions(e.state.doc);
    expect(s).toMatchObject({ authorId: 'u_ada', authorName: 'Ada Lovelace', inserted: ' quietly', deleted: '' });
    expect(s!.id).toMatch(/^s[0-9a-z]+$/);
    expect(s!.at).toBeGreaterThan(Date.now() - 60_000);
    // One suggestion, not eight: each keystroke carries the last one's id on.
    expect(collectSuggestions(e.state.doc)).toHaveLength(1);
  });

  it('does not touch text typed in Editing', () => {
    const e = single(docOf(p('The cat sat.')));
    caretAfter(e, 'cat');
    type(e, 's');
    expect(markup(e)).toBe('The cats sat.');
  });

  it('does not run input rules: a suggestion is the characters typed', () => {
    const e = single(docOf(p('')));
    suggesting(e, ADA);
    type(e, '# Title');
    expect(e.state.doc.firstChild!.type.name).toBe('paragraph');
    expect(markup(e)).toBe('[+# Title+]');
  });

  it('marks text typed over someone else’s insertion as the typist’s own', () => {
    const e = single(docOf(p('Hello')));
    suggesting(e, BEN);
    caretAfter(e, 'Hello');
    type(e, ' world');
    suggesting(e, ADA);
    caretAfter(e, ' wor');
    type(e, 'X');
    const authors = collectSuggestions(e.state.doc).map((s) => [s.authorId, s.inserted]);
    expect(markup(e)).toBe('Hello[+ wor+][+X+][+ld+]');
    expect(authors).toEqual([
      ['u_ben', ' world'],
      ['u_ada', 'X']
    ]);
  });
});

describe('deleting in Suggesting', () => {
  it('strikes the text out instead of removing it, and leaves the caret before it', () => {
    const e = single(docOf(p('The black cat.')));
    suggesting(e, ADA);
    caretAfter(e, 'black');
    press(e, 'Backspace', 5);

    expect(e.getText()).toBe('The black cat.');
    expect(markup(e)).toBe('The [-black-] cat.');
    expect(e.state.selection.from).toBe(rangeOf(e, 'black').from);
    const all = collectSuggestions(e.state.doc);
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ deleted: 'black', inserted: '' });
  });

  it('forward delete leaves the caret after what it struck', () => {
    const e = single(docOf(p('ab')));
    suggesting(e, ADA);
    e.commands.setTextSelection(1);
    press(e, 'Delete');
    expect(markup(e)).toBe('[-a-]b');
    expect(e.state.selection.from).toBe(2);
  });

  it('a selection deleted is struck as one suggestion', () => {
    const e = single(docOf(p('one two three')));
    suggesting(e, ADA);
    select(e, 'two ');
    press(e, 'Backspace');
    expect(markup(e)).toBe('one [-two -]three');
  });

  it('removes the author’s own insertion for real', () => {
    const e = single(docOf(p('Hi')));
    suggesting(e, ADA);
    caretAfter(e, 'Hi');
    type(e, ' there');
    press(e, 'Backspace', 3);
    expect(markup(e)).toBe('Hi[+ th+]');
    press(e, 'Backspace', 3);
    expect(markup(e)).toBe('Hi');
    expect(collectSuggestions(e.state.doc)).toEqual([]);
  });

  it('strikes someone else’s insertion rather than removing it', () => {
    const e = single(docOf(p('Hi')));
    suggesting(e, BEN);
    caretAfter(e, 'Hi');
    type(e, '!');
    suggesting(e, ADA);
    press(e, 'Backspace');
    expect(e.getText()).toBe('Hi!');
    expect(collectSuggestions(e.state.doc).map((s) => [s.authorId, s.inserted, s.deleted])).toEqual([
      ['u_ben', '!', ''],
      ['u_ada', '', '!']
    ]);
  });

  it('typing over a selection is one suggestion that replaces it', () => {
    const e = single(docOf(p('a big dog')));
    suggesting(e, ADA);
    select(e, 'big');
    type(e, 'small');
    expect(markup(e)).toBe('a [-big-][+small+] dog');
    const all = collectSuggestions(e.state.doc);
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ inserted: 'small', deleted: 'big' });
  });

  it('keeps a comment on the struck text where it was', async () => {
    const e = single(docOf(p('keep this word here')));
    // The binding the anchors read arrives a tick after the editor.
    await new Promise((r) => setTimeout(r, 0));
    select(e, 'this word');
    const draft = captureSelection(e)!;
    const anchor: DocsAnchor = { kind: 'docs', ...draft };
    suggesting(e, ADA);
    select(e, 'this word');
    press(e, 'Backspace');
    const at = resolveAnchor(e, anchor);
    expect(at).toEqual(rangeOf(e, 'this word'));
  });
});

describe('Yjs', () => {
  it('a suggested deletion writes no deletion to Yjs', async () => {
    const t = makeEditor(docOf(p('keep this word here')));
    cleanups.push(t.destroy);
    await new Promise((r) => setTimeout(r, 0));
    const deletes: number[] = [];
    t.doc.on('update', (u: Uint8Array) => deletes.push(Y.decodeUpdate(u).ds.clients.size));
    suggesting(t.editor, ADA);
    select(t.editor, 'this word');
    press(t.editor, 'Backspace');
    caretAfter(t.editor, 'here');
    type(t.editor, '!');
    expect(deletes.length).toBeGreaterThan(0);
    expect(deletes.every((n) => n === 0)).toBe(true);
  });

  it('a character outside the basic plane is deleted whole', () => {
    const e = single(docOf(p('a😀')));
    suggesting(e, ADA);
    caretAfter(e, '😀');
    press(e, 'Backspace');
    expect(markup(e)).toBe('a[-😀-]');
  });

  it('undo takes a suggestion back', async () => {
    const t = makeEditor(docOf(p('Hello')));
    cleanups.push(t.destroy);
    await new Promise((r) => setTimeout(r, 0));
    // The content the test set is not this person's to undo.
    yUndoPluginKey.getState(t.editor.state)?.undoManager.stopCapturing();
    suggesting(t.editor, ADA);
    caretAfter(t.editor, 'Hello');
    type(t.editor, ' there');
    t.editor.commands.undo();
    expect(markup(t.editor)).toBe('Hello');
  });
});

describe('Enter and paragraph breaks', () => {
  it('Enter over text across two paragraphs is one suggestion that converges either way', () => {
    for (const accept of [true, false]) {
      const e = single(docOf(p('one two'), p('three four')));
      suggesting(e, ADA);
      e.commands.setTextSelection({ from: rangeOf(e, 'two').from, to: rangeOf(e, 'three').to });
      press(e, 'Enter');
      expect(collectSuggestions(e.state.doc)).toHaveLength(1);
      if (accept) e.commands.acceptAllSuggestions();
      else e.commands.rejectAllSuggestions();
      const blocks: string[] = [];
      e.state.doc.forEach((b) => blocks.push(b.textContent));
      expect(blocks).toEqual(accept ? ['one ', ' four'] : ['one two', 'three four']);
    }
  });

  it('Enter suggests a break, and rejecting it joins the paragraphs again', () => {
    const e = single(docOf(p('First second')));
    suggesting(e, ADA);
    caretAfter(e, 'First');
    press(e, 'Enter');
    type(e, 'X');
    expect(markup(e)).toBe('First | ¶split [+X+] second');
    const [s] = collectSuggestions(e.state.doc);
    expect(s).toMatchObject({ breaks: 1, inserted: 'X' });

    e.commands.rejectSuggestion(s!.id);
    expect(markup(e)).toBe('First second');
  });

  it('accepting a suggested break keeps it, and the paragraph forgets it', () => {
    const e = single(docOf(p('First second')));
    suggesting(e, ADA);
    caretAfter(e, 'First');
    press(e, 'Enter');
    e.commands.acceptAllSuggestions();
    expect(markup(e)).toBe('First |  second');
  });

  it('Backspace at the start of a paragraph suggests joining it', () => {
    const e = single(docOf(h(2, 'Title'), p('Body')));
    suggesting(e, ADA);
    caretBefore(e, 'Body');
    press(e, 'Backspace');
    expect(e.state.doc.childCount).toBe(2);
    expect(markup(e)).toBe('Title | ¶join Body');
    expect(e.state.selection.from).toBe(rangeOf(e, 'Title').to);

    e.commands.acceptAllSuggestions();
    expect(e.state.doc.firstChild!.textContent).toBe('TitleBody');
    expect(collectSuggestions(e.state.doc)).toEqual([]);
  });

  it('Backspace over the author’s own break removes it', () => {
    const e = single(docOf(p('ab')));
    suggesting(e, ADA);
    e.commands.setTextSelection(2);
    press(e, 'Enter');
    expect(e.state.doc.childCount).toBe(2);
    press(e, 'Backspace');
    expect(e.state.doc.childCount).toBe(1);
    expect(markup(e)).toBe('ab');
  });

  it('a split in Editing does not copy a suggestion onto the new paragraph', () => {
    const e = single(docOf(p('ab')));
    suggesting(e, ADA);
    e.commands.setTextSelection(2);
    press(e, 'Enter');
    e.commands.setSuggestState({ mode: 'editing' });
    caretAfter(e, 'b');
    press(e, 'Enter');
    expect(markup(e)).toBe('a | ¶split b | ');
  });
});

describe('paste', () => {
  it('is an insertion, and arrives without anyone else’s suggestions', () => {
    const e = single(docOf(p('Start')));
    suggesting(e, ADA);
    caretAfter(e, 'Start');
    e.view.pasteHTML(
      '<p>, kept <del data-suggestion="x1" data-author-id="u_ben">gone</del><ins data-suggestion="x2" data-author-id="u_ben">plain</ins></p>'
    );
    expect(markup(e)).toBe('Start[+, kept plain+]');
    expect(collectSuggestions(e.state.doc).map((s) => s.authorId)).toEqual(['u_ada']);
  });

  it('in Editing, drops deleted text and keeps the rest plain', () => {
    const e = single(docOf(p('Start')));
    caretAfter(e, 'Start');
    e.view.pasteHTML('<p>, a<del data-suggestion="x1">b</del><ins data-suggestion="x2">c</ins></p>');
    expect(markup(e)).toBe('Start, ac');
  });
});

describe('what Suggesting refuses', () => {
  it('formatting', () => {
    const e = single(docOf(p('plain text')));
    const seen = refusals(e);
    suggesting(e, ADA);
    select(e, 'plain');
    e.commands.toggleBold();
    expect(e.state.doc.firstChild!.firstChild!.marks).toEqual([]);
    expect(seen).toEqual(['format']);
  });

  it('typing in code, which cannot carry a mark', () => {
    const e = single(docOf({ type: 'codeBlock', content: [{ type: 'text', text: 'x = 1' }] }));
    const seen = refusals(e);
    suggesting(e, ADA);
    e.commands.setTextSelection(3);
    type(e, 'y');
    expect(e.state.doc.firstChild!.textContent).toBe('x = 1');
    expect(seen).toEqual(['code']);
  });

  it('nothing at all without an author', () => {
    const e = single(docOf(p('a')));
    e.commands.setSuggestState({ mode: 'suggesting', author: null });
    caretAfter(e, 'a');
    type(e, 'b');
    expect(markup(e)).toBe('ab');
  });
});

describe('two people', () => {
  it('see each other’s suggestions, and converge on accept and reject', () => {
    const { a, b } = pair(docOf(p('The quick fox jumps.')));
    suggesting(a, ADA);
    caretAfter(a, 'fox');
    type(a, ' brown');
    select(a, 'quick ');
    press(a, 'Backspace');

    expect(markup(b)).toBe('The [-quick -]fox[+ brown+] jumps.');
    const [del, ins] = collectSuggestions(b.state.doc);
    expect(del).toMatchObject({ authorName: 'Ada Lovelace', deleted: 'quick ' });
    expect(ins).toMatchObject({ authorName: 'Ada Lovelace', inserted: ' brown' });

    b.commands.acceptSuggestion(ins!.id);
    b.commands.rejectSuggestion(del!.id);
    expect(b.getText()).toBe('The quick fox brown jumps.');
    expect(a.getText()).toBe(b.getText());
    expect(markup(a)).toBe('The quick fox brown jumps.');
    expect(collectSuggestions(a.state.doc)).toEqual([]);
  });

  it('a remote edit is never rewritten as the reader’s suggestion', () => {
    const { a, b } = pair(docOf(p('Hello')));
    suggesting(b, BEN);
    caretAfter(a, 'Hello');
    type(a, ' all');
    expect(markup(b)).toBe('Hello all');
  });

  it('reject all and accept all reach the other side', () => {
    const { a, b } = pair(docOf(p('one two')));
    suggesting(a, ADA);
    caretAfter(a, 'two');
    type(a, ' three');
    select(a, 'one ');
    press(a, 'Backspace');
    b.commands.rejectAllSuggestions();
    expect(markup(a)).toBe('one two');

    caretAfter(a, 'two');
    type(a, '!');
    b.commands.acceptAllSuggestions();
    expect(markup(a)).toBe('one two!');
  });
});

describe('collectSuggestions', () => {
  it('lists them in page order, with text from two paragraphs kept apart', () => {
    const e = single(docOf(p('alpha'), p('beta')));
    suggesting(e, ADA);
    e.commands.setTextSelection({ from: 2, to: rangeOf(e, 'beta').from + 2 });
    press(e, 'Backspace');
    const [s] = collectSuggestions(e.state.doc);
    expect(s).toMatchObject({ deleted: 'lpha be', joins: 1 });
  });
});
