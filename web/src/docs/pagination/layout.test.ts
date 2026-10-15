import { describe, expect, it } from 'vitest';
import { flow, pageOfPos, sameBreaks, type Line, type Setup, type Unit } from './layout';

// Spike S2's fourteen cases, then footnotes. Content height per page is 800.
const setup: Setup = { pageW: 794, pageH: 1000, gap: 20, topFirst: 100, topRest: 100, bottomFirst: 100, bottomRest: 100, widows: 2, orphans: 2 };

/** A stack of units: heights in order, `gap` px between them. */
function stack(heights: number[], gap = 0, kind: Unit['kind'] = 'block', extra: (i: number) => Partial<Unit> = () => ({})): Unit[] {
  let y = setup.topFirst;
  return heights.map((h, i) => {
    const u: Unit = { kind, pos: i * 10, top: y, bottom: y + h, ...extra(i) };
    y += h + gap;
    return u;
  });
}

function textUnit(pos: number, top: number, lineH: number, n: number, notes?: Unit['notes']): Unit {
  const lines: Line[] = Array.from({ length: n }, (_, i) => ({ top: top + i * lineH, bottom: top + (i + 1) * lineH, pos: pos + 1 + i * 50 }));
  return { kind: 'text', pos, top, bottom: top + n * lineH, lines: () => lines, ...(notes ? { notes } : {}) };
}

const table = (i: number, firstRowIdx = 0, pos = 0) => ({
  table: { id: 0, pos, headerSig: 'h', row: i, headerRows: 1, headerRowCount: 1, cols: 3, firstRowIdx }
});

