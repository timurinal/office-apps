import { describe, expect, it } from 'vitest';
import { dateToSerial } from '../engine';
import { currentRegion, defaultTitle, detectLayout, MAX_SERIES, readData } from './series';
import { table, type Entry } from './testing';

const rect = (rows: Entry[][]) => ({ r1: 0, r2: rows.length - 1, c1: 0, c2: Math.max(...rows.map((r) => r.length)) - 1 });
const detect = (rows: Entry[][], type: Parameters<typeof detectLayout>[2] = 'column') => detectLayout(rect(rows), table(rows), type);

const date = (y: number, m: number, d: number): Entry => ({ v: dateToSerial(y, m, d), fmt: 'dd/mm/yyyy' });

describe('detectLayout', () => {
  it('reads a table with a header row and a label column: series in columns', () => {
    expect(
      detect([
        ['', 'Q1', 'Q2'],
        ['Salaries', 48, 50],
        ['Software', 2, 3],
        ['Hosting', 1, 2],
        ['Travel', 1, 1]
      ])
    ).toEqual({ seriesIn: 'cols', headers: true, labels: true });
  });

  it('puts the series in rows when the block is wider than it is tall', () => {
    // Four quarters across, two series down: more columns than rows.
    expect(
      detect([
        ['', 'Q1', 'Q2', 'Q3', 'Q4'],
        ['Salaries', 48, 50, 52, 52],
        ['Software', 2, 3, 3, 3]
      ])
    ).toEqual({ seriesIn: 'rows', headers: true, labels: true });
  });

  it('breaks a tie in favour of columns', () => {
    expect(
      detect([
        ['', 'A', 'B'],
        ['x', 1, 2],
        ['y', 3, 4]
      ])
    ).toEqual({ seriesIn: 'cols', headers: true, labels: true });
  });

  it('knows a single column of numbers with a header', () => {
    expect(detect([['Total'], [10], [20], [30]])).toEqual({ seriesIn: 'cols', headers: true, labels: false });
  });

  it('knows a single column of numbers with no header', () => {
    expect(detect([[10], [20], [30]])).toEqual({ seriesIn: 'cols', headers: false, labels: false });
  });

  it('does not take a row of numbers for a header: a row of years is data', () => {
    expect(
      detect([
        [2021, 2022, 2023],
        [10, 12, 14]
      ])
    ).toEqual({ seriesIn: 'rows', headers: false, labels: false });
  });

  it('takes a first column of numbers as a series, as Excel does', () => {
    expect(
      detect([
        ['Year', 'Sales'],
        [2021, 10],
        [2022, 12],
        [2023, 15]
      ])
    ).toEqual({ seriesIn: 'cols', headers: true, labels: false });
  });

  it('takes it as the labels when its corner is empty, which is how Excel is told', () => {
    expect(
      detect([
        [null, 'Sales', 'Costs'],
        [2021, 10, 4],
        [2022, 12, 5],
        [2023, 15, 6]
      ])
    ).toEqual({ seriesIn: 'cols', headers: true, labels: true });
  });

  it('takes a first column of numbers as x in a scatter', () => {
    expect(
      detect(
        [
          ['Height', 'Weight'],
          [150, 50],
          [160, 58],
          [170, 66]
        ],
        'scatter'
      )
    ).toEqual({ seriesIn: 'cols', headers: true, labels: true });
  });

  it('takes dates in the first column as the labels', () => {
    expect(
      detect([
        ['Date', 'Sales'],
        [date(2025, 1, 1), 10],
        [date(2025, 2, 1), 12],
        [date(2025, 3, 1), 15]
      ])
    ).toEqual({ seriesIn: 'cols', headers: true, labels: true });
  });

  it('tolerates a stray word among numbers', () => {
    expect(
      detect([
        ['Cat', 'Amount'],
        ['a', 10],
        ['b', 'n/a'],
        ['c', 30],
        ['d', 40]
      ])
    ).toEqual({ seriesIn: 'cols', headers: true, labels: true });
  });

  it('has nothing to plot where there are no numbers', () => {
    expect(
      detect([
        ['a', 'b'],
        ['c', 'd']
      ])
    ).toBeNull();
    expect(detect([[null, null]])).toBeNull();
  });

  it('reads a single row of numbers under a name as one series in a row', () => {
    expect(detect([['Total', 10, 20, 30]])).toEqual({ seriesIn: 'rows', headers: true, labels: false });
  });
});

