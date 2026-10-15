/**
 * The formula grammar, and the two spellings of a reference.
 *
 *   A1, what people type and see:    =SUM(Sheet2!$A$1:A10)*2
 *   stored, what the model keeps:    =SUM(`s2!$r1.$c1`:`r10.c1`)*2
 *
 * A stored reference names a row id and a column id, never a position, so an
 * insert anywhere leaves every stored formula byte for byte unchanged, and a
 * reference to a deleted row prints as #REF! until an undo puts the id back.
 *
 *   `rowId.colId`           one cell            `$rowId.$colId`  absolute parts (copy and fill only)
 *   `.colId`                a whole column      `rowId.`         a whole row
 *   `sheetId!rowId.colId`   another sheet; a range names its sheet on the first end only
 *
 * Ids are [A-Za-z0-9_-]. The backtick appears nowhere in Excel's grammar, so the
 * two spellings never collide. Sheet names never appear in a stored formula, so
 * renaming a sheet changes how formulas read and nothing they store. A defined
 * name is stored by name.
 *
 * Operators, loosest first: comparisons; &; + -; * /; ^ (left-associative, so
 * 2^3^2 is 64); % (postfix); unary - and + (tighter than ^, so -2^2 is 4); and
 * the reference operators, : for a range and , for a union inside parentheses.
 * The intersection operator (a space) is not supported.
 */

import { type CellError, ERR, ERROR_LITERAL, type Scalar, errorFromLiteral } from './values';

export interface Ref {
  /** Sheet id; undefined is the formula's own sheet. */
  sheet?: string;
  /** Row id; undefined is a whole column. */
  row?: string;
  /** Column id; undefined is a whole row. */
  col?: string;
  rowAbs: boolean;
  colAbs: boolean;
}

export type BinOp = '+' | '-' | '*' | '/' | '^' | '&' | '=' | '<>' | '<' | '>' | '<=' | '>=' | ':';

export type Node =
  | { t: 'num'; v: number }
  | { t: 'str'; v: string }
  | { t: 'bool'; v: boolean }
  | { t: 'err'; v: CellError }
  | { t: 'arr'; v: Scalar[][] }
  | { t: 'missing' }
  | { t: 'ref'; ref: Ref }
  /** `b.sheet` is always undefined: a range lives on `a.sheet`. */
  | { t: 'range'; a: Ref; b: Ref }
  | { t: 'name'; name: string }
  | { t: 'paren'; e: Node }
  | { t: 'union'; items: Node[] }
  | { t: 'un'; op: '-' | '+'; e: Node }
  | { t: 'pct'; e: Node }
  | { t: 'bin'; op: BinOp; l: Node; r: Node }
  | { t: 'call'; name: string; args: Node[] };

export type RefNode = Extract<Node, { t: 'ref' | 'range' }>;

export class FormulaSyntaxError extends Error {
  constructor(
    message: string,
    readonly at: number
  ) {
    super(message);
  }
}

// ---------------------------------------------------------------- A1 addresses

export const MAX_ROWS = 1_048_576;
export const MAX_COLS = 16_384;

