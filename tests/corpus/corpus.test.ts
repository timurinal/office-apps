/**
 * The fidelity corpus: real documents, and documents made to cover each feature, read by our
 * importer, written by our exporter, and read again.
 *
 * Three things are asserted, in this order of importance:
 *
 *   1. what each file *is*: the key properties the importer must find in it (a table of what
 *      is in each file, so a regression names the feature that broke);
 *   2. that the round trip holds: import, export, re-import, and the two models agree, apart
 *      from the differences `normalised` documents;
 *   3. that what does not belong in a document is refused.
 *
 * The generated files are in docx/ (python-docx and the `docx` package; tests/corpus/README.md
 * and generate/ say how). The real-world ones are in docx/real/ with their sources and
 * licences. docx/hostile/ holds files that must be refused.
 */

import { describe, expect, it } from 'vitest';
import { isFormatError } from '../../web/src/formats/errors';
import { readDocx } from '../../web/src/formats/docx/read';
import { writeDocx } from '../../web/src/formats/docx/write';
import { importDocument } from '../../web/src/formats/import';
import { exportDocument } from '../../web/src/formats/export';
import { readHtml } from '../../web/src/formats/html/read';
import { readMarkdown } from '../../web/src/formats/markdown/read';
import type { ExportComment, ImportResult, JSONContent } from '../../web/src/formats/types';
import { allText, bytesOf, CORPUS_DIR, countNodes, listDocx, normalisedOutline, wordsOf } from './helpers';
import { join } from 'node:path';

const load = (name: string): ImportResult => readDocx(bytesOf(join(CORPUS_DIR, name)));
const marks = (n: JSONContent, type: string): JSONContent[] => {
  const out: JSONContent[] = [];
  const walk = (x: JSONContent) => {
    for (const m of x.marks ?? []) if (m.type === type) out.push(m);
    (x.content ?? []).forEach(walk);
  };
  walk(n);
  return out;
};
const find = (n: JSONContent, type: string): JSONContent[] => [...(n.type === type ? [n] : []), ...(n.content ?? []).flatMap((c) => find(c, type))];

