/**
 * The function registry. Our own functions first; any other name falls through to
 * formulajs, which covers the long tail (finance, engineering, distributions).
 *
 * Ours are the ones where formulajs is wrong for a spreadsheet or too slow for
 * one: it receives plain arrays, so it cannot tell a range from an argument
 * (SUM ignores text in a range and adds it as an argument), and it counts an
 * empty cell as 0 (AVERAGE, MEDIAN and STDEV must skip it). Lookups are ours
 * for the per-pass index. OWN_FUNCTIONS lists them; formulajsFunctions() the rest.
 */

import * as formulajs from '@formulajs/formulajs';
import { type Ctx, type Value, UnionValue, broadcast, isMulti } from '../evaluate';
import type { Node } from '../parser';
import { RangeValue } from '../sheet';
import { CellError, ERR, type Scalar, isError } from '../values';
import { DATETIME } from './datetime';
import type { Args, FnDef, FnTable } from './helpers';
import { INFO } from './info';
import { LOGICAL } from './logical';
import { LOOKUP } from './lookup';
import { MATH } from './math';
import { STATS } from './stats';
import { TEXT } from './text';

const OWN: FnTable = { ...MATH, ...STATS, ...LOGICAL, ...LOOKUP, ...TEXT, ...DATETIME, ...INFO };

export const OWN_FUNCTIONS: readonly string[] = Object.keys(OWN).sort();

const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

type JsFn = (...a: unknown[]) => unknown;

const fjs = formulajs as unknown as Record<string, unknown>;

/** A formulajs function by Excel name; dotted names such as T.DIST.2T are nested properties. */
function formulajsFunction(name: string): JsFn | undefined {
  if (name === 'UTILS' || name.startsWith('UTILS.')) return undefined;
  let o: unknown = fjs;
  for (const k of name.split('.')) {
    if (o === null || (typeof o !== 'object' && typeof o !== 'function') || !has(o, k)) return undefined;
    o = (o as Record<string, unknown>)[k];
  }
  return typeof o === 'function' ? (o as JsFn) : undefined;
}

let fallbackNames: string[] | undefined;

/** Every name formulajs answers that is not ours, for the function list and autocomplete. */
export function formulajsFunctions(): readonly string[] {
  if (fallbackNames) return fallbackNames;
  const out = new Set<string>();
  const visit = (o: Record<string, unknown>, prefix: string, depth: number) => {
    for (const k of Object.keys(o)) {
      if (k === 'utils' || !/^[A-Z0-9]+$/.test(k)) continue;
      const v = o[k];
      const name = prefix + k;
      if (typeof v === 'function' && !has(OWN, name)) out.add(name);
      if (v !== null && (typeof v === 'object' || typeof v === 'function') && depth < 3) visit(v as Record<string, unknown>, name + '.', depth + 1);
    }
  };
  visit(fjs, '', 0);
  fallbackNames = [...out].sort();
  return fallbackNames;
}

export interface FunctionFlags {
  volatile: boolean;
  positional: boolean;
  /** SUBTOTAL and AGGREGATE, whose cells SUBTOTAL skips. */
  subtotal: boolean;
}

export function functionFlags(name: string): FunctionFlags {
  const def = has(OWN, name) ? OWN[name] : undefined;
  return {
    volatile: !!def?.volatile,
    positional: !!def?.positional,
    subtotal: name === 'SUBTOTAL' || name === 'AGGREGATE'
  };
}

export function isKnownFunction(name: string): boolean {
  return has(OWN, name) || !!formulajsFunction(name);
}

function kindAt(def: FnDef, i: number): string {
  const kinds = def.kinds ?? 's';
  if (i < kinds.length) return kinds[i]!;
  const rep = def.repeat ?? 1;
  return kinds[kinds.length - rep + ((i - kinds.length) % rep)]!;
}