describe('flow', () => {
  it('fills a page with blocks and starts the next at the content top of page 2', () => {
    const r = flow(stack(Array(20).fill(100)), setup);
    expect(r.breaks).toHaveLength(2);
    expect(r.pageCount).toBe(3);
    expect(r.breaks[0]!.pos).toBe(80);
    expect(r.breaks[0]!.height).toBe(1020 + 100 - (100 + 800));
    expect(r.breaks[0]!.crosses).toBe(true);
  });

  it('makes one page when nothing breaks', () => {
    const r = flow(stack([100, 100]), setup);
    expect(r.breaks).toEqual([]);
    expect(r.pageCount).toBe(1);
  });

  it('splits a paragraph at a line, keeping at least two lines on each side', () => {
    const r = flow([textUnit(0, 100, 20, 50)], setup);
    expect(r.breaks).toHaveLength(1);
    expect(r.breaks[0]!.kind).toBe('inline');
    expect(r.breaks[0]!.pos).toBe(1 + 40 * 50);
    expect(r.pageCount).toBe(2);
  });

  it('splits a table of contents between its rows, at its own position, across as many pages as it needs', () => {
    // 120 rows of 20px under a 40px title: 38 rows on page 1, 40 on pages 2 and 3, 2 on page 4.
    // Its rows are lines that name a row rather than a position.
    const rows: Line[] = Array.from({ length: 120 }, (_, i) => ({ top: 140 + i * 20, bottom: 160 + i * 20, pos: 7, row: i }));
    const toc: Unit = { kind: 'text', pos: 7, top: 100, bottom: 140 + 120 * 20, lines: () => rows };
    const r = flow([toc, { kind: 'block', pos: 9, top: 2540, bottom: 2600 }], setup);
    expect(r.breaks.map((b) => [b.kind, b.pos, b.row])).toEqual([
      ['part', 7, 38],
      ['part', 7, 78],
      ['part', 7, 118]
    ]);
    expect(r.breaks[0]!.height).toBe(1020 + 100 - (140 + 38 * 20));
    expect(r.pageCount).toBe(4);
    // Two rows that differ only in which row they break before are different layouts.
    expect(sameBreaks(r.breaks, r.breaks.map((b) => ({ ...b, row: (b.row ?? 0) + 1 })))).toBe(false);
  });

  it('never leaves the last line alone on the next page', () => {
    const r = flow([textUnit(0, 100, 20, 41)], setup);
    expect(r.breaks[0]!.pos).toBe(1 + 39 * 50);
  });

  it('moves the whole paragraph rather than leave its first line alone', () => {
    const pre: Unit = { kind: 'block', pos: 0, top: 100, bottom: 100 + 780 };
    const r = flow([pre, textUnit(5, 100 + 780, 20, 10)], setup);
    expect(r.breaks).toHaveLength(1);
    expect(r.breaks[0]!.kind).toBe('block');
    expect(r.breaks[0]!.pos).toBe(5);
  });

  it('keeps a heading with the line that follows it', () => {
    const heading: Unit = { kind: 'text', pos: 0, top: 860, bottom: 890, keepWithNext: true, lines: () => [{ top: 860, bottom: 890, pos: 1 }] };
    const r = flow([{ kind: 'block', pos: -1, top: 100, bottom: 860 }, heading, textUnit(40, 890, 20, 5)], setup);
    expect(r.breaks).toHaveLength(1);
    expect(r.breaks[0]!.pos).toBe(0);
  });

  it('splits a table between rows and repeats its header after the break', () => {
    const r = flow(stack(Array(30).fill(40), 0, 'row', (i) => table(i)), setup);
    expect(r.breaks[0]!.kind).toBe('row');
    expect(r.breaks[0]!.pos).toBe(200);
    expect(r.breaks[0]!.repeatHeader).toBe(true);
    expect(r.breaks[0]!.headerHeight).toBe(40);
    expect(r.pageCount).toBe(2);
  });

  it('moves a header row left alone at the bottom of a page with the first data row', () => {
    const pre: Unit = { kind: 'block', pos: 0, top: 100, bottom: 800 };
    const rows = stack(Array(3).fill(60), 0, 'row', (i) => ({ pos: 100 + i, ...table(i, 1, 99) }));
    for (const u of rows) {
      u.top += 700;
      u.bottom += 700;
    }
    const r = flow([pre, ...rows], setup);
    expect(r.breaks).toHaveLength(1);
    expect(r.breaks[0]!.pos).toBe(100);
    expect(r.breaks[0]!.repeatHeader).toBe(false);
  });

  it('lets a row taller than a page overflow from a page top, without looping', () => {
    const r = flow(stack([40, 40, 2000, 40], 0, 'row', (i) => table(i)), setup);
    expect(r.overflow).toHaveLength(1);
    expect(r.overflow[0]!.kind).toBe('row');
    expect(r.overflow[0]!.pages).toBeGreaterThanOrEqual(3);
    expect(r.pageCount).toBe(4);
  });

  it('starts the block after an overflowing one clear of the margin and the gap', () => {
    const r = flow(stack([200, 2500, 100]), setup);
    expect(r.overflow).toHaveLength(1);
    expect(r.breaks.at(-1)).toBeDefined();
  });

  it('sends what follows a manual break to a new page, and adds no blank page at a page top', () => {
    const units: Unit[] = [
      { kind: 'block', pos: 0, top: 100, bottom: 200 },
      { kind: 'break', pos: 10, top: 200, bottom: 201 },
      { kind: 'block', pos: 20, top: 201, bottom: 301 }
    ];
    const r = flow(units, setup);
    expect(r.breaks).toHaveLength(1);
    expect(r.breaks[0]!.pos).toBe(20);
    expect(r.pageCount).toBe(2);

    const atTop = flow([{ kind: 'break', pos: 0, top: 100, bottom: 100 }, { kind: 'block', pos: 2, top: 100, bottom: 200 }], setup);
    expect(atTop.breaks).toEqual([]);
    expect(atTop.pageCount).toBe(1);
  });

  it('splits a paragraph longer than two pages twice', () => {
    const r = flow([textUnit(0, 100, 20, 120)], setup);
    expect(r.breaks).toHaveLength(2);
    expect(r.pageCount).toBe(3);
  });

  it('gives the same answer twice', () => {
    const units = stack(Array.from({ length: 60 }, (_, i) => 30 + ((i * 37) % 90)), 6);
    expect(flow(units, setup)).toEqual(flow(units, setup));
    expect(sameBreaks(flow(units, setup).breaks, flow(units, setup).breaks)).toBe(true);
  });

  it('does not chain a heading to an image that cannot fit with it on any page', () => {
    const heading: Unit = { kind: 'text', pos: 0, top: 100, bottom: 130, keepWithNext: true, lines: () => [{ top: 100, bottom: 130, pos: 1 }] };
    const r = flow([heading, { kind: 'block', pos: 40, top: 130, bottom: 920 }], setup);
    expect(r.breaks).toHaveLength(1);
    expect(r.breaks[0]!.pos).toBe(40);
    expect(r.overflow).toHaveLength(0);
  });

  it('honours different insets on the first page', () => {
    const s: Setup = { ...setup, topFirst: 200, bottomFirst: 200 };
    // 600 on page 1, 800 after: 6 then 8 blocks of 100.
    let y = 200;
    const units = Array.from({ length: 14 }, (_, i): Unit => {
      const u: Unit = { kind: 'block', pos: i * 10, top: y, bottom: y + 100 };
      y += 100;
      return u;
    });
    const r = flow(units, s);
    expect(r.breaks.map((b) => b.pos)).toEqual([60]);
    expect(r.pageCount).toBe(2);
  });
});