describe('generated corpus: what each file holds', () => {
  it('01 formatting: marks, fonts, alignment, spacing and indent', () => {
    const { model } = load('01-formatting.docx');
    expect(model.body.content![0]).toMatchObject({ type: 'heading', attrs: { level: 1 } });
    const types = new Set(['bold', 'italic', 'underline', 'strike', 'subscript', 'superscript', 'highlight'].filter((t) => marks(model.body, t).length > 0));
    expect([...types].sort()).toEqual(['bold', 'highlight', 'italic', 'strike', 'subscript', 'superscript', 'underline']);
    expect(marks(model.body, 'textStyle').map((m) => m.attrs)).toContainEqual({ fontFamily: 'Georgia', fontSize: '16pt', color: '#8e1f1f' });
    expect(marks(model.body, 'textStyle').map((m) => m.attrs)).toContainEqual({ fontFamily: 'Courier New', fontSize: '9pt' });
    expect(marks(model.body, 'highlight')[0]!.attrs).toEqual({ color: '#ffff00' });
    expect(find(model.body, 'paragraph').map((p) => p.attrs?.textAlign).filter(Boolean)).toEqual(['center', 'right', 'justify']);
    expect(find(model.body, 'paragraph').find((p) => p.attrs?.spaceBefore === 18)!.attrs).toMatchObject({ spaceBefore: 18, spaceAfter: 6, lineHeight: 2 });
    expect(find(model.body, 'paragraph').map((p) => p.attrs?.indent).filter(Boolean)).toEqual([2, 4]);
  });

  it('02 lists: bullets and numbers, and the second level of each nested in the first', () => {
    const { model } = load('02-lists.docx');
    const lists = model.body.content!.filter((n) => n.type === 'bulletList' || n.type === 'orderedList');
    expect(lists.map((l) => l.type)).toEqual(['bulletList', 'orderedList', 'bulletList']);
    expect(lists[0]!.content).toHaveLength(3);
    expect(find(lists[0]!.content![1]!, 'bulletList')).toHaveLength(1);
    expect(find(lists[1]!, 'orderedList')).toHaveLength(2);
  });

  it('03 tables: header row, fill, spans across and down, a table in a cell', () => {
    const { model } = load('03-tables.docx');
    const tables = find(model.body, 'table');
    expect(tables).toHaveLength(4);
    expect(find(tables[0]!, 'tableHeader').map((c) => c.attrs?.backgroundColor)).toEqual(['#dbe7fd', '#dbe7fd', '#dbe7fd']);
    expect(find(tables[1]!, 'tableCell').map((c) => [c.attrs?.colspan ?? 1, c.attrs?.rowspan ?? 1])).toEqual([[4, 1], [1, 3], [2, 1], [1, 1], [1, 1], [1, 1], [1, 1], [1, 1], [1, 1], [1, 1]]);
    // The outer table's second cell holds the inner table, and a paragraph after it.
    const inner = tables[2]!.content![0]!.content![1]!;
    // python-docx leaves an empty paragraph on either side of the inner table, and then there is the one it added.
    expect(inner.content!.map((n) => n.type)).toEqual(['paragraph', 'table', 'paragraph', 'paragraph']);
  });

  it('04 images: five pictures in six places, one of them centred and described', () => {
    const { model, images } = load('04-images.docx');
    expect(images.size).toBe(5);
    expect([...images.values()].map((i) => i.mime)).toEqual(['image/png', 'image/png', 'image/jpeg', 'image/gif', 'image/png']);
    const nodes = find(model.body, 'image');
    expect(nodes).toHaveLength(6);
    expect(nodes.filter((n) => n.attrs?.src === 'import:5')).toHaveLength(2);
    expect(nodes.find((n) => n.attrs?.align === 'center')!.attrs).toMatchObject({ alt: 'A centred orange gradient', width: 288, height: 144 });
    expect(allText(model.body)).toContain('A picture in the middle of a sentence');
  });

  it('05 comments: two threads, one across two runs', () => {
    const { comments, model } = load('05-comments.docx');
    expect(comments.map((c) => [c.author, c.text])).toEqual([['Ben Okoro', 'Is this the right word?'], ['Ada Rowe', 'Check the figure.\nSee the appendix.']]);
    const text = allText(model.body);
    expect(text.slice(comments[0]!.start, comments[0]!.end)).toBe('The first sentence has a comment on this phrase and then carries on. ');
    expect(text.slice(comments[1]!.start, comments[1]!.end)).toBe('A second sentence, partly bold, with a comment spanning two runs.');
  });

  it('06 page setup: Letter landscape, margins, a first page of its own, fields in the footer', () => {
    const { model } = load('06-page-setup.docx');
    expect(model.page).toEqual({ size: 'Letter', orientation: 'landscape', margins: { top: 25.4, right: 19.1, bottom: 22.9, left: 19.1 }, headerDistance: 10.2, footerDistance: 10.2, differentFirst: true });
    expect(allText(model.header.default!)).toBe('Quarterly report');
    expect(allText(model.header.first!)).toBe('Title page header');
    expect(allText(model.footer.first!)).toBe('First page footer');
    expect(find(model.footer.default!, 'pageField').map((f) => f.attrs!.kind)).toEqual(['page', 'pages']);
    expect(allText(model.footer.default!)).toBe('Page  of ');
  });

  it('07 styles: the named ones, a custom one baked in, one based on a heading', () => {
    const { model } = load('07-styles.docx');
    const kinds = model.body.content!.map((n) => (n.type === 'heading' ? `h${n.attrs!.level}` : (n.attrs?.paraStyle ?? n.type)));
    expect(kinds).toEqual(['title', 'subtitle', 'h1', 'h2', 'h3', 'h4', 'paragraph', 'blockquote', 'nospacing', 'nospacing', 'paragraph', 'paragraph', 'h2', 'paragraph']);
    expect(model.body.content![7]!.content).toHaveLength(2);
    const custom = model.body.content![10]!;
    expect(custom.attrs).toMatchObject({ textAlign: 'center' });
    expect(marks(custom, 'bold')).toHaveLength(1);
    expect(marks(custom, 'textStyle')[0]!.attrs).toMatchObject({ fontSize: '13pt', color: '#1f4ea8' });
    expect(marks(model.body.content![11]!, 'italic')).toHaveLength(1);
    expect(marks(model.body.content![13]!, 'textStyle').map((m) => m.attrs!.color)).toContain('#c0501c');
  });

  it('08 breaks and sections: a break for each, none for the continuous one, one warning for the landscape', () => {
    const { model, warnings } = load('08-breaks-sections.docx');
    expect(countNodes(model.body, 'pageBreak')).toBe(4);
    expect(warnings.map((w) => w.code)).toEqual(['sections']);
  });

  it('09 many scripts, tabs and breaks: every character kept', () => {
    const { model } = load('09-unicode.docx');
    const text = allText(model.body);
    for (const s of ['Árvíztűrő tükörfúrógép', 'Съешь же ещё этих мягких', 'Ξεσκεπάζω την ψυχοφθόρα', '日本語のテキスト、中文文本、한국어 텍스트。', 'نص عربي بسيط يُقرأ من اليمين إلى اليسار.', 'טקסט עברי פשוט', '🙂 🚀 ✅', '🇳🇴', '© ® ™', 'after a tab\tand another', 'non-breaking space', 'non‑breaking hyphen', 'x'.repeat(120)]) {
      expect(text, s).toContain(s);
    }
    expect(countNodes(model.body, 'hardBreak')).toBe(1);
  });

  it('10 a long document: 12 chapters, 36 sections, 12 tables, and it opens in the room’s limits', () => {
    const out = importDocument('long.docx', bytesOf(join(CORPUS_DIR, '10-large.docx')));
    const { model } = load('10-large.docx');
    expect(find(model.body, 'heading').filter((h) => h.attrs!.level === 1)).toHaveLength(12);
    expect(find(model.body, 'heading').filter((h) => h.attrs!.level === 2)).toHaveLength(36);
    expect(find(model.body, 'table')).toHaveLength(12);
    expect(out.state.byteLength).toBeLessThan(500_000);
  });

  it('11 links and footnotes: two links kept, two refused and left as text, three notes', () => {
    const { model, warnings } = load('11-links-footnotes.docx');
    expect(marks(model.body, 'link').map((m) => m.attrs!.href)).toEqual(['https://example.com/office?from=corpus', 'mailto:hello@example.com']);
    expect(allText(model.body)).toContain('click for a prize');
    expect(allText(model.body)).toContain('inline page');
    expect(warnings.map((w) => w.code)).toEqual(['link']);
    expect(find(model.body, 'footnote').map((f) => allText(f))).toEqual(['The first note, with some detail.', 'A second note.', 'The third note, at the end of the paragraph.']);
  });

  it('12 tracked changes: a replacement is one suggestion; the others are their own', () => {
    const { model } = load('12-tracked-changes.docx');
    const ins = marks(model.body, 'insertion');
    const del = marks(model.body, 'deletion');
    expect(ins.map((m) => m.attrs!.authorName)).toEqual(['Ben Okoro', 'Ada Rowe']);
    expect(del.map((m) => m.attrs!.authorName)).toEqual(['Ben Okoro', 'Ada Rowe']);
    expect(del[0]!.attrs!.id).toBe(ins[0]!.attrs!.id);
    expect(new Set([ins[1]!.attrs!.id, del[1]!.attrs!.id, ins[0]!.attrs!.id]).size).toBe(3);
    expect(ins[0]!.attrs!.at).toBe(Date.parse('2026-03-04T10:00:00Z'));
  });

  it('13 numbering: legal, roman, a start, a continuation, bullets with children', () => {
    const { model } = load('13-numbering.docx');
    const lists = model.body.content!.filter((n) => n.type === 'orderedList' || n.type === 'bulletList');
    expect(lists.map((l) => [l.type, JSON.stringify(l.attrs ?? {})])).toEqual([
      ['orderedList', '{"format":"legal"}'],
      ['orderedList', '{"type":"I"}'],
      ['orderedList', '{"start":5}'],
      ['orderedList', '{"type":"A"}'],
      ['orderedList', '{"start":3,"type":"A"}'],
      ['bulletList', '{}']
    ]);
    expect(find(lists[0]!, 'orderedList')).toHaveLength(3);
  });

  it('14 threaded comments: two replies to one, a resolved one, ranges on the same text', () => {
    const { comments, model } = load('14-threaded-comments.docx');
    expect(comments.map((c) => [c.text, c.parent, c.resolved])).toEqual([['Should this say "ship" instead?', null, false], ['Yes, changed.', '1', false], ['Thanks.', '1', false], ['Resolved already.', null, true]]);
    const text = allText(model.body);
    expect(text.slice(comments[0]!.start, comments[0]!.end)).toBe('deliver the release');
    expect(text.slice(comments[3]!.start, comments[3]!.end)).toBe('under budget');
    expect([comments[1]!.start, comments[1]!.end]).toEqual([comments[0]!.start, comments[0]!.end]);
  });

  it('15 a table of contents: the node, with the headings Word would list', () => {
    const { model } = load('15-toc-fields.docx');
    const toc = find(model.body, 'tableOfContents')[0]!;
    expect(JSON.parse(toc.attrs!.entries)).toEqual([{ level: 1, text: 'First chapter' }, { level: 2, text: 'A subsection' }, { level: 1, text: 'Second chapter' }]);
    expect(allText(model.body)).toContain('Today is 4 March 2026.');
  });
});