export function callFunction(name: string, args: Node[], ctx: Ctx): Value {
  const def = has(OWN, name) ? OWN[name] : undefined;
  if (!def) {
    const f = formulajsFunction(name);
    return f ? viaFormulajs(name, f, args, ctx) : new CellError('#NAME?', `Unknown function ${name}`);
  }
  if (args.length < def.min || args.length > def.max) return new CellError('#N/A', `Wrong number of arguments to ${name}`);
  if (def.lazy) return def.lazy(args, ctx);
  const vals: Args = [];
  const lifted: number[] = [];
  for (let i = 0; i < args.length; i++) {
    const n = args[i]!;
    if (kindAt(def, i) === 'a') {
      vals.push(ctx.evalArray(n));
      continue;
    }
    const v = ctx.eval(n);
    if (ctx.array && isMulti(v)) {
      lifted.push(i);
      vals.push(v);
    } else vals.push(ctx.scalar(v));
  }
  const fn = def.fn!;
  if (!lifted.length) return fn(vals, ctx);
  // A range or array where one value is wanted, in array mode: once per element.
  return broadcast(
    lifted.map((i) => vals[i]!),
    (xs) => {
      const a = vals.slice();
      lifted.forEach((i, j) => (a[i] = xs[j]!));
      return ctx.first(fn(a, ctx));
    }
  );
}

// ---------------------------------------------------------------- formulajs

const FJS_ERRORS: Record<string, CellError> = {};
for (const e of Object.values(ERR)) if (!e.detail) FJS_ERRORS[e.code] = e;

const toJsDate = (fjs.utils as { date?: { dateToSerial?: (d: Date) => number } } | undefined)?.date?.dateToSerial;

function fromJs(x: unknown): Scalar {
  if (x instanceof Error) return FJS_ERRORS[x.message] ?? ERR.value;
  if (x instanceof Date) return toJsDate ? toJsDate(x) : ERR.value;
  if (typeof x === 'number') return Number.isFinite(x) ? x : ERR.num;
  if (typeof x === 'string' || typeof x === 'boolean') return x;
  if (x === null || x === undefined) return null;
  return ERR.value;
}

const toJs = (x: Scalar): unknown => (isError(x) ? new Error(x.code) : x);

/**
 * Arguments formulajs loops on without end. Its IRR clamps the rate it iterates to (-1, 1000] but
 * not the guess it starts from, and when Newton's method gives up at once (the slope is nil that far
 * out) the bisection that follows walks from the guess in steps of 0.1: a guess of 1e10 is 1e11
 * steps, a very negative one never leaves its search for a sign change. A tab frozen by a cell.
 * Excel answers #NUM! for a guess that does not lead to a root, and so do we, before asking.
 */
const GUESS_AT: Record<string, number> = { IRR: 1 };

function badGuess(name: string, js: readonly unknown[]): boolean {
  const at = GUESS_AT[name];
  if (at === undefined) return false;
  const g = js[at];
  return typeof g === 'number' && !(g > -1 && g <= 1000);
}

function viaFormulajs(name: string, f: JsFn, args: Node[], ctx: Ctx): Value {
  const js: unknown[] = [];
  for (const n of args) {
    if (n.t === 'missing') {
      js.push(undefined);
      continue;
    }
    const v = ctx.evalArray(n);
    if (v instanceof UnionValue) return ERR.value;
    if (v instanceof RangeValue && v.rows * v.cols === 1) {
      const x = v.at(0, 0);
      if (isError(x)) return x;
      js.push(x);
    } else if (v instanceof RangeValue || Array.isArray(v)) {
      // Ranges go as 2-D arrays, row by row, with an empty cell as null (formulajs mostly reads it as 0).
      const rows = v instanceof RangeValue ? v.toArray() : v;
      js.push(rows.map((r) => r.map(toJs)));
    } else {
      if (isError(v)) return v;
      js.push(v);
    }
  }
  if (badGuess(name, js)) return ERR.num;
  let r: unknown;
  try {
    r = f(...js);
  } catch {
    return ERR.value;
  }
  if (Array.isArray(r)) {
    const rows = r.length && Array.isArray(r[0]) ? (r as unknown[][]) : [r as unknown[]];
    return rows.map((row) => row.map(fromJs));
  }
  return fromJs(r);
}