describe('currentRegion', () => {
  const rows: Entry[][] = [
    [null, null, null, null, null, null],
    [null, 'Q', 'A', 'B', null, null],
    [null, 'x', 1, 2, null, null],
    [null, 'y', 3, 4, null, 9],
    [null, null, null, null, null, null],
    [null, null, null, null, null, null]
  ];

  it('grows from one cell to the block joined to it', () => {
    expect(currentRegion(table(rows), { row: 2, col: 2 }, { rows: 6, cols: 6 })).toEqual({ r1: 1, r2: 3, c1: 1, c2: 3 });
  });

  it('is the cell alone when nothing is next to it', () => {
    expect(currentRegion(table(rows), { row: 5, col: 0 }, { rows: 6, cols: 6 })).toEqual({ r1: 5, r2: 5, c1: 0, c2: 0 });
  });

  it('follows a diagonal neighbour, as Excel does', () => {
    expect(currentRegion(table(rows), { row: 3, col: 3 }, { rows: 6, cols: 6 }).c2).toBe(3);
    const diag: Entry[][] = [
      [1, null],
      [null, 2]
    ];
    expect(currentRegion(table(diag), { row: 0, col: 0 }, { rows: 2, cols: 2 })).toEqual({ r1: 0, r2: 1, c1: 0, c2: 1 });
  });

  it('stops at the edge of the sheet', () => {
    const edge: Entry[][] = [
      ['a', 1],
      ['b', 2]
    ];
    expect(currentRegion(table(edge), { row: 1, col: 1 }, { rows: 2, cols: 2 })).toEqual({ r1: 0, r2: 1, c1: 0, c2: 1 });
  });
});

