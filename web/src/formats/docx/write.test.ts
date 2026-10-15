import { unzipSync, strFromU8 } from 'fflate';
import { describe, expect, it } from 'vitest';
import { allText, countNodes, outline } from '../../../../tests/corpus/helpers';
import { PNG_1PX } from '../testing';
import type { DocModel, ExportComment, ExportOptions, JSONContent } from '../types';
import { readDocx } from './read';
import { writeDocx } from './write';

const para = (text: string, marks?: JSONContent['marks'], attrs?: Record<string, unknown>): JSONContent => ({
  type: 'paragraph',
  ...(attrs ? { attrs } : {}),
  content: [{ type: 'text', text, ...(marks ? { marks } : {}) }]
});
const model = (content: JSONContent[], extra: Partial<DocModel> = {}): DocModel => ({
  body: { type: 'doc', content },
  page: null,
  header: {},
  footer: {},
  ...extra
});
const IMG: ExportOptions['resolveImage'] = () => ({ bytes: PNG_1PX, mime: 'image/png', name: 'x.png' });

async function trip(m: DocModel, opts: Partial<ExportOptions> = {}) {
  const { bytes, warnings } = await writeDocx(m, { title: 'Test', ...opts });
  return { bytes, warnings, back: readDocx(bytes), parts: unzipSync(bytes) };
}
const part = (parts: Record<string, Uint8Array>, name: string): string => strFromU8(parts[name] ?? new Uint8Array());

