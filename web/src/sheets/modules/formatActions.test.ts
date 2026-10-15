// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import {
  CELL_STYLES,
  activeStyle,
  alignH,
  alignV,
  applyBorders,
  applyCategory,
  applyCellStyle,
  applyCurrency,
  clearFormats,
  indent,
  isMerged,
  lift,
  merge,
  moreDecimals,
  paint,
  parseSize,
  setColor,
  setFont,
  setSize,
  sizeOf,
  stepSize,
  toggle,
  togglePercent,
  toggleThousands
} from './formatActions';
import { rect, setup, table, type Kit } from './testkit';

const data = table(['Name', 'Q1', 'Q2'], ['Rent', '950', '1000'], ['Food', '400', '420'], ['Total', '=SUM(B2:B3)', '=SUM(C2:C3)']);

/** One undo takes the whole step back, and nothing before it with it. */
function oneUndo(t: Kit, check: () => void, before: () => void) {
  check();
  expect(t.model.undo()).toBe(true);
  before();
}

describe('the font buttons', () => {
  it('turn bold on for the whole selection when the active cell is not bold, and off when it is', async () => {
    const t = await setup(data);
    t.select(rect(0, 0, 0, 2));
    toggle(t.ctx, 'bold');
    expect([0, 1, 2].map((c) => t.style(0, c).bold)).toEqual([true, true, true]);
    // The active cell (A1) is bold, so the next press takes it off every cell, even one that was not.
    t.select(rect(0, 0, 1, 2));
    expect(activeStyle(t.ctx).bold).toBe(true);
    toggle(t.ctx, 'bold');
    expect([t.style(0, 0).bold, t.style(1, 2).bold]).toEqual([undefined, undefined]);
  });

  it('is one undo, and one frame', async () => {
    const t = await setup(data);
    t.select(rect(0, 0, 3, 2));
    oneUndo(
      t,
      () => {
        toggle(t.ctx, 'italic');
        expect(t.style(2, 1).italic).toBe(true);
      },
      () => expect(t.style(2, 1).italic).toBeUndefined()
    );
    expect(t.model.status().pending).toBeLessThanOrEqual(2);
  });

  it('leave a cell that is plain again with nothing stored on it', async () => {
    const t = await setup();
    t.select(rect(4, 4));
    toggle(t.ctx, 'underline');
    expect(t.model.status().cells).toBe(1);
    toggle(t.ctx, 'underline');
    expect(t.model.status().cells).toBe(0);
  });

  it('toggle underline, strikethrough and wrap the same way', async () => {
    const t = await setup(data);
    t.select(rect(1, 0));
    toggle(t.ctx, 'underline');
    toggle(t.ctx, 'strike');
    toggle(t.ctx, 'wrap');
    expect(t.style(1, 0)).toMatchObject({ underline: true, strike: true, wrap: true });
  });

  it('choose a font, with Inter being no font at all', async () => {
    const t = await setup(data);
    t.select(rect(1, 0));
    setFont(t.ctx, 'Georgia');
    expect(t.style(1, 0).font).toBe('Georgia');
    setFont(t.ctx, 'Inter');
    expect(t.style(1, 0).font).toBeUndefined();
    // Nothing is left on the cell but what it holds: the table's twelve.
    expect(t.model.status().cells).toBe(12);
  });

  it('set a size, with the default size being none', async () => {
    const t = await setup(data);
    t.select(rect(0, 0, 0, 2));
    expect(sizeOf(t.ctx)).toBe(10);
    setSize(t.ctx, 14);
    expect(sizeOf(t.ctx)).toBe(14);
    expect(t.style(0, 2).size).toBe(14);
    setSize(t.ctx, 10);
    expect(t.style(0, 2).size).toBeUndefined();
  });

  it('read a typed size, and step along the list', () => {
    expect(parseSize('12')).toBe(12);
    expect(parseSize(' 10,5 pt ')).toBe(10.5);
    expect(parseSize('0')).toBeNull();
    expect(parseSize('500')).toBeNull();
    expect(parseSize('big')).toBeNull();
    const sizes = [8, 10, 12, 14];
    expect(stepSize(10, 1, sizes)).toBe(12);
    expect(stepSize(10, -1, sizes)).toBe(8);
    expect(stepSize(14, 1, sizes)).toBe(15);
    expect(stepSize(8, -1, sizes)).toBe(7);
  });

  it('colour the text and the cell, and take the colour away', async () => {
    const t = await setup(data);
    t.select(rect(1, 1, 2, 2));
    setColor(t.ctx, 'color', '#c0392b');
    setColor(t.ctx, 'fill', '#ffeb9c');
    expect(t.style(2, 2)).toMatchObject({ color: '#c0392b', fill: '#ffeb9c' });
    setColor(t.ctx, 'fill', null);
    expect(t.style(2, 2).fill).toBeUndefined();
    expect(t.style(2, 2).color).toBe('#c0392b');
  });
});

