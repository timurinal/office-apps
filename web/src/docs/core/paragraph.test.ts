// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { applyStyle, indent, indentAt, lineHeightAt, setLineHeight, setSpace, styleAt } from './paragraph';
import { docOf, h, makeEditor, p, select, type TestEditor, jsonOf } from './testing';

let t: TestEditor;
afterEach(() => t?.destroy());

const first = (t: TestEditor) => jsonOf(t.editor).content![0]!;

describe('paragraph styles', () => {
  it('has Word’s names, applied as a heading, a paragraph style, or a wrapper', () => {
    t = makeEditor(docOf(p('Hello there')));
    select(t.editor, 'Hello');

    applyStyle(t.editor, 'h2');
    expect(first(t)).toMatchObject({ type: 'heading', attrs: { level: 2 } });
    expect(styleAt(t.editor.state)).toBe('h2');

    applyStyle(t.editor, 'h6');
    expect(styleAt(t.editor.state)).toBe('h6');

    applyStyle(t.editor, 'title');
    expect(first(t)).toMatchObject({ type: 'paragraph', attrs: { paraStyle: 'title' } });
    expect(styleAt(t.editor.state)).toBe('title');

    applyStyle(t.editor, 'subtitle');
    expect(styleAt(t.editor.state)).toBe('subtitle');

    applyStyle(t.editor, 'nospacing');
    expect(styleAt(t.editor.state)).toBe('nospacing');

    applyStyle(t.editor, 'normal');
    expect(first(t)).toMatchObject({ type: 'paragraph' });
    expect(first(t).attrs?.paraStyle ?? null).toBeNull();
    expect(styleAt(t.editor.state)).toBe('normal');
  });

  it('makes a quote by wrapping, and a code block as one, and leaves either for any other style', () => {
    t = makeEditor(docOf(p('Words')));
    select(t.editor, 'Words');

    applyStyle(t.editor, 'quote');
    expect(first(t).type).toBe('blockquote');
    expect(styleAt(t.editor.state)).toBe('quote');

    // Another style takes it out of the quote first.
    applyStyle(t.editor, 'h1');
    expect(first(t)).toMatchObject({ type: 'heading', attrs: { level: 1 } });

    applyStyle(t.editor, 'code');
    expect(first(t).type).toBe('codeBlock');
    expect(styleAt(t.editor.state)).toBe('code');

    applyStyle(t.editor, 'normal');
    expect(first(t).type).toBe('paragraph');
  });

  it('applies to every block the selection touches and to no other', () => {
    t = makeEditor(docOf(p('one'), p('two'), p('three')));
    t.editor.commands.setTextSelection({ from: 2, to: 8 });
    applyStyle(t.editor, 'h3');
    expect(jsonOf(t.editor).content!.map((n) => n.type)).toEqual(['heading', 'heading', 'paragraph']);
  });

  it('keeps alignment and indent through a style change and drops spacing, which is the style’s', () => {
    t = makeEditor(docOf(p('Aligned', { textAlign: 'center', indent: 2, lineHeight: 2, spaceBefore: 12, spaceAfter: 6 })));
    select(t.editor, 'Aligned');
    applyStyle(t.editor, 'h2');
    expect(first(t).attrs).toMatchObject({ level: 2, textAlign: 'center', indent: 2, lineHeight: null, spaceBefore: null, spaceAfter: null });
  });

  it('reads a heading, a styled paragraph and a quote back as the same style', () => {
    t = makeEditor(docOf(h(4, 'Four'), p('Sub', { paraStyle: 'subtitle' }), { type: 'blockquote', content: [p('Quoted')] }));
    select(t.editor, 'Four');
    expect(styleAt(t.editor.state)).toBe('h4');
    select(t.editor, 'Sub');
    expect(styleAt(t.editor.state)).toBe('subtitle');
    select(t.editor, 'Quoted');
    expect(styleAt(t.editor.state)).toBe('quote');
  });
});

describe('spacing and indent', () => {
  it('sets line height, space before and after, and reads them back', () => {
    t = makeEditor(docOf(p('Spaced')));
    select(t.editor, 'Spaced');
    setLineHeight(t.editor, 1.5);
    setSpace(t.editor, 'spaceBefore', 12);
    setSpace(t.editor, 'spaceAfter', 6);
    expect(first(t).attrs).toMatchObject({ lineHeight: 1.5, spaceBefore: 12, spaceAfter: 6 });
    expect(lineHeightAt(t.editor.state)).toBe(1.5);
    expect(t.editor.getHTML()).toContain('line-height: 1.5');
    expect(t.editor.getHTML()).toContain('margin-top: 12pt');
    expect(t.editor.getHTML()).toContain('margin-bottom: 6pt');

    setLineHeight(t.editor, null);
    setSpace(t.editor, 'spaceBefore', null);
    expect(first(t).attrs).toMatchObject({ lineHeight: null, spaceBefore: null });
    expect(t.editor.getHTML()).not.toContain('line-height');
  });

  it('refuses a line height and a space that are not numbers in range', () => {
    t = makeEditor(docOf(p('Spaced')));
    select(t.editor, 'Spaced');
    setLineHeight(t.editor, 99);
    setSpace(t.editor, 'spaceAfter', -4);
    expect(first(t).attrs).toMatchObject({ lineHeight: null, spaceAfter: null });
  });

  it('indents a paragraph a level at a time, to a ceiling and a floor', () => {
    t = makeEditor(docOf(p('Indented')));
    select(t.editor, 'Indented');
    for (let i = 0; i < 12; i++) indent(t.editor, 1);
    expect(indentAt(t.editor.state)).toBe(8);
    expect(t.editor.getHTML()).toContain('margin-left: 288pt');
    for (let i = 0; i < 12; i++) indent(t.editor, -1);
    expect(indentAt(t.editor.state)).toBe(0);
    expect(t.editor.getHTML()).not.toContain('margin-left');
  });

  it('indents a list item into a nested list instead of setting a margin', () => {
    t = makeEditor(
      docOf({
        type: 'bulletList',
        content: [
          { type: 'listItem', content: [p('one')] },
          { type: 'listItem', content: [p('two')] }
        ]
      })
    );
    select(t.editor, 'two');
    indent(t.editor, 1);
    const list = first(t);
    expect(list.content![0]!.content!.map((n) => n.type)).toEqual(['paragraph', 'bulletList']);
    indent(t.editor, -1);
    expect(first(t).content!.map((n) => n.type)).toEqual(['listItem', 'listItem']);
  });

  it('keeps all of it through Yjs: a second editor on the same document sees it', () => {
    t = makeEditor(docOf(p('Shared')));
    select(t.editor, 'Shared');
    applyStyle(t.editor, 'title');
    setLineHeight(t.editor, 2);
    setSpace(t.editor, 'spaceAfter', 12);
    indent(t.editor, 1);

    const other = makeEditor();
    Y.applyUpdate(other.doc, Y.encodeStateAsUpdate(t.doc));
    expect(jsonOf(other.editor).content![0]!.attrs).toMatchObject({ paraStyle: 'title', lineHeight: 2, spaceAfter: 12, indent: 1 });
    other.destroy();
  });
});
