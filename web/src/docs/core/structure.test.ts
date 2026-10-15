// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { listFormatAt, setListFormat } from './lists';
import { insertTable, inTable, setShading, shadingAt } from './tables';
import { applyLink, isSafeHref, linkAt, removeLink } from './links';
import { docOf, makeEditor, p, select, type TestEditor, jsonOf } from './testing';

let t: TestEditor;
afterEach(() => t?.destroy());

const json = (t: TestEditor) => jsonOf(t.editor);
const item = (text: string) => ({ type: 'listItem', content: [p(text)] });

describe('checklists', () => {
  it('makes a checklist, nests it, and keeps the ticks', () => {
    t = makeEditor(docOf(p('Buy milk')));
    select(t.editor, 'Buy');
    t.editor.commands.toggleTaskList();
    expect(json(t).content![0]!.type).toBe('taskList');
    expect(json(t).content![0]!.content![0]).toMatchObject({ type: 'taskItem', attrs: { checked: false } });

    t.editor.commands.updateAttributes('taskItem', { checked: true });
    expect(json(t).content![0]!.content![0]!.attrs).toMatchObject({ checked: true });
    expect(t.editor.getHTML()).toContain('data-checked="true"');

    // Toggling again takes the list off, leaving the text.
    t.editor.commands.toggleTaskList();
    expect(json(t).content![0]!.type).toBe('paragraph');
  });

  it('nests an item under the one before it', () => {
    t = makeEditor(docOf({ type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: false }, content: [p('one')] }, { type: 'taskItem', attrs: { checked: false }, content: [p('two')] }] }));
    select(t.editor, 'two');
    t.editor.commands.sinkListItem('taskItem');
    expect(json(t).content![0]!.content![0]!.content!.map((n) => n.type)).toEqual(['paragraph', 'taskList']);
  });
});

describe('multilevel numbering', () => {
  const nested = () =>
    docOf({
      type: 'orderedList',
      attrs: { start: 1 },
      content: [{ type: 'listItem', content: [p('one'), { type: 'orderedList', attrs: { start: 1 }, content: [item('one a')] }] }, item('two')]
    });

  it('has the format on the outermost list, read from anywhere inside it', () => {
    t = makeEditor(nested());
    select(t.editor, 'one a');
    expect(listFormatAt(t.editor)).toBe('mixed');
    setListFormat(t.editor, 'legal');
    expect(listFormatAt(t.editor)).toBe('legal');
    const outer = json(t).content![0]!;
    expect(outer.attrs).toMatchObject({ format: 'legal' });
    // The nested list is not given one: the style reads it from the outer list.
    expect(outer.content![0]!.content![1]!.attrs!.format ?? null).toBeNull();
    expect(t.editor.getHTML().match(/data-format="legal"/g)).toHaveLength(1);
  });

  it('keeps the format when Tab makes another nested list', () => {
    t = makeEditor(nested());
    select(t.editor, 'two');
    setListFormat(t.editor, 'legal');
    t.editor.commands.sinkListItem('listItem');
    expect(listFormatAt(t.editor)).toBe('legal');
    setListFormat(t.editor, 'mixed');
    expect(listFormatAt(t.editor)).toBe('mixed');
    expect(t.editor.getHTML()).not.toContain('data-format');
  });

  it('numbers a bulleted list first when asked for a format', () => {
    t = makeEditor(docOf({ type: 'bulletList', content: [item('a'), item('b')] }));
    select(t.editor, 'a');
    setListFormat(t.editor, 'legal');
    expect(json(t).content![0]!.type).toBe('orderedList');
    expect(listFormatAt(t.editor)).toBe('legal');
  });

  it('survives Yjs', () => {
    t = makeEditor(nested());
    select(t.editor, 'two');
    setListFormat(t.editor, 'legal');
    const other = makeEditor();
    Y.applyUpdate(other.doc, Y.encodeStateAsUpdate(t.doc));
    expect(jsonOf(other.editor).content![0]!.attrs).toMatchObject({ format: 'legal' });
    other.destroy();
  });
});

