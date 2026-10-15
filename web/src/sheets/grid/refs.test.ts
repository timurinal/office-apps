import { describe, expect, it } from 'vitest';
import { addressOf, applyCompletion, canPoint, completionAt, cycleAbsolute, REF_COLORS, scanRefs, splice } from './refs';

const texts = (s: string) => scanRefs(s).map((t) => t.text);

describe('finding the references in a formula', () => {
  it('reads cells, ranges, columns and rows', () => {
    expect(texts('=SUM(B2:B9)+C1')).toEqual(['B2:B9', 'C1']);
    expect(texts('=A:A+B:C')).toEqual(['A:A', 'B:C']);
    expect(texts('=SUM(2:4)')).toEqual(['2:4']);
    expect(texts('=$A$1+B$2+$C3')).toEqual(['$A$1', 'B$2', '$C3']);
    expect(texts('=a1+b2')).toEqual(['a1', 'b2']);
  });

  it('gives each span and the rectangle it names, as today\'s indexes', () => {
    const [t] = scanRefs('=SUM(B2:C4)');
    expect(t).toMatchObject({ start: 5, end: 10, rect: { r1: 1, r2: 3, c1: 1, c2: 2 }, foreign: false });
    expect(scanRefs('=C4:B2')[0]!.rect).toEqual({ r1: 1, r2: 3, c1: 1, c2: 2 });
  });

  it('has none in text that is not a formula', () => {
    expect(scanRefs('B2')).toEqual([]);
    expect(scanRefs('hello =B2')).toEqual([]);
  });

  it('does not read a function, a name, a number or a string as a reference', () => {
    expect(texts('=LOG10(100)')).toEqual([]);
    expect(texts('=SUM (A1:A2)')).toEqual(['A1:A2']);
    expect(texts('=Revenue*TaxRate')).toEqual([]);
    expect(texts('=1E5+2.5')).toEqual([]);
    expect(texts('="B2 is not a ref"&C3')).toEqual(['C3']);
    expect(texts('="a ""B2"" b"&C3')).toEqual(['C3']);
    expect(texts('=TRUE')).toEqual([]);
  });

  it('marks a reference to another sheet and still colours it', () => {
    const t = scanRefs("=Sheet2!A1+'My sheet'!B2:C3+D4");
    expect(t.map((x) => [x.text, x.foreign])).toEqual([
      ['Sheet2!A1', true],
      ["'My sheet'!B2:C3", true],
      ['D4', false]
    ]);
    expect(texts("=Q1!A1")).toEqual(['Q1!A1']);
  });

  it('reads half a formula as well as a whole one', () => {
    expect(texts('=SUM(A1:')).toEqual(['A1']);
    expect(texts('=A1+')).toEqual(['A1']);
    expect(texts('=SUM(')).toEqual([]);
  });

  it('refuses an address outside the grid', () => {
    expect(texts('=ZZZZ1')).toEqual([]);
    expect(texts('=A99999999')).toEqual([]);
  });
});

describe('colouring', () => {
  it('gives each distinct reference the next colour, in order, from the first', () => {
    const t = scanRefs('=A1+B1+C1');
    expect(t.map((x) => x.color)).toEqual([0, 1, 2]);
  });

  it('gives the same reference the same colour', () => {
    const t = scanRefs('=A1+B1+$A$1+a1');
    expect(t.map((x) => x.color)).toEqual([0, 1, 0, 0]);
  });

  it('starts over after the palette, and the first is the app green of the board', () => {
    const t = scanRefs('=' + 'ABCDEFGH'.split('').map((c) => `${c}1`).join('+'));
    expect(t.map((x) => x.color)).toEqual([0, 1, 2, 3, 4, 5, 0, 1]);
    expect(REF_COLORS[0]!.line).toBe('#43a873');
    expect(REF_COLORS[0]!.ink).toBe('#1e8255');
  });
});

describe('where an address may be written', () => {
  it('after the equals sign, an operator, a bracket, a comma or a colon', () => {
    for (const text of ['=', '=SUM(', '=A1+', '=A1-', '=A1*', '=A1/', '=A1,', '=IF(A1>', '=A1&', '=SUM(A1:', '= ']) {
      expect(canPoint(text, text.length), text).toBe(true);
    }
  });

  it('not after an operand or a closing bracket', () => {
    for (const text of ['=A1', '=SUM(A1)', '=1', '=SUM(A1) ', '=TRUE']) {
      expect(canPoint(text, text.length), text).toBe(false);
    }
  });

  it('not in text, and not inside a string', () => {
    expect(canPoint('hello', 5)).toBe(false);
    expect(canPoint('="a+', 4)).toBe(false);
    expect(canPoint('="a"+', 5)).toBe(true);
  });

  it('looks at the caret, not the end', () => {
    expect(canPoint('=SUM(A1)', 5)).toBe(true);
    expect(canPoint('=SUM(A1)', 8)).toBe(false);
  });

  it('writes an address over a span', () => {
    expect(splice('=SUM(', 5, 5, 'B2')).toEqual({ text: '=SUM(B2', caret: 7, start: 5, end: 7 });
    expect(splice('=SUM(B2)', 5, 7, 'B2:B9')).toEqual({ text: '=SUM(B2:B9)', caret: 10, start: 5, end: 10 });
  });

  it('prints a cell or a range', () => {
    expect(addressOf({ row: 1, col: 1 }, { row: 1, col: 1 })).toBe('B2');
    expect(addressOf({ row: 1, col: 1 }, { row: 8, col: 1 })).toBe('B2:B9');
  });
});

describe('F4', () => {
  it('goes round relative, absolute, row absolute and column absolute', () => {
    let text = '=SUM(B2)';
    const seen: string[] = [];
    for (let i = 0; i < 5; i++) {
      const r = cycleAbsolute(text, 7)!;
      text = r.text;
      seen.push(text);
    }
    expect(seen).toEqual(['=SUM($B$2)', '=SUM(B$2)', '=SUM($B2)', '=SUM(B2)', '=SUM($B$2)']);
  });

  it('changes a whole range together', () => {
    expect(cycleAbsolute('=SUM(B2:B9)', 8)!.text).toBe('=SUM($B$2:$B$9)');
  });

  it('does nothing where the caret is not on a reference', () => {
    expect(cycleAbsolute('=SUM(B2)', 2)).toBeNull();
    expect(cycleAbsolute('hello', 2)).toBeNull();
  });
});

describe('completing a name', () => {
  it('finds the word at the caret', () => {
    expect(completionAt('=SU', 3)).toEqual({ from: 1, prefix: 'SU' });
    expect(completionAt('=1+SU', 5)).toEqual({ from: 3, prefix: 'SU' });
    expect(completionAt('=IF(Rev', 7)).toEqual({ from: 4, prefix: 'Rev' });
  });

  it('is not an address being typed, a string, or text', () => {
    expect(completionAt('=B2', 3)).toBeNull();
    expect(completionAt('="SU', 4)).toBeNull();
    expect(completionAt('SU', 2)).toBeNull();
    expect(completionAt('=', 1)).toBeNull();
    expect(completionAt('=A1+', 4)).toBeNull();
  });

  it('writes the function and its bracket, once', () => {
    expect(applyCompletion('=SU', 1, 3, 'SUM', true)).toMatchObject({ text: '=SUM(', caret: 5 });
    expect(applyCompletion('=SU(A1)', 1, 3, 'SUM', true)).toMatchObject({ text: '=SUM(A1)', caret: 4 });
    expect(applyCompletion('=Rev', 1, 4, 'Revenue', false)).toMatchObject({ text: '=Revenue', caret: 8 });
  });
});
