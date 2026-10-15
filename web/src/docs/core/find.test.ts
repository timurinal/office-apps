// @vitest-environment happy-dom
import { yUndoPluginKey } from '@tiptap/y-tiptap';
import { afterEach, describe, expect, it } from 'vitest';
import { closeFind, findMatches, findState, gotoMatch, openFind, replaceAll, replaceCurrent, setFind, stepFind } from './find';
import { docOf, makeEditor, p, select, type TestEditor } from './testing';

let t: TestEditor;
afterEach(() => t?.destroy());

const text = (t: TestEditor) => t.editor.state.doc.textBetween(0, t.editor.state.doc.content.size, '\n');

describe('finding', () => {
  it('finds every match, case-insensitive and anywhere in a word by default', () => {
    t = makeEditor(docOf(p('The cat sat on a Cat, the concatenation.'), p('Cat again')));
    expect(findMatches(t.editor.state.doc, { query: 'cat', matchCase: false, wholeWord: false })).toHaveLength(4);
    expect(findMatches(t.editor.state.doc, { query: 'cat', matchCase: true, wholeWord: false })).toHaveLength(2);
    expect(findMatches(t.editor.state.doc, { query: 'cat', matchCase: false, wholeWord: true })).toHaveLength(3);
    expect(findMatches(t.editor.state.doc, { query: 'Cat', matchCase: true, wholeWord: true })).toHaveLength(2);
  });

  it('returns document positions that select exactly the match', () => {
    t = makeEditor(docOf(p('one two'), p('two three')));
    const m = findMatches(t.editor.state.doc, { query: 'two', matchCase: false, wholeWord: false });
    expect(m.map((r) => t.editor.state.doc.textBetween(r.from, r.to))).toEqual(['two', 'two']);
  });

  it('finds a phrase across bold and plain text, but never across blocks or a chip', () => {
    t = makeEditor(
      docOf(
        { type: 'paragraph', content: [{ type: 'text', text: 'across ' }, { type: 'text', text: 'bold', marks: [{ type: 'bold' }] }, { type: 'text', text: ' words' }] },
        p('end'),
        p('start'),
        { type: 'paragraph', content: [{ type: 'text', text: 'before' }, { type: 'dateChip', attrs: { date: '2026-10-14' } }, { type: 'text', text: 'after' }] }
      )
    );
    const q = (query: string) => findMatches(t.editor.state.doc, { query, matchCase: false, wholeWord: false });
    expect(q('across bold words')).toHaveLength(1);
    expect(q('endstart')).toHaveLength(0);
    expect(q('end start')).toHaveLength(0);
    expect(q('beforeafter')).toHaveLength(0);
  });

  it('treats the query as literal text, never a pattern', () => {
    t = makeEditor(docOf(p('a.c abc (x) [y] a+b $5 ^ \\ ?')));
    for (const [query, n] of [['a.c', 1], ['(x)', 1], ['[y]', 1], ['a+b', 1], ['$5', 1], ['^', 1], ['\\', 1], ['?', 1], ['.*', 0]] as const) {
      expect(findMatches(t.editor.state.doc, { query, matchCase: false, wholeWord: false }), query).toHaveLength(n);
    }
  });

  it('matches whole words by letters and digits, so punctuation does not hide one', () => {
    t = makeEditor(docOf(p('cat, (cat) cat-s cats cat_x 3cat')));
    expect(findMatches(t.editor.state.doc, { query: 'cat', matchCase: false, wholeWord: true })).toHaveLength(3);
  });

  it('finds nothing for an empty query, and handles emoji and accents', () => {
    t = makeEditor(docOf(p('naïve 😀 café 😀')));
    expect(findMatches(t.editor.state.doc, { query: '', matchCase: false, wholeWord: false })).toEqual([]);
    const m = findMatches(t.editor.state.doc, { query: '😀', matchCase: false, wholeWord: false });
    expect(m).toHaveLength(2);
    expect(t.editor.state.doc.textBetween(m[1]!.from, m[1]!.to)).toBe('😀');
    expect(findMatches(t.editor.state.doc, { query: 'CAFÉ', matchCase: false, wholeWord: true })).toHaveLength(1);
  });
});

