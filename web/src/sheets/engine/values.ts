/**
 * Values, errors and Excel's coercion rules.
 *
 * A cell holds one of five things: a number, a string, a boolean, an error, or
 * nothing (`null`). Dates are numbers (serials, see dates.ts); there is no date
 * type, as there is none in Excel.
 */

export type ErrorCode = '#NULL!' | '#DIV/0!' | '#VALUE!' | '#REF!' | '#NAME?' | '#NUM!' | '#N/A' | '#SPILL!' | '#CALC!';

export class CellError {
  constructor(
    readonly code: ErrorCode,
    /** Why, for a tooltip. Two errors with one code are the same error. */
    readonly detail?: string
  ) {}
  toString(): string {
    return this.code;
  }
}

export const ERR = {
  null: new CellError('#NULL!'),
  div0: new CellError('#DIV/0!'),
  value: new CellError('#VALUE!'),
  ref: new CellError('#REF!'),
  name: new CellError('#NAME?'),
  num: new CellError('#NUM!'),
  na: new CellError('#N/A'),
  spill: new CellError('#SPILL!'),
  calc: new CellError('#CALC!'),
  // Excel shows 0 and a warning in the status bar; Google Sheets shows #REF! with a
  // tooltip. We follow Google: the cell itself says something is wrong.
  circular: new CellError('#REF!', 'Circular dependency')
};

const LITERALS: Record<string, CellError> = {
  '#NULL!': ERR.null,
  '#DIV/0!': ERR.div0,
  '#VALUE!': ERR.value,
  '#REF!': ERR.ref,
  '#NAME?': ERR.name,
  '#NUM!': ERR.num,
  '#N/A': ERR.na,
  '#SPILL!': ERR.spill,
  '#CALC!': ERR.calc
};

/** The error an error literal names (`#N/A`, any case), or undefined. */
export function errorFromLiteral(s: string): CellError | undefined {
  return LITERALS[s.toUpperCase()];
}

export const ERROR_LITERAL = /^#(?:NULL!|DIV\/0!|VALUE!|REF!|NAME\?|NUM!|N\/A|SPILL!|CALC!)/i;

/** `null` is an empty cell. */
export type Scalar = number | string | boolean | CellError | null;

export const isError = (v: unknown): v is CellError => v instanceof CellError;

/**
 * A number as text, the way `&` and text functions see it: 15 significant digits,
 * no trailing zeros, scientific outside [1e-5, 1e15).
 */
export function numberToText(n: number): string {
  if (n === 0) return '0';
  if (Number.isInteger(n) && Math.abs(n) < 1e15) return String(n);
  const [mant = '0', exp = '0'] = n.toExponential(14).split('e');
  const e = Number(exp);
  if (e >= 15 || e < -5) {
    const m = mant.replace(/\.?0+$/, '');
    return `${m}E${e < 0 ? '-' : '+'}${String(Math.abs(e)).padStart(2, '0')}`;
  }
  return String(parseFloat(n.toPrecision(15)));
}

/** A number rounded to the 15 significant digits Excel keeps. */
export function round15(n: number): number {
  return Number.isFinite(n) && n !== 0 ? parseFloat(n.toPrecision(15)) : n;
}

const NUMERIC = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;
const GROUPED = /^[+-]?\d{1,3}(?:,\d{3})+(?:\.\d*)?$/;
const CURRENCY = /^[$£€¥]/;

/**
 * Text to a number as Excel's implicit conversion does it: " 5 ", "1,234.5",
 * "12%", "$5", "(5)". Dates and times are not numbers here; see dates.ts.
 */
export function parseNumber(s: string): number | undefined {
  let t = s.trim();
  if (t === '') return undefined;
  let sign = 1;
  if (t.startsWith('(') && t.endsWith(')')) {
    sign = -1;
    t = t.slice(1, -1).trim();
  }
  let scale = 1;
  if (t.endsWith('%')) {
    scale = 0.01;
    t = t.slice(0, -1).trim();
  }
  if (t.startsWith('-') || t.startsWith('+')) {
    const rest = t.slice(1).trim();
    if (CURRENCY.test(rest)) t = t[0] + rest.slice(1).trim();
  } else if (CURRENCY.test(t)) {
    t = t.slice(1).trim();
  }
  if (GROUPED.test(t)) t = t.replace(/,/g, '');
  if (!NUMERIC.test(t)) return undefined;
  return sign * parseFloat(t) * scale;
}

export function toBool(v: Scalar): boolean | CellError {
  if (typeof v === 'boolean') return v;
  if (v === null) return false;
  if (typeof v === 'number') return v !== 0;
  if (v instanceof CellError) return v;
  const u = v.toUpperCase();
  if (u === 'TRUE') return true;
  if (u === 'FALSE') return false;
  return ERR.value;
}

export function toText(v: Scalar): string | CellError {
  if (typeof v === 'string') return v;
  if (v === null) return '';
  if (typeof v === 'number') return numberToText(v);
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  return v;
}

/** Two numbers equal at the 15 digits Excel compares, so 0.1+0.2 = 0.3. */
export function numbersEqual(a: number, b: number): boolean {
  if (a === b) return true;
  if (Math.abs(a - b) > Math.max(Math.abs(a), Math.abs(b)) * 1e-14) return false;
  return round15(a) === round15(b);
}

function compareNumbers(a: number, b: number): number {
  if (numbersEqual(a, b)) return 0;
  return a < b ? -1 : 1;
}

/** Excel's ordering for the comparison operators: numbers < text < logicals; text ignores case. */
export function compare(a: Scalar, b: Scalar): number {
  // An empty cell takes the type of the other side.
  if (a === null) a = typeof b === 'string' ? '' : typeof b === 'boolean' ? false : 0;
  if (b === null) b = typeof a === 'string' ? '' : typeof a === 'boolean' ? false : 0;
  const ra = rank(a);
  const rb = rank(b);
  if (ra !== rb) return ra - rb;
  if (typeof a === 'number') return compareNumbers(a, b as number);
  if (typeof a === 'string') return compareText(a, b as string);
  return Number(a) - Number(b);
}

function rank(x: Scalar): number {
  return typeof x === 'number' ? 0 : typeof x === 'string' ? 1 : 2;
}

export function compareText(a: string, b: string): number {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return x < y ? -1 : x > y ? 1 : 0;
}
