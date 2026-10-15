/**
 * The editor's state machine, without a DOM.
 *
 * Two fields edit one cell: the editor drawn over it and the formula bar. They share this
 * state, so whichever holds the caret writes here and the other reads, and the text in the
 * two is the same text. Excel has two modes and so does this:
 *
 *   enter  started by typing. The arrows are for the sheet: in a plain value they commit and
 *          move on; in a formula with the caret where an operand may go they point at a cell
 *          and write its address.
 *   edit   started by F2, Enter or a double click. The arrows move the caret.
 *
 * `editKey` answers what a key means in the editor, as data, so the table of keys is one
 * function with one test.
 */

import { addressOf, canPoint, splice } from './refs';
import type { Cellpos } from './types';

export type EditMode = 'enter' | 'edit';
export type Move = 'down' | 'up' | 'right' | 'left' | 'none';
export type Dir = 'up' | 'down' | 'left' | 'right';

export interface PointState {
  /** The span of text the pointed reference occupies. */
  start: number;
  end: number;
  anchor: Cellpos;
  head: Cellpos;
}

export interface EditState {
  at: Cellpos;
  /** What the cell held when the edit began; an edit that ends where it began is not sent. */
  original: string;
  text: string;
  selStart: number;
  selEnd: number;
  mode: EditMode;
  /** The field that holds the caret. */
  focus: 'cell' | 'bar';
  point: PointState | null;
  /** The completion list: the row that is lit, whether the person has moved it, and the word it was closed for. */
  suggest: { index: number; navigated: boolean; closedFor: string | null };
}

export function startEdit(
  at: Cellpos,
  original: string,
  o: { text?: string; mode: EditMode; focus: 'cell' | 'bar'; select?: 'end' | 'all' }
): EditState {
  const text = o.text ?? original;
  return {
    at,
    original,
    text,
    selStart: o.select === 'all' ? 0 : text.length,
    selEnd: text.length,
    mode: o.mode,
    focus: o.focus,
    point: null,
    suggest: { index: 0, navigated: false, closedFor: null }
  };
}

/** The field's text changed: a key, a paste, a completion. Whatever was being pointed at is now just text. */
export function setText(e: EditState, text: string, selStart: number, selEnd: number): EditState {
  if (text === e.text && selStart === e.selStart && selEnd === e.selEnd) return e;
  const textChanged = text !== e.text;
  return {
    ...e,
    text,
    selStart,
    selEnd,
    point: textChanged ? null : e.point,
    suggest: textChanged ? { index: 0, navigated: false, closedFor: null } : e.suggest
  };
}

/** The caret or selection moved with the text unchanged. Leaving the pointed reference ends pointing. */
export function setSelection(e: EditState, selStart: number, selEnd: number): EditState {
  if (selStart === e.selStart && selEnd === e.selEnd) return e;
  const p = e.point;
  const keep = p && selStart === p.end && selEnd === p.end;
  return { ...e, selStart, selEnd, point: keep ? p : null };
}

export function switchField(e: EditState, focus: 'cell' | 'bar'): EditState {
  return e.focus === focus ? e : { ...e, focus };
}

/** F2: the arrows swap between the sheet and the caret. */
export function toggleMode(e: EditState): EditState {
  return { ...e, mode: e.mode === 'enter' ? 'edit' : 'enter', point: null };
}

export function insertAtSelection(e: EditState, s: string): EditState {
  const sp = splice(e.text, e.selStart, e.selEnd, s);
  return setText(e, sp.text, sp.caret, sp.caret);
}

/** Write a cell's address at the caret, or over the reference already being pointed at. */
export function pointTo(e: EditState, anchor: Cellpos, head: Cellpos): EditState {
  const from = e.point ? e.point.start : e.selStart;
  const to = e.point ? e.point.end : e.selEnd;
  const s = splice(e.text, from, to, addressOf(anchor, head));
  return {
    ...e,
    text: s.text,
    selStart: s.caret,
    selEnd: s.caret,
    point: { start: s.start, end: s.end, anchor, head },
    suggest: { index: 0, navigated: false, closedFor: null }
  };
}