describe('the bar’s state', () => {
  it('is closed and empty until opened, and does nothing to a keystroke while closed', () => {
    t = makeEditor(docOf(p('cat cat')));
    expect(findState(t.editor)).toMatchObject({ open: false, matches: [], current: -1 });
    t.editor.commands.insertContentAt(1, 'x');
    expect(findState(t.editor).matches).toEqual([]);
  });

  it('opens with the selected text as the query, and finds from the caret on', () => {
    t = makeEditor(docOf(p('one cat two cat three cat')));
    select(t.editor, 'cat');
    openFind(t.editor);
    expect(findState(t.editor)).toMatchObject({ open: true, query: 'cat', showReplace: false });
    expect(findState(t.editor).matches).toHaveLength(3);
    expect(findState(t.editor).current).toBe(0);

    // The caret is after the first match, so the search starts at the second.
    t.editor.commands.setTextSelection(9);
    setFind(t.editor, { query: 'cat' });
    expect(findState(t.editor).current).toBe(1);
  });

  it('does not start from a selection that is long or spans lines', () => {
    t = makeEditor(docOf(p('a'.repeat(150)), p('two lines')));
    t.editor.commands.selectAll();
    openFind(t.editor);
    expect(findState(t.editor).query).toBe('');
  });

  it('steps through the matches, wrapping, and selects each', () => {
    t = makeEditor(docOf(p('cat dog cat dog cat')));
    openFind(t.editor);
    setFind(t.editor, { query: 'cat' });
    const at = () => t.editor.state.doc.textBetween(t.editor.state.selection.from, t.editor.state.selection.to);
    expect(findState(t.editor).current).toBe(0);
    stepFind(t.editor, 1);
    expect(findState(t.editor).current).toBe(1);
    expect(at()).toBe('cat');
    stepFind(t.editor, 1);
    stepFind(t.editor, 1);
    expect(findState(t.editor).current).toBe(0);
    stepFind(t.editor, -1);
    expect(findState(t.editor).current).toBe(2);
    gotoMatch(t.editor, 1);
    expect(t.editor.state.selection.from).toBe(findState(t.editor).matches[1]!.from);
  });

  it('follows the document: a change while it is open re-searches', () => {
    t = makeEditor(docOf(p('cat')));
    openFind(t.editor);
    setFind(t.editor, { query: 'cat' });
    expect(findState(t.editor).matches).toHaveLength(1);
    t.editor.chain().insertContentAt(1, 'cat ').run();
    expect(findState(t.editor).matches).toHaveLength(2);
  });

  it('draws the matches as decorations and not as document content', () => {
    t = makeEditor(docOf(p('cat dog cat')));
    openFind(t.editor);
    setFind(t.editor, { query: 'cat' });
    expect(t.editor.view.dom.querySelectorAll('.oa-find')).toHaveLength(2);
    expect(t.editor.view.dom.querySelectorAll('.oa-find-current')).toHaveLength(1);
    expect(t.editor.getHTML()).not.toContain('oa-find');
    closeFind(t.editor);
    expect(t.editor.view.dom.querySelectorAll('.oa-find')).toHaveLength(0);
    // What was typed in the bar is still there when it opens again.
    expect(findState(t.editor).query).toBe('cat');
  });

  it('opens the replace row for Ctrl+H, and keeps it open for Ctrl+F after', () => {
    t = makeEditor(docOf(p('x')));
    openFind(t.editor, { replace: true });
    expect(findState(t.editor).showReplace).toBe(true);
    openFind(t.editor);
    expect(findState(t.editor).showReplace).toBe(true);
  });

  it('opens on Ctrl+F and Ctrl+H pressed in the page, and not on the other keys', () => {
    t = makeEditor(docOf(p('x')));
    const press = (key: string, extra: KeyboardEventInit = {}) => {
      const e = new KeyboardEvent('keydown', { key, ctrlKey: true, bubbles: true, cancelable: true, ...extra });
      t.editor.view.dom.dispatchEvent(e);
      return e.defaultPrevented;
    };
    expect(press('g')).toBe(false);
    expect(findState(t.editor).open).toBe(false);
    expect(press('f')).toBe(true);
    expect(findState(t.editor)).toMatchObject({ open: true, showReplace: false });
    closeFind(t.editor);
    expect(press('h')).toBe(true);
    expect(findState(t.editor).showReplace).toBe(true);
  });
});

