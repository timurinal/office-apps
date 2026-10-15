// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { applyStyle } from './paragraph';
import { armFormatPainter, alignAt, clearFormatting, colorAt, disarm, fontAt, highlightAt, isPainting, setAlign, setFont, setHighlight, setSize, setTextColor, sizeAt } from './text';
import { docOf, h, makeEditor, p, select, type TestEditor, jsonOf } from './testing';

let t: TestEditor;
afterEach(() => t?.destroy());

const marksOf = (t: TestEditor, text: string): string[] => {
  const out: string[] = [];
  t.editor.state.doc.descendants((n) => {
    if (n.isText && n.text?.includes(text)) out.push(...n.marks.map((m) => m.type.name));
  });
  return out;
};

describe('font, size and colour', () => {
  it('stores a font by name and draws it with a stack that has fallbacks', () => {
    t = makeEditor(docOf(p('Hello world')));
    select(t.editor, 'world');
    setFont(t.editor, 'Georgia');
    expect(fontAt(t.editor)).toBe('Georgia');
    const html = t.editor.getHTML();
    expect(html).toMatch(/font-family: Georgia, &quot;DejaVu Serif&quot;|font-family: Georgia, "DejaVu Serif"/);
    expect(JSON.stringify(jsonOf(t.editor))).toContain('"fontFamily":"Georgia"');
    expect(JSON.stringify(jsonOf(t.editor))).not.toContain('DejaVu');
  });

  it('sets a size in points, and shows 11 for text with none', () => {
    t = makeEditor(docOf(p('Hello world')));
    select(t.editor, 'world');
    setSize(t.editor, 14);
    expect(sizeAt(t.editor)).toBe('14pt');
    expect(t.editor.getHTML()).toContain('font-size: 14pt');
    setSize(t.editor, null);
    expect(sizeAt(t.editor)).toBeNull();
    expect(marksOf(t, 'world')).toEqual([]);
  });

  it('sets and clears a text colour and a highlight', () => {
    t = makeEditor(docOf(p('Hello world')));
    select(t.editor, 'world');
    setTextColor(t.editor, '#c0392b');
    setHighlight(t.editor, '#fff2a8');
    expect(colorAt(t.editor)).toBe('#c0392b');
    expect(highlightAt(t.editor)).toBe('#fff2a8');
    expect(t.editor.getHTML()).toContain('color: #c0392b');
    expect(t.editor.getHTML()).toContain('background-color: #fff2a8');

    setTextColor(t.editor, null);
    setHighlight(t.editor, null);
    expect(colorAt(t.editor)).toBeNull();
    expect(highlightAt(t.editor)).toBeNull();
    expect(marksOf(t, 'world')).toEqual([]);
  });

  it('refuses a colour or a size that is not one, and never clears for it', () => {
    t = makeEditor(docOf(p('Hello world')));
    select(t.editor, 'world');
    setTextColor(t.editor, '#c0392b');
    setSize(t.editor, 14);
    expect(setTextColor(t.editor, 'red')).toBe(false);
    expect(setTextColor(t.editor, 'url(//evil)')).toBe(false);
    expect(setSize(t.editor, 9999)).toBe(false);
    expect(setSize(t.editor, Number.NaN)).toBe(false);
    expect(setHighlight(t.editor, 'blue')).toBe(false);
    expect(colorAt(t.editor)).toBe('#c0392b');
    expect(sizeAt(t.editor)).toBe('14pt');
  });

  it('puts font, size and colour on one mark, so they merge and unset one at a time', () => {
    t = makeEditor(docOf(p('Hello world')));
    select(t.editor, 'world');
    setFont(t.editor, 'Arial');
    setSize(t.editor, 18);
    setTextColor(t.editor, '#3d6cd0');
    expect(marksOf(t, 'world')).toEqual(['textStyle']);
    setSize(t.editor, null);
    expect(fontAt(t.editor)).toBe('Arial');
    expect(colorAt(t.editor)).toBe('#3d6cd0');
    expect(sizeAt(t.editor)).toBeNull();
  });

  it('toggles subscript and superscript, and one replaces the other', () => {
    t = makeEditor(docOf(p('H2O and x2')));
    select(t.editor, '2O');
    t.editor.commands.toggleSubscript();
    expect(marksOf(t, '2O')).toContain('subscript');
    select(t.editor, 'x2');
    t.editor.commands.toggleSuperscript();
    expect(marksOf(t, 'x2')).toContain('superscript');
  });
});

