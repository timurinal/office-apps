import { describe, expect, it } from 'vitest';
import { makeDocx, p, r, NS } from '../testing';
import { PNG_1PX } from '../testing';
import { readDocx } from './read';
import { allText, countNodes, outline } from '../../../../tests/corpus/helpers';
import type { JSONContent } from '../types';

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const styles = (inner: string, defaults = '') => `<w:styles ${W}>${defaults}${inner}</w:styles>`;
const style = (id: string, name: string, body = '', type = 'paragraph', extra = '') =>
  `<w:style w:type="${type}" w:styleId="${id}"${extra}><w:name w:val="${name}"/>${body}</w:style>`;
const read = (parts: Parameters<typeof makeDocx>[0]) => readDocx(makeDocx(parts));
const body = (parts: Parameters<typeof makeDocx>[0]) => read(parts).model.body;
const first = (n: JSONContent): JSONContent => n.content![0]!;

describe('paragraph styles', () => {
  const sheet = styles(
    style('Normal', 'Normal', '', 'paragraph', ' w:default="1"') +
      style('Heading1', 'heading 1', '<w:basedOn w:val="Normal"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="48"/><w:color w:val="2F5496"/></w:rPr>') +
      style('Heading7', 'heading 7') +
      style('Title', 'Title', '<w:rPr><w:sz w:val="56"/></w:rPr>') +
      style('Subtitle', 'Subtitle') +
      style('NoSpacing', 'No Spacing', '<w:pPr><w:spacing w:after="0"/></w:pPr>') +
      style('Quote', 'Quote') +
      style('Code', 'Code', '<w:rPr><w:rFonts w:ascii="Courier New"/></w:rPr>') +
      style('Chapter', 'Chapter Heading', '<w:basedOn w:val="Heading1"/>') +
      style('Fancy', 'Fancy', '<w:basedOn w:val="Normal"/><w:pPr><w:jc w:val="center"/><w:spacing w:before="240" w:after="120"/></w:pPr><w:rPr><w:b/><w:color w:val="C0501C"/><w:sz w:val="26"/></w:rPr>') +
      style('Navigation', 'Navigation', '<w:pPr><w:outlineLvl w:val="2"/></w:pPr>')
  );
  const sp = (id: string, text: string) => p(r(text), `<w:pStyle w:val="${id}"/>`);

  it('maps Word names onto the editor’s styles', () => {
    const b = body({
      styles: sheet,
      body: sp('Heading1', 'One') + sp('Heading7', 'Seven') + sp('Title', 'T') + sp('Subtitle', 'S') + sp('NoSpacing', 'N') + sp('Fancy', 'F') + sp('Chapter', 'C') + sp('Navigation', 'Nav')
    });
    const kinds = b.content!.map((n) => (n.type === 'heading' ? `h${n.attrs!.level}` : (n.attrs?.paraStyle ?? n.type)));
    expect(kinds).toEqual(['h1', 'h6', 'title', 'subtitle', 'nospacing', 'paragraph', 'h1', 'h3']);
  });

  it('keeps the editor’s look for a heading, and only what was written on the run', () => {
    const b = body({ styles: sheet, body: sp('Heading1', 'Plain') + p(r('Direct', '<w:i/>'), '<w:pStyle w:val="Heading1"/>') });
    // Word's blue 48-half-point bold Heading 1 is not carried over; direct italic is.
    expect(JSON.stringify(first(b))).not.toContain('2f5496');
    expect(JSON.stringify(first(b))).not.toContain('fontSize');
    expect(b.content![1]!.content![0]!.marks).toEqual([{ type: 'italic' }]);
  });

  it('bakes a custom style into the paragraphs that use it', () => {
    const para = first(body({ styles: sheet, body: sp('Fancy', 'Styled') }));
    expect(para.attrs).toMatchObject({ textAlign: 'center', spaceBefore: 12, spaceAfter: 6 });
    expect(para.content![0]!.marks).toContainEqual({ type: 'bold' });
    expect(para.content![0]!.marks).toContainEqual({ type: 'textStyle', attrs: { color: '#c0501c', fontSize: '13pt' } });
  });

  it('merges neighbouring quotes into one blockquote and neighbouring code into one block', () => {
    const b = body({ styles: sheet, body: sp('Quote', 'a') + sp('Quote', 'b') + sp('Fancy', 'between') + sp('Code', 'let x = 1;') + sp('Code', 'let y = 2;') });
    expect(b.content![0]).toMatchObject({ type: 'blockquote' });
    expect(b.content![0]!.content).toHaveLength(2);
    expect(b.content![2]).toEqual({ type: 'codeBlock', content: [{ type: 'text', text: 'let x = 1;\nlet y = 2;' }] });
  });

  it('takes the document’s font and size from the defaults, and the editor’s own are not marks', () => {
    const defaults = '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Georgia"/><w:sz w:val="24"/></w:rPr></w:rPrDefault></w:docDefaults>';
    const t = first(first(body({ styles: styles('', defaults), body: p(r('x')) })));
    expect(t.marks).toEqual([{ type: 'textStyle', attrs: { fontFamily: 'Georgia', fontSize: '12pt' } }]);
    const own = styles('', '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Inter"/><w:sz w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults>');
    expect(first(first(body({ styles: own, body: p(r('x')) }))).marks).toBeUndefined();
  });

  it('reads a theme font', () => {
    const theme = `<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:themeElements><a:fontScheme><a:majorFont><a:latin typeface="Cambria"/></a:majorFont><a:minorFont><a:latin typeface="Aptos"/></a:minorFont></a:fontScheme></a:themeElements></a:theme>`;
    const parts = {
      styles: styles('', '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:asciiTheme="minorHAnsi"/></w:rPr></w:rPrDefault></w:docDefaults>'),
      body: p(r('x')),
      rels: [{ id: 'th', type: 'theme', target: 'theme/theme1.xml' }],
      files: { 'word/theme/theme1.xml': new TextEncoder().encode(theme) }
    };
    expect(first(first(body(parts))).marks).toEqual([{ type: 'textStyle', attrs: { fontFamily: 'Aptos' } }]);
  });
});