describe('replacing', () => {
  it('replaces one, then moves to the next after it', () => {
    t = makeEditor(docOf(p('cat dog cat dog cat')));
    openFind(t.editor, { replace: true });
    setFind(t.editor, { query: 'cat', replace: 'bird' });
    replaceCurrent(t.editor);
    expect(text(t)).toBe('bird dog cat dog cat');
    expect(findState(t.editor).matches).toHaveLength(2);
    expect(findState(t.editor).current).toBe(0);
    const at = () => t.editor.state.doc.textBetween(t.editor.state.selection.from, t.editor.state.selection.to);
    expect(at()).toBe('cat');
    replaceCurrent(t.editor);
    replaceCurrent(t.editor);
    expect(text(t)).toBe('bird dog bird dog bird');
    expect(findState(t.editor).matches).toHaveLength(0);
  });

  it('does not get stuck on a replacement that contains the query', () => {
    t = makeEditor(docOf(p('cat cat')));
    openFind(t.editor, { replace: true });
    setFind(t.editor, { query: 'cat', replace: 'cats' });
    replaceCurrent(t.editor);
    expect(text(t)).toBe('cats cat');
    expect(t.editor.state.doc.textBetween(t.editor.state.selection.from, t.editor.state.selection.to)).toBe('cat');
    expect(findState(t.editor).current).toBe(1);
  });

  it('replaces all, as one transaction and one undo step', () => {
    t = makeEditor(docOf(p('cat dog cat'), p('a cat')));
    // The undo history merges edits made within half a second; the document being set up
    // above is a step of its own.
    yUndoPluginKey.getState(t.editor.state)!.undoManager.stopCapturing();
    openFind(t.editor, { replace: true });
    setFind(t.editor, { query: 'cat', replace: 'bird' });
    let transactions = 0;
    t.editor.on('transaction', () => transactions++);
    expect(replaceAll(t.editor)).toBe(3);
    expect(transactions).toBe(1);
    expect(text(t)).toBe('bird dog bird\na bird');
    t.editor.commands.undo();
    expect(text(t)).toBe('cat dog cat\na cat');
  });

  it('keeps the formatting of the text it replaces', () => {
    t = makeEditor(docOf({ type: 'paragraph', content: [{ type: 'text', text: 'bold ', marks: [{ type: 'bold' }] }, { type: 'text', text: 'cat', marks: [{ type: 'bold' }, { type: 'italic' }] }, { type: 'text', text: ' plain' }] }));
    openFind(t.editor, { replace: true });
    setFind(t.editor, { query: 'cat', replace: 'dog' });
    replaceAll(t.editor);
    const marks: string[] = [];
    t.editor.state.doc.descendants((n) => {
      if (n.isText && n.text?.includes('dog')) marks.push(...n.marks.map((m) => m.type.name));
    });
    expect(marks.sort()).toEqual(['bold', 'italic']);
  });

  it('replaces with nothing', () => {
    t = makeEditor(docOf(p('a cat b')));
    openFind(t.editor, { replace: true });
    setFind(t.editor, { query: ' cat', replace: '' });
    replaceAll(t.editor);
    expect(text(t)).toBe('a b');
  });

  it('is a search only for a reader: nothing is replaced', () => {
    t = makeEditor(docOf(p('cat')));
    openFind(t.editor, { replace: true });
    setFind(t.editor, { query: 'cat', replace: 'dog' });
    t.editor.setEditable(false);
    expect(replaceAll(t.editor)).toBe(0);
    expect(replaceCurrent(t.editor)).toBe(false);
    expect(text(t)).toBe('cat');
  });

  it('is fast enough to run on every keystroke while the bar is open: a 50-page document', () => {
    const para = (i: number) => p(`Paragraph ${i} lorem ipsum dolor sit amet consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. `.repeat(6));
    t = makeEditor(docOf(...Array.from({ length: 400 }, (_, i) => para(i))));
    const start = performance.now();
    const m = findMatches(t.editor.state.doc, { query: 'dolor', matchCase: false, wholeWord: true });
    const ms = performance.now() - start;
    expect(m.length).toBeGreaterThan(1000);
    // A budget with a wide margin for a loaded CI machine: the real figure is a few ms.
    expect(ms).toBeLessThan(150);
  });
});