describe('tables', () => {
  const cell = (text: string) => ({ type: 'tableCell', content: [p(text)] });
  const rows = (t: TestEditor) => json(t).content![0]!.content!.length;
  const cols = (t: TestEditor) => json(t).content![0]!.content![0]!.content!.length;

  it('inserts a plain grid of the size asked for, with a paragraph after it to type in', () => {
    t = makeEditor(docOf(p('before')));
    t.editor.commands.focus('end');
    insertTable(t.editor, 3, 4);
    const table = json(t).content!.find((n) => n.type === 'table')!;
    expect(table.content).toHaveLength(3);
    expect(table.content![0]!.content).toHaveLength(4);
    expect(table.content![0]!.content![0]!.type).toBe('tableCell');
    expect(json(t).content!.at(-1)!.type).toBe('paragraph');
    expect(inTable(t.editor)).toBe(true);
  });

  it('adds and deletes rows and columns', () => {
    t = makeEditor();
    insertTable(t.editor, 2, 2);
    expect([rows(t), cols(t)]).toEqual([2, 2]);
    t.editor.commands.addRowAfter();
    t.editor.commands.addRowBefore();
    expect(rows(t)).toBe(4);
    t.editor.commands.deleteRow();
    expect(rows(t)).toBe(3);
    t.editor.commands.addColumnAfter();
    t.editor.commands.addColumnBefore();
    expect(cols(t)).toBe(4);
    t.editor.commands.deleteColumn();
    expect(cols(t)).toBe(3);
    t.editor.commands.deleteTable();
    expect(json(t).content!.some((n) => n.type === 'table')).toBe(false);
  });

  it('merges and splits cells', () => {
    t = makeEditor(docOf({ type: 'table', content: [{ type: 'tableRow', content: [cell('a'), cell('b')] }, { type: 'tableRow', content: [cell('c'), cell('d')] }] }));
    // A cell selection over the top row.
    t.editor.commands.setCellSelection({ anchorCell: 2, headCell: 7 });
    expect(t.editor.can().mergeCells()).toBe(true);
    t.editor.commands.mergeCells();
    const merged = json(t).content![0]!.content![0]!.content![0]!;
    expect(merged.attrs).toMatchObject({ colspan: 2 });
    t.editor.commands.splitCell();
    expect(json(t).content![0]!.content![0]!.content).toHaveLength(2);
  });

  it('makes the first row a header row, and back', () => {
    t = makeEditor();
    insertTable(t.editor, 2, 2);
    t.editor.commands.toggleHeaderRow();
    expect(json(t).content![0]!.content![0]!.content![0]!.type).toBe('tableHeader');
    t.editor.commands.toggleHeaderRow();
    expect(json(t).content![0]!.content![0]!.content![0]!.type).toBe('tableCell');
  });

  it('shades a cell, with a checked colour, and clears it', () => {
    t = makeEditor();
    insertTable(t.editor, 2, 2);
    setShading(t.editor, '#e7f5ee');
    expect(shadingAt(t.editor)).toBe('#e7f5ee');
    expect(t.editor.getHTML()).toContain('background-color: #e7f5ee');
    setShading(t.editor, 'red; position:fixed');
    expect(shadingAt(t.editor)).toBe('#e7f5ee');
    setShading(t.editor, null);
    expect(shadingAt(t.editor)).toBeNull();
    expect(t.editor.getHTML()).not.toContain('background-color');
  });

  it('refuses a poisoned fill that arrives in the document', () => {
    t = makeEditor(
      docOf({ type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', attrs: { backgroundColor: 'url(//evil/x); position: fixed' }, content: [p('x')] }] }] })
    );
    expect(t.editor.getHTML()).not.toContain('evil');
    expect(t.editor.getHTML()).not.toContain('position');
  });

  it('survives Yjs, merged cells and shading included', () => {
    t = makeEditor();
    insertTable(t.editor, 2, 2);
    setShading(t.editor, '#fdefe7');
    const other = makeEditor();
    Y.applyUpdate(other.doc, Y.encodeStateAsUpdate(t.doc));
    expect(JSON.stringify(jsonOf(other.editor))).toContain('#fdefe7');
    other.destroy();
  });
});

describe('what a link may point at', () => {
  it('accepts http, https and mailto, and nothing else', () => {
    for (const ok of ['https://example.com', 'http://example.com/a?b=1#c', 'mailto:ada@example.com']) expect(isSafeHref(ok), ok).toBe(true);
    for (const no of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', ' javascript:alert(1)', 'java\tscript:alert(1)', 'data:text/html,<b>', 'ftp://example.com', 'tel:+441234', 'sms:1', 'file:///etc/passwd', '/relative', '#anchor', 'example.com', '', null, undefined]) {
      expect(isSafeHref(no as string), String(no)).toBe(false);
    }
  });
});

describe('links in the page', () => {
  it('links the selected text, normalising what was typed', () => {
    t = makeEditor(docOf(p('See our site today')));
    select(t.editor, 'our site');
    expect(applyLink(t.editor, 'example.com/plan')).toBe(true);
    expect(t.editor.getHTML()).toContain('href="https://example.com/plan"');
    expect(linkAt(t.editor)?.text).toBe('our site');
  });

  it('inserts the address as the text when nothing is selected, or the text given', () => {
    t = makeEditor(docOf(p('Go: ')));
    t.editor.commands.focus('end');
    applyLink(t.editor, 'https://example.com');
    expect(t.editor.getText()).toContain('https://example.com');
    t.editor.commands.insertContent(' and ');
    applyLink(t.editor, 'ada@example.com', 'email Ada');
    expect(t.editor.getHTML()).toContain('href="mailto:ada@example.com"');
    expect(t.editor.getText()).toContain('email Ada');
  });

  it('edits the link the caret is in: the address and the text', () => {
    t = makeEditor(docOf({ type: 'paragraph', content: [{ type: 'text', text: 'old text', marks: [{ type: 'link', attrs: { href: 'https://old.example' } }] }] }));
    t.editor.commands.setTextSelection(3);
    expect(linkAt(t.editor)).toMatchObject({ href: 'https://old.example', text: 'old text' });
    applyLink(t.editor, 'https://new.example', 'new text');
    expect(t.editor.getHTML()).toContain('href="https://new.example"');
    expect(t.editor.getText()).toBe('new text');
    expect(t.editor.getHTML()).not.toContain('old.example');
  });

  it('removes a link and keeps its text', () => {
    t = makeEditor(docOf({ type: 'paragraph', content: [{ type: 'text', text: 'kept', marks: [{ type: 'link', attrs: { href: 'https://x.example' } }] }] }));
    t.editor.commands.setTextSelection(2);
    removeLink(t.editor);
    expect(t.editor.getHTML()).not.toContain('<a');
    expect(t.editor.getText()).toBe('kept');
  });

  it('refuses an address that is not a web or mail address and changes nothing', () => {
    t = makeEditor(docOf(p('Click here')));
    select(t.editor, 'here');
    for (const bad of ['javascript:alert(1)', 'ftp://x.example', 'tel:123', 'has spaces', '', 'localhost-without-dot']) {
      expect(applyLink(t.editor, bad), bad).toBe(false);
    }
    expect(t.editor.getHTML()).not.toContain('<a');
  });

  it('drops a pasted link to anything but http, https and mailto, and keeps its text', () => {
    t = makeEditor(docOf(p('')));
    t.editor.commands.insertContent('<p><a href="tel:+441234">call</a> <a href="javascript:alert(1)">bad</a> <a href="ftp://x.example/f">file</a> <a href="https://ok.example">fine</a></p>');
    const html = t.editor.getHTML();
    expect(html).toContain('href="https://ok.example"');
    for (const poison of ['tel:', 'javascript', 'ftp:']) expect(html).not.toContain(poison);
    expect(t.editor.getText()).toContain('call');
    expect(t.editor.getText()).toContain('bad');
  });

  it('does not render a link another person’s edit smuggled into the document', () => {
    t = makeEditor(docOf({ type: 'paragraph', content: [{ type: 'text', text: 'x', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] }] }));
    expect(t.editor.getHTML()).not.toContain('javascript');
  });
});
