import { describe, expect, it } from 'vitest';
import { parseCell, withCategory, withRowAdded, withRowRemoved, withSeriesAdded, withSeriesName, withSeriesRemoved, withValue } from './ChartTab';

const data = () => ({
  categories: ['Q1', 'Q2', 'Q3'],
  series: [
    { name: 'North', values: [1, 2, 3] },
    { name: 'South', values: [4, 5, 6] }
  ]
});

describe('a chart\'s data cell', () => {
  it('is a number, with a comma for a point, and nothing is zero', () => {
    expect(parseCell('4.25')).toBe(4.25);
    expect(parseCell('4,25')).toBe(4.25);
    expect(parseCell(' -3 ')).toBe(-3);
    expect(parseCell('1e3')).toBe(1000);
    expect(parseCell('.5')).toBe(0.5);
    expect(parseCell('')).toBe(0);
    expect(parseCell('   ')).toBe(0);
  });

  it('refuses what is not a number', () => {
    for (const bad of ['abc', '1,2,3', '12px', '--1', '1..2', 'Infinity', 'NaN', '0x10']) expect(parseCell(bad), bad).toBeNull();
  });
});

describe('a chart\'s data edits', () => {
  it('change one cell and leave the rest', () => {
    expect(withValue(data(), 1, 2, 9).series[1]!.values).toEqual([4, 5, 9]);
    expect(withValue(data(), 1, 2, 9).series[0]!.values).toEqual([1, 2, 3]);
    expect(withCategory(data(), 0, 'Spring').categories).toEqual(['Spring', 'Q2', 'Q3']);
    expect(withSeriesName(data(), 0, 'East').series.map((s) => s.name)).toEqual(['East', 'South']);
  });

  it('add a row with a zero in every series, labelled in order', () => {
    const d = withRowAdded(data(), false);
    expect(d.categories).toEqual(['Q1', 'Q2', 'Q3', 'Item 4']);
    expect(d.series.map((s) => s.values)).toEqual([[1, 2, 3, 0], [4, 5, 6, 0]]);
  });

  it('add a scatter\'s row one x past the last', () => {
    const d = withRowAdded({ categories: ['1', '2.5'], series: [{ name: 'a', values: [1, 2] }] }, true);
    expect(d.categories).toEqual(['1', '2.5', '3.5']);
    expect(withRowAdded({ categories: ['a'], series: [{ name: 'a', values: [1] }] }, true).categories).toEqual(['a', 'Item 2']);
  });

  it('remove a row from every series, and a series by itself', () => {
    const d = withRowRemoved(data(), 1);
    expect(d.categories).toEqual(['Q1', 'Q3']);
    expect(d.series.map((s) => s.values)).toEqual([[1, 3], [4, 6]]);
    expect(withSeriesRemoved(data(), 0).series.map((s) => s.name)).toEqual(['South']);
  });

  it('add a series of zeros the length of the categories, named in order', () => {
    const d = withSeriesAdded(data());
    expect(d.series[2]).toEqual({ name: 'Series 3', values: [0, 0, 0] });
  });

  it('never leave a series shorter or longer than the categories', () => {
    let d = data();
    for (const step of [withRowAdded, (x: typeof d) => withRowRemoved(x, 0), withSeriesAdded, (x: typeof d) => withRowAdded(x, true)]) {
      d = step(d as never, false as never) as typeof d;
      expect(d.series.every((s) => s.values.length === d.categories.length)).toBe(true);
    }
  });
});
