import { describe, expect, it } from 'vitest';
import { MergeIndex } from './merges';
import {
  advance,
  cell,
  clampSel,
  expandForMerges,
  jumpEdge,
  navigate,
  selRect,
  selectAll,
  single,
  usedCorner,
  wholeCols,
  wholeRows,
  type Mods,
  type NavCtx,
  type SelState
} from './selection';
import type { Rect } from './types';

const NONE: Mods = { shift: false, ctrl: false, alt: false };
const SHIFT: Mods = { ...NONE, shift: true };
const CTRL: Mods = { ...NONE, ctrl: true };
const CTRL_SHIFT: Mods = { shift: true, ctrl: true, alt: false };

interface Sheet {
  rows?: number;
  cols?: number;
  /** "r,c" keys of cells with content. */
  filled?: string[];
  merges?: Rect[];
  hiddenRows?: number[];
  hiddenCols?: number[];
  page?: number;
  used?: { row: number; col: number } | null;
}

function ctx(o: Sheet = {}): { nav: NavCtx; merges: Rect[] } {
  const filled = new Set(o.filled ?? []);
  const merges = o.merges ?? [];
  const index = new MergeIndex(merges);
  return {
    merges,
    nav: {
      rows: o.rows ?? 100,
      cols: o.cols ?? 26,
      frozen: { rows: 0, cols: 0 },
      hidden: (axis, i) => (axis === 'row' ? (o.hiddenRows ?? []).includes(i) : (o.hiddenCols ?? []).includes(i)),
      mergeAt: (r, c) => index.at(r, c),
      isEmpty: (r, c) => !filled.has(`${r},${c}`),
      pageSize: () => o.page ?? 20,
      usedEnd: () => (o.used === undefined ? null : o.used)
    }
  };
}

const at = (r: number, c: number): SelState => single(cell(r, c));
const press = (s: SelState, key: string, mods: Mods, o: Sheet = {}) => {
  const c = ctx(o);
  return navigate(s, key, mods, c.nav, c.merges);
};

describe('arrows', () => {
  it('move one cell and collapse the selection', () => {
    expect(press(at(5, 5), 'ArrowDown', NONE)!.sel).toEqual(at(6, 5));
    expect(press(at(5, 5), 'ArrowUp', NONE)!.sel).toEqual(at(4, 5));
    expect(press(at(5, 5), 'ArrowLeft', NONE)!.sel).toEqual(at(5, 4));
    expect(press(at(5, 5), 'ArrowRight', NONE)!.sel).toEqual(at(5, 6));
    const wide: SelState = { anchor: cell(2, 2), head: cell(6, 6), active: cell(2, 2) };
    expect(press(wide, 'ArrowDown', NONE)!.sel).toEqual(at(3, 2));
  });

  it('stop at the edges of the sheet', () => {
    expect(press(at(0, 0), 'ArrowUp', NONE)!.sel).toEqual(at(0, 0));
    expect(press(at(0, 0), 'ArrowLeft', NONE)!.sel).toEqual(at(0, 0));
    expect(press(at(99, 25), 'ArrowDown', NONE)!.sel).toEqual(at(99, 25));
    expect(press(at(99, 25), 'ArrowRight', NONE)!.sel).toEqual(at(99, 25));
  });

  it('step over hidden rows and columns', () => {
    expect(press(at(2, 2), 'ArrowDown', NONE, { hiddenRows: [3, 4] })!.sel).toEqual(at(5, 2));
    expect(press(at(2, 2), 'ArrowRight', NONE, { hiddenCols: [3] })!.sel).toEqual(at(2, 4));
    expect(press(at(5, 2), 'ArrowUp', NONE, { hiddenRows: [3, 4] })!.sel).toEqual(at(2, 2));
  });

  it('extend with Shift, keeping the anchor, and shrink back', () => {
    let s = at(5, 5);
    s = press(s, 'ArrowDown', SHIFT)!.sel;
    s = press(s, 'ArrowDown', SHIFT)!.sel;
    s = press(s, 'ArrowRight', SHIFT)!.sel;
    expect(selRect(s, [])).toEqual({ r1: 5, r2: 7, c1: 5, c2: 6 });
    expect(s.active).toEqual(cell(5, 5));
    s = press(s, 'ArrowUp', SHIFT)!.sel;
    expect(selRect(s, [])).toEqual({ r1: 5, r2: 6, c1: 5, c2: 6 });
    s = press(s, 'ArrowLeft', SHIFT)!.sel;
    expect(selRect(s, [])).toEqual({ r1: 5, r2: 6, c1: 5, c2: 5 });
  });

  it('extend upwards and to the left of the anchor', () => {
    let s = at(5, 5);
    s = press(s, 'ArrowUp', SHIFT)!.sel;
    s = press(s, 'ArrowLeft', SHIFT)!.sel;
    expect(selRect(s, [])).toEqual({ r1: 4, r2: 5, c1: 4, c2: 5 });
  });
});

