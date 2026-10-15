/**
 * `Sheet.denseColumn`: a column's cells by row position, so that a whole-column SUM over 100,000 rows is a loop over an
 * array and not 100,000 `Map.get`s. It is kept in step by `notePlaced`, `noteRemoved` and `noteColumnGone`, which the
 * engine calls beside every change to `Sheet.cols`, and dropped when the row order changes. A copy that falls behind
 * would make a total wrong without a word, so this does what nothing else would: after every one of a few hundred
 * random operations (writes and clears, row and column inserts, deletes, the undo of a delete that revives what was
 * parked, and reorders), every range scan through the dense column is compared with the scan it replaced.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RangeValue, Sheet, type Cell } from '../sheet';
import { Book } from './book';

let was = 0;
beforeEach(() => {
  was = Sheet.denseFrom;
  // Every range is "tall" here, so every scan that can go through a dense column does.
  Sheet.denseFrom = 1;
});
afterEach(() => {
  Sheet.denseFrom = was;
});

/** The scan the dense one replaces, for a range the dense branch takes (a column with at least as many cells as rows). */
function plain(sheet: Sheet, c: number, r1: number, r2: number): Cell[] {
  const col = sheet.cols.get(sheet.colOrder[c]!);
  const out: Cell[] = [];
  if (!col) return out;
  for (let r = r1; r <= r2; r++) {
    const cell = col.get(sheet.rowOrder[r]!);
    if (cell) out.push(cell);
  }
  return out;
}

function scanned(sheet: Sheet, c: number, r1: number, r2: number): Cell[] {
  const out: Cell[] = [];
  new RangeValue(sheet, r1, r2, c, c).eachCell((cell) => out.push(cell));
  return out;
}

const name = (c: number): string => String.fromCharCode(65 + c);

/** A small deterministic generator, so a failure names its seed. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function check(b: Book, where: string): number {
  const sheet = b.sheet('S');
  let compared = 0;
  for (let c = 0; c < sheet.colOrder.length; c++) {
    const col = sheet.cols.get(sheet.colOrder[c]!);
    if (!col) continue;
    const n = sheet.rowOrder.length;
    // Whole column, and a few windows of it; the dense branch is taken when the column has at least as many cells as the window has rows.
    for (const [r1, r2] of [
      [0, n - 1],
      [0, Math.floor(n / 2)],
      [Math.floor(n / 3), n - 1],
      [2, Math.min(n - 1, 6)]
    ] as const) {
      if (r1 > r2 || col.size < r2 - r1 + 1) continue;
      const want = plain(sheet, c, r1, r2);
      const got = scanned(sheet, c, r1, r2);
      expect(got.length, `${where}: column ${c} rows ${r1} to ${r2}`).toBe(want.length);
      for (let i = 0; i < want.length; i++) expect(got[i] === want[i], `${where}: column ${c}, the ${i}th cell`).toBe(true);
      compared++;
    }
  }
  return compared;
}

describe('the dense column', () => {
  it('reads the same cells in the same order as the scan it replaces, through whatever changes a sheet', () => {
    let total = 0;
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const rand = rng(seed);
      const b = new Book({ S: [14, 4] });
      const sheet = b.sheet('S');
      const pick = (n: number) => Math.floor(rand() * n);
      // Full to start, so the dense branch is the one taken.
      for (let r = 1; r <= 14; r++) for (let c = 0; c < 4; c++) b.set('S', `${name(c)}${r}`, { v: r * 10 + c });
      total += check(b, `seed ${seed}, start`);

      for (let step = 0; step < 80; step++) {
        const rows = sheet.rowOrder.length;
        const cols = sheet.colOrder.length;
        const op = pick(12);
        let what = '';
        if (op <= 3) {
          // Write, over a cell or in an empty one.
          const r = pick(rows) + 1;
          const c = pick(cols);
          what = `write ${name(c)}${r}`;
          b.set('S', `${name(c)}${r}`, { v: step });
        } else if (op === 4 || op === 5) {
          const r = pick(rows) + 1;
          const c = pick(cols);
          what = `clear ${name(c)}${r}`;
          b.set('S', `${name(c)}${r}`, null);
        } else if (op === 6) {
          const at = pick(rows + 1);
          what = `insert 1 row at ${at}`;
          b.insertRows('S', at, 1 + pick(2));
        } else if (op === 7 && rows > 4) {
          const at = pick(rows - 1);
          const n = 1 + pick(2);
          // The ids that go, to bring them back as an undo does: the same ids in the same place.
          const ids = sheet.rowOrder.slice(at, at + n);
          what = `delete rows ${at}+${n}`;
          b.deleteRows('S', at, n);
          if (pick(2) === 0) {
            what += ' and undo it';
            b.e.insertRows(sheet.id, at, ids);
          }
        } else if (op === 8) {
          const at = pick(cols + 1);
          what = `insert a column at ${at}`;
          b.insertCols('S', at, 1);
        } else if (op === 9 && cols > 2) {
          const at = pick(cols - 1);
          const ids = sheet.colOrder.slice(at, at + 1);
          what = `delete column ${at}`;
          b.deleteCols('S', at, 1);
          if (pick(2) === 0) {
            what += ' and undo it';
            b.e.insertCols(sheet.id, at, ids);
          }
        } else if (op === 10) {
          // A reorder: a sort or a move, every id kept.
          const ids = [...sheet.rowOrder];
          for (let i = ids.length - 1; i > 0; i--) {
            const j = pick(i + 1);
            [ids[i], ids[j]] = [ids[j]!, ids[i]!];
          }
          what = 'shuffle the rows';
          b.e.setOrder(sheet.id, 'rows', ids);
        } else {
          // Fill a column back up, so the dense branch keeps being the one taken.
          const c = pick(cols);
          what = `fill column ${name(c)}`;
          for (let r = 1; r <= sheet.rowOrder.length; r++) b.set('S', `${name(c)}${r}`, { v: r + step });
        }
        b.e.recalc();
        total += check(b, `seed ${seed}, step ${step} (${what})`);
      }
    }
    // The test compared a good many scans, not none.
    expect(total).toBeGreaterThan(2000);
  });

  it('builds a column once, and an edit patches it in place instead of rebuilding it', () => {
    const b = new Book({ S: [50, 2] });
    for (let r = 1; r <= 50; r++) b.set('S', `A${r}`, { v: r });
    const sheet = b.sheet('S');
    const first = sheet.denseColumn(sheet.colOrder[0]!)!;
    expect(sheet.denseColumn(sheet.colOrder[0]!)).toBe(first);
    b.set('S', 'A7', { v: 700 });
    expect(sheet.denseColumn(sheet.colOrder[0]!)).toBe(first);
    expect(first[6]!.value).toBe(700);
    b.set('S', 'A8', null);
    expect(first[7]).toBeUndefined();
    // A row inserted changes every position below it: the column is built again.
    b.insertRows('S', 3, 1);
    expect(sheet.denseColumn(sheet.colOrder[0]!)).not.toBe(first);
  });
});
