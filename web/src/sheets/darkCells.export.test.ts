// @vitest-environment happy-dom
import ExcelJS from 'exceljs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setAppearance } from '../core/appearance';
import { writeXlsx } from '../formats/xlsx/write';
import { buildSheetSeed } from './model/seed';
import { darkCellsPref } from './darkCells';

afterEach(() => {
  vi.useRealTimers();
  darkCellsPref.set(false);
  setAppearance('system');
  localStorage.clear();
});

/**
 * Dark cells is how this reader's grid draws what was set. What was set is what the workbook holds,
 * so a download, which is made from the workbook, is the same whichever way it was being looked at.
 */
describe('a download while Dark cells is on', () => {
  const seed = buildSheetSeed((b) => {
    const s = b.addSheet('Costs');
    s.cell(0, 0, { value: 'red on yellow', style: { color: '#c0392b', fill: '#fff2a8' } });
    s.cell(1, 0, { value: 'plain' });
  });
  const NOW = Date.UTC(2026, 9, 15, 12);

  async function cells() {
    const out = await writeXlsx(seed, { title: 'Test', now: NOW });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(out.bytes));
    const c = wb.getWorksheet('Costs')!.getCell('A1');
    return { font: c.font.color, fill: c.fill };
  }

  it('writes the colours as they were set', async () => {
    setAppearance('dark');
    const light = await cells();
    darkCellsPref.set(true);
    const dark = await cells();
    expect(dark).toEqual(light);
    expect(dark.font).toMatchObject({ argb: 'FFC0392B' });
    expect(dark.fill).toMatchObject({ fgColor: { argb: 'FFFFF2A8' } });
  });

  it('writes the same file as with it off', async () => {
    // The zip stamps each entry with the clock (two-second steps): two writes either side of a step differ.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    const off = await writeXlsx(seed, { title: 'Test', now: NOW });
    darkCellsPref.set(true);
    setAppearance('dark');
    const on = await writeXlsx(seed, { title: 'Test', now: NOW });
    expect(Buffer.from(on.bytes).equals(Buffer.from(off.bytes))).toBe(true);
  });
});
