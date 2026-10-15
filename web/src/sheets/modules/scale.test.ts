// @vitest-environment happy-dom
/**
 * The tools at 100k rows: what a person waits for when they open the filter menu, search, add a
 * rule or sort a big block. The numbers are printed; the bounds are loose enough not to flake and
 * tight enough to catch a tool that has started to take a second.
 */

import { describe, expect, it } from 'vitest';
import { BARS, addBars, addQuick } from './conditionalActions';
import { filterRect, setCriterion, toggleFilter, sortBy } from './dataActions';
import { DEFAULT_FIND, findAll } from './findActions';
import { rect, setup } from './testkit';

const ROWS = 100_000;

async function big() {
  return setup((b) => {
    const s = b.addSheet('Data', { rows: ROWS + 10, cols: 8 });
    s.cell(0, 0, { value: 'Id' }).cell(0, 1, { value: 'Item' }).cell(0, 2, { value: 'Team' }).cell(0, 3, { value: 'Score' });
    for (let r = 1; r <= ROWS; r++) {
      s.cell(r, 0, { value: r });
      s.cell(r, 1, { value: `Item ${r}` });
      s.cell(r, 2, { value: `Team ${r % 1000}` });
      s.cell(r, 3, { value: (r * 7919) % 10_007 });
    }
  });
}

const ms = (since: number) => performance.now() - since;
const fmt = (x: number) => x.toFixed(1);

describe('100k rows', () => {
  it('opens a filter menu, filters, searches and highlights in a time a person does not notice', { timeout: 180_000 }, async () => {
    const t = await big();
    t.select(rect(1, 0));
    const out: string[] = [];

    let s = performance.now();
    toggleFilter(t.ctx);
    out.push(`filter on ${fmt(ms(s))}`);
    expect(filterRect(t.ctx)).toEqual(rect(0, 0, ROWS, 3));

    // The menu's list: 1,000 distinct teams over 100k rows, counted and sorted.
    s = performance.now();
    const list = t.ctx.data.features()!.columnValues(2);
    const listMs = ms(s);
    out.push(`menu list (${list.length} values) ${fmt(listMs)}`);
    expect(list).toHaveLength(1000);
    expect(list[0]!.count).toBe(100);

    s = performance.now();
    setCriterion(t.ctx, 2, { kind: 'values', hidden: list.slice(10).map((v) => v.text) });
    const hidden = [...Array(ROWS + 1).keys()].filter((r) => t.ctx.data.rowHeight(r) === 0).length;
    const filterMs = ms(s);
    out.push(`filter to 10 teams ${fmt(filterMs)}`);
    expect(hidden).toBe(ROWS - 10 * 100);

    s = performance.now();
    setCriterion(t.ctx, 3, { kind: 'condition', op: 'gt', a: 5000 });
    out.push(`and a number condition ${fmt(ms(s))}`);

    // Find across 400k cells: the slowest slice is what holds the page up.
    let slowest = 0;
    let last = performance.now();
    s = performance.now();
    const found = (await findAll(t.ctx, { ...DEFAULT_FIND, query: 'item 99999' }, () => {
      const now = performance.now();
      slowest = Math.max(slowest, now - last);
      last = now;
      return false;
    }))!;
    const findMs = ms(s);
    out.push(`find in 400k cells ${fmt(findMs)} (slowest slice ${fmt(slowest)})`);
    expect(found.length).toBe(1);

    t.model.setFilter(t.ctx.sheetId, null);
    s = performance.now();
    t.select(rect(1, 3, ROWS, 3));
    addBars(t.ctx, BARS[0]!);
    const first = t.ctx.data.cell(500, 3);
    out.push(`data bars on 100k numbers, first screen cell ${fmt(ms(s))}`);
    expect(first?.conditional?.bar).toBeTruthy();
    s = performance.now();
    for (let r = 0; r < 40; r++) for (let c = 0; c < 4; c++) t.ctx.data.cell(60_000 + r, c);
    const screen = ms(s);
    out.push(`a screen with the bars ${fmt(screen)}`);

    t.select(rect(1, 0, ROWS, 0));
    s = performance.now();
    addQuick(t.ctx, { kind: 'duplicate' });
    t.ctx.data.cell(500, 0);
    out.push(`duplicates over 100k ${fmt(ms(s))}`);

    console.log(`100k rows: ${out.join('; ')}`);
    expect(listMs).toBeLessThan(1500);
    expect(filterMs).toBeLessThan(3000);
    expect(slowest).toBeLessThan(400);
    expect(screen).toBeLessThan(50);
  });

  it('sorts as many rows as one step may hold, and says so past that', { timeout: 180_000 }, async () => {
    const t = await big();
    t.select(rect(1, 3));
    let s = performance.now();
    sortBy(t.ctx, false);
    const refused = t.notices.at(-1);
    expect(refused?.message).toBe('That changes too many cells at once.');
    expect(t.text(1, 0)).toBe('1');
    // Under the cap: 20,000 rows by 4 columns is 80,000 writes.
    t.select(rect(1, 3, 20_000, 3));
    s = performance.now();
    sortBy(t.ctx, true);
    const sortMs = ms(s);
    console.log(`sort of 20k rows by 4 columns ${fmt(sortMs)} ms`);
    expect(Number(t.text(1, 3))).toBeGreaterThan(Number(t.text(2, 3)) - 1);
    expect(sortMs).toBeLessThan(5000);
  });
});