describe('alignment', () => {
  it('chooses a side, and chooses it off again', async () => {
    const t = await setup(data);
    t.select(rect(1, 1, 2, 2));
    alignH(t.ctx, 'center');
    expect(t.style(2, 2).h).toBe('center');
    alignH(t.ctx, 'center');
    expect(t.style(2, 2).h).toBeUndefined();
    alignH(t.ctx, 'right');
    alignH(t.ctx, 'left');
    expect(t.style(1, 1).h).toBe('left');
  });

  it('puts a cell at the top or bottom, and the middle is where it is anyway', async () => {
    const t = await setup(data);
    t.select(rect(1, 0));
    alignV(t.ctx, 'top');
    expect(t.style(1, 0).v).toBe('top');
    alignV(t.ctx, 'bottom');
    expect(t.style(1, 0).v).toBe('bottom');
    alignV(t.ctx, 'middle');
    expect(t.style(1, 0).v).toBeUndefined();
  });

  it('indents text from the left, a number from the right, and stops at none and at fifteen', async () => {
    const t = await setup(data);
    t.select(rect(1, 0));
    indent(t.ctx, 1);
    expect(t.style(1, 0)).toMatchObject({ indent: 1, h: 'left' });
    t.select(rect(1, 1));
    indent(t.ctx, 1);
    expect(t.style(1, 1)).toMatchObject({ indent: 1, h: 'right' });
    indent(t.ctx, -1);
    expect(t.style(1, 1).indent).toBeUndefined();
    indent(t.ctx, -1);
    expect(t.style(1, 1).indent).toBeUndefined();
    for (let i = 0; i < 20; i++) indent(t.ctx, 1);
    expect(t.style(1, 1).indent).toBe(15);
  });

  it('keeps an alignment already chosen when it indents', async () => {
    const t = await setup(data);
    t.select(rect(1, 0));
    alignH(t.ctx, 'center');
    indent(t.ctx, 1);
    expect(t.style(1, 0).h).toBe('center');
  });
});

describe('merging', () => {
  it('merges and centres as one step, and the same button undoes the merge', async () => {
    const t = await setup(data);
    t.select(rect(0, 0, 0, 2));
    merge(t.ctx, 'centre');
    expect(t.ctx.data.merges()).toEqual([rect(0, 0, 0, 2)]);
    expect(t.style(0, 0).h).toBe('center');
    expect(isMerged(t.ctx)).toBe(true);
    // One undo takes both the merge and the centring.
    expect(t.model.undo()).toBe(true);
    expect(t.ctx.data.merges()).toEqual([]);
    expect(t.style(0, 0).h).toBeUndefined();
    expect(t.text(0, 0)).toBe('Name');
    t.model.redo();
    merge(t.ctx, 'centre');
    expect(t.ctx.data.merges()).toEqual([]);
  });

  it('merges across, one area to a row, as one step', async () => {
    const t = await setup(data);
    t.select(rect(1, 0, 3, 2));
    merge(t.ctx, 'across');
    expect(t.ctx.data.merges()).toHaveLength(3);
    expect(t.ctx.data.merges()).toEqual(expect.arrayContaining([rect(1, 0, 1, 2), rect(2, 0, 2, 2), rect(3, 0, 3, 2)]));
    t.model.undo();
    expect(t.ctx.data.merges()).toEqual([]);
  });

  it('does nothing to one cell, and unmerges what is selected', async () => {
    const t = await setup(data);
    t.select(rect(0, 0));
    merge(t.ctx, 'cells');
    merge(t.ctx, 'centre');
    expect(t.ctx.data.merges()).toEqual([]);
    expect(t.model.canUndo()).toBe(false);
    t.select(rect(2, 0, 3, 0));
    merge(t.ctx, 'cells');
    expect(t.ctx.data.merges()).toHaveLength(1);
    merge(t.ctx, 'unmerge');
    expect(t.ctx.data.merges()).toEqual([]);
  });
});