describe('real-world corpus: what each file holds', () => {
  const real = (name: string) => readDocx(bytesOf(join(CORPUS_DIR, 'real', name)));

  it('ComplexNumberedLists: restarts and continuations', () => {
    const lists = real('ComplexNumberedLists.docx').model.body.content!.filter((n) => n.type === 'orderedList');
    expect(lists.map((l) => l.attrs?.start ?? 1)).toEqual([1, 1, 10, 12]);
    expect(find(lists[0]!.content![1]!, 'orderedList')).toHaveLength(1);
  });

  it('delins: tracked insertions and deletions by one author, over links and lists', () => {
    const { model } = real('delins.docx');
    expect(new Set([...marks(model.body, 'insertion'), ...marks(model.body, 'deletion')].map((m) => m.attrs!.authorName))).toEqual(new Set(['pavel']));
    expect(marks(model.body, 'insertion').length).toBeGreaterThan(10);
    expect(marks(model.body, 'deletion').length).toBeGreaterThan(3);
    expect(marks(model.body, 'link').length).toBeGreaterThan(10);
  });

  it('footnotes and table_footnotes: the note’s text, in a paragraph and in a cell', () => {
    expect(find(real('footnotes.docx').model.body, 'footnote').map(allText)).toEqual(['snoska']);
    expect(find(find(real('table_footnotes.docx').model.body, 'table')[0]!, 'footnote').map(allText)).toEqual(['snoska']);
  });

  it('comments-rich-para: four comments with their authors', () => {
    const { comments } = real('comments-rich-para.docx');
    expect(comments).toHaveLength(4);
    expect(comments[0]).toMatchObject({ author: 'Steve Canny', text: 'Text with hyperlink https://google.com embedded.' });
  });

  it('WithGIF: a picture, kept as a GIF, ahead of its text', () => {
    const { model, images } = real('WithGIF.docx');
    expect([...images.values()].map((i) => i.mime)).toEqual(['image/gif']);
    expect(model.body.content![0]!.type).toBe('image');
  });

  it('rtl: Arabic text kept, with its links', () => {
    const { model } = real('rtl.docx');
    expect(allText(model.body)).toContain('إسبانيا');
    expect(marks(model.body, 'link').length).toBeGreaterThan(2);
  });

  it('sct-first-page-hdrftr: section breaks become page breaks, headers are read', () => {
    const { model } = real('sct-first-page-hdrftr.docx');
    expect(countNodes(model.body, 'pageBreak')).toBe(5);
    expect(model.header.default).toBeDefined();
  });

  it('shapes-with-text: the text of floating boxes, and a warning for what has no place', () => {
    const { model, warnings } = real('shapes-with-text.docx');
    expect(allText(model.body)).toContain('Floating text box');
    expect(allText(model.body)).toContain('A square shape with text inside');
    expect(warnings.map((w) => w.code).sort()).toEqual(['shape', 'textbox']);
  });

  it('checkboxes: a form field is its box, and a picture in a header is left out and said so', () => {
    expect(allText(real('checkboxes.docx').model.body)).toMatch(/[☐☒]/);
    expect(real('headerPic.docx').warnings.map((w) => w.code)).toEqual(['hf-image']);
  });

  it('FieldCodes: the result of a field is its text', () => {
    expect(allText(real('FieldCodes.docx').model.body)).toContain('16 June 2010');
  });

  it('tbl-having-tables: three tables, none of them lost', () => {
    expect(find(real('tbl-having-tables.docx').model.body, 'table').length).toBe(3);
  });
});