describe('Ctrl and an arrow', () => {
  const data = { filled: ['2,1', '3,1', '4,1', '8,1', '9,1'] };

  it('runs to the end of a block of content', () => {
    expect(press(at(2, 1), 'ArrowDown', CTRL, data)!.sel).toEqual(at(4, 1));
  });

  it('crosses a gap from the end of a block to the next one', () => {
    expect(press(at(4, 1), 'ArrowDown', CTRL, data)!.sel).toEqual(at(8, 1));
  });

  it('goes from an empty cell to the next one with content', () => {
    expect(press(at(5, 1), 'ArrowDown', CTRL, data)!.sel).toEqual(at(8, 1));
    expect(press(at(7, 1), 'ArrowUp', CTRL, data)!.sel).toEqual(at(4, 1));
  });

  it('goes to the edge of the sheet when nothing follows', () => {
    expect(press(at(9, 1), 'ArrowDown', CTRL, data)!.sel).toEqual(at(99, 1));
    expect(press(at(2, 1), 'ArrowUp', CTRL, data)!.sel).toEqual(at(0, 1));
    expect(press(at(0, 5), 'ArrowRight', CTRL, data)!.sel).toEqual(at(0, 25));
    expect(press(at(50, 5), 'ArrowLeft', CTRL, data)!.sel).toEqual(at(50, 0));
  });

  it('moves along a row the same way', () => {
    const row = { filled: ['3,2', '3,3', '3,4', '3,8'] };
    expect(press(at(3, 2), 'ArrowRight', CTRL, row)!.sel).toEqual(at(3, 4));
    expect(press(at(3, 4), 'ArrowRight', CTRL, row)!.sel).toEqual(at(3, 8));
    expect(press(at(3, 8), 'ArrowLeft', CTRL, row)!.sel).toEqual(at(3, 4));
  });

  it('extends with Shift as well', () => {
    const s = press(at(2, 1), 'ArrowDown', CTRL_SHIFT, data)!.sel;
    expect(selRect(s, [])).toEqual({ r1: 2, r2: 4, c1: 1, c2: 1 });
    expect(s.active).toEqual(cell(2, 1));
  });

  it('is a plain jump() that does nothing at the edge', () => {
    const c = ctx(data);
    expect(jumpEdge(cell(99, 1), 'row', 1, c.nav)).toEqual(cell(99, 1));
  });
});

describe('Home, End and the pages', () => {
  it('Home goes to the first column of the row, Ctrl+Home to A1', () => {
    expect(press(at(7, 9), 'Home', NONE)!.sel).toEqual(at(7, 0));
    expect(press(at(7, 9), 'Home', CTRL)!.sel).toEqual(at(0, 0));
    expect(selRect(press(at(7, 9), 'Home', SHIFT)!.sel, [])).toEqual({ r1: 7, r2: 7, c1: 0, c2: 9 });
  });

  it('End goes to the last column with content in the row', () => {
    expect(press(at(3, 0), 'End', NONE, { filled: ['3,2', '3,6'] })!.sel).toEqual(at(3, 6));
  });

  it('Ctrl+End goes to the last used row and column, scanned or given', () => {
    const scanned = { filled: ['2,1', '10,3', '6,12'] };
    expect(press(at(0, 0), 'End', CTRL, scanned)!.sel).toEqual(at(10, 12));
    expect(press(at(0, 0), 'End', CTRL, { used: { row: 40, col: 7 } })!.sel).toEqual(at(40, 7));
    expect(usedCorner(ctx({ used: null }).nav)).toEqual(cell(0, 0));
    expect(usedCorner(ctx({}).nav)).toEqual(cell(0, 0));
  });

  it('PageDown moves a screen of rows and says the pane should scroll with it', () => {
    const r = press(at(10, 3), 'PageDown', NONE, { page: 18 })!;
    expect(r.sel).toEqual(at(28, 3));
    expect(r.page).toEqual({ axis: 'row', dir: 1 });
    expect(press(at(10, 3), 'PageUp', NONE, { page: 18 })!.sel).toEqual(at(0, 3));
  });

  it('Alt+PageDown moves a screen of columns', () => {
    const r = press(at(10, 3), 'PageDown', { ...NONE, alt: true }, { page: 4 })!;
    expect(r.sel).toEqual(at(10, 7));
    expect(r.page).toEqual({ axis: 'col', dir: 1 });
  });

  it('ignores a key that is not navigation', () => {
    expect(press(at(0, 0), 'q', NONE)).toBeNull();
    expect(press(at(0, 0), 'Enter', NONE)).toBeNull();
  });
});

