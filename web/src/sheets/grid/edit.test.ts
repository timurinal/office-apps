import { describe, expect, it } from 'vitest';
import {
  canPointNow,
  editKey,
  insertAtSelection,
  nextPoint,
  pointTo,
  setSelection,
  setText,
  startEdit,
  switchField,
  toggleMode,
  type EditKey,
  type EditState
} from './edit';

const A1 = { row: 0, col: 0 };
const bounds = { rows: 100, cols: 26, hidden: () => false };
const key = (k: string, m: Partial<EditKey> = {}): EditKey => ({ key: k, shift: false, ctrl: false, alt: false, ...m });

const typed = (text: string, mode: 'enter' | 'edit' = 'enter'): EditState => startEdit(A1, '', { text, mode, focus: 'cell' });

describe('starting', () => {
  it('replaces the cell when typed over and edits it in place from F2', () => {
    const t = startEdit(A1, '=SUM(B1:B3)', { text: 'x', mode: 'enter', focus: 'cell' });
    expect(t).toMatchObject({ text: 'x', original: '=SUM(B1:B3)', selStart: 1, selEnd: 1, mode: 'enter' });
    const f = startEdit(A1, '=SUM(B1:B3)', { mode: 'edit', focus: 'cell' });
    expect(f).toMatchObject({ text: '=SUM(B1:B3)', selStart: 11, selEnd: 11, mode: 'edit' });
  });

  it('can start with everything selected', () => {
    expect(startEdit(A1, 'abc', { mode: 'edit', focus: 'bar', select: 'all' })).toMatchObject({ selStart: 0, selEnd: 3, focus: 'bar' });
  });
});

describe('the two fields', () => {
  it('share the text, and the field with the caret is the one that is told', () => {
    let e = startEdit(A1, 'hello', { mode: 'edit', focus: 'cell' });
    e = setText(switchField(e, 'bar'), 'hello!', 6, 6);
    expect(e).toMatchObject({ text: 'hello!', focus: 'bar' });
    e = setText(switchField(e, 'cell'), 'hello!!', 7, 7);
    expect(e).toMatchObject({ text: 'hello!!', focus: 'cell' });
  });

  it('keep the same object for a change that changes nothing', () => {
    const e = typed('abc');
    expect(setText(e, 'abc', 3, 3)).toBe(e);
    expect(setSelection(e, 3, 3)).toBe(e);
    expect(switchField(e, 'cell')).toBe(e);
  });

  it('insert at the selection for Alt+Enter', () => {
    const e = { ...typed('ab'), selStart: 1, selEnd: 1 };
    expect(insertAtSelection(e, '\n')).toMatchObject({ text: 'a\nb', selStart: 2, selEnd: 2 });
  });

  it('F2 swaps the mode, either way', () => {
    expect(toggleMode(typed('x')).mode).toBe('edit');
    expect(toggleMode(typed('x', 'edit')).mode).toBe('enter');
  });
});

describe('pointing', () => {
  it('writes the address of the cell at the caret and goes on rewriting it', () => {
    let e = typed('=SUM(');
    e = pointTo(e, { row: 1, col: 1 }, { row: 1, col: 1 });
    expect(e.text).toBe('=SUM(B2');
    expect(e.point).toMatchObject({ start: 5, end: 7 });
    e = pointTo(e, { row: 1, col: 1 }, { row: 8, col: 1 });
    expect(e.text).toBe('=SUM(B2:B9');
    e = pointTo(e, { row: 4, col: 2 }, { row: 4, col: 2 });
    expect(e.text).toBe('=SUM(C5');
    expect(e.selStart).toBe(7);
  });

  it('ends when the text is typed into, and when the caret leaves the address', () => {
    let e = pointTo(typed('=SUM('), { row: 1, col: 1 }, { row: 1, col: 1 });
    expect(setText(e, e.text + ')', e.text.length + 1, e.text.length + 1).point).toBeNull();
    e = pointTo(typed('=SUM('), { row: 1, col: 1 }, { row: 1, col: 1 });
    expect(setSelection(e, 2, 2).point).toBeNull();
    expect(setSelection(e, e.selStart, e.selEnd).point).not.toBeNull();
  });

  it('may happen where an operand may go, or while a reference is already being pointed', () => {
    expect(canPointNow(typed('=SUM('))).toBe(true);
    expect(canPointNow(typed('=SUM(A1)'))).toBe(false);
    expect(canPointNow(pointTo(typed('=SUM('), { row: 1, col: 1 }, { row: 1, col: 1 }))).toBe(true);
    expect(canPointNow(typed('hello'))).toBe(false);
  });

  it('moves one cell from the edited cell, and from where it was pointing after that', () => {
    let e = startEdit({ row: 4, col: 4 }, '', { text: '=', mode: 'enter', focus: 'cell' });
    let p = nextPoint(e, 'up', false, bounds);
    expect(p.head).toEqual({ row: 3, col: 4 });
    e = pointTo(e, p.anchor, p.head);
    p = nextPoint(e, 'right', false, bounds);
    expect(p.head).toEqual({ row: 3, col: 5 });
  });

  it('extends from the first cell with Shift', () => {
    let e = startEdit({ row: 4, col: 4 }, '', { text: '=SUM(', mode: 'enter', focus: 'cell' });
    let p = nextPoint(e, 'up', true, bounds);
    e = pointTo(e, p.anchor, p.head);
    p = nextPoint(e, 'up', true, bounds);
    e = pointTo(e, p.anchor, p.head);
    expect(e.text).toBe('=SUM(E4:E3'.replace('E4:E3', 'E5:E3'.replace('E5', 'E5')));
  });

  it('skips hidden lines and stops at the edge', () => {
    const e = startEdit({ row: 0, col: 0 }, '', { text: '=', mode: 'enter', focus: 'cell' });
    expect(nextPoint(e, 'up', false, bounds).head).toEqual({ row: 0, col: 0 });
    expect(nextPoint(e, 'down', false, { ...bounds, hidden: (axis, i) => axis === 'row' && i === 1 }).head).toEqual({ row: 2, col: 0 });
  });
});