describe('runs', () => {
  const marksOfRun = (rpr: string) => first(first(body({ body: p(r('x', rpr)) }))).marks ?? [];

  it('reads the character formats the editor has', () => {
    expect(marksOfRun('<w:b/><w:i/><w:u w:val="single"/><w:strike/>').map((m) => m.type)).toEqual(['bold', 'italic', 'underline', 'strike']);
    expect(marksOfRun('<w:vertAlign w:val="superscript"/>')).toEqual([{ type: 'superscript' }]);
    expect(marksOfRun('<w:vertAlign w:val="subscript"/>')).toEqual([{ type: 'subscript' }]);
  });

  it('takes "off" as off', () => {
    expect(marksOfRun('<w:b w:val="0"/><w:i w:val="false"/><w:u w:val="none"/>')).toEqual([]);
  });

  it('reads colour, size and highlight, and ignores automatic and black', () => {
    expect(marksOfRun('<w:color w:val="C0392B"/><w:sz w:val="28"/>')).toEqual([{ type: 'textStyle', attrs: { fontSize: '14pt', color: '#c0392b' } }]);
    expect(marksOfRun('<w:color w:val="auto"/>')).toEqual([]);
    expect(marksOfRun('<w:color w:val="000000"/>')).toEqual([]);
    expect(marksOfRun('<w:highlight w:val="yellow"/>')).toEqual([{ type: 'highlight', attrs: { color: '#ffff00' } }]);
    expect(marksOfRun('<w:highlight w:val="none"/>')).toEqual([]);
    expect(marksOfRun('<w:shd w:val="clear" w:fill="FFF2A8"/>')).toEqual([{ type: 'highlight', attrs: { color: '#fff2a8' } }]);
  });

  it('drops hidden text', () => {
    const b = body({ body: p(r('seen') + r('hidden', '<w:vanish/>')) });
    expect(allText(b)).toBe('seen');
  });

  it('merges the runs Word splits a sentence into', () => {
    const b = body({ body: p(r('Hel') + r('lo ') + r('wor', '<w:b/>') + r('ld', '<w:b/>')) });
    expect(first(b).content).toEqual([{ type: 'text', text: 'Hello ' }, { type: 'text', text: 'world', marks: [{ type: 'bold' }] }]);
  });

  it('turns tabs and line breaks into a tab character and a hard break', () => {
    const b = body({ body: p('<w:r><w:t>a</w:t><w:tab/><w:t>b</w:t><w:br/><w:t>c</w:t></w:r>') });
    expect(first(b).content).toEqual([{ type: 'text', text: 'a\tb' }, { type: 'hardBreak' }, { type: 'text', text: 'c' }]);
  });

  it('cuts a paragraph in three around a page break, and drops the empty halves', () => {
    const b = body({ body: p(r('before') + '<w:r><w:br w:type="page"/></w:r>' + r('after')) + p('<w:r><w:br w:type="page"/></w:r>') });
    expect(b.content!.map((n) => n.type)).toEqual(['paragraph', 'pageBreak', 'paragraph', 'pageBreak']);
  });
});

