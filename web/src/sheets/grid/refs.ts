/**
 * References in the text of a formula that is being typed, for colouring and for pointing.
 *
 * While a person edits `=SUM(B2:B9)` each reference is drawn in the text in a colour and
 * outlined on the grid in the same one, so the formula and its ranges read as a pair. It is
 * also how a cell is chosen by clicking: with the caret where an operand may go, a click or an
 * arrow writes that cell's address at the caret and goes on writing it as the pointer moves.
 *
 * This reads the A1 text a person types, never the stored form with its ids. It is not the
 * engine's parser: it never fails, it skips what it does not understand, and it must give
 * the same answer on half a formula as on a whole one.
 */

import { cellAddress, lettersToCol, MAX_COLS, MAX_ROWS } from './a1';
import type { Cellpos, Rect } from './types';

export interface RefToken {
  start: number;
  end: number;
  /** As typed, sheet name included. */
  text: string;
  /** Today's indexes; a whole column or row runs to the engine's limit and is clamped by the reader. */
  rect: Rect;
  /** Names another sheet: coloured in the text, never outlined on this grid. */
  foreign: boolean;
  /** Index into `REF_COLORS`; the same reference twice gets the same colour. */
  color: number;
}

/** In the order they are handed out. The first is the app's own green, as the board draws it. */
export const REF_COLORS: readonly { ink: string; line: string }[] = [
  { ink: '#1e8255', line: '#43a873' },
  { ink: '#2f55a6', line: '#6b93e8' },
  { ink: '#5e52a3', line: '#796cbf' },
  { ink: '#9a4116', line: '#ea7a3f' },
  { ink: '#0c7a72', line: '#0fb3a8' },
  { ink: '#7a4d85', line: '#a56ab3' }
];

const CELL = /^(\$?)([A-Za-z]{1,3})(\$?)(\d{1,7})$/;
const COLUMN = /^\$?([A-Za-z]{1,3})$/;
const WORD = /[A-Za-z0-9_.$]/;
const WORD_START = /[A-Za-z_$]/;

function cellAt(w: string): Cellpos | null {
  const m = CELL.exec(w);
  if (!m) return null;
  const col = lettersToCol(m[2]!);
  const row = Number(m[4]) - 1;
  return col < MAX_COLS && row >= 0 && row < MAX_ROWS ? { row, col } : null;
}

const rectOf = (a: Cellpos, b: Cellpos): Rect => ({
  r1: Math.min(a.row, b.row),
  r2: Math.max(a.row, b.row),
  c1: Math.min(a.col, b.col),
  c2: Math.max(a.col, b.col)
});

interface Found {
  end: number;
  rect: Rect;
}

function wordAt(text: string, i: number): string {
  let j = i;
  while (j < text.length && WORD.test(text[j]!)) j++;
  return text.slice(i, j);
}

/** A cell, `A1:B2`, a column `A:C` or a row `2:4` starting at `i`, or null. */
function readRef(text: string, i: number): Found | null {
  const first = wordAt(text, i);
  if (first === '') {
    return null;
  }
  const a = cellAt(first);
  if (a) {
    const end = i + first.length;
    if (text[end] === ':') {
      const second = wordAt(text, end + 1);
      const b = cellAt(second);
      if (b) return { end: end + 1 + second.length, rect: rectOf(a, b) };
    }
    return { end, rect: rectOf(a, a) };
  }
  const col = COLUMN.exec(first);
  if (col && text[i + first.length] === ':') {
    const second = wordAt(text, i + first.length + 1);
    const col2 = COLUMN.exec(second);
    if (col2) {
      const x = lettersToCol(col[1]!);
      const y = lettersToCol(col2[1]!);
      if (x < MAX_COLS && y < MAX_COLS) {
        return { end: i + first.length + 1 + second.length, rect: { r1: 0, r2: MAX_ROWS - 1, c1: Math.min(x, y), c2: Math.max(x, y) } };
      }
    }
  }
  const row = /^\$?(\d{1,7}):\$?(\d{1,7})/.exec(text.slice(i, i + 18));
  if (row) {
    const x = Number(row[1]) - 1;
    const y = Number(row[2]) - 1;
    if (x >= 0 && y >= 0 && x < MAX_ROWS && y < MAX_ROWS) {
      return { end: i + row[0].length, rect: { r1: Math.min(x, y), r2: Math.max(x, y), c1: 0, c2: MAX_COLS - 1 } };
    }
  }
  return null;
}

const normal = (s: string) => s.replace(/\$/g, '').toUpperCase();