describe('what a key does in the editor', () => {
  const act = (e: EditState, k: EditKey, open = false) => editKey(e, k, open);

  it('Enter commits and moves down, Shift+Enter up, Ctrl+Enter stays', () => {
    expect(act(typed('x'), key('Enter'))).toEqual({ type: 'commit', move: 'down' });
    expect(act(typed('x'), key('Enter', { shift: true }))).toEqual({ type: 'commit', move: 'up' });
    expect(act(typed('x'), key('Enter', { ctrl: true }))).toEqual({ type: 'commit', move: 'none' });
  });

  it('Alt+Enter is a new line', () => {
    expect(act(typed('x'), key('Enter', { alt: true }))).toEqual({ type: 'newline' });
  });

  it('Tab commits and moves right, Shift+Tab left', () => {
    expect(act(typed('x'), key('Tab'))).toEqual({ type: 'commit', move: 'right' });
    expect(act(typed('x'), key('Tab', { shift: true }))).toEqual({ type: 'commit', move: 'left' });
  });

  it('Escape cancels', () => {
    expect(act(typed('x'), key('Escape'))).toEqual({ type: 'cancel' });
  });

  it('F2 toggles the mode, F4 cycles absolute references', () => {
    expect(act(typed('x'), key('F2'))).toEqual({ type: 'toggleMode' });
    expect(act(typed('=A1'), key('F4'))).toEqual({ type: 'cycleAbsolute' });
  });

  it('in Enter mode an arrow commits a value and moves on', () => {
    expect(act(typed('5'), key('ArrowDown'))).toEqual({ type: 'commit', move: 'down' });
    expect(act(typed('5'), key('ArrowLeft'))).toEqual({ type: 'commit', move: 'left' });
    expect(act(typed('5'), key('ArrowUp'))).toEqual({ type: 'commit', move: 'up' });
    expect(act(typed('5'), key('ArrowRight'))).toEqual({ type: 'commit', move: 'right' });
  });

  it('in Edit mode an arrow is the caret\'s', () => {
    for (const k of ['ArrowDown', 'ArrowLeft', 'ArrowUp', 'ArrowRight']) expect(act(typed('5', 'edit'), key(k))).toBeNull();
  });

  it('in a formula where an address may go, an arrow points', () => {
    expect(act(typed('=SUM('), key('ArrowUp'))).toEqual({ type: 'point', dir: 'up', extend: false });
    expect(act(typed('=SUM('), key('ArrowRight', { shift: true }))).toEqual({ type: 'point', dir: 'right', extend: true });
    expect(act(pointTo(typed('=SUM('), { row: 1, col: 1 }, { row: 1, col: 1 }), key('ArrowDown'))).toEqual({ type: 'point', dir: 'down', extend: false });
  });

  it('in a formula where one may not, an arrow is the caret\'s, never a commit', () => {
    expect(act(typed('=SUM(A1)'), key('ArrowLeft'))).toBeNull();
    expect(act(typed('=SUM(A1)'), key('ArrowDown'))).toBeNull();
  });

  it('Shift or Ctrl with an arrow in a value selects text', () => {
    expect(act(typed('abc'), key('ArrowLeft', { shift: true }))).toBeNull();
    expect(act(typed('abc'), key('ArrowLeft', { ctrl: true }))).toBeNull();
  });

  it('while the list is open: Up and Down choose, Tab takes, Enter takes only a row that was moved to, Escape closes', () => {
    const e = typed('=SU');
    expect(act(e, key('ArrowDown'), true)).toEqual({ type: 'suggest', delta: 1 });
    expect(act(e, key('ArrowUp'), true)).toEqual({ type: 'suggest', delta: -1 });
    expect(act(e, key('Tab'), true)).toEqual({ type: 'accept' });
    expect(act(e, key('Enter'), true)).toEqual({ type: 'commit', move: 'down' });
    const moved = { ...e, suggest: { ...e.suggest, navigated: true } };
    expect(act(moved, key('Enter'), true)).toEqual({ type: 'accept' });
    expect(act(e, key('Escape'), true)).toEqual({ type: 'closeSuggest' });
    expect(act(e, key('Escape'), false)).toEqual({ type: 'cancel' });
  });

  it('Up and Down with the list open work in Edit mode too', () => {
    expect(act(typed('=SU', 'edit'), key('ArrowDown'), true)).toEqual({ type: 'suggest', delta: 1 });
  });

  it('is the IME\'s while composing', () => {
    expect(act(typed('x'), key('Enter', { composing: true }))).toBeNull();
    expect(act(typed('x'), key('Process'))).toBeNull();
  });

  it('leaves every other key to the field', () => {
    for (const k of ['a', 'Backspace', 'Home', 'End', 'Delete', ' ']) expect(act(typed('x'), key(k))).toBeNull();
  });
});
