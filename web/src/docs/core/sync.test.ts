// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { applyStyle, indent, setLineHeight } from './paragraph';
import { setListFormat } from './lists';
import { insertTable, setShading } from './tables';
import { setAlign, setHighlight, setSize, setTextColor, setFont } from './text';
import { docOf, jsonOf, makeEditor, p, select, type TestEditor } from './testing';

const open: TestEditor[] = [];
afterEach(() => {
  while (open.length) open.pop()!.destroy();
});

/** Two people on one document, each with their own `Y.Doc`, joined by their updates. */
function pair() {
  const a = makeEditor(docOf(p('Plan the quarter'), p('Owners meet on Monday'), { type: 'orderedList', content: [{ type: 'listItem', content: [p('first')] }, { type: 'listItem', content: [p('second')] }] }, p('Closing line')));
  const b = makeEditor();
  open.push(a, b);
  const link = (from: TestEditor, to: TestEditor) => from.doc.on('update', (u: Uint8Array, origin: unknown) => origin !== 'remote' && Y.applyUpdate(to.doc, u, 'remote'));
  Y.applyUpdate(b.doc, Y.encodeStateAsUpdate(a.doc), 'remote');
  return {
    a,
    b,
    /** Edits made while apart reach the other side when `join` is called. */
    join() {
      Y.applyUpdate(b.doc, Y.encodeStateAsUpdate(a.doc, Y.encodeStateVector(b.doc)), 'remote');
      Y.applyUpdate(a.doc, Y.encodeStateAsUpdate(b.doc, Y.encodeStateVector(a.doc)), 'remote');
      link(a, b);
      link(b, a);
    }
  };
}

describe('two people editing at once, with everything the core module can write', () => {
  it('converge, and keep what each of them did', () => {
    const { a, b, join } = pair();

    // Ada, apart from Ben: a heading, a colour and a font, a table, indent.
    select(a.editor, 'Plan the quarter');
    applyStyle(a.editor, 'h2');
    select(a.editor, 'quarter');
    setTextColor(a.editor, '#c0392b');
    setFont(a.editor, 'Georgia');
    select(a.editor, 'Closing line');
    indent(a.editor, 1);
    a.editor.commands.focus('end');
    insertTable(a.editor, 2, 3);
    setShading(a.editor, '#e7f5ee');

    // Ben, apart from Ada: an alignment and spacing, a numbering format, a size and a highlight, a chip.
    select(b.editor, 'Owners meet');
    setAlign(b.editor, 'center');
    setLineHeight(b.editor, 1.5);
    select(b.editor, 'Monday');
    setSize(b.editor, 18);
    setHighlight(b.editor, '#fff2a8');
    select(b.editor, 'second');
    setListFormat(b.editor, 'legal');
    b.editor.chain().focus().insertContentAt(b.editor.state.doc.content.size - 2, { type: 'mention', attrs: { id: 'u_ben', label: 'Ben Okoro' } }).run();

    join();

    expect(jsonOf(a.editor)).toEqual(jsonOf(b.editor));
    const j = JSON.stringify(jsonOf(a.editor));
    for (const want of ['"level":2', '#c0392b', 'Georgia', '"indent":1', '"type":"table"', '#e7f5ee', '"textAlign":"center"', '"lineHeight":1.5', '18pt', '#fff2a8', '"format":"legal"', '"label":"Ben Okoro"']) {
      expect(j, want).toContain(want);
    }
  });

  it('merge two people typing in the same paragraph, and a row added while a cell is typed in', () => {
    const { a, b, join } = pair();
    a.editor.commands.focus('end');
    insertTable(a.editor, 2, 2);
    join();

    // Both are in the table now. Ada types in the first cell; Ben adds a row and a column.
    a.editor.commands.setTextSelection(a.editor.state.doc.content.size - 20);
    const cellAt = (e: TestEditor) => {
      let at = -1;
      e.editor.state.doc.descendants((n, pos) => {
        if (at < 0 && n.type.name === 'tableCell') at = pos + 2;
      });
      return at;
    };
    a.editor.commands.setTextSelection(cellAt(a));
    a.editor.commands.insertContent('typed by Ada');
    b.editor.commands.setTextSelection(cellAt(b));
    b.editor.commands.addRowAfter();
    b.editor.commands.addColumnAfter();

    join();
    expect(jsonOf(a.editor)).toEqual(jsonOf(b.editor));
    const table = jsonOf(a.editor).content!.find((n) => n.type === 'table')!;
    expect(table.content).toHaveLength(3);
    expect(table.content![0]!.content).toHaveLength(3);
    expect(JSON.stringify(table)).toContain('typed by Ada');
  });

  it('keep one find bar per person: a search is not a change and is not sent', async () => {
    const { a, b, join } = pair();
    join();
    const { openFind, setFind } = await import('./find');
    let sent = 0;
    a.doc.on('update', () => sent++);
    openFind(a.editor);
    setFind(a.editor, { query: 'quarter' });
    expect(sent).toBe(0);
    expect(b.editor.view.dom.querySelectorAll('.oa-find')).toHaveLength(0);
  });
});
