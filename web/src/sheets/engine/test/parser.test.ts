import { describe, expect, it } from 'vitest';
import { FormulaSyntaxError, colToLetters, lettersToCol, parseCellAddress, parseStored, printStored } from '../parser';
import { Book } from './book';

function book(): Book {
  const b = new Book({ Sheet1: [20, 6], Sheet2: [5, 5], 'Q3 Plan': [5, 2], "It's": [2, 2] });
  b.define('Keys', 'Sheet1!$E$1:$E$5');
  return b;
}

/** Typed, stored, and printed back. */
function roundTrip(b: Book, text: string): string | undefined {
  b.input('Sheet1', 'F20', text);
  return b.formula('Sheet1', 'F20');
}

describe('the parser', () => {
  it.each([
    '=SUM($A$1:B$5)*-2^2%',
    "='Q3 Plan'!A1+SUM(Sheet2!B:B)",
    '=SUM(3:3)+SUM($C:$D)',
    '={1,2;"a",TRUE}',
    '=IF(A1<>"x",#N/A,"a""b")',
    '=SUM(A1:A3,(B1,C2))',
    '=Keys*2',
    '=-(-1)',
    '=1E+21',
    '=0.5',
    '=A1:INDEX(B:B,2)',
    '=NORM.S.DIST(0,TRUE)',
    '=IF(,1,)',
    '=50%',
    "='It''s'!B2",
    '=Sheet1!A1',
    '=1-2-3',
    '=2^3^2',
    '=(1+2)*3',
    '="a"&"b"&"c"',
    '=A1>=B1',
    '=A:A'
  ])('%s survives A1 → stored → A1', (f) => {
    expect(roundTrip(book(), f)).toBe(f);
  });

  it('normalises what Excel normalises', () => {
    const b = book();
    expect(roundTrip(b, '= sum( a1 , 2 )')).toBe('=SUM(A1,2)');
    expect(roundTrip(b, '=SUM(B5:A1)')).toBe('=SUM(A1:B5)');
    expect(roundTrip(b, '=SUM($B5:A$1)')).toBe('=SUM(A$1:$B5)');
    expect(roundTrip(b, '=sheet2!a1')).toBe('=Sheet2!A1');
    expect(roundTrip(b, '=true')).toBe('=TRUE');
    expect(roundTrip(b, '=#n/a')).toBe('=#N/A');
    expect(roundTrip(b, '={-1,2.5E-3}')).toBe('={-1,0.0025}');
    expect(roundTrip(b, '=Sheet2!A1:Sheet2!B2')).toBe('=Sheet2!A1:B2');
  });

  it('a reference to a sheet that does not exist is #REF!', () => {
    expect(roundTrip(book(), '=Nope!A1+1')).toBe('=#REF!+1');
  });

  it.each([
    ['=SUM(1,2', 'unclosed'],
    ['=1+', 'dangling operator'],
    ['=(1+2', 'unclosed parenthesis'],
    ['="abc', 'unclosed string'],
    ['=SUM(A1:Sheet2!B2)', 'two sheets'],
    ['={1,2;3}', 'ragged array'],
    ['=1 2', 'intersection, unsupported']
  ])('refuses %s (%s)', (f) => {
    const b = book();
    const r = b.e.contentFromInput(b.sheet('Sheet1').id, f);
    expect(r.kind).toBe('error');
  });

  it('stores ids, and refuses A1 in a stored formula', () => {
    const f = '=SUM(`$r1.$c1`:`r10.c1`)+`s2!r1.c2`*SUM(`.c3`:`.c4`)+SUM(`r5.`:`r6.`)';
    expect(printStored(parseStored(f))).toBe(f);
    expect(() => parseStored('=A1+1')).toThrow(FormulaSyntaxError);
    expect(() => parseStored("=Sheet2!`r1.c1`")).toThrow(FormulaSyntaxError);
  });

  it('converts addresses', () => {
    expect([colToLetters(0), colToLetters(25), colToLetters(26), colToLetters(16383)]).toEqual(['A', 'Z', 'AA', 'XFD']);
    expect(lettersToCol('XFD')).toBe(16383);
    expect(parseCellAddress('$B$3')).toEqual({ row: 2, col: 1 });
    expect(parseCellAddress('XFE1')).toBeUndefined();
  });
});
