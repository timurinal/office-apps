/**
 * The adapter at 100k rows: what the grid asks for one screen, read 60 times at places across
 * the sheet, as a scroll and a jump would. The numbers are printed; the bound is a frame.
 */

import { describe, expect, it } from 'vitest';
import { SheetModel } from '../model';
import { buildSheetSeed } from '../seed';
import { localSheetSource } from '../source';

const ROWS = 100_000;
const SCREEN = { rows: 40, cols: 12 };

describe('100k rows', () => {
  it('one screen of cells reads well inside a frame', { timeout: 120_000 }, async () => {
    let t = performance.now();
    const seed = buildSheetSeed((b) => {
      const s = b.addSheet('Data', { rows: ROWS, cols: 26 });
      for (let r = 0; r < ROWS; r++) {
        s.cell(r, 0, { value: r * 1.5 });
        s.cell(r, 1, { value: `Item ${r}` });
        s.cell(r, 2, { formula: `A${r + 1}*2` });
        s.cell(r, 3, { value: 45000 + (r % 365) });
      }
      // A column's format, as an import writes one: a style on every cell would not fit the room.
      s.colStyle(3, { numFmt: 'dd/mm/yyyy' });
    });
    const built = performance.now() - t;
    t = performance.now();
    const m = new SheetModel(localSheetSource(seed));
    // A file this big is taken in in slices that give the page back between them (model.ts, `applyInSlices`).
    while (!m.status().loaded) await new Promise((r) => setTimeout(r, 0));
    const loaded = performance.now() - t;
    const sheet = m.sheets()[0]!.id;
    const v = m.view(sheet);
    expect(v.rowCount()).toBe(ROWS);
    expect(m.status().cells).toBe(4 * ROWS);

    const screen = (top: number, left: number) => {
      const s = performance.now();
      let n = 0;
      for (let r = top; r < top + SCREEN.rows; r++) {
        v.rowHeight(r);
        for (let c = left; c < left + SCREEN.cols; c++) {
          v.colWidth(c);
          if (v.cell(r, c)) n++;
        }
      }
      return { ms: performance.now() - s, n };
    };
    // The first read of a sheet builds its sizes; a person sees that once, on opening it.
    const first = screen(0, 0);
    const times: number[] = [];
    for (let i = 0; i < 60; i++) {
      const top = Math.floor(((i * 7919) % 60) * (ROWS / 60)) % (ROWS - SCREEN.rows);
      const r = screen(top, i % 3 === 0 ? 0 : 2);
      expect(r.n).toBeGreaterThanOrEqual(SCREEN.rows * 2);
      times.push(r.ms);
    }
    const again = screen(50_000, 0);
    const u = performance.now();
    expect(v.usedRange()).toEqual({ r1: 0, c1: 0, r2: ROWS - 1, c2: 3 });
    const used = performance.now() - u;
    times.sort((a, b) => a - b);
    const mean = times.reduce((a, b) => a + b, 0) / times.length;
    const fmt = (x: number) => x.toFixed(2);
    console.log(
      `100k rows, 400k cells, ${(m.status().cellBytes / 1048576).toFixed(1)} MiB: seed ${fmt(built)} ms, load ${fmt(loaded)} ms; first screen ${fmt(first.ms)} ms; ` +
        `60 cold screens of ${SCREEN.rows}x${SCREEN.cols}: median ${fmt(times[30]!)} ms, mean ${fmt(mean)} ms, max ${fmt(times[59]!)} ms; ` +
        `a cached screen ${fmt(again.ms)} ms; usedRange ${fmt(used)} ms`
    );
    expect(v.cell(99_999, 2)?.text).toBe(String(99_999 * 1.5 * 2));
    expect(v.cell(99_999, 3)?.text).toMatch(/^\d\d\/\d\d\/\d{4}$/);
    expect(mean).toBeLessThan(16);
  });
});
