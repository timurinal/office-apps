import { describe, expect, it } from 'vitest';
import { allText, countNodes, outline } from '../../../../tests/corpus/helpers';
import type { DocModel, JSONContent } from '../types';
import { readMarkdown } from './read';
import { writeMarkdown } from './write';

const read = (src: string) => readMarkdown(src).model.body;
const model = (body: JSONContent): DocModel => ({ body, page: null, header: {}, footer: {} });
const write = (body: JSONContent) => writeMarkdown(model(body), { title: 't' }).markdown;

describe('readMarkdown', () => {
  it('reads headings, paragraphs, emphasis, code and links', () => {
    const b = read('# One\n\n## Two\n\nSome **bold**, *italic*, ~~gone~~, `code` and [a link](https://example.com/).\n');
    expect(outline(b)).toEqual([
      'heading {level=1} "One"',
      'heading {level=2} "Two"',
      'paragraph "Some " "bold"[bold] ", " "italic"[italic] ", " "gone"[strike] ", " "code"[code] " and " "a link"[link(https://example.com/)] "."'
    ]);
  });

  it('reads lists, nested, numbered with a start, and checklists', () => {
    const b = read('- a\n  - b\n- c\n\n3. x\n4. y\n\n- [x] done\n- [ ] todo\n');
    expect(outline(b)).toEqual([
      'bulletList',
      '  listItem',
      '    paragraph "a"',
      '    bulletList',
      '      listItem',
      '        paragraph "b"',
      '  listItem',
      '    paragraph "c"',
      'orderedList {start=3}',
      '  listItem',
      '    paragraph "x"',
      '  listItem',
      '    paragraph "y"',
      'taskList',
      '  taskItem {checked=true}',
      '    paragraph "done"',
      '  taskItem',
      '    paragraph "todo"'
    ]);
  });

  it('reads quotes, fenced code with its language, rules and tables', () => {
    const b = read('> quoted\n\n```ts\nlet x = 1;\n```\n\n---\n\n| a | b |\n|:-:|---|\n| 1 | 2 |\n');
    expect(outline(b)).toEqual([
      'blockquote',
      '  paragraph "quoted"',
      'codeBlock {language="ts"} "let x = 1;"',
      'horizontalRule',
      'table',
      '  tableRow',
      '    tableHeader',
      '      paragraph {textAlign="center"} "a"',
      '    tableHeader',
      '      paragraph "b"',
      '  tableRow',
      '    tableCell',
      '      paragraph {textAlign="center"} "1"',
      '    tableCell',
      '      paragraph "2"'
    ]);
  });

  it('reads footnotes from their definitions', () => {
    const b = read('Text[^1] and more[^note].\n\n[^1]: The first.\n[^note]: The second,\n    continued.\n');
    expect(outline(b)).toEqual(['paragraph "Text" <footnote "The first."> " and more" <footnote "The second, continued."> "."']);
  });

  it('honours the handful of HTML tags the editor writes into Markdown, and no others', () => {
    const b = read('a <u>under</u> b <sub>s</sub><sup>p</sup> <mark>hi</mark> c<br>d <script>alert(1)</script> <span onclick="x">e</span>\n');
    const json = JSON.stringify(b);
    expect(json).toContain('"underline"');
    expect(json).toContain('"subscript"');
    expect(json).toContain('"superscript"');
    expect(json).toContain('"highlight"');
    expect(json).toContain('hardBreak');
    expect(json).not.toMatch(/<script|onclick|<span|"span"/);
  });

  it('reads a block of raw HTML through the same allowlist as a page', () => {
    const b = read('<div><h3>Raw</h3><p onclick="x">text <b>bold</b></p><script>alert(1)</script></div>\n');
    expect(outline(b)).toEqual(['heading {level=3} "Raw"', 'paragraph "text " "bold"[bold]']);
  });

  it('keeps text that Markdown would have escaped', () => {
    expect(allText(read('1 \\* 2 \\[not a link\\] \\# not a heading\n'))).toBe('1 * 2 [not a link] # not a heading');
  });

  it('does not let a code span carry other marks', () => {
    const para = read('**`both`**\n').content![0]!;
    expect(para.content![0]!.marks).toEqual([{ type: 'code' }]);
  });

  it('takes a document with nothing in it as one empty paragraph', () => {
    expect(read('')).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] });
  });

  it('keeps a picture only when it is a data URL, as a block', () => {
    const png = btoa(String.fromCharCode(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4));
    const res = readMarkdown(`before ![alt text](data:image/png;base64,${png}) after\n\n![remote](https://example.com/x.png)\n`);
    expect(res.images.size).toBe(1);
    expect(outline(res.model.body)).toEqual(['paragraph "before "', 'image {alt="alt text" src="import:1"}', 'paragraph " after"']);
    expect(res.warnings.map((w) => w.code)).toEqual(['external-image']);
  });

  it('does not read past a nesting bound', () => {
    const deep = '> '.repeat(40) + 'x\n';
    expect(allText(read(deep))).toBe('x');
  });
});

