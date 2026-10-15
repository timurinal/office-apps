/**
 * A formula as a file writes it, and as the engine reads it.
 *
 * The text is the same grammar, with one wrinkle: a function Excel added after 2007 is stored
 * under a prefix, `_xlfn.XLOOKUP(`, so that an old Excel shows `#NAME?` and not a wrong answer.
 * The engine knows no prefixes, so they come off on the way in and go back on the way out.
 */

import { isKnownFunction } from '../../sheets/engine';

/** Quoted runs a formula's text can hold: a string, or a sheet name. What is inside is not formula. */
const QUOTED = /"(?:[^"]|"")*"|'(?:[^']|'')*'/g;

/** `f` with `change` applied to everything outside quotes. */
function outsideQuotes(f: string, change: (s: string) => string): string {
  let out = '';
  let at = 0;
  for (const m of f.matchAll(QUOTED)) {
    out += change(f.slice(at, m.index)) + m[0];
    at = m.index + m[0].length;
  }
  return out + change(f.slice(at));
}

/**
 * A block from the first row to the last one Excel has, or from the first column to the last, is how some tools write
 * a whole column or a whole row. Left as it is, a reference to row 1,048,576 would have the sheet grow to that many
 * rows; said the way Excel says it, it grows nothing and means the same.
 */
function wholeLines(s: string): string {
  return s
    .replace(/(\$?[A-Za-z]{1,3})\$?1:(\$?[A-Za-z]{1,3})\$?1048576(?![0-9])/g, (_, a: string, b: string) => `${a}:${b}`)
    .replace(/(?<![A-Za-z0-9_.$])\$?[Aa]\$?(\d{1,7}):\$?[Xx][Ff][Dd]\$?(\d{1,7})(?![0-9])/g, (m: string, a: string, b: string) => (a === b ? `${a}:${b}` : m));
}

/** The formula without its `=` and without the prefixes Excel adds to newer functions. */
export function fromFile(f: string): string {
  const text = f.startsWith('=') ? f.slice(1) : f;
  return outsideQuotes(text, (s) => wholeLines(s.replace(/_xl(?:fn|ws|pm)\./gi, '')));
}

/** Functions added after Excel 2007, which a file names with `_xlfn.` in front. */
const FUTURE = new Set(
  (
    'BETA.DIST BETA.INV BINOM.DIST BINOM.INV CEILING.PRECISE CHISQ.DIST CHISQ.DIST.RT CHISQ.INV CHISQ.INV.RT CHISQ.TEST CONFIDENCE.NORM CONFIDENCE.T COVARIANCE.P COVARIANCE.S ' +
    'ERF.PRECISE ERFC.PRECISE EXPON.DIST F.DIST F.DIST.RT F.INV F.INV.RT F.TEST FLOOR.PRECISE GAMMA.DIST GAMMA.INV GAMMALN.PRECISE HYPGEOM.DIST LOGNORM.DIST LOGNORM.INV ' +
    'MODE.MULT MODE.SNGL NEGBINOM.DIST NORM.DIST NORM.INV NORM.S.DIST NORM.S.INV PERCENTILE.EXC PERCENTILE.INC PERCENTRANK.EXC PERCENTRANK.INC POISSON.DIST QUARTILE.EXC QUARTILE.INC ' +
    'RANK.AVG RANK.EQ STDEV.P STDEV.S T.DIST T.DIST.2T T.DIST.RT T.INV T.INV.2T T.TEST VAR.P VAR.S WEIBULL.DIST Z.TEST ' +
    'ACOT ACOTH ARABIC BASE BITAND BITLSHIFT BITOR BITRSHIFT BITXOR CEILING.MATH COMBINA COT COTH CSC CSCH DAYS DECIMAL ENCODEURL FILTERXML FLOOR.MATH FORMULATEXT GAMMA GAUSS IFNA ' +
    'IMCOSH IMCOT IMCSC IMCSCH IMSEC IMSECH IMSINH IMTAN ISFORMULA ISOWEEKNUM MUNIT NUMBERVALUE PDURATION PERMUTATIONA PHI RRI SEC SECH SHEET SHEETS SKEW.P UNICHAR UNICODE WEBSERVICE XOR ' +
    'CONCAT IFS MAXIFS MINIFS SWITCH TEXTJOIN XLOOKUP XMATCH UNIQUE SEQUENCE RANDARRAY SORTBY TEXTBEFORE TEXTAFTER TEXTSPLIT VSTACK HSTACK TOCOL TOROW WRAPROWS WRAPCOLS CHOOSEROWS CHOOSECOLS DROP TAKE EXPAND'
  ).split(' ')
);

/** These two carry a second prefix. */
const FUTURE_SHEET = new Set(['FILTER', 'SORT']);

/** A formula the engine printed, as a file should hold it. */
export function toFile(f: string): string {
  const text = f.startsWith('=') ? f.slice(1) : f;
  return outsideQuotes(text, (s) =>
    s.replace(/([A-Za-z][A-Za-z0-9.]*)\(/g, (m, name: string) => {
      const upper = name.toUpperCase();
      if (FUTURE.has(upper)) return `_xlfn.${upper}(`;
      if (FUTURE_SHEET.has(upper)) return `_xlfn._xlws.${upper}(`;
      return m;
    })
  );
}

/** The names a formula calls, once each, in upper case and without prefixes. */
export function functionsIn(f: string): string[] {
  const out = new Set<string>();
  outsideQuotes(f, (s) => {
    for (const m of s.matchAll(/([A-Za-z_][A-Za-z0-9_.]*)\(/g)) out.add(m[1]!.toUpperCase());
    return s;
  });
  return [...out];
}

/** The first function in the formula that the engine does not have, or undefined. */
export function unknownFunction(f: string): string | undefined {
  return functionsIn(f).find((n) => !isKnownFunction(n));
}

/** The largest row any reference in the formula names, outside quotes. Whole columns name none. */
export function farthestRow(f: string): number {
  let max = 0;
  outsideQuotes(f, (s) => {
    for (const m of s.matchAll(/(?<![A-Za-z0-9_.$])\$?[A-Za-z]{1,3}\$?(\d{1,7})(?![0-9(A-Za-z_.])/g)) max = Math.max(max, Number(m[1]));
    return s;
  });
  return max;
}