export function colToLetters(i: number): string {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

export function lettersToCol(s: string): number {
  let n = 0;
  for (const ch of s.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

const CELL = /^(\$?)([A-Za-z]{1,3})(\$?)(\d{1,7})$/;
const COLUMN = /^(\$?)([A-Za-z]{1,3})$/;
const ROW = /^(\$?)(\d{1,7})$/;

/** A1 text such as `B3` or `$B$3` to zero-based indices, or undefined. */
export function parseCellAddress(s: string): { row: number; col: number } | undefined {
  const m = CELL.exec(s.trim());
  if (!m) return undefined;
  const col = lettersToCol(m[2]!);
  const row = Number(m[4]) - 1;
  return col < MAX_COLS && row >= 0 && row < MAX_ROWS ? { row, col } : undefined;
}

export function cellAddress(row: number, col: number): string {
  return `${colToLetters(col)}${row + 1}`;
}

// ---------------------------------------------------------------- tokens

type Tok =
  | { k: 'num'; v: number; at: number }
  | { k: 'str'; v: string; at: number }
  | { k: 'err'; v: CellError; at: number }
  | { k: 'word'; v: string; at: number }
  | { k: 'qsheet'; v: string; at: number }
  | { k: 'idref'; ref: Ref; at: number }
  | { k: 'op'; v: string; at: number }
  | { k: '(' | ')' | ',' | ';' | '{' | '}' | '!' | 'eof'; at: number };

const ID = /^[A-Za-z0-9_-]*$/;
const WORD_START = /[\p{L}_\\$]/u;
const WORD_CHAR = /[\p{L}\p{N}_.$\\?]/u;
const NUMBER = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/;

function decodeIdRef(body: string, at: number): Ref {
  let sheet: string | undefined;
  const bang = body.indexOf('!');
  if (bang >= 0) {
    sheet = body.slice(0, bang);
    body = body.slice(bang + 1);
  }
  const dot = body.indexOf('.');
  if (dot < 0) throw new FormulaSyntaxError('Bad stored reference', at);
  let r = body.slice(0, dot);
  let c = body.slice(dot + 1);
  const rowAbs = r.startsWith('$');
  const colAbs = c.startsWith('$');
  if (rowAbs) r = r.slice(1);
  if (colAbs) c = c.slice(1);
  if (!ID.test(r) || !ID.test(c) || (r === '' && c === '') || (sheet !== undefined && (sheet === '' || !ID.test(sheet)))) {
    throw new FormulaSyntaxError('Bad stored reference', at);
  }
  const ref: Ref = { rowAbs, colAbs };
  if (sheet !== undefined) ref.sheet = sheet;
  if (r) ref.row = r;
  if (c) ref.col = c;
  return ref;
}

export function encodeIdRef(ref: Ref, withSheet = true): string {
  const s = withSheet && ref.sheet ? `${ref.sheet}!` : '';
  const r = ref.row ? (ref.rowAbs ? '$' : '') + ref.row : '';
  const c = ref.col ? (ref.colAbs ? '$' : '') + ref.col : '';
  return `\`${s}${r}.${c}\``;
}

function quoted(src: string, i: number, q: string): { v: string; end: number } {
  let s = '';
  let j = i + 1;
  for (;;) {
    if (j >= src.length) throw new FormulaSyntaxError(q === '"' ? 'Unterminated text' : 'Unterminated sheet name', i);
    if (src[j] === q) {
      if (src[j + 1] === q) {
        s += q;
        j += 2;
        continue;
      }
      return { v: s, end: j + 1 };
    }
    s += src[j++];
  }
}

function tokenize(src: string, stored: boolean): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i]!;
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i++;
      continue;
    }
    const at = i;
    if (ch === '"' || ch === "'") {
      const q = quoted(src, i, ch);
      out.push(ch === '"' ? { k: 'str', v: q.v, at } : { k: 'qsheet', v: q.v, at });
      i = q.end;
      continue;
    }
    if (ch === '`') {
      if (!stored) throw new FormulaSyntaxError("Unexpected '`'", at);
      const end = src.indexOf('`', i + 1);
      if (end < 0) throw new FormulaSyntaxError('Unterminated stored reference', at);
      out.push({ k: 'idref', ref: decodeIdRef(src.slice(i + 1, end), at), at });
      i = end + 1;
      continue;
    }
    if (ch === '#') {
      const m = ERROR_LITERAL.exec(src.slice(i));
      if (!m) throw new FormulaSyntaxError('Unknown error value', at);
      out.push({ k: 'err', v: errorFromLiteral(m[0])!, at });
      i += m[0].length;
      continue;
    }
    const num = NUMBER.exec(src.slice(i));
    // A word such as A1 or LOG10 starts with a letter; a number never does.
    if (num && !WORD_CHAR.test(src[i + num[0].length] ?? ' ')) {
      out.push({ k: 'num', v: parseFloat(num[0]), at });
      i += num[0].length;
      continue;
    }
    if (WORD_START.test(ch) || /\d/.test(ch)) {
      let j = i + 1;
      while (j < src.length && WORD_CHAR.test(src[j]!)) j++;
      out.push({ k: 'word', v: src.slice(i, j), at });
      i = j;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (two === '<>' || two === '<=' || two === '>=') {
      out.push({ k: 'op', v: two, at });
      i += 2;
      continue;
    }
    if ('+-*/^&=<>%:'.includes(ch)) {
      out.push({ k: 'op', v: ch, at });
      i++;
      continue;
    }
    if ('(),;{}!'.includes(ch)) {
      out.push({ k: ch as '(', at });
      i++;
      continue;
    }
    throw new FormulaSyntaxError(`Unexpected '${ch}'`, at);
  }
  out.push({ k: 'eof', at: src.length });
  return out;
}