describe('round trip: import, export, re-import', () => {
  const files = [...listDocx(CORPUS_DIR), ...listDocx(join(CORPUS_DIR, 'real'))];

  for (const file of files) {
    const name = file.slice(CORPUS_DIR.length + 1);
    it(`${name} comes back the same`, async () => {
      const first = readDocx(bytesOf(file));
      const comments: ExportComment[] = [];
      const { bytes, warnings } = await writeDocx(first.model, { title: 'Round trip', resolveImage: (src) => first.images.get(src) ?? null, comments });
      const second = readDocx(bytes);
      expect(warnings, 'the exporter left something out').toEqual([]);

      if (name.startsWith('15-')) {
        // A table of contents is written as its entries: the one thing that does not come back as it was.
        const words = wordsOf(second.model.body);
        for (const w of ['Contents', 'First', 'chapter', 'subsection', 'Second']) expect(words).toContain(w);
        expect(find(second.model.body, 'heading').map(allText)).toEqual(['Contents', 'First chapter', 'A subsection', 'Second chapter']);
      } else {
        expect(normalisedOutline(second.model)).toEqual(normalisedOutline(first.model));
      }
      expect(second.model.page).toEqual(first.model.page);
      expect(second.model.header).toEqual(first.model.header);
      expect(second.model.footer).toEqual(first.model.footer);
      expect(second.images.size, 'distinct pictures').toBeGreaterThanOrEqual(first.images.size);
      expect(find(second.model.body, 'image').length, 'pictures in the text').toBe(find(first.model.body, 'image').length);
      expect(find(second.model.body, 'footnote').length, 'footnotes').toBe(find(first.model.body, 'footnote').length);
      if (!name.startsWith('15-')) expect(wordsOf(second.model.body).join(' ')).toContain(wordsOf(first.model.body).slice(0, 25).join(' '));
    });
  }

  it('keeps comments through an export that is given them, with their replies and where they sit', async () => {
    const first = load('14-threaded-comments.docx');
    const text = allText(first.model.body);
    const root = first.comments[0]!;
    const comments: ExportComment[] = [
      { id: 'a', author: root.author, at: root.at, text: root.text, resolved: false, start: root.start, end: root.end, replies: first.comments.slice(1, 3).map((c) => ({ author: c.author, at: c.at, text: c.text })) },
      { id: 'b', author: first.comments[3]!.author, at: first.comments[3]!.at, text: first.comments[3]!.text, resolved: true, start: first.comments[3]!.start, end: first.comments[3]!.end, replies: [] }
    ];
    const { bytes } = await writeDocx(first.model, { title: 't', comments });
    const second = readDocx(bytes);
    expect(second.comments.map((c) => [c.author, c.text, c.parent !== null, c.resolved])).toEqual(first.comments.map((c) => [c.author, c.text, c.parent !== null, c.resolved]));
    expect(text.slice(second.comments[0]!.start, second.comments[0]!.end)).toBe('deliver the release');
    expect(text.slice(second.comments[3]!.start, second.comments[3]!.end)).toBe('under budget');
  });
});

