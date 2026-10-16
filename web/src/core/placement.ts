/**
 * Where a floating panel goes, as arithmetic on rectangles.
 *
 * A dropdown, a context menu and its submenus all have to end up inside the window, flipped to the
 * other side of what they came from when there is no room, and given a height to scroll in when
 * neither side has enough. The three shapes differ only in what they hang from, so each is one
 * function here with no DOM in it, and `placement.test.ts` holds the corners. The components measure
 * with `getBoundingClientRect` and offsetWidth/Height and hand the numbers in.
 *
 * Panels are `position: fixed`, so every number is a window coordinate.
 */

export interface Size {
  w: number;
  h: number;
}

export interface Viewport {
  width: number;
  height: number;
}

/** What `getBoundingClientRect` answers, as far as placement needs it. */
export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface Placed {
  left: number;
  top: number;
  /** The tallest the panel may be here; it scrolls inside this when its content is taller. */
  maxHeight: number;
  /** Which side of what it hangs from it went to. */
  side: 'below' | 'above' | 'right' | 'left';
}

/** The space kept clear at every edge of the window. */
export const EDGE = 8;

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(n, Math.max(lo, hi)));

/**
 * A context menu opened at a point: down and to the right of it, flipped up and to the left where
 * that would run off the window, and pushed back inside when neither fits.
 */
export function placeAtPoint(at: { x: number; y: number }, size: Size, vp: Viewport, edge = EDGE): Placed {
  const maxHeight = Math.max(0, vp.height - edge * 2);
  const h = Math.min(size.h, maxHeight);
  let top = at.y;
  let side: Placed['side'] = 'below';
  if (top + h + edge > vp.height) {
    if (at.y - h >= edge) {
      top = at.y - h;
      side = 'above';
    } else top = vp.height - h - edge;
  }
  let left = at.x;
  if (left + size.w + edge > vp.width) left = at.x - size.w >= edge ? at.x - size.w : vp.width - size.w - edge;
  return { left: Math.max(edge, left), top: Math.max(edge, top), maxHeight, side };
}

/**
 * A dropdown under a button: the button's left edge, below it, and above it when there is not room
 * below and there is more above. The height it may have is the room on the side it took.
 */
export function placeBelow(anchor: Box, size: Size, vp: Viewport, gap = 4, edge = EDGE): Placed {
  const below = vp.height - anchor.bottom - gap - edge;
  const above = anchor.top - gap - edge;
  const flip = size.h > below && above > below;
  const room = Math.max(0, flip ? above : below);
  const h = Math.min(size.h, room);
  return {
    left: clamp(anchor.left, edge, vp.width - size.w - edge),
    top: flip ? anchor.top - gap - h : anchor.bottom + gap,
    maxHeight: room,
    side: flip ? 'above' : 'below'
  };
}

/**
 * A submenu beside the row that opened it: to the right with its first row level with that row, to
 * the left where the right has no room, and moved up where it would run off the bottom.
 * `lift` is the parent panel's padding, so the two rows line up; `overlap` tucks the submenu under
 * the parent's edge so the pointer crosses no gap.
 */
export function placeBeside(row: Box, size: Size, vp: Viewport, edge = EDGE, lift = 6, overlap = 4): Placed {
  const maxHeight = Math.max(0, vp.height - edge * 2);
  const h = Math.min(size.h, maxHeight);
  let left = row.right - overlap;
  let side: Placed['side'] = 'right';
  if (left + size.w + edge > vp.width) {
    side = 'left';
    left = row.left - size.w + overlap;
  }
  return { left: Math.max(edge, left), top: clamp(row.top - lift, edge, vp.height - h - edge), maxHeight, side };
}