describe('writeMarkdown', () => {
  const p = (text: string, marks?: JSONContent['marks']): JSONContent => ({ type: 'paragraph', content: [{ type: 'text', text, ...(marks ? { marks } : {}) }] });

  it('writes the usual things', () => {
    const md = write({
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Head' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'a ' }, { type: 'text', text: 'bold', marks: [{ type: 'bold' }] }, { type: 'text', text: ' ' }, { type: 'text', text: 'link', marks: [{ type: 'link', attrs: { href: 'https://example.com/a%20b' } }] }] },
        { type: 'bulletList', content: [{ type: 'listItem', content: [p('x'), { type: 'orderedList', content: [{ type: 'listItem', content: [p('y')] }] }] }] },
        { type: 'blockquote', content: [p('q')] },
        { type: 'codeBlock', attrs: { language: 'js' }, content: [{ type: 'text', text: 'a()\nb()' }] },
        { type: 'horizontalRule' }
      ]
    });
    expect(md).toBe('## Head\n\na **bold** [link](https://example.com/a%20b)\n\n- x\n  1. y\n\n> q\n\n```js\na()\nb()\n```\n\n---\n');
  });

  it('keeps the space outside emphasis, where Markdown needs it', () => {
    expect(write({ type: 'doc', content: [p(' padded ', [{ type: 'bold' }])] })).toBe(' **padded** \n');
  });

  it('escapes what would otherwise be Markdown', () => {
    expect(write({ type: 'doc', content: [p('*stars* _under_ [br] <tag> `tick`'), p('# not a heading'), p('1. not a list')] })).toBe('\\*stars\\* \\_under\\_ \\[br\\] \\<tag\\> \\`tick\\`\n\n\\# not a heading\n\n1\\. not a list\n');
  });

  it('writes a table, a checklist and a footnote', () => {
    const cell = (t: string, type = 'tableCell'): JSONContent => ({ type, content: [p(t)] });
    const md = write({
      type: 'doc',
      content: [
        { type: 'table', content: [{ type: 'tableRow', content: [cell('a', 'tableHeader'), cell('b|c', 'tableHeader')] }, { type: 'tableRow', content: [cell('1'), cell('2')] }] },
        { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: true }, content: [p('done')] }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'note' }, { type: 'footnote', content: [{ type: 'text', text: 'The note.' }] }] }
      ]
    });
    expect(md).toBe('| a | b\\|c |\n| --- | --- |\n| 1 | 2 |\n\n- [x] done\n\nnote[^1]\n\n[^1]: The note.\n');
  });

  it('writes the accepted state of a suggestion: an insertion is text, a deletion is gone', () => {
    const attrs = { id: 's', authorId: 'u', authorName: 'A', at: 1 };
    expect(write({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'old', marks: [{ type: 'deletion', attrs }] }, { type: 'text', text: 'new', marks: [{ type: 'insertion', attrs }] }] }] })).toBe('new\n');
  });

  it('round trips: what it writes, it reads back as the same document', () => {
    const src = '# Title\n\nParagraph with **bold**, *italic*, `code` and [link](https://example.com/).\n\n- one\n  - two\n- three\n\n1. first\n2. second\n\n> quote\n\n```py\nprint(1)\n```\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\n- [x] done\n- [ ] todo\n\nText[^1].\n\n[^1]: A note.\n';
    const once = read(src);
    const again = read(write(once));
    expect(outline(again)).toEqual(outline(once));
    expect(countNodes(again, 'footnote')).toBe(1);
  });
});