describe('paragraph properties', () => {
  it('maps alignment, spacing and indent', () => {
    const para = first(body({ body: p(r('x'), '<w:jc w:val="both"/><w:ind w:left="1440"/><w:spacing w:before="360" w:after="120" w:line="360" w:lineRule="auto"/>') }));
    expect(para.attrs).toEqual({ textAlign: 'justify', indent: 2, spaceBefore: 18, spaceAfter: 6, lineHeight: 1.5 });
  });

  it('takes an exact line height as a multiple of the font size', () => {
    const para = first(body({ body: p(r('x'), '<w:spacing w:line="440" w:lineRule="exact"/>') }));
    expect(para.attrs?.lineHeight).toBe(2);
  });

  it('puts a break before a paragraph that asks for one', () => {
    const b = body({ body: p(r('a')) + p(r('b'), '<w:pageBreakBefore/>') });
    expect(b.content!.map((n) => n.type)).toEqual(['paragraph', 'pageBreak', 'paragraph']);
  });

  it('keeps single spacing and no gap as nothing', () => {
    expect(first(body({ body: p(r('x'), '<w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/>') })).attrs).toBeUndefined();
  });
});

describe('lists', () => {
  const numbering =
    `<w:numbering ${W}>` +
    '<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/></w:lvl><w:lvl w:ilvl="1"><w:numFmt w:val="bullet"/><w:lvlText w:val="o"/></w:lvl></w:abstractNum>' +
    '<w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl><w:lvl w:ilvl="1"><w:numFmt w:val="lowerLetter"/><w:lvlText w:val="%2)"/></w:lvl></w:abstractNum>' +
    '<w:abstractNum w:abstractNumId="2"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="upperRoman"/><w:lvlText w:val="%1."/></w:lvl><w:lvl w:ilvl="1"><w:numFmt w:val="decimal"/><w:lvlText w:val="%1.%2."/></w:lvl></w:abstractNum>' +
    '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>' +
    '<w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>' +
    '<w:num w:numId="3"><w:abstractNumId w:val="2"/></w:num>' +
    '<w:num w:numId="4"><w:abstractNumId w:val="1"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="7"/></w:lvlOverride></w:num>' +
    '</w:numbering>';
  const li = (num: number, lvl: number, text: string) => p(r(text), `<w:numPr><w:ilvl w:val="${lvl}"/><w:numId w:val="${num}"/></w:numPr>`);
  const lines = (parts: Parameters<typeof makeDocx>[0]) => outline(body({ numbering, ...parts })).map((l) => l.replace(/ \{.*?\}/, (m) => m));

  it('nests by level and tells bullets from numbers', () => {
    const o = lines({ body: li(1, 0, 'a') + li(1, 1, 'b') + li(1, 0, 'c') + li(2, 0, 'one') + li(2, 1, 'sub') });
    expect(o).toEqual([
      'bulletList',
      '  listItem',
      '    paragraph "a"',
      '    bulletList',
      '      listItem',
      '        paragraph "b"',
      '  listItem',
      '    paragraph "c"',
      'orderedList',
      '  listItem',
      '    paragraph "one"',
      '    orderedList',
      '      listItem',
      '        paragraph "sub"'
    ]);
  });

  it('keeps a numbering style that departs from the editor’s, and a start override', () => {
    const b = body({ numbering, body: li(3, 0, 'i') + p(r('break')) + li(4, 0, 'seven') });
    expect(b.content![0]).toMatchObject({ type: 'orderedList', attrs: { type: 'I' } });
    expect(b.content![2]).toMatchObject({ type: 'orderedList', attrs: { start: 7 } });
  });

  it('continues a list’s count after something in between', () => {
    const b = body({ numbering, body: li(2, 0, 'a') + li(2, 0, 'b') + p(r('between')) + li(2, 0, 'c') });
    expect(b.content![2]).toMatchObject({ type: 'orderedList', attrs: { start: 3 } });
  });

  it('marks the outermost list as legal when its inner levels count 1.1.', () => {
    expect(first(body({ numbering, body: li(3, 0, 'x') + li(3, 1, 'y') }))).toMatchObject({ type: 'orderedList', attrs: { format: 'legal', type: 'I' } });
  });

  it('takes List Bullet 2 as the second level of List Bullet', () => {
    const sheet = styles(style('ListBullet', 'List Bullet', '<w:pPr><w:numPr><w:numId w:val="1"/></w:numPr></w:pPr>') + style('ListBullet2', 'List Bullet 2', '<w:pPr><w:numPr><w:numId w:val="1"/></w:numPr></w:pPr>'));
    const sp = (id: string, t: string) => p(r(t), `<w:pStyle w:val="${id}"/>`);
    const b = body({ numbering, styles: sheet, body: sp('ListBullet', 'a') + sp('ListBullet2', 'b') + sp('ListBullet', 'c') });
    expect(countNodes(b, 'bulletList')).toBe(2);
    expect(b.content).toHaveLength(1);
  });

  it('leaves a heading a heading even when it is numbered', () => {
    const sheet = styles(style('Heading1', 'heading 1', '<w:pPr><w:outlineLvl w:val="0"/></w:pPr>'));
    const b = body({ numbering, styles: sheet, body: p(r('Intro'), '<w:pStyle w:val="Heading1"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr>') });
    expect(first(b).type).toBe('heading');
  });
});

