/**
 * Sheets to look at: the board's budget, a sheet that uses every way a cell can look, and a
 * hundred thousand rows. They are the harness's, and some tests use the first.
 */

import { colToLetters } from '../a1';
import type { PeerSelection } from '../types';
import { FakeSheet, type Generated } from './fake';

const GBP = '£#,##0';

/** The Sheets board: "Budget 2027", a header row, six categories and a total row. */
export function budgetSheet(): FakeSheet {
  const s = new FakeSheet({ rows: 200, cols: 26, colWidth: 112 });
  s.setColWidth(0, 180);
  s.setColWidth(5, 120);
  const bold = s.style({ bold: true });
  const head = s.style({ bold: true, fill: '#f3f5fe' });
  const money = s.style({ numFmt: GBP, h: 'right' });
  const moneyBold = s.style({ numFmt: GBP, bold: true });
  s.put(0, 0, 'Budget 2027', { bold: true, size: 11.25 });
  ['Category', 'Q1', 'Q2', 'Q3', 'Q4', 'Total'].forEach((t, c) => s.put(2, c, t, c === 0 ? head : { bold: true, fill: '#f3f5fe', h: 'right' }));
  const rows: [string, number, number, number, number][] = [
    ['Salaries', 48000, 48000, 52000, 52000],
    ['Contractors', 6500, 8000, 9000, 7500],
    ['Software', 2400, 2400, 2600, 2600],
    ['Hosting', 1100, 1200, 1300, 1400],
    ['Travel', 900, 1500, 600, 2000],
    ['Marketing', 3000, 4500, 6000, 8500]
  ];
  rows.forEach(([name, ...q], i) => {
    const r = 3 + i;
    s.put(r, 0, name);
    q.forEach((v, c) => s.put(r, 1 + c, String(v), money));
    s.put(r, 5, `=SUM(B${r + 1}:E${r + 1})`, money);
  });
  s.put(9, 0, 'Total', bold);
  for (let c = 1; c <= 4; c++) s.put(9, c, `=SUM(${colToLetters(c)}4:${colToLetters(c)}9)`, moneyBold);
  s.put(9, 5, '=SUM(F4:F9)', moneyBold);
  return s;
}

export const PRIYA: PeerSelection = {
  clientId: 7,
  name: 'Priya',
  color: '#886193',
  rect: { r1: 4, r2: 4, c1: 2, c2: 2 },
  active: { row: 4, col: 2 }
};

/** Every way a cell can look, at fixed places the tests and a person can find. */
export function sinkSheet(): FakeSheet {
  const s = new FakeSheet({ rows: 300, cols: 26, colWidth: 110 });
  s.mergeList = [{ r1: 0, r2: 0, c1: 0, c2: 3 }, { r1: 15, r2: 17, c1: 6, c2: 7 }];
  s.put(0, 0, 'Every kind of cell', { bold: true, size: 14, h: 'center', fill: '#e7f5ee' });

  ['left', 'center', 'right', 'general'].forEach((h, c) => s.put(2, c, `align ${h}`, { h: h as 'left' }));
  s.put(3, 0, '1234.5', { h: 'general' }).put(3, 1, 'TRUE').put(3, 2, '=1/0').put(3, 3, 'text');

  s.put(4, 0, 'Bold', { bold: true }).put(4, 1, 'Italic', { italic: true }).put(4, 2, 'Underline', { underline: true });
  s.put(4, 3, 'Strike', { strike: true }).put(4, 4, 'Colour', { color: '#b3261e' }).put(4, 5, 'Big', { size: 16 }).put(4, 6, 'Fill', { fill: '#fff4cc' });

  s.setRowHeight(5, 56);
  s.put(5, 0, 'A long sentence that has to wrap inside its cell', { wrap: true, v: 'top' });
  s.put(5, 1, 'Wrapped and middle', { wrap: true, v: 'middle' });
  s.put(5, 2, 'Wrapped and bottom', { wrap: true, v: 'bottom' });
  s.put(5, 3, 'indent 1', { indent: 1 }).put(5, 4, 'indent 2', { indent: 2 });

  (['thin', 'medium', 'thick', 'dashed', 'dotted', 'double'] as const).forEach((line, c) => {
    const b = { line, color: '#292b31' };
    s.put(7, c, line, { borderTop: b, borderRight: b, borderBottom: b, borderLeft: b, h: 'center' });
  });

  s.put(9, 0, 'This heading runs on across the empty cells beside it');
  s.put(10, 0, 'This one is cut off by its neighbour');
  s.put(10, 1, 'next');
  s.put(11, 3, 'Right aligned text that spills to the left', { h: 'right' });
  s.setColWidth(7, 44);
  s.put(12, 7, '123456789');
  s.put(12, 0, 'Centred text that is much wider than its cell', { h: 'center' });
  s.put(12, 5, 'x');

  s.put(13, 0, 'Error', { h: 'general' }).put(13, 1, '=1/0');
  s.put(13, 2, 'Commented').patch(13, 2, { commented: true });
  s.put(13, 3, 'Pending').lists.set(13 * 16384 + 3, ['Pending', 'Approved', 'Rejected']);
  s.put(14, 0, 'Conditional').patch(14, 0, { conditional: { fill: '#ffd9d6', color: '#b3261e', bold: true } });
  s.put(14, 1, '-1250', { numFmt: '[Red]#,##0' }).patch(14, 1, { color: '#b3261e' });

  s.put(15, 6, 'A merged block', { h: 'center', v: 'middle', fill: '#eef0f8', bold: true });
  s.setRowHeight(18, 60);
  s.put(18, 0, 'top', { v: 'top' }).put(18, 1, 'middle', { v: 'middle' }).put(18, 2, 'bottom', { v: 'bottom' });

  for (let r = 20; r < 40; r++) s.put(r, 0, `Row ${r + 1}`).put(r, 1, String((r * 37) % 100));
  s.filterInfo = { headerRow: 2, cols: [0, 1, 2], active: [1] };
  return s;
}

