import { describe, expect, it } from 'vitest';
import { allText, outline } from '../../../../tests/corpus/helpers';
import type { DocModel, JSONContent } from '../types';
import { decodeEntities, parseHtml, textOfNode } from './parse';
import { readHtml } from './read';
import { writeHtml } from './write';

const read = (src: string) => readHtml(src).model.body;
const model = (body: JSONContent): DocModel => ({ body, page: null, header: {}, footer: {} });

describe('parseHtml', () => {
  it('decodes character references, and leaves a name it does not know as it was written', () => {
    expect(decodeEntities('a &amp; b &lt;c&gt; &quot;d&quot; &#65;&#x42; &copy; &mdash; &nbsp;|&unknownthing; &amp')).toBe('a & b <c> "d" AB © —  |&unknownthing; &');
    expect(decodeEntities('&#0;&#xD800;&#x110000;')).toBe('���');
  });

  it('closes void elements, and the elements a browser closes for you', () => {
    const { root } = parseHtml('<p>one<p>two<br>three<ul><li>a<li>b</ul><table><tr><td>1<td>2<tr><td>3</table>');
    const text = (n: Parameters<typeof textOfNode>[0]) => textOfNode(n);
    expect(text(root)).toBe('onetwothreeab123');
    const ul = JSON.stringify(root);
    expect((ul.match(/"tag":"li"/g) ?? []).length).toBe(2);
    expect((ul.match(/"tag":"td"/g) ?? []).length).toBe(3);
  });

  it('skips comments and the doctype, takes CDATA as text and keeps a stray < as text', () => {
    expect(textOfNode(parseHtml('<!doctype html><!-- c --><p>a < b <![CDATA[<x>]]></p>').root)).toBe('a < b <x>');
  });

  it('reads attributes quoted either way, bare, and with entities', () => {
    const { root } = parseHtml(`<a href='x?a=1&amp;b=2' title="t" data-x=y hidden>`);
    expect(root.children[0]).toMatchObject({ tag: 'a', attrs: { href: 'x?a=1&b=2', title: 't', 'data-x': 'y', hidden: '' } });
  });

  it('takes the title, and keeps script and style out of the text', () => {
    const p = parseHtml('<title>A &amp; B</title><script>var a = "<p>";</script><style>p{}</style><p>kept</p>');
    expect(p.title).toBe('A & B');
    expect(textOfNode(p.root)).toBe('kept');
  });

  it('survives garbage', () => {
    for (const junk of ['<', '<<<>>>', '</', '</p', '<p', '<p a="unclosed', '<a b=>', '&', '<!--', '<![CDATA[', '\u0000<p>\u0000', '</p></div></table>']) {
      expect(() => parseHtml(junk), junk).not.toThrow();
    }
  });

  it('does not recurse without limit', () => {
    const { root } = parseHtml('<div>'.repeat(5000) + 'deep');
    expect(textOfNode(root)).toBe('deep');
  });
});