describe('footnotes', () => {
  const withSep: Setup = { ...setup, noteSep: 20 };

  it('reserve their height on the page that holds the reference', () => {
    // Eight blocks of 100 fill page 1 exactly. A 50px note on block 2 pushes block 7 over.
    const units = stack(Array(8).fill(100), 0, 'block', (i) => (i === 2 ? { notes: [{ pos: 25, i: 0 }] } : {}));
    const r = flow(units, withSep, [50]);
    expect(r.notePage).toEqual([0]);
    expect(r.breaks.map((b) => b.pos)).toEqual([70]);
    expect(r.pageCount).toBe(2);
  });

  it('cost nothing on a page without any', () => {
    const r = flow(stack(Array(8).fill(100)), withSep, [50]);
    expect(r.breaks).toEqual([]);
    expect(r.notePage).toEqual([-1]);
  });

  it('go with the line that carries the reference when a paragraph splits', () => {
    // 50 lines of 20px. Line 10 (pos 501) has a 100px note, line 45 (pos 2251) another.
    const u = textUnit(0, 100, 20, 50, [
      { pos: 505, i: 0 },
      { pos: 2255, i: 1 }
    ]);
    const r = flow([u], withSep, [100, 100]);
    // Page 1 gives up 120px to the first note: 680px is 34 lines.
    expect(r.breaks[0]!.pos).toBe(1 + 34 * 50);
    expect(r.notePage).toEqual([0, 1]);
  });

  it('move with a heading that is kept with the next paragraph', () => {
    const pre: Unit = { kind: 'block', pos: 0, top: 100, bottom: 860 };
    const heading: Unit = {
      kind: 'text',
      pos: 10,
      top: 860,
      bottom: 880,
      keepWithNext: true,
      notes: [{ pos: 12, i: 0 }],
      lines: () => [{ top: 860, bottom: 880, pos: 11 }]
    };
    const r = flow([pre, heading, textUnit(20, 880, 20, 5)], withSep, [10]);
    expect(r.breaks.map((b) => b.pos)).toEqual([10]);
    expect(r.notePage).toEqual([1]);
  });

  it('leave a block that cannot fit with its notes at the top of its page, as overflow', () => {
    const units = stack([790], 0, 'block', () => ({ notes: [{ pos: 1, i: 0 }] }));
    const r = flow(units, withSep, [400]);
    expect(r.notePage).toEqual([0]);
    expect(r.overflow).toHaveLength(1);
  });
});

describe('pageOfPos', () => {
  it('reads the page from the breaks before a position', () => {
    const r = flow(stack(Array(20).fill(100)), setup);
    expect(pageOfPos(r.breaks, 0)).toBe(0);
    expect(pageOfPos(r.breaks, 79)).toBe(0);
    expect(pageOfPos(r.breaks, 80)).toBe(1);
    expect(pageOfPos(r.breaks, 199)).toBe(2);
    expect(pageOfPos([], 500)).toBe(0);
  });
});