/** A hundred thousand rows by 26, made on demand: labels, money, percentages, dates and formulas. */
export function bigSheet(rows = 100_000, cols = 26): FakeSheet {
  const s = new FakeSheet({ rows, cols, colWidth: 96 });
  s.setColWidth(0, 160);
  const head = s.style({ bold: true, fill: '#f3f5fe' });
  const money = s.style({ numFmt: GBP });
  const pct = s.style({ numFmt: '0.0%' });
  const dec = s.style({ numFmt: '0.00' });
  const bold = s.style({ bold: true, numFmt: GBP });
  const plain = s.style({});
  const note = s.style({ italic: true, color: '#75798c' });
  const fmt = (n: number, f: 'money' | 'pct' | 'dec') =>
    f === 'money' ? `£${Math.round(n).toLocaleString('en-GB')}` : f === 'pct' ? `${(n * 100).toFixed(1)}%` : n.toFixed(2);
  const num = (r: number, c: number) => ((r * 7919 + c * 104729 + r * c) % 100000) / 1;
  s.generate = (r, c): Generated | null => {
    if (r === 0) return { edit: `Column ${colToLetters(c)}`, text: `Column ${colToLetters(c)}`, kind: 'text', style: head };
    if (c === 0) return { edit: `Item ${r}`, text: `Item ${r}`, kind: 'text', style: plain };
    if (c === 1 || c === 2 || c === 3 || c === 4) {
      const v = num(r, c);
      return { edit: String(v), text: fmt(v, 'money'), kind: 'number', value: v, style: money };
    }
    if (c === 5) {
      const v = (num(r, c) % 1000) / 1000;
      return { edit: String(v), text: fmt(v, 'pct'), kind: 'number', value: v, style: pct };
    }
    if (c === 6) return { edit: `Note for row ${r}`, text: `Note for row ${r}`, kind: 'text', style: note };
    if (c === 7) {
      const v = num(r, c) / 1000;
      return { edit: String(v), text: fmt(v, 'dec'), kind: 'number', value: v, style: dec };
    }
    if (c === cols - 1) {
      const v = num(r, 1) + num(r, 2) + num(r, 3) + num(r, 4);
      return { edit: `=SUM(B${r + 1}:E${r + 1})`, text: fmt(v, 'money'), kind: 'number', value: v, style: bold };
    }
    if (c % 3 === 0) {
      const v = num(r, c);
      return { edit: String(v), text: fmt(v, 'money'), kind: 'number', value: v, style: money };
    }
    if (c % 3 === 1) return r % 5 === 0 ? { edit: `Row ${r + 1}`, text: `Row ${r + 1}`, kind: 'text', style: plain } : null;
    return null;
  };
  return s;
}