describe('writeDocx', () => {
  it('writes a package Word can open: content types, relationships, a main part', async () => {
    const { parts } = await trip(model([para('hello')]));
    expect(Object.keys(parts)).toEqual(expect.arrayContaining(['[Content_Types].xml', '_rels/.rels', 'word/document.xml', 'word/styles.xml']));
    expect(part(parts, 'word/document.xml')).toContain('hello');
  });

  it('keeps character formatting through a round trip', async () => {
    const body = [
      para('a', [{ type: 'bold' }, { type: 'italic' }, { type: 'underline' }, { type: 'strike' }]),
      para('b', [{ type: 'superscript' }]),
      para('c', [{ type: 'textStyle', attrs: { fontFamily: 'Georgia', fontSize: '16pt', color: '#8e1f1f' } }, { type: 'highlight', attrs: { color: '#ffff00' } }]),
      para('d', [{ type: 'link', attrs: { href: 'https://example.com/x?y=1' } }])
    ];
    const { back } = await trip(model(body));
    expect(outline(back.model.body)).toEqual([
      'paragraph "a"[bold,italic,strike,underline]',
      'paragraph "b"[superscript]',
      'paragraph "c"[highlight(#ffff00),style(fontFamily:Georgia,fontSize:16pt,color:#8e1f1f)]',
      'paragraph "d"[link(https://example.com/x?y=1)]'
    ]);
  });

  it('keeps the named styles, alignment, spacing and indent', async () => {
    const body = [
      { type: 'paragraph', attrs: { paraStyle: 'title' }, content: [{ type: 'text', text: 'Title' }] },
      { type: 'paragraph', attrs: { paraStyle: 'subtitle' }, content: [{ type: 'text', text: 'Sub' }] },
      { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'H3' }] },
      para('centred', undefined, { textAlign: 'center', spaceBefore: 12, spaceAfter: 3, lineHeight: 1.5, indent: 2 }),
      { type: 'paragraph', attrs: { paraStyle: 'nospacing' }, content: [{ type: 'text', text: 'tight' }] },
      { type: 'blockquote', content: [para('q1'), para('q2')] },
      { type: 'codeBlock', content: [{ type: 'text', text: 'one\ntwo' }] }
    ] as JSONContent[];
    const { back } = await trip(model(body));
    expect(outline(back.model.body)).toEqual([
      'paragraph {paraStyle="title"} "Title"',
      'paragraph {paraStyle="subtitle"} "Sub"',
      'heading {level=3} "H3"',
      'paragraph {indent=2 lineHeight=1.5 spaceAfter=3 spaceBefore=12 textAlign="center"} "centred"',
      'paragraph {paraStyle="nospacing"} "tight"',
      'blockquote',
      '  paragraph "q1"',
      '  paragraph "q2"',
      'codeBlock "one\\ntwo"'
    ]);
  });

  it('keeps lists, their numbering style, start and nesting', async () => {
    const item = (t: string, ...nested: JSONContent[]): JSONContent => ({ type: 'listItem', content: [para(t), ...nested] });
    const body: JSONContent[] = [
      { type: 'bulletList', content: [item('a', { type: 'orderedList', attrs: { start: 3 }, content: [item('n1'), item('n2')] }), item('b')] },
      { type: 'orderedList', attrs: { type: 'I', start: 5 }, content: [item('five'), item('six')] },
      { type: 'orderedList', attrs: { format: 'legal' }, content: [item('top', { type: 'orderedList', content: [item('inner')] })] },
      { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: true }, content: [para('done')] }, { type: 'taskItem', attrs: { checked: false }, content: [para('todo')] }] }
    ];
    const { back } = await trip(model(body));
    expect(outline(back.model.body).slice(0, 25)).toEqual([
      'bulletList',
      '  listItem',
      '    paragraph "a"',
      '    orderedList {start=3}',
      '      listItem',
      '        paragraph "n1"',
      '      listItem',
      '        paragraph "n2"',
      '  listItem',
      '    paragraph "b"',
      'orderedList {start=5 type="I"}',
      '  listItem',
      '    paragraph "five"',
      '  listItem',
      '    paragraph "six"',
      'orderedList {format="legal"}',
      '  listItem',
      '    paragraph "top"',
      '    orderedList',
      '      listItem',
      '        paragraph "inner"',
      // A checklist is paragraphs with their boxes, which Word has as a font and no list.
      'paragraph {indent=1} "☑ done"',
      'paragraph {indent=1} "☐ todo"'
    ]);
  });

  it('keeps tables: spans, a header row, shading', async () => {
    const cell = (t: string, attrs?: Record<string, unknown>, type = 'tableCell'): JSONContent => ({ type, ...(attrs ? { attrs } : {}), content: [para(t)] });
    const body: JSONContent[] = [
      {
        type: 'table',
        content: [
          { type: 'tableRow', content: [cell('H', { colspan: 2, backgroundColor: '#ebf1fe' }, 'tableHeader'), cell('H3', undefined, 'tableHeader')] },
          { type: 'tableRow', content: [cell('tall', { rowspan: 2 }), cell('b'), cell('c')] },
          { type: 'tableRow', content: [cell('d'), cell('e')] }
        ]
      }
    ];
    const { back } = await trip(model(body));
    expect(outline(back.model.body)).toEqual([
      'table',
      '  tableRow',
      '    tableHeader {backgroundColor="#ebf1fe" colspan=2}',
      '      paragraph "H"',
      '    tableHeader',
      '      paragraph "H3"',
      '  tableRow',
      '    tableCell {rowspan=2}',
      '      paragraph "tall"',
      '    tableCell',
      '      paragraph "b"',
      '    tableCell',
      '      paragraph "c"',
      '  tableRow',
      '    tableCell',
      '      paragraph "d"',
      '    tableCell',
      '      paragraph "e"'
    ]);
  });

  it('keeps footnotes, page breaks, a rule and the chips as text', async () => {
    const body: JSONContent[] = [
      { type: 'paragraph', content: [{ type: 'text', text: 'word' }, { type: 'footnote', content: [{ type: 'text', text: 'The note' }] }, { type: 'text', text: ' and ' }, { type: 'mention', attrs: { id: 'u1', label: 'ben' } }, { type: 'text', text: ' ' }, { type: 'dateChip', attrs: { date: '2026-03-04' } }] },
      { type: 'pageBreak' },
      { type: 'horizontalRule' },
      para('after')
    ];
    const { back } = await trip(model(body));
    expect(allText(back.model.body)).toContain('word');
    expect(countNodes(back.model.body, 'footnote')).toBe(1);
    expect(allText(back.model.body)).toContain('The note');
    expect(allText(back.model.body)).toContain('@ben');
    expect(allText(back.model.body)).toContain('Mar 4, 2026');
    expect(countNodes(back.model.body, 'pageBreak')).toBe(1);
  });

  it('writes the page setup and the headers and footers with their fields', async () => {
    const hf = (c: JSONContent[]): JSONContent => ({ type: 'doc', content: [{ type: 'paragraph', attrs: { textAlign: 'center' }, content: c }] });
    const m = model([para('body')], {
      page: { size: 'Letter', orientation: 'landscape', margins: { top: 20, right: 25.4, bottom: 22.9, left: 19.1 }, headerDistance: 10.2, footerDistance: 11, differentFirst: true },
      header: { default: hf([{ type: 'text', text: 'Report' }]), first: hf([{ type: 'text', text: 'Cover' }]) },
      footer: { default: hf([{ type: 'text', text: 'Page ' }, { type: 'pageField', attrs: { kind: 'page' } }, { type: 'text', text: ' of ' }, { type: 'pageField', attrs: { kind: 'pages' } }, { type: 'pageField', attrs: { kind: 'title' } }]) }
    });
    const { back } = await trip(m, { title: 'My report' });
    expect(back.model.page).toEqual(m.page);
    expect(back.model.header).toEqual(m.header);
    expect(back.model.footer.default!.content![0]!.content!.map((n) => n.type === 'pageField' ? n.attrs!.kind : n.text)).toEqual(['Page ', 'page', ' of ', 'pages', 'title']);
  });

  it('puts a picture where it was, at its size and alignment, with its alt text', async () => {
    const body: JSONContent[] = [para('a'), { type: 'image', attrs: { src: '/api/office/documents/d/assets/a1', width: 200, height: 100, align: 'center', alt: 'A picture' } }, para('b')];
    const { back, parts } = await trip(model(body), { resolveImage: IMG });
    expect(outline(back.model.body)).toEqual(['paragraph "a"', 'image {align="center" alt="A picture" height=100 src="import:1" width=200}', 'paragraph "b"']);
    expect(Object.keys(parts).some((n) => n.startsWith('word/media/'))).toBe(true);
  });

  it('leaves a picture it cannot get and one Word cannot take out, and says so', async () => {
    const body: JSONContent[] = [{ type: 'image', attrs: { src: 'gone' } }, { type: 'image', attrs: { src: 'webp' } }, para('end')];
    const resolve: ExportOptions['resolveImage'] = (src) => (src === 'webp' ? { bytes: PNG_1PX, mime: 'image/webp', name: 'x.webp' } : null);
    const { back, warnings } = await trip(model(body), { resolveImage: resolve });
    expect(back.images.size).toBe(0);
    expect(warnings).toEqual([{ code: 'picture', message: '2 pictures could not be included.', count: 2 }]);
  });

  it('puts comments where their text is, with replies, and the resolved flag', async () => {
    const body = [para('Hello big wide world'), para('Second paragraph')];
    const comments: ExportComment[] = [
      { id: 'c1', author: 'Ben Okoro', at: 1_772_618_400_000, text: 'Why wide?\nExplain.', resolved: false, start: 10, end: 14, replies: [{ author: 'Ada Rowe', at: 1_772_622_000_000, text: 'Because.' }] },
      { id: 'c2', author: 'Ada Rowe', at: 1_772_622_000_000, text: 'Done', resolved: true, start: 20, end: 26, replies: [] }
    ];
    const { back } = await trip(model(body), { comments });
    const text = allText(back.model.body);
    expect(back.comments.map((c) => [c.author, c.text, c.parent, c.resolved])).toEqual([
      ['Ben Okoro', 'Why wide?\nExplain.', null, false],
      ['Ada Rowe', 'Because.', '1', false],
      ['Ada Rowe', 'Done', null, true]
    ]);
    expect(text.slice(back.comments[0]!.start, back.comments[0]!.end)).toBe('wide');
    expect(back.comments[1]).toMatchObject({ start: 10, end: 14 });
    expect(text.slice(back.comments[2]!.start, back.comments[2]!.end)).toBe('Second');
  });

  it('counts a chip as no text, so a comment after one is where it should be', async () => {
    const body: JSONContent[] = [{ type: 'paragraph', content: [{ type: 'mention', attrs: { id: 'u', label: 'long-handle' } }, { type: 'text', text: 'target here' }] }];
    const { back } = await trip(model(body), { comments: [{ id: 'c', author: 'A', at: null, text: 't', resolved: false, start: 0, end: 6, replies: [] }] });
    // The editor counts a chip as no text, so characters 0 to 6 are "target". The file writes the
    // chip as text, and the comment must still be on "target" there.
    const t = allText(back.model.body);
    expect(t.slice(back.comments[0]!.start, back.comments[0]!.end)).toBe('target');
  });

  it('writes suggestions as tracked changes with their author and time', async () => {
    const attrs = (id: string) => ({ id, authorId: 'u', authorName: 'Ben Okoro', at: 1_772_618_400_000 });
    const body: JSONContent[] = [
      { type: 'paragraph', content: [{ type: 'text', text: 'keep ' }, { type: 'text', text: 'old', marks: [{ type: 'deletion', attrs: attrs('s1') }] }, { type: 'text', text: 'new', marks: [{ type: 'insertion', attrs: attrs('s2') }] }] }
    ];
    const { back, parts } = await trip(model(body));
    expect(outline(back.model.body)).toEqual(['paragraph "keep " "old"[deletion(Ben Okoro)] "new"[insertion(Ben Okoro)]']);
    expect(part(parts, 'word/document.xml')).toMatch(/<w:del [^>]*w:author="Ben Okoro"/);
  });

  it('writes a table of contents as its entries', async () => {
    const body: JSONContent[] = [{ type: 'tableOfContents', attrs: { entries: JSON.stringify([{ level: 1, text: 'One' }, { level: 2, text: 'Two' }]) } }, { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'One' }] }];
    const { back } = await trip(model(body));
    expect(allText(back.model.body)).toContain('Contents');
    expect(allText(back.model.body)).toContain('Two');
  });

  it('survives an empty document and a node it does not know', async () => {
    const { back } = await trip(model([{ type: 'paragraph' }, { type: 'mystery', content: [{ type: 'text', text: 'kept text' }] }]));
    expect(allText(back.model.body)).toBe('kept text');
  });

  it('is stable: writing what it read gives the same model', async () => {
    const m = model([para('Stable text', [{ type: 'bold' }]), { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Head' }] }]);
    const first = await trip(m);
    const second = await trip(first.back.model);
    expect(outline(second.back.model.body)).toEqual(outline(first.back.model.body));
  });
});
