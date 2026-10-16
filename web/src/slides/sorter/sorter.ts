/**
 * The slide sorter's arithmetic, over plain numbers: how wide a thumbnail is at a zoom, where a
 * dragged slide would land among thumbnails laid out in rows, which thumbnail an arrow key goes to, and
 * where a keyboard move puts the chosen slides. The component measures and draws; none of this
 * touches the page.
 *
 * Pure: no DOM.
 */

/** Thumbnail widths, CSS px. A fit zoom (the slide filling the room) is a size of its own here. */
export const SORTER_WIDTH = { min: 112, max: 640, fit: 224, perZoomPoint: 3.2 } as const;

/** The width of a thumbnail at the footer's zoom (a percentage), or the default when it is on fit. */
export function thumbWidth(zoom: number, fit: boolean): number {
  if (fit) return SORTER_WIDTH.fit;
  return Math.round(Math.max(SORTER_WIDTH.min, Math.min(SORTER_WIDTH.max, zoom * SORTER_WIDTH.perZoomPoint)));
}

/** A thumbnail's box in the list's own coordinates. */
export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Where a drop would go: before the slide at `index` (the end when it is the length), and the line to draw. */
export interface Drop {
  index: number;
  line: { x: number; y: number; height: number };
}

/** The thumbnails by row: a thumbnail lower than half its height below the row's top starts the next. */
export function rowsOf(rects: readonly Rect[]): number[][] {
  const rows: number[][] = [];
  let top = -Infinity;
  rects.forEach((r, i) => {
    if (rows.length === 0 || r.top > top + r.height / 2) {
      rows.push([i]);
      top = r.top;
    } else rows[rows.length - 1]!.push(i);
  });
  return rows;
}

/** How many thumbnails are in the first row: what Up and Down step by. */
export const columnsOf = (rects: readonly Rect[]): number => rowsOf(rects)[0]?.length ?? 1;

/**
 * Where the pointer at (`x`, `y`) would drop. It picks the row the pointer is in (the nearest when it is
 * between two) and, in it, the first thumbnail the pointer is left of the middle of; past the last it
 * goes after it. The line is drawn in the gap before that thumbnail, or after the last of the row,
 * `gap` px wide.
 */
export function dropAt(rects: readonly Rect[], x: number, y: number, gap = 20): Drop {
  const rows = rowsOf(rects);
  if (!rows.length) return { index: 0, line: { x: 0, y: 0, height: 0 } };
  let row = rows[0]!;
  let best = Infinity;
  for (const r of rows) {
    const top = Math.min(...r.map((i) => rects[i]!.top));
    const bottom = Math.max(...r.map((i) => rects[i]!.top + rects[i]!.height));
    const d = y < top ? top - y : y > bottom ? y - bottom : 0;
    if (d < best) {
      best = d;
      row = r;
    }
  }
  const top = Math.min(...row.map((i) => rects[i]!.top));
  const height = Math.max(...row.map((i) => rects[i]!.height));
  const before = row.find((i) => x < rects[i]!.left + rects[i]!.width / 2);
  if (before !== undefined) return { index: before, line: { x: Math.max(1, rects[before]!.left - gap / 2), y: top, height } };
  const last = row[row.length - 1]!;
  return { index: last + 1, line: { x: rects[last]!.left + rects[last]!.width + gap / 2, y: top, height } };
}

export type StepKey = 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown' | 'Home' | 'End' | 'PageUp' | 'PageDown';

/** The thumbnail an arrow key goes to from `at`, staying inside the list. */
export function stepIndex(at: number, key: StepKey, columns: number, count: number): number {
  const by = key === 'ArrowLeft' ? -1 : key === 'ArrowRight' ? 1 : key === 'ArrowUp' ? -columns : key === 'ArrowDown' ? columns : key === 'PageUp' ? -columns * 3 : key === 'PageDown' ? columns * 3 : 0;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  return Math.max(0, Math.min(count - 1, at + by));
}

/**
 * The `to` that `model.moveSlides` takes to move the chosen slides one place earlier or later: before
 * the slide that is at that place now. Null when they are at the end already.
 */
export function nudgeTarget(order: readonly string[], chosen: readonly string[], by: -1 | 1): number | null {
  const at = order.map((id, i) => (chosen.includes(id) ? i : -1)).filter((i) => i >= 0);
  if (!at.length) return null;
  if (by < 0) return at[0]! > 0 ? at[0]! - 1 : null;
  return at[at.length - 1]! < order.length - 1 ? at[at.length - 1]! + 2 : null;
}
