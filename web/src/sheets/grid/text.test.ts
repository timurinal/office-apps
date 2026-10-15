import { describe, expect, it } from 'vitest';
import { MergeIndex } from './merges';
import { alignOf, breakLines, fontFor, hashes, TextMeter } from './text';

/** Every character is 10 wide. */
const w = (s: string) => s.length * 10;

describe('alignment', () => {
  it('puts numbers right, text left, and booleans and errors in the middle, until told otherwise', () => {
    expect(alignOf({ kind: 'number', style: {} })).toBe('right');
    expect(alignOf({ kind: 'text', style: {} })).toBe('left');
    expect(alignOf({ kind: 'boolean', style: {} })).toBe('center');
    expect(alignOf({ kind: 'error', style: {} })).toBe('center');
    expect(alignOf({ kind: 'number', style: { h: 'left' } })).toBe('left');
    expect(alignOf({ kind: 'text', style: { h: 'general' } })).toBe('left');
  });
});

describe('breaking lines', () => {
  it('breaks at spaces', () => {
    expect(breakLines('one two three four', 100, w)).toEqual(['one two', 'three four']);
  });

  it('keeps a short text whole', () => {
    expect(breakLines('hello', 100, w)).toEqual(['hello']);
  });

  it('breaks a word that is wider than the cell, anywhere', () => {
    expect(breakLines('abcdefghij', 40, w)).toEqual(['abcd', 'efgh', 'ij']);
  });

  it('breaks at a newline, and keeps an empty line', () => {
    expect(breakLines('a\n\nb', 100, w)).toEqual(['a', '', 'b']);
  });

  it('fits every line to the width', () => {
    for (const line of breakLines('the quick brown fox jumps over the lazy dog', 90, w)) expect(w(line)).toBeLessThanOrEqual(90);
  });
});

describe('number that does not fit', () => {
  it('is as many hashes as fit, at least one', () => {
    expect(hashes(45, 10)).toBe('####');
    expect(hashes(3, 10)).toBe('#');
  });
});

describe('fonts', () => {
  it('sets the size in points to pixels at the scale, and bold at 600', () => {
    const f = fontFor({ size: 12, bold: true, italic: true }, undefined, 2);
    expect(f.px).toBe(32);
    expect(f.css).toMatch(/^italic 600 32px Inter/);
  });

  it('is 10 points by default, 13.33px at 100%', () => {
    expect(fontFor({}, undefined, 1).px).toBeCloseTo(13.333, 2);
  });

  it('takes bold and italic from a conditional format', () => {
    expect(fontFor({}, { bold: true }, 1).css).toMatch(/^600 /);
    expect(fontFor({ bold: true }, { bold: false }, 1).css).toMatch(/^400 /);
  });

  it('names a font that is not Inter, with the fallbacks after it', () => {
    expect(fontFor({ font: 'Courier New' }, undefined, 1).css).toContain('"Courier New", Inter');
  });
});

describe('the meter', () => {
  it('measures a width once and remembers it, and forgets when told', () => {
    let calls = 0;
    const ctx = { font: '', measureText: (s: string) => (calls++, { width: s.length * 7 }) } as unknown as CanvasRenderingContext2D;
    const m = new TextMeter(ctx);
    expect(m.width('13px x', 'hello')).toBe(35);
    expect(m.width('13px x', 'hello')).toBe(35);
    expect(calls).toBe(1);
    expect(m.width('14px x', 'hello')).toBe(35);
    expect(calls).toBe(2);
    m.reset();
    m.width('13px x', 'hello');
    expect(calls).toBe(3);
  });

  it('selects a font again after the context has been restored', () => {
    const sets: string[] = [];
    const ctx = {
      set font(v: string) {
        sets.push(v);
      },
      get font() {
        return '';
      },
      measureText: () => ({ width: 1 })
    } as unknown as CanvasRenderingContext2D;
    const m = new TextMeter(ctx);
    m.setFont('a');
    m.setFont('a');
    expect(sets).toEqual(['a']);
    m.forgetFont();
    m.setFont('a');
    expect(sets).toEqual(['a', 'a']);
  });
});

describe('merged areas', () => {
  const merges = [
    { r1: 0, r2: 0, c1: 0, c2: 3 },
    { r1: 40, r2: 42, c1: 1, c2: 2 },
    { r1: 100, r2: 5000, c1: 0, c2: 0 }
  ];
  const index = new MergeIndex(merges);

  it('answers the merge a cell is in, or null', () => {
    expect(index.at(0, 2)).toBe(merges[0]);
    expect(index.at(41, 2)).toBe(merges[1]);
    expect(index.at(41, 3)).toBeNull();
    expect(index.at(2500, 0)).toBe(merges[2]);
    expect(index.at(5001, 0)).toBeNull();
  });

  it('lists those that touch a rectangle', () => {
    expect(index.within({ r1: 0, r2: 10, c1: 0, c2: 0 })).toEqual([merges[0]]);
    expect(index.within({ r1: 39, r2: 41, c1: 0, c2: 5 })).toEqual([merges[1]]);
    expect(index.within({ r1: 4000, r2: 4100, c1: 0, c2: 5 })).toEqual([merges[2]]);
    expect(index.within({ r1: 10, r2: 20, c1: 0, c2: 5 })).toEqual([]);
  });

  it('is empty when there are none', () => {
    expect(new MergeIndex([]).at(0, 0)).toBeNull();
    expect(new MergeIndex([]).within({ r1: 0, r2: 9, c1: 0, c2: 9 })).toEqual([]);
  });
});