describe('merged areas', () => {
  const merge: Rect = { r1: 2, r2: 4, c1: 2, c2: 3 };
  const o = { merges: [merge] };

  it('widen a selection to take a merge whole', () => {
    expect(expandForMerges({ r1: 1, r2: 2, c1: 1, c2: 2 }, [merge])).toEqual({ r1: 1, r2: 4, c1: 1, c2: 3 });
    expect(expandForMerges({ r1: 0, r2: 1, c1: 0, c2: 1 }, [merge])).toEqual({ r1: 0, r2: 1, c1: 0, c2: 1 });
  });

  it('are left by their far edge', () => {
    expect(press(at(2, 2), 'ArrowDown', NONE, o)!.sel).toEqual(at(5, 2));
    expect(press(at(2, 2), 'ArrowRight', NONE, o)!.sel).toEqual(at(2, 4));
    expect(press(at(2, 2), 'ArrowUp', NONE, o)!.sel).toEqual(at(1, 2));
  });

  it('are entered at their top left, from any side', () => {
    expect(press(at(5, 3), 'ArrowUp', NONE, o)!.sel).toEqual(at(2, 2));
    expect(press(at(3, 4), 'ArrowLeft', NONE, o)!.sel).toEqual(at(2, 2));
  });

  it('are crossed in one press with Shift', () => {
    const s = press(at(0, 2), 'ArrowDown', SHIFT, o)!.sel;
    const s2 = press(s, 'ArrowDown', SHIFT, o)!.sel;
    expect(selRect(s2, [merge])).toEqual({ r1: 0, r2: 4, c1: 2, c2: 3 });
    const s3 = press(s2, 'ArrowDown', SHIFT, o)!.sel;
    expect(selRect(s3, [merge])).toEqual({ r1: 0, r2: 5, c1: 2, c2: 3 });
  });
});

describe('Tab and Enter inside a selection', () => {
  const sel: SelState = { anchor: cell(2, 2), head: cell(4, 3), active: cell(2, 2) };
  const walk = (s: SelState, dir: 'down' | 'up' | 'right' | 'left', n: number, o: Sheet = {}) => {
    const c = ctx(o);
    const out: [number, number][] = [];
    for (let i = 0; i < n; i++) {
      s = advance(s, dir, c.nav, c.merges);
      out.push([s.active.row, s.active.col]);
    }
    return { s, out };
  };

  it('Enter walks down each column of the rectangle and wraps to the next', () => {
    expect(walk(sel, 'down', 7).out).toEqual([[3, 2], [4, 2], [2, 3], [3, 3], [4, 3], [2, 2], [3, 2]]);
  });

  it('Tab walks along each row and wraps', () => {
    expect(walk(sel, 'right', 7).out).toEqual([[2, 3], [3, 2], [3, 3], [4, 2], [4, 3], [2, 2], [2, 3]]);
  });

  it('go the other way with Shift', () => {
    expect(walk(sel, 'up', 3).out).toEqual([[4, 3], [3, 3], [2, 3]]);
    expect(walk(sel, 'left', 3).out).toEqual([[4, 3], [4, 2], [3, 3]]);
  });

  it('leave the selection as it is', () => {
    const { s } = walk(sel, 'down', 2);
    expect(s.anchor).toEqual(sel.anchor);
    expect(s.head).toEqual(sel.head);
  });

  it('with one cell selected, move and select the next', () => {
    expect(walk(at(5, 5), 'down', 1).s).toEqual(at(6, 5));
    expect(walk(at(5, 5), 'right', 1).s).toEqual(at(5, 6));
    expect(walk(at(5, 5), 'up', 1).s).toEqual(at(4, 5));
    expect(walk(at(0, 0), 'left', 1).s).toEqual(at(0, 0));
  });

  it('skip the inside of a merged area', () => {
    const merge: Rect = { r1: 3, r2: 3, c1: 2, c2: 3 };
    // Walking right across row 3 lands on the merge's top left once and not on its second cell.
    const { out } = walk(sel, 'right', 4, { merges: [merge] });
    expect(out).toEqual([[2, 3], [3, 2], [4, 2], [4, 3]]);
  });

  it('skip hidden rows', () => {
    expect(walk(sel, 'down', 2, { hiddenRows: [3] }).out).toEqual([[4, 2], [2, 3]]);
  });

  it('move out of a single merged cell by its far edge', () => {
    const merge: Rect = { r1: 3, r2: 5, c1: 2, c2: 2 };
    const s = at(3, 2);
    const c = ctx({ merges: [merge] });
    expect(advance(s, 'down', c.nav, c.merges)).toEqual(at(6, 2));
  });
});

describe('selecting whole lines', () => {
  const c = ctx({ rows: 50, cols: 8 }).nav;

  it('rows, columns and everything', () => {
    expect(selRect(wholeRows(3, 5, c), [])).toEqual({ r1: 3, r2: 5, c1: 0, c2: 7 });
    expect(selRect(wholeCols(2, 1, c), [])).toEqual({ r1: 0, r2: 49, c1: 1, c2: 2 });
    expect(selRect(selectAll(c), [])).toEqual({ r1: 0, r2: 49, c1: 0, c2: 7 });
  });

  it('a shrunken sheet keeps the selection inside it', () => {
    const s = clampSel({ anchor: cell(80, 20), head: cell(90, 25), active: cell(80, 20) }, 50, 8);
    expect(s).toEqual({ anchor: cell(49, 7), head: cell(49, 7), active: cell(49, 7) });
  });
});