describe('tables', () => {
  const tc = (inner: string, pr = '') => `<w:tc>${pr ? `<w:tcPr>${pr}</w:tcPr>` : ''}${inner}</w:tc>`;
  const tr = (cells: string, pr = '') => `<w:tr>${pr ? `<w:trPr>${pr}</w:trPr>` : ''}${cells}</w:tr>`;
  const tbl = (rows: string, grid = '') => `<w:tbl><w:tblPr/><w:tblGrid>${grid}</w:tblGrid>${rows}</w:tbl>`;

  it('merges across and down', () => {
    const t = first(
      body({
        body: tbl(
          tr(tc(p(r('wide')), '<w:gridSpan w:val="2"/>') + tc(p(r('x')))) + tr(tc(p(r('tall')), '<w:vMerge w:val="restart"/>') + tc(p(r('a'))) + tc(p(r('b')))) + tr(tc(p(''), '<w:vMerge/>') + tc(p(r('c'))) + tc(p(r('d'))))
        )
      })
    );
    expect(outline(t)).toEqual([
      'table',
      '  tableRow',
      '    tableCell {colspan=2}',
      '      paragraph "wide"',
      '    tableCell',
      '      paragraph "x"',
      '  tableRow',
      '    tableCell {rowspan=2}',
      '      paragraph "tall"',
      '    tableCell',
      '      paragraph "a"',
      '    tableCell',
      '      paragraph "b"',
      '  tableRow',
      '    tableCell',
      '      paragraph "c"',
      '    tableCell',
      '      paragraph "d"'
    ]);
  });

  it('makes a header row of the rows Word repeats, and fills cells', () => {
    const t = first(body({ body: tbl(tr(tc(p(r('H')), '<w:shd w:fill="DBE7FD" w:val="clear"/>'), '<w:tblHeader/>') + tr(tc(p(r('b'))), '<w:tblHeader w:val="0"/>')) }));
    expect(t.content![0]!.content![0]).toMatchObject({ type: 'tableHeader', attrs: { backgroundColor: '#dbe7fd' } });
    expect(t.content![1]!.content![0]!.type).toBe('tableCell');
  });

  it('turns grid widths into pixel column widths', () => {
    const t = first(body({ body: tbl(tr(tc(p(r('a'))) + tc(p(r('b')))), '<w:gridCol w:w="3000"/><w:gridCol w:w="6000"/>') }));
    expect(t.content![0]!.content!.map((c) => c.attrs?.colwidth)).toEqual([[200], [400]]);
  });

  it('nests a table in a cell and gives the cell a paragraph to end in', () => {
    const inner = tbl(tr(tc(p(r('in')))));
    const t = first(body({ body: tbl(tr(tc(inner))) }));
    const cell = t.content![0]!.content![0]!;
    expect(cell.content!.map((n) => n.type)).toEqual(['table', 'paragraph']);
  });

  it('survives a cell with nothing in it', () => {
    const t = first(body({ body: tbl(tr('<w:tc/>')) }));
    expect(t.content![0]!.content![0]!.content).toEqual([{ type: 'paragraph' }]);
  });
});