describe('readData', () => {
  const rows: Entry[][] = [
    ['', 'Q1', 'Q2'],
    ['Salaries', 48, 50],
    ['Software', 2, 3],
    ['Hosting', 1, 2]
  ];

  it('reads series in columns under a header row with a label column', () => {
    const d = readData(rect(rows), table(rows), { type: 'column', seriesIn: 'cols', headers: true, labels: true });
    expect(d.labels).toEqual(['Salaries', 'Software', 'Hosting']);
    expect(d.series.map((s) => s.name)).toEqual(['Q1', 'Q2']);
    expect(d.series[0]!.values).toEqual([48, 2, 1]);
    expect(d.series[1]!.values).toEqual([50, 3, 2]);
    expect(d.x).toBeNull();
    expect(d.every).toBe(1);
  });

  it('reads the same block with the series in rows', () => {
    const d = readData(rect(rows), table(rows), { type: 'column', seriesIn: 'rows', headers: true, labels: true });
    expect(d.labels).toEqual(['Q1', 'Q2']);
    expect(d.series.map((s) => s.name)).toEqual(['Salaries', 'Software', 'Hosting']);
    expect(d.series[0]!.values).toEqual([48, 50]);
  });

  it('numbers the points and the series when there are no labels or headers', () => {
    const plain: Entry[][] = [
      [1, 2],
      [3, 4],
      [5, 6]
    ];
    const d = readData(rect(plain), table(plain), { type: 'line', seriesIn: 'cols', headers: false, labels: false });
    expect(d.labels).toEqual(['1', '2', '3']);
    expect(d.series.map((s) => s.name)).toEqual(['Series 1', 'Series 2']);
  });

  it('skips empty cells, text and errors as gaps, and keeps the rest in place', () => {
    const gappy: Entry[][] = [
      ['', 'A'],
      ['a', 1],
      ['b', null],
      ['c', 'n/a'],
      ['d', { error: '#N/A' }],
      ['e', 5]
    ];
    const d = readData(rect(gappy), table(gappy), { type: 'line', seriesIn: 'cols', headers: true, labels: true });
    expect(d.series[0]!.values).toEqual([1, null, null, null, 5]);
    expect(d.labels).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('leaves out hidden and filtered rows and columns', () => {
    const d = readData(rect(rows), table(rows, { rows: [2], cols: [2] }), { type: 'column', seriesIn: 'cols', headers: true, labels: true });
    expect(d.labels).toEqual(['Salaries', 'Hosting']);
    expect(d.series.map((s) => s.name)).toEqual(['Q1']);
    expect(d.series[0]!.values).toEqual([48, 1]);
  });

  it('keeps the number format of each series: the first number it holds', () => {
    const money: Entry[][] = [
      ['', 'Spend'],
      ['Q1', { v: 61_900, fmt: '£#,##0' }],
      ['Q2', { v: 65_600, fmt: '£#,##0' }]
    ];
    const d = readData(rect(money), table(money), { type: 'column', seriesIn: 'cols', headers: true, labels: true });
    expect(d.series[0]!.fmt).toBe('£#,##0');
  });

  it('reads dates in the label column as a time axis, with the numbers behind them', () => {
    const dated: Entry[][] = [
      ['Date', 'Sales'],
      [date(2025, 1, 1), 10],
      [date(2025, 2, 1), 12],
      [date(2025, 4, 1), 15]
    ];
    const d = readData(rect(dated), table(dated), { type: 'line', seriesIn: 'cols', headers: true, labels: true });
    expect(d.xDate).toBe(true);
    expect(d.x).toEqual([dateToSerial(2025, 1, 1), dateToSerial(2025, 2, 1), dateToSerial(2025, 4, 1)]);
    expect(d.xFmt).toBe('dd/mm/yyyy');
    expect(d.labels).toEqual(['01/01/2025', '01/02/2025', '01/04/2025']);
  });

  it('reads numbers in the label column as x values that are not dates', () => {
    const xy: Entry[][] = [
      ['x', 'y'],
      [1.5, 10],
      [2.5, 12]
    ];
    const d = readData(rect(xy), table(xy), { type: 'scatter', seriesIn: 'cols', headers: true, labels: true });
    expect(d.x).toEqual([1.5, 2.5]);
    expect(d.xDate).toBe(false);
  });

  it('has no x when the labels are words', () => {
    expect(readData(rect(rows), table(rows), { type: 'line', seriesIn: 'cols', headers: true, labels: true }).x).toBeNull();
  });

  it('samples a range longer than the chart draws, evenly, and keeps the last point', () => {
    const long: Entry[][] = [['', 'v']];
    for (let i = 0; i < 1000; i++) long.push([`p${i}`, i]);
    const d = readData(rect(long), table(long), { type: 'line', seriesIn: 'cols', headers: true, labels: true, maxPoints: 100 });
    expect(d.total).toBe(1000);
    expect(d.every).toBe(10);
    expect(d.labels.length).toBeLessThanOrEqual(101);
    expect(d.labels[0]).toBe('p0');
    expect(d.labels.at(-1)).toBe('p999');
    expect(d.series[0]!.values.at(-1)).toBe(999);
  });

  it('draws no more series than it can tell apart', () => {
    const wide: Entry[][] = [Array.from({ length: 40 }, (_, i) => `s${i}`), Array.from({ length: 40 }, (_, i) => i)];
    const d = readData(rect(wide), table(wide), { type: 'line', seriesIn: 'cols', headers: true, labels: false });
    expect(d.series).toHaveLength(MAX_SERIES);
  });

  it('names an unnamed series, never with an empty string', () => {
    const odd: Entry[][] = [
      ['', ' ', 'B'],
      ['a', 1, 2]
    ];
    const d = readData(rect(odd), table(odd), { type: 'column', seriesIn: 'cols', headers: true, labels: true });
    expect(d.series.map((s) => s.name)).toEqual(['Series 1', 'B']);
  });
});

describe('defaultTitle', () => {
  it('names a chart after its one series, and leaves several untitled', () => {
    const one: Entry[][] = [['Total'], [1], [2]];
    const d1 = readData(rect(one), table(one), { type: 'column', seriesIn: 'cols', headers: true, labels: false });
    expect(defaultTitle(d1, { headers: true })).toBe('Total');
    const two: Entry[][] = [['A', 'B'], [1, 2]];
    const d2 = readData(rect(two), table(two), { type: 'column', seriesIn: 'cols', headers: true, labels: false });
    expect(defaultTitle(d2, { headers: true })).toBeUndefined();
  });
});
