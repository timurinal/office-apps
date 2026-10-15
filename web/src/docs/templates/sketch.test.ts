import { describe, expect, it } from 'vitest';
import type { JSONContent } from '@tiptap/core';
import { bullets, checklist, h2, line, numbered, p, pageBreak, para, quote, rule, subtitle, table, title } from './build';
import { DOCS_TEMPLATES, predefinedId, sketchFor } from './index';
import { heightOf, SKETCH_GAP, SKETCH_HEIGHT, sketchOf } from './sketch';

const heightUsed = (rows: ReturnType<typeof sketchOf>['rows']): number =>
  rows.reduce((n, r, i) => n + (i ? SKETCH_GAP : 0) + (r.t === 'heading' && i > 0 ? 4 : 0) + heightOf(r), 0);

describe('the sketch of a page', () => {
  it('draws a title in the 700, a heading in the 300 and text in lines', () => {
    const { rows } = sketchOf([title('Plan'), h2('Goal'), p('What this project changes, in a sentence or two.')]);
    expect(rows.map((r) => r.t)).toEqual(['title', 'heading', 'line']);
  });

  it('draws a short line short and a long paragraph across the page and then a shorter last line', () => {
    const short = sketchOf([p('Date')]).rows[0]!;
    expect(short).toMatchObject({ t: 'line' });
    expect((short as { w: number }).w).toBeLessThan(40);
    const long = sketchOf([p('word '.repeat(40))]).rows as { t: string; w: number }[];
    expect(long.length).toBeGreaterThan(1);
    expect(long[0]!.w).toBeGreaterThanOrEqual(92);
    expect(long.at(-1)!.w).toBeLessThan(long[0]!.w + 1);
  });

  it('draws nothing for an empty paragraph, which has no text to draw', () => {
    expect(sketchOf([p(), p()]).rows).toEqual([]);
  });

  it('draws a list as items with the mark of its kind, two at most', () => {
    expect(sketchOf([bullets('a', 'b', 'c')]).rows).toEqual([
      { t: 'item', w: expect.any(Number), mark: 'dot' },
      { t: 'item', w: expect.any(Number), mark: 'dot' }
    ]);
    expect(sketchOf([numbered('a')]).rows[0]).toMatchObject({ mark: 'number' });
    expect(sketchOf([checklist('a')]).rows[0]).toMatchObject({ mark: 'box' });
  });

  it('draws a table as a grid, and says whether its first row is a header', () => {
    expect(sketchOf([table([['a', 'b', 'c'], ['', '', ''], ['', '', ''], ['', '', ''], ['', '', '']])]).rows).toEqual([{ t: 'table', cols: 3, rows: 3, header: true }]);
    expect(sketchOf([table([['Date', ''], ['Who', '']], { header: false })]).rows).toEqual([{ t: 'table', cols: 2, rows: 2, header: false }]);
  });

  it('keeps the alignment of a centred or right-aligned line', () => {
    const rows = sketchOf([para({ textAlign: 'right' }, 'Your name'), para({ textAlign: 'center' }, 'Issue 1')]).rows;
    expect(rows.map((r) => ('align' in r ? r.align : undefined))).toEqual(['right', 'center']);
  });

  it('draws a quote, a rule and the subtitle', () => {
    expect(sketchOf([subtitle('A line under the title'), quote('Said once'), rule()]).rows.map((r) => r.t)).toEqual(['title', 'quote', 'rule']);
  });

  it('titles the page with the heading that opens it, and no other', () => {
    expect(sketchOf([h2('Summary'), p('Text that fills a line of the page.'), h2('Background')]).rows.map((r) => r.t)).toEqual(['title', 'line', 'heading']);
  });

  it('stops at the first page break', () => {
    const rows = sketchOf([title('Cover'), subtitle('Sub'), line('Author name here'), line('A second line'), line('A third line'), pageBreak(), h2('Later'), p('Never drawn, it is on page two.')]).rows;
    // Page two's heading and text are not drawn.
    expect(rows.map((r) => r.t)).toEqual(['title', 'heading', 'line', 'line', 'line']);
  });

  it('skips a cover, which would be a title and white space, and draws the page after it', () => {
    const cover = [title('Report'), subtitle('Sub'), pageBreak()];
    const body = [h2('Summary'), p('The finding in a paragraph of some length.'), h2('Background'), p('What led to this report.'), h2('Findings'), pageBreak()];
    const rows = sketchOf([...cover, ...body]).rows;
    expect(rows.map((r) => r.t)).toEqual(['title', 'line', 'heading', 'line', 'heading']);
  });

  it('draws the fullest page when every page is thin, rather than nothing', () => {
    expect(sketchOf([title('A'), pageBreak(), title('B'), p('Some text here'), pageBreak(), title('C')]).rows.map((r) => r.t)).toEqual(['title', 'line']);
  });

  it('fits the card: never more rows than the page area has height for', () => {
    const many: JSONContent[] = [title('Long'), ...Array.from({ length: 40 }, (_, i) => p(`Paragraph ${i} with enough words in it to need a line`))];
    const { rows } = sketchOf(many);
    expect(rows.length).toBeGreaterThan(3);
    expect(heightUsed(rows)).toBeLessThanOrEqual(SKETCH_HEIGHT);
  });

  it('is the same drawing for the same content, and a different one for different text', () => {
    const a = sketchOf([p('One paragraph that is long enough to take up two whole lines of the page, or more.')]);
    expect(sketchOf([p('One paragraph that is long enough to take up two whole lines of the page, or more.')])).toEqual(a);
    expect(sketchOf([p('Another paragraph that is long enough to take up two whole lines of the page, or so.')])).not.toEqual(a);
  });

  it('marks a landscape page as wide', () => {
    expect(sketchOf([title('Plan')], { wide: true }).wide).toBe(true);
    expect(sketchFor(predefinedId({ slug: 'weekly-plan' }))?.wide).toBe(true);
    expect(sketchFor(predefinedId({ slug: 'letter' }))?.wide).toBe(false);
  });

  it('is made once per template, and null for an id that is not one', () => {
    const id = predefinedId(DOCS_TEMPLATES[0]!);
    expect(sketchFor(id)).toBe(sketchFor(id));
    expect(sketchFor('predefined:nope')).toBeNull();
  });

  it('shows each template’s own signature: the plan’s grid, the letter’s right-aligned address, the newsletter’s centred masthead', () => {
    const rowsOf = (slug: string) => sketchFor(predefinedId({ slug }))!.rows;
    expect(rowsOf('weekly-plan').some((r) => r.t === 'table')).toBe(true);
    expect(rowsOf('letter').some((r) => 'align' in r && r.align === 'right')).toBe(true);
    expect(rowsOf('newsletter')[0]).toMatchObject({ t: 'title', align: 'center' });
    expect(rowsOf('project-brief').some((r) => r.t === 'table')).toBe(true);
    expect(rowsOf('meeting-notes').some((r) => r.t === 'item')).toBe(true);
    // The report's card is its body, not its cover.
    expect(rowsOf('report').length).toBeGreaterThan(5);
  });
});