describe('notes, comments and review', () => {
  const footnotes = (id: string, text: string) => `<w:footnotes ${W}><w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote><w:footnote w:id="${id}"><w:p><w:r><w:footnoteRef/></w:r><w:r><w:t xml:space="preserve"> ${text}</w:t></w:r></w:p></w:footnote></w:footnotes>`;

  it('puts a footnote’s text in the node, and skips the separators', () => {
    const b = body({ footnotes: footnotes('2', 'The note.'), body: p(r('word') + '<w:r><w:footnoteReference w:id="2"/></w:r>' + r(' after')) });
    expect(first(b).content).toEqual([{ type: 'text', text: 'word' }, { type: 'footnote', content: [{ type: 'text', text: 'The note.' }] }, { type: 'text', text: ' after' }]);
  });

  const comments = (n: number) =>
    `<w:comments ${NS}>${Array.from({ length: n }, (_, i) => `<w:comment w:id="${i}" w:author="Ada Rowe" w:date="2026-03-04T10:00:00Z"><w:p w14:paraId="0000000${i}"><w:r><w:t>Note ${i}</w:t></w:r></w:p></w:comment>`).join('')}</w:comments>`;

  it('anchors a comment by characters of text, counted across runs and paragraphs', () => {
    const res = read({
      comments: comments(1),
      body: p(r('Hello ')) + p(r('big ') + '<w:commentRangeStart w:id="0"/>' + r('wide') + '<w:commentRangeEnd w:id="0"/><w:r><w:commentReference w:id="0"/></w:r>' + r(' world'))
    });
    expect(res.comments).toHaveLength(1);
    expect(res.comments[0]).toMatchObject({ author: 'Ada Rowe', text: 'Note 0', start: 10, end: 14, parent: null, resolved: false });
    expect(allText(res.model.body).slice(10, 14)).toBe('wide');
  });

  it('reads replies and the resolved flag from commentsExtended', () => {
    const ext = `<w15:commentsEx ${NS}><w15:commentEx w15:paraId="00000000" w15:done="0"/><w15:commentEx w15:paraId="00000001" w15:paraIdParent="00000000" w15:done="0"/><w15:commentEx w15:paraId="00000002" w15:done="1"/></w15:commentsEx>`;
    const res = read({
      comments: comments(3),
      commentsExtended: ext,
      body: p('<w:commentRangeStart w:id="0"/><w:commentRangeStart w:id="1"/>' + r('text') + '<w:commentRangeEnd w:id="0"/><w:commentRangeEnd w:id="1"/>' + '<w:commentRangeStart w:id="2"/>' + r(' more') + '<w:commentRangeEnd w:id="2"/>')
    });
    expect(res.comments.map((c) => [c.id, c.parent, c.resolved])).toEqual([['0', null, false], ['1', '0', false], ['2', null, true]]);
    expect(res.comments[1]).toMatchObject({ start: 0, end: 4 });
  });

  it('turns tracked insertions and deletions into the editor’s suggestion marks', () => {
    const b = body({
      body: p(
        r('keep ') +
          '<w:del w:id="1" w:author="Ben" w:date="2026-03-04T10:00:00Z"><w:r><w:delText>old</w:delText></w:r></w:del>' +
          '<w:ins w:id="2" w:author="Ben" w:date="2026-03-04T10:00:00Z"><w:r><w:t>new</w:t></w:r></w:ins>'
      )
    });
    const [keep, del, ins] = first(b).content!;
    expect(keep!.marks).toBeUndefined();
    expect(del).toMatchObject({ text: 'old', marks: [{ type: 'deletion', attrs: { authorName: 'Ben', at: Date.parse('2026-03-04T10:00:00Z') } }] });
    expect(ins).toMatchObject({ text: 'new', marks: [{ type: 'insertion', attrs: { authorName: 'Ben' } }] });
    // A replacement is one suggestion to the editor: the deletion and the insertion share an id.
    expect(del!.marks![0]!.attrs!.id).toBe(ins!.marks![0]!.attrs!.id);
  });

  it('puts an inserted paragraph mark on the paragraph that follows it', () => {
    const b = body({ body: p(r('one'), '<w:rPr><w:ins w:id="3" w:author="Ada" w:date="2026-03-04T10:00:00Z"/></w:rPr>') + p(r('two')) });
    expect(b.content![0]!.attrs?.suggest).toBeUndefined();
    expect(b.content![1]!.attrs?.suggest).toMatchObject({ kind: 'split', authorName: 'Ada' });
  });

  it('gives each change its own id when they are not a replacement', () => {
    const b = body({
      body: p('<w:ins w:id="1" w:author="A" w:date="2026-03-04T10:00:00Z"><w:r><w:t>x</w:t></w:r></w:ins>' + r(' mid ') + '<w:ins w:id="2" w:author="A" w:date="2026-03-04T10:00:00Z"><w:r><w:t>y</w:t></w:r></w:ins>')
    });
    const ids = first(b).content!.flatMap((n) => (n.marks ?? []).filter((m) => m.type === 'insertion').map((m) => m.attrs!.id));
    expect(new Set(ids).size).toBe(2);
  });
});

