// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { docOf, h, jsonOf, makeEditor, p, type TestEditor } from '../core/testing';

/**
 * A command that inserts a block must use the transaction it was handed. Starting a chain of its
 * own dispatches first, and the caller then dispatches a stale one: "Applying a mismatched
 * transaction", thrown out of the key handler after the page break was already in.
 */
let t: TestEditor | null = null;
afterEach(() => {
  t?.destroy();
  t = null;
});

const kinds = (e: TestEditor) => (jsonOf(e.editor).content ?? []).map((n) => n.type);

describe('inserting a block', () => {
  it('a page break from a command, from a chain, and from the key, each once and without throwing', () => {
    t = makeEditor(docOf(p('First'), p('Second')));
    t.editor.commands.focus('end');

    expect(() => t!.editor.commands.setPageBreak()).not.toThrow();
    expect(kinds(t).filter((k) => k === 'pageBreak')).toHaveLength(1);

    expect(() => t!.editor.chain().focus().setPageBreak().run()).not.toThrow();
    expect(kinds(t).filter((k) => k === 'pageBreak')).toHaveLength(2);

    // The caret is after the last break, in a paragraph to type in.
    expect(kinds(t).at(-1)).toBe('paragraph');
    const { $from } = t.editor.state.selection;
    expect($from.parent.type.name).toBe('paragraph');
  });

  it('Ctrl+Enter runs the same command', () => {
    t = makeEditor(docOf(p('First')));
    t.editor.commands.focus('end');
    const handled = t.editor.view.someProp('handleKeyDown', (f) => f(t!.editor.view, new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true })));
    expect(handled).toBe(true);
    expect(kinds(t)).toContain('pageBreak');
  });

  it('a table of contents is made from the headings, from a chain, without throwing', () => {
    t = makeEditor(docOf(h(1, 'Intro'), p('Text'), h(2, 'Detail')));
    t.editor.commands.focus('end');
    expect(() => t!.editor.chain().focus().insertTableOfContents().run()).not.toThrow();
    const toc = (jsonOf(t.editor).content ?? []).find((n) => n.type === 'tableOfContents');
    expect(toc).toBeTruthy();
    expect(JSON.parse(toc!.attrs!.entries as string)).toEqual([
      { level: 1, text: 'Intro' },
      { level: 2, text: 'Detail' }
    ]);
  });
});