// ---------------------------------------------------------------- parser

const PREC: Record<string, number> = {
  '=': 1,
  '<>': 1,
  '<': 1,
  '>': 1,
  '<=': 1,
  '>=': 1,
  '&': 2,
  '+': 3,
  '-': 3,
  '*': 4,
  '/': 4,
  '^': 5
};

/** The ids an A1 position binds to. */
export interface BoundIds {
  sheet?: string;
  row?: string;
  col?: string;
}

/**
 * Turns a typed position into ids: `row` or `col` undefined is a whole column or
 * row. Returns null for #REF! (an unknown sheet, or a position the binder refuses).
 */
export type Binder = (sheetName: string | undefined, row: number | undefined, col: number | undefined) => BoundIds | null;

/** A reference before binding: positions, not ids. */
interface Atom {
  sheetName?: string;
  stored?: Ref;
  row?: number;
  col?: number;
  rowAbs: boolean;
  colAbs: boolean;
}

/** Parses a formula in A1, binding each reference through `bind`. A leading = is optional. */
export function parseA1(text: string, bind: Binder): Node {
  return parse(text, bind);
}

/** Parses a stored formula: references are ids, and A1 is a syntax error. */
export function parseStored(text: string): Node {
  return parse(text, undefined);
}

function parse(text: string, bind: Binder | undefined): Node {
  const offset = text.startsWith('=') ? 1 : 0;
  let toks: Tok[];
  try {
    toks = tokenize(text.slice(offset), !bind);
  } catch (e) {
    if (e instanceof FormulaSyntaxError) throw new FormulaSyntaxError(e.message, e.at + offset);
    throw e;
  }
  let p = 0;
  const peek = (o = 0): Tok => toks[Math.min(p + o, toks.length - 1)]!;
  const next = (): Tok => toks[Math.min(p++, toks.length - 1)]!;
  const isOp = (t: Tok, v: string) => t.k === 'op' && t.v === v;
  const fail = (msg: string, t: Tok = peek()): never => {
    throw new FormulaSyntaxError(msg, t.at + offset);
  };
  const describe = (t: Tok): string => (t.k === 'eof' ? 'the end' : t.k === 'op' ? `'${t.v}'` : `'${'v' in t ? String(t.v) : t.k}'`);

  function expect(k: Tok['k']) {
    const t = next();
    if (t.k !== k) fail(`Expected '${k}' but found ${describe(t)}`, t);
    return t;
  }

  function parseExpr(minPrec: number): Node {
    let left = parsePrefix();
    for (;;) {
      const t = peek();
      if (t.k !== 'op') break;
      const prec = PREC[t.v];
      if (prec === undefined || prec < minPrec) break;
      next();
      left = { t: 'bin', op: t.v as BinOp, l: left, r: parseExpr(prec + 1) };
    }
    return left;
  }

  function parsePrefix(): Node {
    const t = peek();
    if (isOp(t, '-') || isOp(t, '+')) {
      next();
      return { t: 'un', op: (t as { v: '-' | '+' }).v, e: parsePrefix() };
    }
    let e = parseRange();
    while (isOp(peek(), '%')) {
      next();
      e = { t: 'pct', e };
    }
    return e;
  }

  /** A primary, then the range operator between references that are not both static. */
  function parseRange(): Node {
    let e = parsePrimary();
    while (isOp(peek(), ':')) {
      next();
      const atom = tryAtom(true);
      const r = atom ? single(atom) : parsePrimary();
      e = { t: 'bin', op: ':', l: e, r };
    }
    return e;
  }

  /** Reads a sheet-qualified or bare reference; undefined if the next tokens are not one. */
  function tryAtom(line: boolean): Atom | undefined {
    const start = p;
    const t = peek();
    let sheetName: string | undefined;
    if ((t.k === 'qsheet' || t.k === 'word') && peek(1).k === '!') {
      if (!bind) fail('Sheet names are not allowed in a stored formula', t);
      sheetName = (t as { v: string }).v;
      p += 2;
    }
    const u = peek();
    if (u.k === 'idref') {
      next();
      return { stored: u.ref, rowAbs: u.ref.rowAbs, colAbs: u.ref.colAbs };
    }
    const lineOk = line || isOp(peek(1), ':');
    if (u.k === 'word' && bind) {
      let m = CELL.exec(u.v);
      if (m && peek(1).k !== '(') {
        const col = lettersToCol(m[2]!);
        const row = Number(m[4]) - 1;
        if (col < MAX_COLS && row >= 0 && row < MAX_ROWS) {
          next();
          return { sheetName, row, col, colAbs: m[1] === '$', rowAbs: m[3] === '$' };
        }
      }
      if (lineOk && (m = COLUMN.exec(u.v)) && lettersToCol(m[2]!) < MAX_COLS) {
        next();
        return { sheetName, col: lettersToCol(m[2]!), colAbs: m[1] === '$', rowAbs: false };
      }
      if (lineOk && (m = ROW.exec(u.v)) && Number(m[2]) >= 1 && Number(m[2]) <= MAX_ROWS) {
        next();
        return { sheetName, row: Number(m[2]) - 1, rowAbs: m[1] === '$', colAbs: false };
      }
    }
    if (u.k === 'num' && bind && lineOk && Number.isInteger(u.v) && u.v >= 1 && u.v <= MAX_ROWS) {
      next();
      return { sheetName, row: u.v - 1, rowAbs: false, colAbs: false };
    }
    if (sheetName !== undefined) {
      if (u.k === 'err' && u.v === ERR.ref) return undefined;
      fail(`Expected a reference after ${sheetName}!`, u);
    }
    p = start;
    return undefined;
  }

  function bindAtom(a: Atom): Ref | null {
    if (a.stored) return a.stored;
    const ids = bind!(a.sheetName, a.row, a.col);
    if (!ids) return null;
    const ref: Ref = { rowAbs: a.rowAbs, colAbs: a.colAbs };
    if (ids.sheet !== undefined) ref.sheet = ids.sheet;
    if (ids.row !== undefined) ref.row = ids.row;
    if (ids.col !== undefined) ref.col = ids.col;
    return ref;
  }

  function single(atom: Atom): Node {
    if (!atom.stored && (atom.row === undefined || atom.col === undefined)) fail('A whole row or column needs a range, such as A:A');
    if (atom.stored && (!atom.stored.row || !atom.stored.col)) fail('A whole row or column needs a range');
    const r = bindAtom(atom);
    return r ? { t: 'ref', ref: r } : { t: 'err', v: ERR.ref };
  }

  function range(first: Atom, second: Atom): Node {
    let a = first;
    // The second end may repeat the first's sheet (Sheet2!A1:Sheet2!B2) but not name another.
    if (second.sheetName !== undefined && second.sheetName.toLowerCase() !== first.sheetName?.toLowerCase()) {
      fail('A range cannot span two sheets');
    }
    let b: Atom = { ...second, sheetName: first.sheetName };
    // Excel stores B5:A1 as A1:B5, each corner's $ moving with its coordinate.
    if (!a.stored && !b.stored) {
      if (a.row !== undefined && b.row !== undefined && a.row > b.row) {
        [a, b] = [
          { ...a, row: b.row, rowAbs: b.rowAbs },
          { ...b, row: a.row, rowAbs: a.rowAbs }
        ];
      }
      if (a.col !== undefined && b.col !== undefined && a.col > b.col) {
        [a, b] = [
          { ...a, col: b.col, colAbs: b.colAbs },
          { ...b, col: a.col, colAbs: a.colAbs }
        ];
      }
    }
    const x = bindAtom(a);
    const y = bindAtom(b);
    if (!x || !y) return { t: 'err', v: ERR.ref };
    if (!!x.row !== !!y.row || !!x.col !== !!y.col) fail('The two ends of a range do not match');
    const end: Ref = { rowAbs: y.rowAbs, colAbs: y.colAbs };
    if (y.row) end.row = y.row;
    if (y.col) end.col = y.col;
    return { t: 'range', a: x, b: end };
  }

  function parsePrimary(): Node {
    const atom = tryAtom(false);
    if (atom) {
      if (isOp(peek(), ':')) {
        const colon = p;
        next();
        const second = tryAtom(true);
        if (second) return range(atom, second);
        p = colon;
      }
      return single(atom);
    }
    const t = next();
    switch (t.k) {
      case 'num':
        return { t: 'num', v: t.v };
      case 'str':
        return { t: 'str', v: t.v };
      case 'err':
        return { t: 'err', v: t.v };
      case '{':
        return parseArray();
      case '(': {
        const e = parseExpr(1);
        if (peek().k === ',') {
          const items = [e];
          while (peek().k === ',') {
            next();
            items.push(parseExpr(1));
          }
          expect(')');
          return { t: 'union', items };
        }
        expect(')');
        return { t: 'paren', e };
      }
      case 'word': {
        if (peek().k === '(') {
          next();
          const name = t.v.toUpperCase().replace(/^(?:_XLFN\.|_XLWS\.)+/, '');
          const args: Node[] = [];
          if (peek().k !== ')') {
            for (;;) {
              const k = peek().k;
              args.push(k === ',' || k === ')' ? { t: 'missing' } : parseExpr(1));
              if (peek().k === ',') {
                next();
                continue;
              }
              break;
            }
          }
          expect(')');
          return { t: 'call', name, args };
        }
        const u = t.v.toUpperCase();
        if (u === 'TRUE' || u === 'FALSE') return { t: 'bool', v: u === 'TRUE' };
        if (!/^[\p{L}_\\]/u.test(t.v)) fail(`Unexpected '${t.v}'`, t);
        // A stored formula names cells by id; A1 there is a formula that skipped binding.
        if (!bind && CELL.test(t.v)) fail(`A stored formula cannot hold the A1 reference ${t.v}`, t);
        return { t: 'name', name: t.v };
      }
      default:
        return fail(`Unexpected ${describe(t)}`, t);
    }
  }

  function parseArray(): Node {
    const rows: Scalar[][] = [[]];
    for (;;) {
      let t = next();
      let v: Scalar;
      const signed = isOp(t, '-') || isOp(t, '+');
      const neg = isOp(t, '-');
      if (signed) {
        t = next();
        if (t.k !== 'num') fail('Expected a number in the array', t);
      }
      if (t.k === 'num') v = neg ? -t.v : t.v;
      else if (t.k === 'str') v = t.v;
      else if (t.k === 'err') v = t.v;
      else if (t.k === 'word' && /^(TRUE|FALSE)$/i.test(t.v)) v = t.v.toUpperCase() === 'TRUE';
      else return fail('An array holds numbers, text, TRUE, FALSE and errors', t);
      rows[rows.length - 1]!.push(v);
      const sep = next();
      if (sep.k === ',') continue;
      if (sep.k === ';') {
        rows.push([]);
        continue;
      }
      if (sep.k === '}') break;
      fail(`Expected ',', ';' or '}' in the array`, sep);
    }
    const w = rows[0]!.length;
    if (rows.some((r) => r.length !== w)) fail('Every row of an array needs the same number of values');
    return { t: 'arr', v: rows };
  }

  if (peek().k === 'eof') fail('The formula is empty');
  const node = parseExpr(1);
  if (peek().k !== 'eof') fail(`Unexpected ${describe(peek())}`);
  return node;
}

