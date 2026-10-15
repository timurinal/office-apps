import { describe, expect, it } from 'vitest';
import { canonicalFamily, FONTS, parseSize, stackFor, stepSize } from './fonts';
import { firstFamily, safeColor, safeFamilyName, safeFontSize, safeIndent, safeLineHeight, safeSpace, toPoints } from './sanitize';

describe('colours', () => {
  it('takes hex and rgb, and nothing that is a name, a function or a second declaration', () => {
    for (const ok of ['#fff', '#ffff', '#3d6cd0', '#3d6cd0cc', 'rgb(1, 2, 3)', 'rgba(1,2,3,0.5)', 'RGB( 255 , 0 , 0 )', 'rgba(0,0,0,.25)']) expect(safeColor(ok), ok).toBe(ok);
    for (const no of ['red', 'transparent', 'currentColor', 'var(--x)', 'url(//e)', '#ggg', '#12345', 'rgb(1,2)', 'rgb(1,2,3); x', '#fff; position:fixed', 'red!important', '', '  ', null, 1, 'x'.repeat(50)]) {
      expect(safeColor(no), String(no)).toBeNull();
    }
  });
});

describe('sizes', () => {
  it('takes a size in points, from one to four hundred', () => {
    expect(safeFontSize('11pt')).toBe('11pt');
    expect(safeFontSize('10.5pt')).toBe('10.5pt');
    for (const no of ['0pt', '401pt', '12px', '12', '12pt;x', 'large', '', null, '-3pt', '1e3pt']) expect(safeFontSize(no), String(no)).toBeNull();
  });

  it('turns a pasted size into points, to the half point, and refuses units it cannot know', () => {
    expect(toPoints('16px')).toBe('12pt');
    expect(toPoints('14.5px')).toBe('11pt');
    expect(toPoints('12pt')).toBe('12pt');
    for (const no of ['2em', '120%', 'larger', '', null, undefined]) expect(toPoints(no as string), String(no)).toBeNull();
  });

  it('reads what is typed in the size box', () => {
    expect(parseSize('12')).toBe(12);
    expect(parseSize(' 10,5 ')).toBe(10.5);
    expect(parseSize('12pt')).toBe(12);
    expect(parseSize('10.3')).toBe(10.5);
    for (const no of ['', 'abc', '0', '500', '-1', '1e2']) expect(parseSize(no), no).toBeNull();
  });

  it('steps along Word’s list, and past its ends', () => {
    expect(stepSize(11, 1)).toBe(12);
    expect(stepSize(11, -1)).toBe(10.5);
    expect(stepSize(13, 1)).toBe(14);
    expect(stepSize(72, 1)).toBe(80);
    expect(stepSize(8, -1)).toBe(7);
    expect(stepSize(1, -1)).toBe(1);
  });
});

describe('fonts', () => {
  it('lists each family with a stack that ends in a generic one, and Inter first', () => {
    expect(FONTS[0]!.name).toBe('Inter');
    for (const f of FONTS) expect(f.stack, f.name).toMatch(/(sans-serif|serif|monospace)$/);
    expect(new Set(FONTS.map((f) => f.name)).size).toBe(FONTS.length);
  });

  it('has metric-compatible stand-ins for the Microsoft fonts', () => {
    expect(stackFor('Calibri')).toContain('Carlito');
    expect(stackFor('Arial')).toContain('Liberation Sans');
    expect(stackFor('Times New Roman')).toContain('Liberation Serif');
    expect(stackFor('Courier New')).toContain('Liberation Mono');
  });

  it('draws a family it does not list in its own name, falling back to the page’s font', () => {
    expect(stackFor('Segoe UI')).toBe(`"Segoe UI", ${FONTS[0]!.stack}`);
    expect(stackFor('calibri')).toBe(stackFor('Calibri'));
  });

  it('refuses a name that could break out of the declaration', () => {
    for (const bad of ['a"; } body { x', 'a;b', 'a{b}', 'url(x)', '', 'x'.repeat(61)]) {
      expect(safeFamilyName(bad), bad).toBeNull();
      expect(stackFor(bad), bad).toBeNull();
    }
    expect(safeFamilyName('Noto Sans CJK JP')).toBe('Noto Sans CJK JP');
    expect(safeFamilyName('Ünïcode Fönt')).toBe('Ünïcode Fönt');
  });

  it('reads the first family of a pasted list, in the listed spelling', () => {
    expect(firstFamily('"Times New Roman", serif')).toBe('Times New Roman');
    expect(firstFamily("'Courier New'")).toBe('Courier New');
    expect(canonicalFamily(firstFamily('arial, sans-serif'))).toBe('Arial');
    expect(canonicalFamily(null)).toBeNull();
    expect(firstFamily('')).toBeNull();
  });
});

describe('block numbers', () => {
  it('line heights, spaces and indents are numbers in range', () => {
    expect(safeLineHeight(1.15)).toBe(1.15);
    expect(safeLineHeight('1.5')).toBe(1.5);
    for (const no of [0, 0.1, 6, '1.5x', 'normal', null, NaN, Infinity]) expect(safeLineHeight(no), String(no)).toBeNull();
    expect(safeSpace(12)).toBe(12);
    expect(safeSpace(0)).toBe(0);
    for (const no of [-1, 201, '12pt', null, NaN]) expect(safeSpace(no), String(no)).toBeNull();
    expect(safeIndent(3)).toBe(3);
    for (const no of [-1, 9, 1.5, '2', null, NaN]) expect(safeIndent(no === '2' ? 'x' : no), String(no)).toBeNull();
  });
});
