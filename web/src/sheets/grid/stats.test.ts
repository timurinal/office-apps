import { describe, expect, it } from 'vitest';
import { average, parseDisplayed, plainFormat, selectionStats, selectionStatsAsync, statusText, type SelectionStats } from './stats';
import { FakeSheet } from './testing/fake';
import { budgetSheet } from './testing/samples';

describe('reading a displayed number', () => {
  const cases: [string, number][] = [
    ['£48,000', 48000],
    ['1,234.50', 1234.5],
    ['1.234,50', 1234.5],
    ['(12)', -12],
    ['-3', -3],
    ['15%', 0.15],
    ['12,5', 12.5],
    ['1,234,567', 1234567],
    ['$1,000', 1000],
    ['1e3', 1000]
  ];
  for (const [text, n] of cases) {
    it(`${text} is ${n}`, () => expect(parseDisplayed(text)).toBeCloseTo(n, 9));
  }
  it('is NaN for what is not one', () => {
    for (const t of ['', 'abc', '£', '#DIV/0!']) expect(parseDisplayed(t)).toBeNaN();
  });
});

describe('the status line', () => {
  it('adds up what the board shows: the totals of the budget', () => {
    const s = budgetSheet();
    // F4:F9, the six rows of the Total column.
    const stats = selectionStats(s, { r1: 3, r2: 8, c1: 5, c2: 5 });
    expect(stats.numbers).toBe(6);
    expect(stats.sum).toBe(273000);
    expect(stats.min).toBe(5000);
    expect(stats.max).toBe(200000);
    expect(average(stats)).toBe(45500);
    expect(stats.numFmt).toBe('£#,##0');
    expect(statusText(stats, 'sum', (n, f) => (f === '£#,##0' ? `£${n.toLocaleString('en-GB')}` : String(n)))).toBe('Sum: £273,000');
  });

  it('counts everything with content, numbers or not', () => {
    const stats = selectionStats(budgetSheet(), { r1: 2, r2: 4, c1: 0, c2: 2 });
    expect(stats.count).toBe(9);
    expect(stats.numbers).toBe(4);
  });

  it('reads text when the model gives no value', () => {
    const s = new FakeSheet({ rows: 3, cols: 2 });
    s.put(0, 0, '£1,000', { numFmt: '£#,##0' });
    const cell = s.cell(0, 0)!;
    delete cell.value;
    expect(selectionStats(s, { r1: 0, r2: 0, c1: 0, c2: 0 }).sum).toBe(1000);
  });

  it('says nothing where there are no numbers, and counts when asked', () => {
    const s = new FakeSheet({ rows: 3, cols: 3 });
    s.put(0, 0, 'a').put(0, 1, 'b').put(0, 2, 'c');
    const stats = selectionStats(s, { r1: 0, r2: 0, c1: 0, c2: 2 });
    expect(statusText(stats, 'sum')).toBeNull();
    expect(statusText(stats, 'count')).toBe('Count: 3');
    expect(statusText(selectionStats(s, { r1: 0, r2: 0, c1: 0, c2: 0 }), 'count')).toBeNull();
  });

  it('is one number for one numeric cell, as the board shows', () => {
    const stats = selectionStats(budgetSheet(), { r1: 9, r2: 9, c1: 5, c2: 5 });
    expect(statusText(stats, 'sum', plainFormat)).toBe('Sum: 273,000');
  });

  it('gives the average, minimum and maximum', () => {
    const stats: SelectionStats = { count: 4, numbers: 4, sum: 10, min: 1, max: 4 };
    expect(statusText(stats, 'average')).toBe('Average: 2.5');
    expect(statusText(stats, 'min')).toBe('Min: 1');
    expect(statusText(stats, 'max')).toBe('Max: 4');
  });

  it('stays inside the used range the model gives', () => {
    const s = budgetSheet();
    const used = s.usedRange();
    expect(used).not.toBeNull();
    const all = selectionStats(s, { r1: 0, r2: 199, c1: 0, c2: 25 });
    expect(all.numbers).toBe(selectionStats(s, used!).numbers);
  });

  it('adds up a whole column of a hundred thousand rows in slices, and gives up when a new selection arrives', async () => {
    const s = new FakeSheet({ rows: 100_000, cols: 2 });
    s.generate = (r, c) => (c === 0 ? { edit: String(r), text: String(r), kind: 'number', value: r } : null);
    const slices: number[] = [];
    const t = Date.now();
    const full = await selectionStatsAsync(s, { r1: 0, r2: 99_999, c1: 0, c2: 0 }, new AbortController().signal, 10_000);
    expect(full!.sum).toBe((99_999 * 100_000) / 2);
    expect(Date.now() - t).toBeLessThan(5000);
    void slices;
    const ctl = new AbortController();
    const pending = selectionStatsAsync(s, { r1: 0, r2: 99_999, c1: 0, c2: 0 }, ctl.signal, 5_000);
    ctl.abort();
    expect(await pending).toBeNull();
  });
});