describe('number formats', () => {
  it('apply a category in the currency in use', async () => {
    const t = await setup(data);
    t.select(rect(1, 1, 3, 2));
    applyCategory(t.ctx, 'currency', '£');
    expect(t.text(1, 1)).toBe('£950.00');
    applyCategory(t.ctx, 'currency', '€');
    expect(t.text(1, 1)).toBe('€950.00');
    applyCurrency(t.ctx, '$');
    expect(t.text(3, 2)).toBe('$1,420.00');
    applyCategory(t.ctx, 'general', '£');
    expect(t.text(1, 1)).toBe('950');
    expect(t.style(1, 1).numFmt).toBeUndefined();
  });

  it('toggle percent and the thousands separator from the active cell', async () => {
    const t = await setup(table(['0.5', '1234567']));
    t.select(rect(0, 0));
    togglePercent(t.ctx);
    expect(t.text(0, 0)).toBe('50%');
    togglePercent(t.ctx);
    expect(t.text(0, 0)).toBe('0.5');
    t.select(rect(0, 1));
    toggleThousands(t.ctx);
    expect(t.text(0, 1)).toBe('1,234,567.00');
    toggleThousands(t.ctx);
    expect(t.text(0, 1)).toBe('1234567');
  });

  it('add and take away decimals for the selection by what the active cell shows', async () => {
    const t = await setup(table(['1.5', '2.25', '3']));
    t.select(rect(0, 0, 0, 2));
    moreDecimals(t.ctx, 1);
    expect([0, 1, 2].map((c) => t.text(0, c))).toEqual(['1.5', '2.3', '3.0']);
    moreDecimals(t.ctx, 1);
    expect([0, 1, 2].map((c) => t.text(0, c))).toEqual(['1.50', '2.25', '3.00']);
    moreDecimals(t.ctx, -1);
    moreDecimals(t.ctx, -1);
    expect(t.style(0, 0).numFmt).toBe('0');
    moreDecimals(t.ctx, -1);
    expect(t.style(0, 0).numFmt).toBe('0');
  });

  it('are a step each', async () => {
    const t = await setup(data);
    t.select(rect(1, 1, 3, 2));
    applyCategory(t.ctx, 'percent', '£');
    t.model.undo();
    expect(t.style(1, 1).numFmt).toBeUndefined();
    expect(t.model.canUndo()).toBe(false);
  });
});

describe('borders', () => {
  const sides = (t: Kit, r: number, c: number) => {
    const s = t.style(r, c);
    return [s.borderTop, s.borderRight, s.borderBottom, s.borderLeft].map((b) => b?.line ?? '-').join(' ');
  };

  it('draws every edge of every cell for All borders', async () => {
    const t = await setup(data);
    t.select(rect(1, 0, 2, 1));
    applyBorders(t.ctx, 'all', { line: 'thin' });
    expect(sides(t, 1, 0)).toBe('thin thin thin thin');
    expect(sides(t, 2, 1)).toBe('thin thin thin thin');
    // The edge beyond the selection is written too, the same, so it reads the same from there.
    expect(t.style(0, 0).borderBottom?.line).toBe('thin');
    expect(t.style(1, 2).borderLeft?.line).toBe('thin');
    expect(t.style(3, 1).borderTop?.line).toBe('thin');
  });

  it('draws only the outside of the block for Outside borders, in the pen it is given', async () => {
    const t = await setup(data);
    t.select(rect(1, 0, 3, 2));
    applyBorders(t.ctx, 'outside', { line: 'dashed', color: '#c0392b' });
    expect(t.style(1, 0)).toMatchObject({ borderTop: { line: 'dashed', color: '#c0392b' }, borderLeft: { line: 'dashed', color: '#c0392b' } });
    expect(t.style(1, 0).borderRight).toBeUndefined();
    expect(t.style(2, 1)).toEqual({});
    expect(t.style(3, 2)).toMatchObject({ borderBottom: { line: 'dashed' }, borderRight: { line: 'dashed' } });
  });

  it('draws inside edges only between cells of the block', async () => {
    const t = await setup(data);
    t.select(rect(1, 0, 3, 2));
    applyBorders(t.ctx, 'inside-h', { line: 'thin' });
    expect(sides(t, 1, 0)).toBe('- - thin -');
    expect(sides(t, 2, 0)).toBe('thin - thin -');
    expect(sides(t, 3, 0)).toBe('thin - - -');
    applyBorders(t.ctx, 'inside-v', { line: 'dotted' });
    expect(t.style(2, 1)).toMatchObject({ borderLeft: { line: 'dotted' }, borderRight: { line: 'dotted' } });
    expect(t.style(2, 0).borderLeft).toBeUndefined();
  });

  it('draws one side, thick outside, bottom double and top and bottom', async () => {
    const t = await setup(data);
    t.select(rect(3, 0, 3, 2));
    applyBorders(t.ctx, 'top-bottom', { line: 'thin' });
    expect(sides(t, 3, 1)).toBe('thin - thin -');
    applyBorders(t.ctx, 'bottom-double', { line: 'thin' });
    expect(t.style(3, 1).borderBottom?.line).toBe('double');
    applyBorders(t.ctx, 'thick-outside', { line: 'thin' });
    expect(t.style(3, 0)).toMatchObject({ borderTop: { line: 'thick' }, borderLeft: { line: 'thick' }, borderBottom: { line: 'thick' } });
    applyBorders(t.ctx, 'left', { line: 'medium' });
    expect(t.style(3, 0).borderLeft?.line).toBe('medium');
    expect(t.style(3, 1).borderLeft).toBeUndefined();
  });

  it('takes every border away, from both sides of an edge, and leaves nothing stored', async () => {
    const t = await setup(data);
    t.select(rect(1, 0, 2, 1));
    applyBorders(t.ctx, 'all', { line: 'thin' });
    applyBorders(t.ctx, 'none', { line: 'thin' });
    for (const [r, c] of [[1, 0], [2, 1], [0, 0], [1, 2], [3, 1]] as const) expect(sides(t, r, c)).toBe('- - - -');
    // Only the cells that hold something remain.
    expect(t.model.status().cells).toBe(12);
  });

  it('is one undo', async () => {
    const t = await setup(data);
    t.select(rect(1, 0, 3, 2));
    applyBorders(t.ctx, 'all', { line: 'thin' });
    t.model.undo();
    expect(sides(t, 1, 0)).toBe('- - - -');
    expect(sides(t, 0, 0)).toBe('- - - -');
    expect(t.model.canUndo()).toBe(false);
  });

  it('puts the line on the column for a whole column', async () => {
    const t = await setup(data);
    t.select(rect(0, 1, 999, 1));
    applyBorders(t.ctx, 'left', { line: 'thin' });
    expect(t.style(500, 1).borderLeft?.line).toBe('thin');
    expect(t.style(500, 0).borderRight?.line).toBe('thin');
  });
});