describe('fields, sections and the rest', () => {
  const fld = (instr: string, result: string) =>
    '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' + `<w:r><w:instrText xml:space="preserve"> ${instr} </w:instrText></w:r>` + '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' + r(result) + '<w:r><w:fldChar w:fldCharType="end"/></w:r>';

  /** A field that is still open: its result is the paragraphs that follow, up to the one that ends it. */
  const open = (instr: string) =>
    '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' + `<w:r><w:instrText xml:space="preserve"> ${instr} </w:instrText></w:r>` + '<w:r><w:fldChar w:fldCharType="separate"/></w:r>';

  it('replaces a table of contents with the node and the headings it would list', () => {
    const sheet = styles(style('Heading1', 'heading 1', '<w:pPr><w:outlineLvl w:val="0"/></w:pPr>') + style('TOC1', 'toc 1'));
    const h = (t: string) => p(r(t), '<w:pStyle w:val="Heading1"/>');
    const b = body({
      styles: sheet,
      body: p(open('TOC \\o "1-3" \\h') + r('Intro 1')) + p(r('Chapter two 3'), '<w:pStyle w:val="TOC1"/>') + p('<w:r><w:fldChar w:fldCharType="end"/></w:r>') + h('Intro') + h('Chapter two')
    });
    expect(b.content!.map((n) => n.type)).toEqual(['tableOfContents', 'heading', 'heading']);
    expect(JSON.parse(first(b).attrs!.entries)).toEqual([{ level: 1, text: 'Intro' }, { level: 1, text: 'Chapter two' }]);
  });

  it('reads headers and footers with their page fields', () => {
    const hdr = `<w:ftr ${W}><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t xml:space="preserve">Page </w:t></w:r>${fld('PAGE', '1')}<w:r><w:t xml:space="preserve"> of </w:t></w:r><w:fldSimple w:instr=" NUMPAGES "><w:r><w:t>9</w:t></w:r></w:fldSimple></w:p></w:ftr>`;
    const res = read({
      footers: { footer1: hdr },
      rels: [],
      body: p(r('body')) + '<w:sectPr><w:footerReference w:type="default" r:id="rid-footer1"/><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720"/></w:sectPr>'
    });
    expect(res.model.footer.default).toEqual({
      type: 'doc',
      content: [{ type: 'paragraph', attrs: { textAlign: 'center' }, content: [{ type: 'text', text: 'Page ' }, { type: 'pageField', attrs: { kind: 'page' } }, { type: 'text', text: ' of ' }, { type: 'pageField', attrs: { kind: 'pages' } }] }]
    });
  });

  it('reads the first section’s paper, orientation, margins and first-page setting', () => {
    const sect = (w: number, h: number, extra = '') => `<w:sectPr><w:pgSz w:w="${w}" w:h="${h}"${extra}/><w:pgMar w:top="1134" w:right="1701" w:bottom="1134" w:left="1701" w:header="709" w:footer="709"/><w:titlePg/></w:sectPr>`;
    const a4 = read({ body: p(r('x')) + sect(11906, 16838) }).model.page!;
    expect(a4).toMatchObject({ size: 'A4', orientation: 'portrait', differentFirst: true, margins: { top: 20, right: 30, bottom: 20, left: 30 }, headerDistance: 12.5 });
    const land = read({ body: p(r('x')) + sect(15840, 12240, ' w:orient="landscape"') }).model.page!;
    expect(land).toMatchObject({ size: 'Letter', orientation: 'landscape' });
    const a3 = read({ body: p(r('x')) + sect(16838, 23811) });
    expect(a3.model.page!.size).toBe('A4');
    expect(a3.warnings.map((w) => w.message)).toContain('The page size was changed to A4.');
  });

  it('breaks pages at a section break and not at a continuous one', () => {
    const sect = (type?: string) => `<w:sectPr>${type ? `<w:type w:val="${type}"/>` : ''}<w:pgSz w:w="12240" w:h="15840"/></w:sectPr>`;
    // How a section *begins* is its own type, so the break after the first paragraph is decided by the second section's.
    const nextPage = body({ body: p(r('a'), sect()) + p(r('b'), sect()) + sect() });
    expect(nextPage.content!.map((n) => n.type)).toEqual(['paragraph', 'pageBreak', 'paragraph']);
    const continuous = body({ body: p(r('a'), sect()) + p(r('b'), sect('continuous')) + sect() });
    expect(continuous.content!.map((n) => n.type)).toEqual(['paragraph', 'paragraph']);
  });

  it('reads through content controls and smart tags, and takes the first choice of an alternate', () => {
    const b = body({
      body:
        '<w:sdt><w:sdtContent>' + p(r('in a control')) + '</w:sdtContent></w:sdt>' +
        p('<w:smartTag w:uri="x" w:element="place">' + r('Oslo') + '</w:smartTag>' + '<mc:AlternateContent><mc:Choice Requires="w14"><w:r><w:t>chosen</w:t></w:r></mc:Choice><mc:Fallback><w:r><w:t>fallback</w:t></w:r></mc:Fallback></mc:AlternateContent>')
    });
    expect(allText(b)).toContain('in a control');
    expect(allText(b)).toContain('Oslo');
  });

  it('keeps the paragraphs of a text box, after the one it was anchored in', () => {
    const box = '<w:r><w:drawing><wp:anchor><a:graphic><a:graphicData><wps:wsp xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"><wps:txbx><w:txbxContent>' + p(r('Boxed')) + '</w:txbxContent></wps:txbx></wps:wsp></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r>';
    const res = read({ body: p(r('Anchor') + box) });
    expect(res.model.body.content!.map((n) => allText(n))).toEqual(['Anchor', 'Boxed']);
    expect(res.warnings.map((w) => w.code)).toContain('textbox');
  });

  it('reads an equation as its text, and says so', () => {
    const res = read({ body: p('<m:oMath xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"><m:r><m:t>x+1</m:t></m:r></m:oMath>') });
    expect(allText(res.model.body)).toBe('x+1');
    expect(res.warnings.map((w) => w.code)).toContain('math');
  });

  it('reads a form checkbox as its box', () => {
    const box = (checked: boolean) =>
      `<w:r><w:fldChar w:fldCharType="begin"><w:ffData><w:checkBox><w:default w:val="${checked ? 1 : 0}"/></w:checkBox></w:ffData></w:fldChar></w:r><w:r><w:instrText> FORMCHECKBOX </w:instrText></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>`;
    expect(allText(body({ body: p(box(true) + box(false)) }))).toBe('☒☐');
  });

  it('takes a picture with its size, its alt text and the paragraph’s alignment', () => {
    const drawing = '<w:r><w:drawing><wp:inline><wp:extent cx="1905000" cy="952500"/><wp:docPr id="1" name="Picture 1" descr="A small square"/><a:graphic><a:graphicData><pic:pic><pic:blipFill><a:blip r:embed="rImg"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>';
    const res = read({ body: p(drawing, '<w:jc w:val="center"/>'), rels: [{ id: 'rImg', type: 'image', target: 'media/a.png' }], files: { 'word/media/a.png': PNG_1PX } });
    expect(first(res.model.body)).toEqual({ type: 'image', attrs: { src: 'import:1', alt: 'A small square', width: 200, height: 100, align: 'center' } });
    expect([...res.images.values()][0]).toMatchObject({ mime: 'image/png' });
  });

  it('leaves a picture in a header out and says so', () => {
    const hdr = `<w:hdr ${NS}><w:p><w:r><w:drawing><wp:inline><a:graphic><a:graphicData><pic:pic><pic:blipFill><a:blip r:embed="rImg"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p></w:hdr>`;
    const res = read({ headers: { header1: hdr }, body: p(r('x')) + '<w:sectPr><w:headerReference w:type="default" r:id="rid-header1"/></w:sectPr>' });
    expect(res.model.header.default).toBeUndefined();
    expect(res.warnings.map((w) => w.code)).toContain('hf-image');
  });

  it('reads a document with nothing in it as one empty paragraph', () => {
    expect(body({ body: '' })).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] });
  });
});

