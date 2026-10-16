// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { darkFill, darkInk } from '../../core/darkColors';
import { contrast } from '../../core/color';
import { DARK_GROUND } from '../../core/darkColors';
import { writeHtml } from '../../formats/html/write';
import { writeMarkdown } from '../../formats/markdown/write';
import { pageColourPref } from '../pageColour';
import { insertTable, setShading } from './tables';
import { setHighlight, setTextColor } from './text';
import { docOf, jsonOf, makeEditor, p, select, type TestEditor } from './testing';

let t: TestEditor;
afterEach(() => {
  t?.destroy();
  pageColourPref.set('auto');
});

/** The DOM the editor drew for the first thing that carries `needle`. */
const drawn = (t: TestEditor, sel: string): HTMLElement => t.editor.view.dom.querySelector<HTMLElement>(sel)!;
const custom = (el: HTMLElement, name: string): string => new RegExp(`${name}:\\s*([^;]+)`).exec(el.getAttribute('style') ?? '')?.[1]?.trim() ?? '';

describe('what a dark page needs from the page it draws', () => {
  it('draws a text colour with its dark variant beside it, and keeps the colour as set', () => {
    t = makeEditor(docOf(p('Hello world')));
    select(t.editor, 'world');
    setTextColor(t.editor, '#2f55a6');
    const span = drawn(t, '.oa-dk-i');
    expect(span.getAttribute('style')).toContain('color: #2f55a6');
    expect(custom(span, '--oa-dk-ink')).toBe(darkInk('#2f55a6'));
    // On the dark page that variant reads: this is the number the brief asks for.
    expect(contrast(custom(span, '--oa-dk-ink'), DARK_GROUND)).toBeGreaterThanOrEqual(4.5);
  });

  it('draws a highlight with a dark variant of its fill', () => {
    t = makeEditor(docOf(p('Hello world')));
    select(t.editor, 'world');
    setHighlight(t.editor, '#fff2a8');
    const mark = drawn(t, 'mark.oa-dk-f');
    expect(mark.getAttribute('data-color')).toBe('#fff2a8');
    expect(mark.getAttribute('style')).toContain('background-color: #fff2a8');
    expect(custom(mark, '--oa-dk-fill')).toBe(darkFill('#fff2a8'));
  });

  it("draws a cell's shading with a dark variant of its fill", () => {
    t = makeEditor();
    insertTable(t.editor, 2, 2);
    setShading(t.editor, '#e7f5ee');
    const cell = drawn(t, 'td.oa-dk-f');
    expect(cell.getAttribute('data-bg')).toBe('#e7f5ee');
    expect(custom(cell, '--oa-dk-fill')).toBe(darkFill('#e7f5ee'));
  });

  it('draws nothing extra for text that has no colour', () => {
    t = makeEditor(docOf(p('Hello world')));
    expect(t.editor.getHTML()).not.toContain('--oa-dk');
  });

  it('never puts a dark variant in the document: the stored colours are the ones that were set', () => {
    t = makeEditor(docOf(p('Hello world')));
    select(t.editor, 'world');
    setTextColor(t.editor, '#c0392b');
    setHighlight(t.editor, '#fff2a8');
    const json = JSON.stringify(jsonOf(t.editor));
    expect(json).toContain('#c0392b');
    expect(json).toContain('#fff2a8');
    expect(json).not.toContain('--oa-dk');
    expect(json).not.toContain(darkInk('#c0392b'));
  });

  it('reads its own output back as the colour that was set', () => {
    t = makeEditor(docOf(p('Hello world')));
    select(t.editor, 'world');
    setTextColor(t.editor, '#c0392b');
    const html = t.editor.getHTML();
    t.editor.commands.setContent('<p>x</p>');
    t.editor.commands.insertContent(html);
    expect(JSON.stringify(jsonOf(t.editor))).toContain('"color":"#c0392b"');
    expect(JSON.stringify(jsonOf(t.editor))).not.toContain('--oa-dk');
  });

  it('is cleared with the colour', () => {
    t = makeEditor(docOf(p('Hello world')));
    select(t.editor, 'world');
    setTextColor(t.editor, '#c0392b');
    setTextColor(t.editor, null);
    expect(t.editor.getHTML()).not.toContain('--oa-dk');
  });
});

describe('exports do not know what page the reader chose', () => {
  const body = docOf({
    type: 'paragraph',
    content: [
      { type: 'text', text: 'red', marks: [{ type: 'textStyle', attrs: { color: '#c0392b' } }] },
      { type: 'text', text: 'marked', marks: [{ type: 'highlight', attrs: { color: '#fff2a8' } }] }
    ]
  });
  const model = { body, page: null, header: {}, footer: {} };
  const opts = { title: 'Doc', images: new Map() } as unknown as Parameters<typeof writeHtml>[1];

  it('write the colours as set and the same document the same way on a dark page and a white one', () => {
    pageColourPref.set('white');
    const white = writeHtml(model, opts).html;
    const md = writeMarkdown(model, opts).markdown;
    pageColourPref.set('dark');
    expect(writeHtml(model, opts).html).toBe(white);
    expect(writeMarkdown(model, opts).markdown).toBe(md);
    expect(white).toContain('#c0392b');
    expect(white).not.toContain('--oa-dk');
  });
});