describe('what a document may not carry into a style', () => {
  it('drops a colour, a size, a font and a highlight that are not exactly what the ribbon writes', () => {
    const bad = (type: string, attrs: Record<string, unknown>) => ({
      type: 'paragraph',
      content: [{ type: 'text', text: 'x', marks: [{ type, attrs }] }]
    });
    t = makeEditor(
      docOf(
        bad('textStyle', { color: 'red; position: fixed; inset: 0', fontSize: '10pt; background: url(//evil/x)', fontFamily: 'a"; } body { display:none' }),
        bad('textStyle', { color: 'url(https://evil/x)', fontSize: '9999pt' }),
        bad('highlight', { color: 'expression(alert(1))' })
      )
    );
    const html = t.editor.getHTML();
    for (const poison of ['position', 'evil', 'url(', 'expression', 'display:none', 'inset']) expect(html, poison).not.toContain(poison);
  });

  it('reads a pasted span into the same attributes: px to pt, the first family, hex or rgb', () => {
    t = makeEditor(docOf(p('')));
    t.editor.commands.insertContent('<p><span style="font-size: 16px; font-family: \'Times New Roman\', serif; color: rgb(192, 57, 43)">pasted</span></p>');
    const json = JSON.stringify(jsonOf(t.editor));
    expect(json).toContain('"fontSize":"12pt"');
    expect(json).toContain('"fontFamily":"Times New Roman"');
    expect(json).toContain('rgb(192, 57, 43)');
  });

  it('refuses a named colour and a size in em on paste rather than guessing', () => {
    t = makeEditor(docOf(p('')));
    t.editor.commands.insertContent('<p><span style="color: red; font-size: 2em">pasted</span></p>');
    // The span is still a text style, with nothing in it.
    expect(JSON.stringify(jsonOf(t.editor))).toContain('"attrs":{"fontFamily":null,"fontSize":null,"color":null}');
  });
});

describe('alignment', () => {
  it('aligns a paragraph, and left is the absence of an attribute', () => {
    t = makeEditor(docOf(p('Centre me')));
    select(t.editor, 'Centre');
    setAlign(t.editor, 'center');
    expect(alignAt(t.editor)).toBe('center');
    expect(t.editor.getHTML()).toContain('text-align: center');
    setAlign(t.editor, 'justify');
    expect(alignAt(t.editor)).toBe('justify');
    setAlign(t.editor, 'left');
    expect(alignAt(t.editor)).toBe('left');
    expect(t.editor.getHTML()).not.toContain('text-align');
  });

  it('aligns a selected picture instead of the text', () => {
    t = makeEditor(docOf({ type: 'image', attrs: { src: 'data:image/png;base64,iVBORw0KGgo=' } }, p('after')));
    t.editor.commands.setNodeSelection(0);
    setAlign(t.editor, 'right');
    expect(jsonOf(t.editor).content![0]!.attrs).toMatchObject({ align: 'right' });
    expect(alignAt(t.editor)).toBe('right');
    setAlign(t.editor, 'left');
    expect(jsonOf(t.editor).content![0]!.attrs!.align).toBeNull();
  });
});