// ---------------------------------------------------------------- printers

function printScalar(v: Scalar, num: (n: number) => string): string {
  if (v === null) return '';
  if (typeof v === 'number') return num(v);
  if (typeof v === 'string') return `"${v.replace(/"/g, '""')}"`;
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  return v.code;
}

function print(node: Node, ref: (r: Ref) => string, range: (a: Ref, b: Ref) => string, num: (n: number) => string): string {
  const go = (n: Node): string => {
    switch (n.t) {
      case 'num':
        return num(n.v);
      case 'str':
      case 'bool':
      case 'err':
        return printScalar(n.v, num);
      case 'arr':
        return `{${n.v.map((r) => r.map((x) => printScalar(x, num)).join(',')).join(';')}}`;
      case 'missing':
        return '';
      case 'ref':
        return ref(n.ref);
      case 'range':
        return range(n.a, n.b);
      case 'name':
        return n.name;
      case 'paren':
        return `(${go(n.e)})`;
      case 'union':
        return `(${n.items.map(go).join(',')})`;
      case 'un':
        return n.op + go(n.e);
      case 'pct':
        return `${go(n.e)}%`;
      case 'bin':
        return go(n.l) + n.op + go(n.r);
      case 'call':
        return `${n.name}(${n.args.map(go).join(',')})`;
    }
  };
  return `=${go(node)}`;
}

