import { describe, expect, it } from 'vitest';
import { OWN_FUNCTIONS, formulajsFunctions, isKnownFunction } from '../functions/index';
import { CellError, type Scalar } from '../values';
import { Book, err } from './book';
import { CASES, FIXTURE, FIXTURE_FORMULAS, NAMES, NOW_MS } from './cases';

function fixture(): Book {
  const b = new Book({ Data: [20 + CASES.length, 14], Sheet2: [10, 4] }, { now: () => NOW_MS, timeZone: 'UTC' });
  for (const [a1, v] of FIXTURE) b.set('Data', a1, { v });
  for (const [a1, f] of FIXTURE_FORMULAS) b.input('Data', a1, f);
  for (const [name, ref] of NAMES) b.define(name, ref);
  return b;
}

const norm = (v: Scalar) => (v instanceof CellError ? { error: v.code } : v);

function same(got: unknown, want: unknown): boolean {
  if (typeof want === 'number' && typeof got === 'number') {
    return Math.abs(got - want) <= 1e-9 * Math.max(1, Math.abs(want));
  }
  return JSON.stringify(got) === JSON.stringify(want);
}

describe('functions and operators', () => {
  it(`match Excel on ${CASES.length} cases`, () => {
    const b = fixture();
    // Each case sits in column N from row 20 down, below the fixture.
    CASES.forEach(([f], i) => b.input('Data', `N${20 + i}`, f));
    b.e.recalcAll();
    const failures: string[] = [];
    CASES.forEach(([f, want], i) => {
      const got = norm(b.get('Data', `N${20 + i}`));
      if (!same(got, want)) failures.push(`${f}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
    });
    expect(failures).toEqual([]);
  });

  // formulajs's IRR walks from its guess in steps of 0.1 once Newton's method gives up, so a guess of
  // 1e10 is 1e11 steps (found by the xlsx corpus: an IRR in a real workbook froze the importing tab).
  it('answers #NUM! to an IRR whose guess no root lies near, instead of looping', () => {
    const b = fixture();
    b.input('Data', 'N20', '=IRR({-20,5,5,5,5,5},10000000000)');
    b.input('Data', 'N21', '=IRR({-20,5,5,5,5,5},-10000000000)');
    b.input('Data', 'N22', '=IRR({-20,5,5,5,5,5},-1)');
    b.input('Data', 'N23', '=IRR({-20,5,5,5,5,5},0.2)');
    b.input('Data', 'N24', '=IRR({-20,5,5,5,5,5})');
    const t0 = performance.now();
    b.e.recalcAll();
    expect(performance.now() - t0).toBeLessThan(1000);
    for (const a1 of ['N20', 'N21', 'N22']) expect(err(b.get('Data', a1)), a1).toBe('#NUM!');
    expect(b.get('Data', 'N23')).toBeCloseTo(0.0793, 3);
    expect(b.get('Data', 'N24')).toBeCloseTo(0.0793, 3);
  });

  // SUM and AVERAGE of a column add the numbers as they stand, without making a list of them first (a whole column
  // of 100,000 is the heaviest thing a big sheet recalculates). The floats must be the ones the list gave: the same
  // cells, in the same order, and text, blanks, logicals and an error treated as the list-based aggregates do.
  it('adds a range as the list-based aggregates do, bit for bit, and stops at an error', () => {
    const b = fixture();
    const sheet = b.sheet('Data');
    b.grow(sheet.id, 1700, 14);
    const values: number[] = [];
    for (let i = 1; i <= 1500; i++) {
      // Floats whose sum depends on the order they are added in.
      const v = (i % 13) * 0.1 + i * 1e-9 + (i % 97) * 1e7;
      if (i % 7 === 0) b.set('Data', `K${i}`, { v: 'text' });
      else if (i % 11 === 0) b.set('Data', `K${i}`, { v: i % 2 === 0 });
      else if (i % 17 !== 0) {
        b.set('Data', `K${i}`, { v });
        values.push(v);
      }
    }
    b.input('Data', 'M1', '=SUM(K1:K1500)');
    b.input('Data', 'M2', '=AVERAGE(K1:K1500)');
    b.input('Data', 'M3', '=SUM(K1:K1500,K1:K10)');
    b.input('Data', 'M4', '=AVERAGE(K1600:K1650)');
    b.e.recalcAll();
    let want = 0;
    for (const v of values) want += v;
    expect(b.get('Data', 'M1')).toBe(want);
    expect(b.get('Data', 'M2')).toBe(want / values.length);
    expect(typeof b.get('Data', 'M3')).toBe('number');
    expect(err(b.get('Data', 'M4'))).toBe('#DIV/0!');

    b.set('Data', 'K700', { e: '#N/A' });
    b.e.recalcAll();
    expect(err(b.get('Data', 'M1'))).toBe('#N/A');
    expect(err(b.get('Data', 'M2'))).toBe('#N/A');
  });

  it('gives a reason with an error where there is one', () => {
    const b = fixture();
    b.input('Data', 'N20', '=ROUND()');
    b.input('Data', 'N21', '=NOPE(1)');
    b.e.recalc();
    const a = b.get('Data', 'N20') as CellError;
    expect([a.code, a.detail]).toEqual(['#N/A', 'Wrong number of arguments to ROUND']);
    expect((b.get('Data', 'N21') as CellError).detail).toBe('Unknown function NOPE');
  });

  it('refuses a formula that does not parse, with where', () => {
    const b = fixture();
    const r = b.e.contentFromInput(b.sheet('Data').id, '=SUM(1,2');
    expect(r.kind).toBe('error');
    expect(b.e.contentFromInput(b.sheet('Data').id, '=1+').kind).toBe('error');
    expect(b.e.contentFromInput(b.sheet('Data').id, '=Nope!A1').kind).toBe('content'); // #REF!, as Excel stores it
  });

  it('reads a range by implicit intersection where one value is wanted', () => {
    const b = fixture();
    b.input('Data', 'N3', '=C1:C6*2'); // row 3: C3*2
    b.input('Data', 'N30', '=C1:C6*2'); // outside the range
    b.input('Data', 'N1', '=J2:M2'); // column N is outside J:M
    b.input('Data', 'K5', '=J2:M2+1'); // column K: K2+1
    b.e.recalcAll();
    expect(b.get('Data', 'N3')).toBe(6);
    expect(err(b.get('Data', 'N30'))).toBe('#VALUE!');
    expect(err(b.get('Data', 'N1'))).toBe('#VALUE!');
    expect(b.get('Data', 'K5')).toBe(201);
  });

  it('covers its own functions and falls through to formulajs for the rest', () => {
    for (const f of ['SUM', 'VLOOKUP', 'XLOOKUP', 'INDEX', 'MATCH', 'SUMIFS', 'COUNTIFS', 'AVERAGEIFS', 'IFERROR', 'IFS', 'TEXT', 'NETWORKDAYS']) {
      expect(OWN_FUNCTIONS).toContain(f);
    }
    const rest = formulajsFunctions();
    expect(rest).toContain('PMT');
    expect(rest).not.toContain('SUM');
    expect(isKnownFunction('NORM.S.DIST')).toBe(true);
    expect(isKnownFunction('UTILS')).toBe(false);
    expect(isKnownFunction('NOPE')).toBe(false);
    console.log(`# ${CASES.length} cases; ${OWN_FUNCTIONS.length} functions are ours, ${rest.length} more through formulajs`);
  });
});