/** Every reference in a formula's text, in order. Text that is not a formula has none. */
export function scanRefs(text: string): RefToken[] {
  if (text[0] !== '=') return [];
  const out: RefToken[] = [];
  const colours = new Map<string, number>();
  const push = (start: number, f: Found, foreign: boolean) => {
    const t = text.slice(start, f.end);
    const key = normal(t);
    let color = colours.get(key);
    if (color === undefined) {
      color = colours.size % REF_COLORS.length;
      colours.set(key, color);
    }
    out.push({ start, end: f.end, text: t, rect: f.rect, foreign, color });
  };

  let i = 1;
  const n = text.length;
  while (i < n) {
    const ch = text[i]!;
    if (ch === '"') {
      i++;
      while (i < n) {
        if (text[i] === '"') {
          if (text[i + 1] === '"') {
            i += 2;
            continue;
          }
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if (ch === "'") {
      let j = i + 1;
      while (j < n) {
        if (text[j] === "'") {
          if (text[j + 1] === "'") {
            j += 2;
            continue;
          }
          break;
        }
        j++;
      }
      if (text[j + 1] === '!') {
        const f = readRef(text, j + 2);
        if (f) {
          push(i, f, true);
          i = f.end;
          continue;
        }
      }
      i = j + 1;
      continue;
    }
    if (/\d/.test(ch)) {
      const row = readRef(text, i);
      if (row) {
        push(i, row, false);
        i = row.end;
        continue;
      }
      // A number: skip it whole, so `1E5` and `2.5` are not read as pieces of a name.
      const num = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(text.slice(i));
      i += Math.max(1, num ? num[0].length : 1);
      continue;
    }
    if (WORD_START.test(ch)) {
      const w = wordAt(text, i);
      const after = i + w.length;
      if (text[after] === '!') {
        const f = readRef(text, after + 1);
        if (f) {
          push(i, f, true);
          i = f.end;
          continue;
        }
        i = after + 1;
        continue;
      }
      let k = after;
      while (text[k] === ' ') k++;
      if (text[k] === '(') {
        i = after;
        continue;
      }
      const f = readRef(text, i);
      if (f) {
        push(i, f, false);
        i = f.end;
        continue;
      }
      i = after;
      continue;
    }
    i++;
  }
  return out;
}

// ── pointing ────────────────────────────────────────────────────────────────

/** True inside a string literal at `caret`. */
function inString(text: string, caret: number): boolean {
  let q = 0;
  for (let i = 0; i < caret && i < text.length; i++) if (text[i] === '"') q++;
  return q % 2 === 1;
}

/**
 * Whether a cell address may be written at `caret`: in a formula, after an operator, an open
 * bracket, a comma or the `=`, and outside a string. It is what lets an arrow key choose a
 * cell while typing `=SUM(` and move the caret after `=SUM(A1)`.
 */
export function canPoint(text: string, caret: number): boolean {
  if (text[0] !== '=' || caret < 1 || inString(text, caret)) return false;
  let i = caret - 1;
  while (i > 0 && text[i] === ' ') i--;
  return i === 0 || '=(,+-*/^&<>;:{'.includes(text[i]!);
}

export interface Spliced {
  text: string;
  /** The caret, after what was written. */
  caret: number;
  /** The span of what was written. */
  start: number;
  end: number;
}

/** Writes `ref` over `[start, end)`. */
export function splice(text: string, start: number, end: number, ref: string): Spliced {
  return { text: text.slice(0, start) + ref + text.slice(end), caret: start + ref.length, start, end: start + ref.length };
}

/** `B3`, or `B3:D5`. */
export function addressOf(anchor: Cellpos, head: Cellpos): string {
  const a = cellAddress(anchor.row, anchor.col);
  return anchor.row === head.row && anchor.col === head.col ? a : `${a}:${cellAddress(head.row, head.col)}`;
}

const CYCLE: readonly [boolean, boolean][] = [
  [false, false],
  [true, true],
  [true, false],
  [false, true]
];

/**
 * F4: relative, then absolute, then row absolute, then column absolute, then relative, for the
 * reference at the caret. null when the caret is not on one.
 */
export function cycleAbsolute(text: string, caret: number): Spliced | null {
  const tok = scanRefs(text).find((t) => caret >= t.start && caret <= t.end && /\d/.test(t.text) && !t.text.includes('!'));
  if (!tok) return null;
  const parts = tok.text.split(':');
  const parsed = parts.map((p) => CELL.exec(p));
  if (parsed.some((m) => !m)) return null;
  const first = parsed[0]!;
  const now: [boolean, boolean] = [first[3] === '$', first[1] === '$'];
  const at = CYCLE.findIndex(([r, c]) => r === now[0] && c === now[1]);
  const [rowAbs, colAbs] = CYCLE[(at + 1) % CYCLE.length]!;
  const next = parsed.map((m) => `${colAbs ? '$' : ''}${m![2]}${rowAbs ? '$' : ''}${m![4]}`).join(':');
  return splice(text, tok.start, tok.end, next);
}

// ── completing ──────────────────────────────────────────────────────────────

/** The word being typed at `caret` that a function or a name could complete, or null. */
export function completionAt(text: string, caret: number): { from: number; prefix: string } | null {
  if (text[0] !== '=' || caret < 2 || inString(text, caret)) return null;
  let from = caret;
  while (from > 1 && /[A-Za-z0-9_.]/.test(text[from - 1]!)) from--;
  const prefix = text.slice(from, caret);
  if (prefix === '' || !/^[A-Za-z_]/.test(prefix)) return null;
  const before = text[from - 1];
  if (before !== undefined && /[A-Za-z0-9_.$!'"]/.test(before)) return null;
  // `B2` is an address being typed, not the start of a name.
  if (cellAt(prefix)) return null;
  return { from, prefix };
}

export function applyCompletion(text: string, from: number, caret: number, label: string, isFunction: boolean): Spliced {
  const open = isFunction && text[caret] !== '(' ? '(' : '';
  const s = splice(text, from, caret, label + open);
  return s;
}