export function printStored(node: Node): string {
  return print(
    node,
    (r) => encodeIdRef(r),
    (a, b) => `${encodeIdRef(a)}:${encodeIdRef(b, false)}`,
    (n) => String(n)
  );
}

/** Positions for printing A1. Each answers undefined when the id no longer exists. */
export interface Locator {
  sheetName(sheetId: string): string | undefined;
  rowIndex(sheetId: string | undefined, rowId: string): number | undefined;
  colIndex(sheetId: string | undefined, colId: string): number | undefined;
}

export function quoteSheetName(name: string): string {
  const plain = /^[\p{L}_][\p{L}\p{N}_.]*$/u.test(name) && !CELL.test(name) && !/^R\d*C\d*$/i.test(name) && !/^(TRUE|FALSE)$/i.test(name);
  return plain ? name : `'${name.replace(/'/g, "''")}'`;
}

export function printA1(node: Node, loc: Locator): string {
  const part = (r: Ref, sheet: string | undefined): string | undefined => {
    let s = '';
    if (r.col) {
      const c = loc.colIndex(sheet, r.col);
      if (c === undefined) return undefined;
      s += (r.colAbs ? '$' : '') + colToLetters(c);
    }
    if (r.row) {
      const i = loc.rowIndex(sheet, r.row);
      if (i === undefined) return undefined;
      s += (r.rowAbs ? '$' : '') + String(i + 1);
    }
    return s;
  };
  const prefix = (sheet: string | undefined): string | undefined => {
    if (!sheet) return '';
    const name = loc.sheetName(sheet);
    return name === undefined ? undefined : `${quoteSheetName(name)}!`;
  };
  return print(
    node,
    (r) => {
      const pre = prefix(r.sheet);
      const s = part(r, r.sheet);
      return pre === undefined || s === undefined ? '#REF!' : pre + s;
    },
    (a, b) => {
      const pre = prefix(a.sheet);
      const x = part(a, a.sheet);
      const y = part(b, a.sheet);
      return pre === undefined || x === undefined || y === undefined ? '#REF!' : `${pre}${x}:${y}`;
    },
    (n) => String(n).replace('e', 'E')
  );
}