describe('the other formats, from the corpus', () => {
  const files = listDocx(CORPUS_DIR).filter((f) => !/10-large/.test(f));

  for (const file of files) {
    const name = file.slice(CORPUS_DIR.length + 1);
    it(`${name} exports to Markdown, HTML and text that say what it says`, async () => {
      const { model, images } = readDocx(bytesOf(file));
      const opts = { title: 'x', resolveImage: (src: string) => images.get(src) ?? null };
      const md = new TextDecoder().decode((await exportDocument('markdown', model, opts)).bytes);
      const html = new TextDecoder().decode((await exportDocument('html', model, opts)).bytes);
      const txt = new TextDecoder().decode((await exportDocument('text', model, opts)).bytes);
      const keep = (all: string[]) => all.filter((w) => /^\p{L}{5,}$/u.test(w) && !/^(?:Paragraph|Chapter|Section)$/.test(w)).slice(0, 6);
      // Text and Markdown say the document as if every suggestion were accepted: a deletion is not in them.
      for (const w of keep(wordsOf(model.body, [], true))) {
        expect(txt, `text lacks ${w}`).toContain(w);
        // Markdown may have split or escaped a word, never lost it.
        expect(md.replace(/[\\*_]/g, ''), `markdown lacks ${w}`).toContain(w);
      }
      for (const w of keep(wordsOf(model.body))) expect(html, `html lacks ${w}`).toContain(w);
      expect(html).not.toMatch(/javascript:|<script/i);
      expect(md).not.toMatch(/javascript:/i);
    });
  }

  it('what HTML and Markdown write, they read back as the same paragraphs and headings', async () => {
    const { model } = load('07-styles.docx');
    const html = new TextDecoder().decode((await exportDocument('html', model, { title: 'x' })).bytes);
    const md = new TextDecoder().decode((await exportDocument('markdown', model, { title: 'x' })).bytes);
    const headings = (b: JSONContent) => find(b, 'heading').map((h) => `${h.attrs!.level}:${allText(h)}`);
    expect(headings(readHtml(html).model.body)).toEqual(headings(model.body));
    // Markdown has no Title: it is a first-level heading there.
    expect(headings(readMarkdown(md).model.body)).toEqual(['1:A title', ...headings(model.body)]);
  });
});

describe('hostile files are refused', () => {
  const hostile = (name: string) => bytesOf(join(CORPUS_DIR, 'hostile', name));
  const code = (fn: () => unknown) => {
    try {
      fn();
    } catch (e) {
      return isFormatError(e) ? e.code : 'other';
    }
    return 'accepted';
  };

  it('ExternalEntityInText (Apache POI’s XXE test): a doctype with an entity, refused', () => {
    expect(code(() => readDocx(hostile('ExternalEntityInText.docx')))).toBe('xml_unsafe');
    expect(code(() => importDocument('x.docx', hostile('ExternalEntityInText.docx')))).toBe('xml_unsafe');
  });

  it('deep-table-cell (Apache POI’s fuzzer find): nested past the parser’s bound, refused', () => {
    expect(code(() => readDocx(hostile('deep-table-cell.docx')))).toBe('zip_limit');
  });
});
