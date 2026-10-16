import { describe, expect, it } from 'vitest';
import type { ElementJSON } from '../model/deck';
import {
  angleTo,
  handleCursor,
  handlePoint,
  HIT_PX,
  hitTest,
  inBox,
  lineEndAt,
  marqueeHits,
  moveLineEnd,
  reboxed,
  resizeBox,
  scaleInto
} from './geometry';

const rect = (id: string, x: number, y: number, w: number, h: number, extra: Partial<ElementJSON> = {}): ElementJSON =>
  ({ id, type: 'shape', shape: 'rect', x, y, w, h, ...extra }) as ElementJSON;

const close = (a: number, b: number) => expect(a).toBeCloseTo(b, 6);

describe('hit testing', () => {
  it('takes the topmost element, which is the last one', () => {
    const els = [rect('a', 0, 0, 100, 100), rect('b', 50, 50, 100, 100)];
    expect(hitTest(els, { x: 75, y: 75 }, 0)?.id).toBe('b');
    expect(hitTest(els, { x: 25, y: 25 }, 0)?.id).toBe('a');
    expect(hitTest(els, { x: 500, y: 500 }, 0)).toBeNull();
  });

  it('honours rotation: a 45° square misses its own corner and catches a point past its edge', () => {
    const el = rect('a', 0, 0, 100, 100, { rot: 45 });
    expect(inBox({ x: 2, y: 2 }, el)).toBe(false);
    expect(inBox({ x: 50, y: -15 }, el)).toBe(true);
  });

  it('catches a line within the tolerance and not past it', () => {
    const line = { id: 'l', type: 'line', x: 0, y: 0, w: 100, h: 100, line: { width: 2 } } as ElementJSON;
    expect(hitTest([line], { x: 53, y: 47 }, 6)?.id).toBe('l');
    expect(hitTest([line], { x: 70, y: 30 }, 6)).toBeNull();
    const flipped = { ...line, flipH: true } as ElementJSON;
    expect(hitTest([flipped], { x: 90, y: 10 }, 6)?.id).toBe('l');
  });

  it('gives a group by its id and the child under the point as the path', () => {
    const group = { id: 'g', type: 'group', x: 0, y: 0, w: 300, h: 100, children: [rect('c1', 0, 0, 100, 100), rect('c2', 200, 0, 100, 100)] } as ElementJSON;
    expect(hitTest([group], { x: 250, y: 50 }, 0)).toEqual({ id: 'g', path: ['g', 'c2'] });
    // The gap between the children is not the group.
    expect(hitTest([group], { x: 150, y: 50 }, 0)).toBeNull();
  });

  it('reads a flipped group mirrored', () => {
    const group = { id: 'g', type: 'group', x: 0, y: 0, w: 300, h: 100, flipH: true, children: [rect('c1', 0, 0, 100, 100)] } as ElementJSON;
    expect(hitTest([group], { x: 250, y: 50 }, 0)?.path).toEqual(['g', 'c1']);
    expect(hitTest([group], { x: 50, y: 50 }, 0)).toBeNull();
  });

  describe('thin things, measured on screen from the stroke', () => {
    /** The hit test as the canvas runs it at `scale` screen px per slide px, for a point given in screen px. */
    const at = (els: ElementJSON[], x: number, y: number, scale = 1) => hitTest(els, { x: x / scale, y: y / scale }, HIT_PX / scale)?.id ?? null;
    const line = (id: string, x: number, y: number, w: number, h: number, width = 1, extra: Partial<ElementJSON> = {}): ElementJSON =>
      ({ id, type: 'line', x, y, w, h, line: { color: '#000000', width }, ...extra }) as ElementJSON;

    it('catches a 1 px line 8 px off it, and not 14 px off', () => {
      const els = [line('l', 0, 100, 300, 0)];
      expect(at(els, 150, 108)).toBe('l');
      expect(at(els, 150, 92)).toBe('l');
      expect(at(els, 150, 114)).toBeNull();
      // The same on screen at 50% and at 200%: the tolerance is screen px, not slide px.
      const half = [line('l', 0, 200, 600, 0)];
      expect(at(half, 150, 108, 0.5)).toBe('l');
      expect(at(half, 150, 114, 0.5)).toBeNull();
      const twice = [line('l', 0, 50, 150, 0)];
      expect(at(twice, 150, 108, 2)).toBe('l');
      expect(at(twice, 150, 114, 2)).toBeNull();
    });

    it('misses a diagonal line inside its box but away from the stroke', () => {
      const els = [line('l', 0, 0, 300, 300)];
      expect(at(els, 150, 150)).toBe('l');
      expect(at(els, 250, 50)).toBeNull();
      expect(at(els, 40, 260)).toBeNull();
      // Flipped, it is the other diagonal.
      expect(at([line('l', 0, 0, 300, 300, 1, { flipH: true })], 250, 50)).toBe('l');
    });

    it('measures from the edge of a thick stroke', () => {
      const els = [line('l', 0, 100, 300, 0, 12)];
      // 6 px of half the stroke, then the tolerance.
      expect(at(els, 150, 115)).toBe('l');
      expect(at(els, 150, 118)).toBeNull();
    });

    it('catches a rectangle 2 px tall 8 px away', () => {
      const els = [rect('r', 0, 100, 300, 2)];
      expect(at(els, 150, 110)).toBe('r');
      expect(at(els, 150, 92)).toBe('r');
      expect(at(els, 150, 116)).toBeNull();
      // Past its end, by the distance to the corner and not the box grown square.
      expect(at(els, 308, 109)).toBeNull();
      // A big shape gets no slop: its edge is where it ends.
      expect(at([rect('big', 0, 0, 300, 300)], 150, 305)).toBeNull();
    });

    it('lets a big shape under a line keep the clicks away from the line, and the line the ones near it', () => {
      const els = [rect('big', 0, 0, 400, 400), line('l', 0, 200, 400, 0)];
      expect(at(els, 200, 205)).toBe('l');
      expect(at(els, 200, 230)).toBe('big');
      expect(at(els, 200, 170)).toBe('big');
      // Topmost still wins: with the shape over the line, the shape has it.
      expect(at([els[1]!, els[0]!], 200, 205)).toBe('big');
    });

    it('reaches a thin child of a group the same way', () => {
      const group = { id: 'g', type: 'group', x: 0, y: 0, w: 300, h: 300, children: [line('c', 0, 150, 300, 0), rect('d', 0, 0, 50, 50)] } as ElementJSON;
      expect(hitTest([group], { x: 150, y: 158 }, HIT_PX)?.path).toEqual(['g', 'c']);
      expect(hitTest([group], { x: 150, y: 200 }, HIT_PX)).toBeNull();
    });
  });

  it('selects with a marquee only what it holds whole', () => {
    const els = [rect('a', 10, 10, 50, 50), rect('b', 100, 100, 50, 50)];
    expect(marqueeHits(els, { x: 0, y: 0, w: 120, h: 120 })).toEqual(['a']);
    // Dragged up and to the left.
    expect(marqueeHits(els, { x: 200, y: 200, w: -200, h: -200 })).toEqual(['a', 'b']);
  });
});