// ---------------------------------------------------------------- walking

/** Every reference and range in a formula, in order. */
export function walkRefs(node: Node, visit: (n: RefNode) => void): void {
  const go = (n: Node): void => {
    switch (n.t) {
      case 'ref':
      case 'range':
        visit(n);
        break;
      case 'paren':
      case 'un':
      case 'pct':
        go(n.e);
        break;
      case 'bin':
        go(n.l);
        go(n.r);
        break;
      case 'union':
        n.items.forEach(go);
        break;
      case 'call':
        n.args.forEach(go);
        break;
    }
  };
  go(node);
}

/** Every node, depth first. */
export function walk(node: Node, visit: (n: Node) => void): void {
  visit(node);
  switch (node.t) {
    case 'paren':
    case 'un':
    case 'pct':
      walk(node.e, visit);
      break;
    case 'bin':
      walk(node.l, visit);
      walk(node.r, visit);
      break;
    case 'union':
      for (const x of node.items) walk(x, visit);
      break;
    case 'call':
      for (const x of node.args) walk(x, visit);
      break;
  }
}

/** A copy of a formula with each reference replaced by what `f` returns for it. */
export function mapRefs(node: Node, f: (n: RefNode) => Node): Node {
  const go = (n: Node): Node => {
    switch (n.t) {
      case 'ref':
      case 'range':
        return f(n);
      case 'paren':
      case 'un':
      case 'pct':
        return { ...n, e: go(n.e) };
      case 'bin':
        return { ...n, l: go(n.l), r: go(n.r) };
      case 'union':
        return { ...n, items: n.items.map(go) };
      case 'call':
        return { ...n, args: n.args.map(go) };
      default:
        return n;
    }
  };
  return go(node);
}