describe('clearing and painting a format', () => {
  it('clears every format and keeps the contents', async () => {
    const t = await setup(data);
    t.select(rect(0, 0, 3, 2));
    toggle(t.ctx, 'bold');
    setColor(t.ctx, 'fill', '#ffeb9c');
    clearFormats(t.ctx);
    expect(t.style(1, 1)).toEqual({});
    expect(t.text(1, 1)).toBe('950');
  });

  it('lifts a cell and lays it on others, so a plain cell makes them plain', async () => {
    const t = await setup(data);
    t.select(rect(0, 0));
    toggle(t.ctx, 'bold');
    setColor(t.ctx, 'color', '#1e8255');
    applyBorders(t.ctx, 'bottom', { line: 'medium' });
    const bold = lift(activeStyle(t.ctx));
    t.select(rect(1, 0, 3, 2));
    toggle(t.ctx, 'italic');
    paint(t.ctx, bold);
    expect(t.style(2, 1)).toMatchObject({ bold: true, color: '#1e8255', borderBottom: { line: 'medium' } });
    expect(t.style(2, 1).italic).toBeUndefined();
    // A plain cell lifted, then painted over the bold ones, leaves them plain.
    t.select(rect(0, 2));
    const plain = lift(activeStyle(t.ctx));
    t.select(rect(2, 1));
    paint(t.ctx, plain);
    expect(t.style(2, 1)).toEqual({});
  });
});

describe('named styles', () => {
  it('lay their format over the cell and keep what the cell already has', async () => {
    const t = await setup(data);
    t.select(rect(1, 1));
    toggle(t.ctx, 'italic');
    applyCellStyle(t.ctx, 'good');
    expect(t.style(1, 1)).toMatchObject({ italic: true, color: '#006100', fill: '#c6efce' });
    applyCellStyle(t.ctx, 'total');
    expect(t.style(1, 1)).toMatchObject({ bold: true, borderBottom: { line: 'double' } });
  });

  it('go back to Normal by clearing the format', async () => {
    const t = await setup(data);
    t.select(rect(1, 1));
    applyCellStyle(t.ctx, 'bad');
    applyCellStyle(t.ctx, 'normal');
    expect(t.style(1, 1)).toEqual({});
  });

  it('have ids that are different, and a numeric one applies its number format', async () => {
    expect(new Set(CELL_STYLES.map((s) => s.id)).size).toBe(CELL_STYLES.length);
    const t = await setup(data);
    t.select(rect(1, 1));
    applyCellStyle(t.ctx, 'currency');
    expect(t.text(1, 1)).toBe('£950.00');
  });
});