describe('resizing', () => {
  const box = { x: 100, y: 100, w: 200, h: 100 };

  it('keeps the opposite corner', () => {
    expect(resizeBox(box, 'se', { x: 50, y: 20 })).toEqual({ x: 100, y: 100, w: 250, h: 120 });
    expect(resizeBox(box, 'nw', { x: 50, y: 20 })).toEqual({ x: 150, y: 120, w: 150, h: 80 });
    expect(resizeBox(box, 'e', { x: 50, y: 999 })).toEqual({ x: 100, y: 100, w: 250, h: 100 });
  });

  it('keeps the proportion with Shift', () => {
    const r = resizeBox(box, 'se', { x: 100, y: 0 }, { keepAspect: true });
    expect(r).toEqual({ x: 100, y: 100, w: 300, h: 150 });
    const edge = resizeBox(box, 's', { x: 0, y: 50 }, { keepAspect: true });
    expect(edge.w / edge.h).toBeCloseTo(2);
  });

  it('keeps the centre with Alt', () => {
    expect(resizeBox(box, 'e', { x: 50, y: 0 }, { fromCentre: true })).toEqual({ x: 50, y: 100, w: 300, h: 100 });
  });

  it('never goes below the minimum', () => {
    const r = resizeBox(box, 'e', { x: -500, y: 0 });
    expect(r.w).toBe(4);
    expect(r.x).toBe(100);
  });

  it('reads the drag in a rotated box’s own frame and keeps its opposite handle on the slide', () => {
    const turned = { ...box, rot: 90 };
    const before = handlePoint(turned, 'w');
    // Turned 90°, the box's east edge faces down: dragging down by 40 grows it by 40.
    const r = resizeBox(turned, 'e', { x: 0, y: 40 });
    close(r.w, 240);
    close(r.h, 100);
    const after = handlePoint({ ...r, rot: 90 }, 'w');
    close(after.x, before.x);
    close(after.y, before.y);
  });

  it('scales the members of a multiple selection into the new union', () => {
    expect(scaleInto({ x: 50, y: 0, w: 50, h: 50 }, { x: 0, y: 0, w: 100, h: 100 }, { x: 0, y: 0, w: 200, h: 100 })).toEqual({ x: 100, y: 0, w: 100, h: 50 });
  });

  it('scales a group’s children with it', () => {
    const group = { id: 'g', type: 'group', x: 0, y: 0, w: 200, h: 100, children: [rect('c', 100, 0, 100, 100)] } as ElementJSON;
    const out = reboxed(group, { x: 10, y: 10, w: 400, h: 100 });
    expect(out.type === 'group' && out.children[0]).toMatchObject({ x: 210, y: 10, w: 200, h: 100 });
  });

  it('moves one end of a line and flips it when the ends cross', () => {
    const line = { x: 0, y: 0, w: 100, h: 50 };
    expect(moveLineEnd(line, 'b', { x: 20, y: 0 })).toEqual({ x: 0, y: 0, w: 120, h: 50, flipH: false, flipV: false });
    expect(moveLineEnd(line, 'b', { x: -150, y: 0 })).toEqual({ x: -50, y: 0, w: 50, h: 50, flipH: true, flipV: false });
    expect(lineEndAt({ flipH: true }, 'ne')).toBe('a');
    expect(lineEndAt({ flipH: true }, 'sw')).toBe('b');
    expect(lineEndAt({}, 'ne')).toBeNull();
  });
});

describe('rotating', () => {
  it('points the handle at the pointer, snapping to 15° with Shift', () => {
    const c = { x: 0, y: 0 };
    expect(angleTo(c, { x: 0, y: -10 })).toBe(0);
    expect(angleTo(c, { x: 10, y: 0 })).toBe(90);
    expect(angleTo(c, { x: -10, y: 0 })).toBe(270);
    expect(angleTo(c, { x: 10, y: -9 }, true)).toBe(45);
  });

  it('turns the resize cursor with the box', () => {
    expect(handleCursor('e')).toBe('ew-resize');
    expect(handleCursor('e', 90)).toBe('ns-resize');
    expect(handleCursor('n', 45)).toBe('nesw-resize');
  });
});