describe('readHtml', () => {
  it('reads blocks, collapsing whitespace as a browser does', () => {
    const b = read('<h1>  Title  </h1>\n  <p>one\n   two   <b>three</b> </p>\n<p></p>');
    expect(outline(b)).toEqual(['heading {level=1} "Title"', 'paragraph "one two " "three"[bold]']);
  });

  it('reads inline formatting and the styles of Word and Google’s HTML', () => {
    const b = read('<p><span style="font-family:Georgia,serif;font-size:14pt;color:#c0392b;font-weight:700;font-style:italic;text-decoration:underline line-through;background-color:#ffff00">x</span> <sup>2</sup> <sub>i</sub> <font face="Arial" size="5" color="red">f</font></p>');
    expect(outline(b)).toEqual([
      'paragraph "x"[bold,highlight(#ffff00),italic,strike,style(fontFamily:Georgia,fontSize:14pt,color:#c0392b),underline] " " "2"[superscript] " " "i"[subscript] " " "f"[style(fontFamily:Arial,fontSize:18pt,color:#ff0000)]'
    ]);
  });

  it('reads alignment, spacing and indent', () => {
    expect(read('<p style="text-align:center;line-height:150%;margin-top:12pt;margin-bottom:6pt;margin-left:72pt">x</p><center>y</center>').content!.map((n) => n.attrs)).toEqual([
      { textAlign: 'center', lineHeight: 1.5, spaceBefore: 12, spaceAfter: 6, indent: 2 },
      { textAlign: 'center' }
    ]);
  });

  it('reads lists, with the items that begin with a list, checklists and a start', () => {
    const b = read('<ul><li>a<ul><li>b</li></ul></li><li><ul><li>only a list</li></ul></li></ul><ol start="4" type="a"><li>x</li></ol><ul data-type="taskList"><li data-checked="true">done</li><li data-checked="false">todo</li></ul>');
    expect(outline(b)).toEqual([
      'bulletList',
      '  listItem',
      '    paragraph "a"',
      '    bulletList',
      '      listItem',
      '        paragraph "b"',
      '  listItem',
      '    paragraph',
      '    bulletList',
      '      listItem',
      '        paragraph "only a list"',
      'orderedList {start=4 type="a"}',
      '  listItem',
      '    paragraph "x"',
      'taskList',
      '  taskItem {checked=true}',
      '    paragraph "done"',
      '  taskItem',
      '    paragraph "todo"'
    ]);
  });

  it('reads tables with spans, headers and a fill', () => {
    const b = read('<table><thead><tr><th colspan="2" style="background-color:#ebf1fe">H</th></tr></thead><tbody><tr><td rowspan="2">a</td><td>b</td></tr><tr><td>c</td></tr></tbody></table>');
    expect(outline(b)).toEqual([
      'table',
      '  tableRow',
      '    tableHeader {backgroundColor="#ebf1fe" colspan=2}',
      '      paragraph "H"',
      '  tableRow',
      '    tableCell {rowspan=2}',
      '      paragraph "a"',
      '    tableCell',
      '      paragraph "b"',
      '  tableRow',
      '    tableCell',
      '      paragraph "c"'
    ]);
  });

  it('reads preformatted text with its language, quotes, rules and the editor’s own markers', () => {
    const b = read('<pre><code class="language-js">a()\n  b()\n</code></pre><blockquote><p>q</p></blockquote><hr><div data-page-break></div><div data-toc data-entries=\'[{"level":1,"text":"One"}]\'></div><p data-style="title">T</p><p>x<sup data-footnote>The note</sup></p>');
    expect(outline(b)).toEqual([
      'codeBlock {language="js"} "a()\\n  b()"',
      'blockquote',
      '  paragraph "q"',
      'horizontalRule',
      'pageBreak',
      'tableOfContents',
      'paragraph {paraStyle="title"} "T"',
      'paragraph "x" <footnote "The note">'
    ]);
  });

  it('reads suggestions the editor wrote', () => {
    const b = read('<p>a <ins data-suggestion="s1" data-author-id="u" data-author="Ada" data-at="5">new</ins><del data-suggestion="s1" data-author="Ada" data-at="5">old</del></p>');
    expect(outline(b)).toEqual(['paragraph "a " "new"[insertion(Ada)] "old"[deletion(Ada)]']);
  });

  it('treats unknown elements as their text, and whole documents as their body', () => {
    expect(allText(read('<html><head><title>x</title></head><body><custom-tag>kept <blink>too</blink></custom-tag></body></html>'))).toBe('kept too');
  });
});

describe('writeHtml', () => {
  const p = (text: string, marks?: JSONContent['marks'], attrs?: Record<string, unknown>): JSONContent => ({ type: 'paragraph', ...(attrs ? { attrs } : {}), content: [{ type: 'text', text, ...(marks ? { marks } : {}) }] });

  it('escapes text and attributes', () => {
    const { html } = writeHtml(model({ type: 'doc', content: [p('<b>&"x"</b>', [{ type: 'link', attrs: { href: 'https://example.com/?a=1&b="2"' } }])] }), { title: '</title><script>alert(1)</script>' });
    expect(html).toContain('&lt;/title&gt;&lt;script&gt;');
    expect(html).toContain('&lt;b&gt;&amp;&quot;x&quot;&lt;/b&gt;');
    expect(html).toContain('href="https://example.com/?a=1&amp;b=&quot;2&quot;"');
    expect(html).not.toContain('<script>');
  });

  it('round trips: what it writes, it reads back as the same document', () => {
    const attrs = { id: 's1', authorId: 'u', authorName: 'Ada', at: 5 };
    const doc: JSONContent = {
      type: 'doc',
      content: [
        { type: 'paragraph', attrs: { paraStyle: 'title' }, content: [{ type: 'text', text: 'Title' }] },
        { type: 'heading', attrs: { level: 2, textAlign: 'center' }, content: [{ type: 'text', text: 'Head' }] },
        { type: 'paragraph', attrs: { spaceAfter: 6, lineHeight: 1.5, indent: 1 }, content: [{ type: 'text', text: 'styled', marks: [{ type: 'bold' }, { type: 'textStyle', attrs: { fontFamily: 'Georgia', fontSize: '14pt', color: '#c0392b' } }, { type: 'highlight', attrs: { color: '#fff2a8' } }] }, { type: 'text', text: ' new', marks: [{ type: 'insertion', attrs }] }, { type: 'footnote', content: [{ type: 'text', text: 'Note' }] }] },
        { type: 'orderedList', attrs: { start: 3, type: 'a' }, content: [{ type: 'listItem', content: [p('x')] }] },
        { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: true }, content: [p('t')] }] },
        { type: 'blockquote', content: [p('q')] },
        { type: 'codeBlock', attrs: { language: 'ts' }, content: [{ type: 'text', text: 'a\nb' }] },
        { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableHeader', attrs: { colspan: 2, backgroundColor: '#ebf1fe' }, content: [p('h')] }] }, { type: 'tableRow', content: [{ type: 'tableCell', content: [p('a')] }, { type: 'tableCell', content: [p('b')] }] }] },
        { type: 'pageBreak' },
        { type: 'horizontalRule' }
      ]
    };
    const once = readHtml(writeHtml(model(doc), { title: 't' }).html).model.body;
    expect(outline(once)).toEqual(outline(doc));
  });
});
