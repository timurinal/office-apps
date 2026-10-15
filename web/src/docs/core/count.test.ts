// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { countRange, formatCount } from './count';
import { chipText, formatDay, isIsoDay, isoDay } from './chipText';
import { outlineOf, sectionAt } from './outline';
import { docOf, h, makeEditor, p, select, type TestEditor } from './testing';

let t: TestEditor;
afterEach(() => t?.destroy());

describe('counting', () => {
  it('counts words as Word does: runs between spaces', () => {
    t = makeEditor(docOf(p('Ship the course library.'), p('  spaced   out   '), p('')));
    expect(countRange(t.editor.state.doc)).toMatchObject({ words: 6, paragraphs: 2 });
  });

  it('counts characters with and without spaces', () => {
    t = makeEditor(docOf(p('ab cd'), p('e f')));
    expect(countRange(t.editor.state.doc)).toMatchObject({ characters: 8, charactersNoSpaces: 6 });
  });

  it('never joins words across blocks', () => {
    t = makeEditor(docOf(p('end.'), p('Start')));
    expect(countRange(t.editor.state.doc).words).toBe(2);
  });

  it('counts a chip as the words it shows, and a mention as one', () => {
    t = makeEditor(
      docOf({ type: 'paragraph', content: [{ type: 'text', text: 'Due ' }, { type: 'dateChip', attrs: { date: '2026-10-14' } }, { type: 'text', text: ' from ' }, { type: 'mention', attrs: { id: 'u1', label: 'Priya' } }] })
    );
    // "Due" "14 Oct 2026" (three words) "from" "@Priya"
    expect(countRange(t.editor.state.doc).words).toBe(6);
  });

  it('counts a selection, cutting a block where the selection does', () => {
    t = makeEditor(docOf(p('alpha beta gamma'), p('delta epsilon')));
    select(t.editor, 'beta gamma');
    const { from, to } = t.editor.state.selection;
    expect(countRange(t.editor.state.doc, from, to)).toMatchObject({ words: 2, paragraphs: 1, characters: 10 });
    t.editor.commands.selectAll();
    expect(countRange(t.editor.state.doc, 0, t.editor.state.doc.content.size).words).toBe(5);
  });

  it('counts text in a table and a list, which are blocks inside blocks', () => {
    t = makeEditor(
      docOf(
        { type: 'bulletList', content: [{ type: 'listItem', content: [p('one two')] }] },
        { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [p('three')] }, { type: 'tableCell', content: [p('four five')] }] }] }
      )
    );
    expect(countRange(t.editor.state.doc)).toMatchObject({ words: 5, paragraphs: 3 });
  });

  it('is quick on a 50-page document', () => {
    const para = p('Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt. '.repeat(6));
    t = makeEditor(docOf(...Array.from({ length: 400 }, () => para)));
    const start = performance.now();
    const c = countRange(t.editor.state.doc);
    expect(performance.now() - start).toBeLessThan(150);
    expect(c.words).toBeGreaterThan(25_000);
  });

  it('writes numbers the way the rest of the product does', () => {
    expect(formatCount(1284)).toBe('1,284');
    expect(formatCount(0)).toBe('0');
  });
});

describe('the outline', () => {
  it('lists headings in order, with their level and where they start', () => {
    t = makeEditor(docOf(p('Intro text'), h(1, 'Goals'), p('body'), h(2, 'Milestones'), h(3, '  '), h(2, 'Risks')));
    const items = outlineOf(t.editor.state.doc);
    expect(items.map((i) => [i.level, i.text])).toEqual([
      [1, 'Goals'],
      [2, 'Milestones'],
      [2, 'Risks']
    ]);
    expect(t.editor.state.doc.textBetween(items[1]!.pos, items[1]!.pos + 3)).toBe('Mil');
  });

  it('finds headings in a list item or a table cell, and not in a code block, and leaves Title out', () => {
    t = makeEditor(
      docOf(
        p('A title', { paraStyle: 'title' }),
        { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [h(2, 'In a cell')] }] }] },
        { type: 'codeBlock', content: [{ type: 'text', text: '# not a heading' }] }
      )
    );
    expect(outlineOf(t.editor.state.doc).map((i) => i.text)).toEqual(['In a cell']);
  });

  it('says which section the caret is in', () => {
    t = makeEditor(docOf(p('before'), h(1, 'One'), p('inside one'), h(1, 'Two'), p('inside two')));
    const items = outlineOf(t.editor.state.doc);
    select(t.editor, 'before');
    expect(sectionAt(items, t.editor.state.selection.from)).toBe(-1);
    select(t.editor, 'inside one');
    expect(sectionAt(items, t.editor.state.selection.from)).toBe(0);
    select(t.editor, 'inside two');
    expect(sectionAt(items, t.editor.state.selection.from)).toBe(1);
  });
});

describe('what a chip says', () => {
  it('formats a day in the product’s way and refuses a day that does not exist', () => {
    expect(formatDay('2026-10-14')).toBe('14 Oct 2026');
    expect(formatDay('2026-02-30')).toBe('2026-02-30');
    expect(formatDay('nope')).toBe('nope');
    expect(isIsoDay('2026-10-14')).toBe(true);
    expect(isIsoDay('2026-13-01')).toBe(false);
    expect(isIsoDay('14/10/2026')).toBe(false);
  });

  it('gives today, plus or minus days, in the reader’s calendar, across a month end', () => {
    const at = new Date(2026, 9, 31, 23, 30);
    expect(isoDay(0, at)).toBe('2026-10-31');
    expect(isoDay(1, at)).toBe('2026-11-01');
    expect(isoDay(-31, at)).toBe('2026-09-30');
  });

  it('reads each chip as text, and anything else as nothing', () => {
    expect(chipText('mention', { label: 'Priya Shah' })).toBe('@Priya Shah');
    expect(chipText('dateChip', { date: '2026-10-14' })).toBe('14 Oct 2026');
    expect(chipText('docLink', { title: 'Q4 plan' })).toBe('Q4 plan');
    expect(chipText('image', {})).toBeNull();
  });
});