describe('contextual spacing', () => {
  const sheet = styles(style('ListParagraph', 'List Paragraph', '<w:pPr><w:spacing w:after="200"/><w:contextualSpacing/></w:pPr>'));
  const sp = (t: string) => p(r(t), '<w:pStyle w:val="ListParagraph"/>');

  it('takes the space out between paragraphs of a style that asks for it, and keeps it at the ends', () => {
    const b = body({ styles: sheet, body: sp('a') + sp('b') + sp('c') });
    expect(b.content!.map((n) => n.attrs?.spaceAfter)).toEqual([undefined, undefined, 10]);
  });

  it('leaves the space when the neighbour is another style', () => {
    const b = body({ styles: sheet, body: sp('a') + p(r('plain')) });
    expect(b.content![0]!.attrs?.spaceAfter).toBe(10);
  });
});

describe('lists nested by indent', () => {
  const lvl = (left: number) => `<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:pPr><w:ind w:left="${left}" w:hanging="360"/></w:pPr></w:lvl>`;
  const numbering = `<w:numbering ${W}><w:abstractNum w:abstractNumId="0">${lvl(720)}</w:abstractNum><w:abstractNum w:abstractNumId="1">${lvl(1440)}</w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num><w:num w:numId="3"><w:abstractNumId w:val="0"/></w:num></w:numbering>`;
  const li = (num: number, t: string, extra = '') => p(r(t), `<w:numPr><w:ilvl w:val="0"/><w:numId w:val="${num}"/></w:numPr>${extra}`);

  it('puts a list of its own that sits further in inside the list before it', () => {
    const b = body({ numbering, body: li(1, 'a') + li(2, 'b') + li(2, 'c') + li(1, 'd') });
    expect(outline(b)).toEqual([
      'bulletList',
      '  listItem',
      '    paragraph "a"',
      '    bulletList',
      '      listItem',
      '        paragraph "b"',
      '      listItem',
      '        paragraph "c"',
      '  listItem',
      '    paragraph "d"'
    ]);
  });

  it('keeps two lists at the same indent as two lists, and takes the paragraph’s own indent over the level’s', () => {
    expect(body({ numbering, body: li(1, 'a') + li(3, 'b') }).content).toHaveLength(2);
    const b = body({ numbering, body: li(1, 'a') + li(3, 'b', '<w:ind w:left="2000"/>') });
    expect(b.content).toHaveLength(1);
  });
});