describe('clear formatting', () => {
  it('takes off every character format and the paragraph’s style, and keeps a link', () => {
    t = makeEditor(
      docOf(
        h(2, 'Styled heading'),
        {
          type: 'paragraph',
          attrs: { textAlign: 'center', lineHeight: 2, indent: 2 },
          content: [
            {
              type: 'text',
              text: 'rich',
              marks: [{ type: 'bold' }, { type: 'italic' }, { type: 'underline' }, { type: 'highlight', attrs: { color: '#fff2a8' } }, { type: 'textStyle', attrs: { fontSize: '20pt' } }, { type: 'link', attrs: { href: 'https://example.com' } }]
            }
          ]
        }
      )
    );
    t.editor.commands.selectAll();
    clearFormatting(t.editor);
    const json = jsonOf(t.editor);
    expect(json.content!.map((n) => n.type)).toEqual(['paragraph', 'paragraph']);
    expect(json.content![1]!.attrs).toMatchObject({ textAlign: null, lineHeight: null, indent: 0 });
    expect(marksOf(t, 'rich')).toEqual(['link']);
  });

  it('leaves a code block a code block', () => {
    t = makeEditor(docOf({ type: 'codeBlock', content: [{ type: 'text', text: 'let x = 1' }] }));
    t.editor.commands.selectAll();
    clearFormatting(t.editor);
    expect(jsonOf(t.editor).content![0]!.type).toBe('codeBlock');
  });
});

describe('the format painter', () => {
  const doc = () => docOf(p('plain'), { type: 'paragraph', attrs: { textAlign: 'right' }, content: [{ type: 'text', text: 'fancy', marks: [{ type: 'bold' }, { type: 'textStyle', attrs: { color: '#c0392b', fontSize: '18pt' } }] }] }, p('target one'), p('target two'));

  it('is armed from the selection and is not armed twice', () => {
    t = makeEditor(doc());
    select(t.editor, 'fancy');
    expect(isPainting(t.editor)).toBe(false);
    armFormatPainter(t.editor);
    expect(isPainting(t.editor)).toBe(true);
    expect(t.editor.view.dom.classList.contains('oa-painting')).toBe(true);
    disarm(t.editor);
    expect(isPainting(t.editor)).toBe(false);
    expect(t.editor.view.dom.classList.contains('oa-painting')).toBe(false);
  });

  it('applies what it picked up to the next selection, once, and puts itself away', async () => {
    t = makeEditor(doc());
    select(t.editor, 'fancy');
    armFormatPainter(t.editor);

    select(t.editor, 'one');
    t.editor.view.dom.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 5));

    expect(marksOf(t, 'one').sort()).toEqual(['bold', 'textStyle']);
    expect(jsonOf(t.editor).content![2]!.attrs).toMatchObject({ textAlign: 'right' });
    expect(isPainting(t.editor)).toBe(false);

    // Armed no longer: the next selection is left alone.
    select(t.editor, 'two');
    t.editor.view.dom.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 5));
    expect(marksOf(t, 'two')).toEqual([]);
  });

  it('replaces the target’s own formatting, not adds to it', async () => {
    t = makeEditor(docOf(p('plain'), { type: 'paragraph', content: [{ type: 'text', text: 'target', marks: [{ type: 'italic' }, { type: 'underline' }] }] }));
    select(t.editor, 'plain');
    armFormatPainter(t.editor);
    select(t.editor, 'target');
    t.editor.view.dom.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 5));
    expect(marksOf(t, 'target')).toEqual([]);
  });

  it('waits through a click that selects nothing', async () => {
    t = makeEditor(doc());
    select(t.editor, 'fancy');
    armFormatPainter(t.editor);
    t.editor.commands.setTextSelection(3);
    t.editor.view.dom.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 5));
    expect(isPainting(t.editor)).toBe(true);
  });

  it('is put away by Escape', () => {
    t = makeEditor(doc());
    select(t.editor, 'fancy');
    armFormatPainter(t.editor);
    t.editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(isPainting(t.editor)).toBe(false);
  });

  it('copies a heading’s level with its look', async () => {
    t = makeEditor(docOf(h(3, 'Heading here'), p('plain target')));
    select(t.editor, 'Heading');
    armFormatPainter(t.editor);
    select(t.editor, 'plain');
    t.editor.view.dom.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 5));
    expect(jsonOf(t.editor).content![1]).toMatchObject({ type: 'heading', attrs: { level: 3 } });
    applyStyle(t.editor, 'normal');
  });
});