/** Whether a click on a cell, or an arrow, may write an address now. */
export function canPointNow(e: EditState): boolean {
  if (e.selStart !== e.selEnd && !e.point) return e.text[0] === '=' && canPoint(e.text, e.selStart);
  return e.point !== null || canPoint(e.text, e.selStart);
}

/** The cell an arrow points at next, from where pointing is now (or from the edited cell). */
export function nextPoint(
  e: EditState,
  dir: Dir,
  extend: boolean,
  bounds: { rows: number; cols: number; hidden(axis: 'row' | 'col', i: number): boolean }
): { anchor: Cellpos; head: Cellpos } {
  const from = e.point ? e.point.head : e.at;
  const axis = dir === 'up' || dir === 'down' ? 'row' : 'col';
  const step = dir === 'down' || dir === 'right' ? 1 : -1;
  const n = axis === 'row' ? bounds.rows : bounds.cols;
  let i = (axis === 'row' ? from.row : from.col) + step;
  while (i >= 0 && i < n && bounds.hidden(axis, i)) i += step;
  const at = axis === 'row' ? from.row : from.col;
  const to = i < 0 || i >= n ? at : i;
  const head = axis === 'row' ? { row: to, col: from.col } : { row: from.row, col: to };
  return { anchor: extend ? (e.point ? e.point.anchor : e.at) : head, head };
}

// ── keys ────────────────────────────────────────────────────────────────────

export interface EditKey {
  key: string;
  shift: boolean;
  ctrl: boolean;
  alt: boolean;
  /** An IME is composing: every key is its. */
  composing?: boolean;
}

export type EditAction =
  | { type: 'commit'; move: Move }
  | { type: 'cancel' }
  | { type: 'newline' }
  | { type: 'toggleMode' }
  | { type: 'point'; dir: Dir; extend: boolean }
  | { type: 'suggest'; delta: 1 | -1 }
  | { type: 'accept' }
  | { type: 'closeSuggest' }
  | { type: 'cycleAbsolute' };

const ARROW: Record<string, Dir> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };

/**
 * What a key does in the editor, or null to leave it to the text field. `suggestOpen` is
 * whether the completion list is showing, which the arrows, Tab, Enter and Escape then
 * belong to.
 */
export function editKey(e: EditState, k: EditKey, suggestOpen: boolean): EditAction | null {
  if (k.composing || k.key === 'Process') return null;
  switch (k.key) {
    case 'Escape':
      return suggestOpen ? { type: 'closeSuggest' } : { type: 'cancel' };
    case 'Enter':
      if (k.alt) return { type: 'newline' };
      if (suggestOpen && e.suggest.navigated) return { type: 'accept' };
      if (k.ctrl) return { type: 'commit', move: 'none' };
      return { type: 'commit', move: k.shift ? 'up' : 'down' };
    case 'Tab':
      if (suggestOpen && !k.shift) return { type: 'accept' };
      return { type: 'commit', move: k.shift ? 'left' : 'right' };
    case 'F2':
      return { type: 'toggleMode' };
    case 'F4':
      return { type: 'cycleAbsolute' };
  }

  const dir = ARROW[k.key];
  if (!dir) return null;
  if (suggestOpen && (dir === 'up' || dir === 'down') && !k.shift) return { type: 'suggest', delta: dir === 'down' ? 1 : -1 };
  if (e.mode === 'edit' || k.ctrl || k.alt) return null;

  const formula = e.text[0] === '=';
  if (formula && canPointNow(e)) return { type: 'point', dir, extend: k.shift };
  // A shifted arrow in a value is a text selection; in a formula that cannot point it is the caret's too.
  if (formula || k.shift) return null;
  return { type: 'commit', move: dir };
}
