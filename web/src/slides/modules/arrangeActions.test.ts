import { describe, expect, it } from 'vitest';
import type { Target } from '../editor/actions';
import { SelectionStore } from '../editor/selection';
import type { ElementJSON } from '../model/deck';
import { box, modelOf, testDeck } from '../model/testing';
import {
  align,
  alignDeltas,
  alignPatches,
  canReorder,
  chosenCount,
  distribute,
  distributeDeltas,
  distributePatches,
  flip,
  flipPatches,
  group,
  reorder,
  turn,
  turnPatches,
  ungroup
} from './arrangeActions';

const el = (id: string, x: number, y: number, w = 100, h = 100, extra: Partial<ElementJSON> = {}): ElementJSON => ({ ...box(x, y, w, h), id, ...extra }) as ElementJSON;

function target(elements: ElementJSON[], chosen: string[] = []): Target {
  const model = modelOf(testDeck([{ id: 's', layout: 'blank', elements }]));
  const selection = new SelectionStore();
  selection.set({ slide: 's', slides: ['s'], els: chosen });
  return { model, selection };
}

const ids = (t: Target): string[] => t.model.slide('s')!.elements.map((e) => e.id!);
const at = (t: Target, id: string): ElementJSON => t.model.element('s', id)!;

/** What one undo brings back. */
function undone(t: Target): void {
  expect(t.model.undo()).toBe(true);
}

describe('z-order', () => {
  it('brings to the front, sends to the back, and moves one step, each as one undo entry', () => {
    const t = target([el('a', 0, 0), el('b', 0, 0), el('c', 0, 0), el('d', 0, 0)], ['b']);
    expect(reorder(t, 'front')).toBe(true);
    expect(ids(t)).toEqual(['a', 'c', 'd', 'b']);
    undone(t);
    expect(ids(t)).toEqual(['a', 'b', 'c', 'd']);

    reorder(t, 'back');
    expect(ids(t)).toEqual(['b', 'a', 'c', 'd']);
    undone(t);

    reorder(t, 'forward');
    expect(ids(t)).toEqual(['a', 'c', 'b', 'd']);
    undone(t);

    reorder(t, 'backward');
    expect(ids(t)).toEqual(['b', 'a', 'c', 'd']);
    undone(t);
    expect(ids(t)).toEqual(['a', 'b', 'c', 'd']);
    // Nothing is left to undo: the four moves were four entries and no more.
    expect(t.model.canUndo()).toBe(false);
  });

  it('moves several together and keeps their order among themselves', () => {
    const t = target([el('a', 0, 0), el('b', 0, 0), el('c', 0, 0), el('d', 0, 0)], ['b', 'd']);
    reorder(t, 'back');
    expect(ids(t)).toEqual(['b', 'd', 'a', 'c']);
    undone(t);
    reorder(t, 'backward');
    expect(ids(t)).toEqual(['b', 'a', 'd', 'c']);
  });

  it('says when a move would change nothing, so the button can be off', () => {
    const t = target([el('a', 0, 0), el('b', 0, 0), el('c', 0, 0)], ['c']);
    expect(canReorder(t, 'front')).toBe(false);
    expect(canReorder(t, 'forward')).toBe(false);
    expect(canReorder(t, 'back')).toBe(true);
    expect(canReorder(t, 'backward')).toBe(true);
    t.selection.set({ els: ['a', 'c'] });
    // One of the two can still go forward.
    expect(canReorder(t, 'forward')).toBe(true);
    expect(canReorder(t, 'front')).toBe(true);
    t.selection.set({ els: [] });
    expect(canReorder(t, 'front')).toBe(false);
    expect(reorder(t, 'front')).toBe(false);
  });

  it('keeps a group’s child inside its group', () => {
    const t = target([el('x', 0, 0), el('p', 0, 0), el('q', 0, 0)], ['p', 'q']);
    const g = group(t)!;
    t.selection.set({ els: [] });
    const kids = (at(t, g) as Extract<ElementJSON, { type: 'group' }>).children.map((c) => c.id);
    t.selection.set({ els: [kids[1]!] });
    expect(canReorder(t, 'front')).toBe(false);
    reorder(t, 'back');
    expect((at(t, g) as Extract<ElementJSON, { type: 'group' }>).children.map((c) => c.id)).toEqual([kids[1], kids[0]]);
    expect(ids(t)).toEqual(['x', g]);
  });

  it('is refused for a reader, and nothing changes', () => {
    const model = modelOf(testDeck([{ id: 's', layout: 'blank', elements: [el('a', 0, 0), el('b', 0, 0)] }]), { readOnly: true });
    const selection = new SelectionStore();
    selection.set({ slide: 's', slides: ['s'], els: ['a'] });
    expect(reorder({ model, selection }, 'front')).toBe(false);
    expect(model.slide('s')!.elements.map((e) => e.id)).toEqual(['a', 'b']);
  });
});

describe('group and ungroup', () => {
  it('groups two or more and chooses the group; one undo takes it back', () => {
    const t = target([el('a', 0, 0), el('b', 200, 0), el('c', 400, 0)], ['a', 'c']);
    const g = group(t)!;
    expect(ids(t)).toEqual(['b', g]);
    expect(t.selection.get().els).toEqual([g]);
    expect(at(t, g)).toMatchObject({ type: 'group', x: 0, y: 0, w: 500, h: 100 });
    undone(t);
    expect(ids(t)).toEqual(['a', 'b', 'c']);
    expect(t.model.canUndo()).toBe(false);
  });

  it('does nothing for one object', () => {
    const t = target([el('a', 0, 0), el('b', 0, 0)], ['a']);
    expect(group(t)).toBeNull();
    expect(ids(t)).toEqual(['a', 'b']);
  });

  it('ungroups and chooses the children; one undo brings the group back', () => {
    const t = target([el('a', 0, 0), el('b', 200, 0)], ['a', 'b']);
    const g = group(t)!;
    const kids = ungroup(t)!;
    expect(kids.sort()).toEqual(['a', 'b']);
    expect(ids(t)).toEqual(['a', 'b']);
    expect([...t.selection.get().els].sort()).toEqual(['a', 'b']);
    undone(t);
    expect(ids(t)).toEqual([g]);
    undone(t);
    expect(ids(t)).toEqual(['a', 'b']);
  });

  it('refuses a ungroup with no group chosen', () => {
    const t = target([el('a', 0, 0)], ['a']);
    expect(ungroup(t)).toBeNull();
  });
});

describe('align', () => {
  const slide = { x: 0, y: 0, w: 1920, h: 1080 };

  it('moves each box by how far its edge or centre is from the reference', () => {
    const boxes = [
      { x: 100, y: 50, w: 200, h: 100 },
      { x: 400, y: 300, w: 100, h: 300 }
    ];
    const ref = { x: 100, y: 50, w: 400, h: 550 };
    expect(alignDeltas(boxes, ref, 'left')).toEqual([{ dx: 0, dy: 0 }, { dx: -300, dy: 0 }]);
    expect(alignDeltas(boxes, ref, 'right')).toEqual([{ dx: 200, dy: 0 }, { dx: 0, dy: 0 }]);
    expect(alignDeltas(boxes, ref, 'centre')).toEqual([{ dx: 100, dy: 0 }, { dx: -150, dy: 0 }]);
    expect(alignDeltas(boxes, ref, 'top')).toEqual([{ dx: 0, dy: 0 }, { dx: 0, dy: -250 }]);
    expect(alignDeltas(boxes, ref, 'bottom')).toEqual([{ dx: 0, dy: 450 }, { dx: 0, dy: 0 }]);
    expect(alignDeltas(boxes, ref, 'middle')).toEqual([{ dx: 0, dy: 225 }, { dx: 0, dy: -125 }]);
  });

  it('aligns one object to the slide', () => {
    const t = target([el('a', 700, 400, 200, 100)], ['a']);
    align(t, 'left');
    expect([at(t, 'a').x, at(t, 'a').y]).toEqual([0, 400]);
    align(t, 'centre');
    expect(at(t, 'a').x).toBe(860);
    align(t, 'right');
    expect(at(t, 'a').x).toBe(1720);
    align(t, 'top');
    expect(at(t, 'a').y).toBe(0);
    align(t, 'middle');
    expect(at(t, 'a').y).toBe(490);
    align(t, 'bottom');
    expect(at(t, 'a').y).toBe(980);
  });

  it('aligns several to the box around them, not to the slide', () => {
    const t = target([el('a', 100, 100, 200, 100), el('b', 500, 300, 100, 100), el('c', 900, 600, 50, 50)], ['a', 'b']);
    align(t, 'left');
    expect([at(t, 'a').x, at(t, 'b').x, at(t, 'c').x]).toEqual([100, 100, 900]);
    align(t, 'bottom');
    expect([at(t, 'a').y, at(t, 'b').y]).toEqual([300, 300]);
  });

  it('is one undo entry however many objects move', () => {
    const t = target([el('a', 100, 100), el('b', 500, 300), el('c', 900, 600)], ['a', 'b', 'c']);
    expect(align(t, 'centre')).toBe(true);
    expect(new Set([at(t, 'a').x, at(t, 'b').x, at(t, 'c').x]).size).toBe(1);
    undone(t);
    expect([at(t, 'a').x, at(t, 'b').x, at(t, 'c').x]).toEqual([100, 500, 900]);
    expect(t.model.canUndo()).toBe(false);
  });

  it('writes nothing when everything is already lined up', () => {
    const t = target([el('a', 100, 100), el('b', 100, 300)], ['a', 'b']);
    expect(align(t, 'left')).toBe(false);
    expect(t.model.canUndo()).toBe(false);
  });

  it('reads a turned object by the box it covers, and moves its own x and y', () => {
    // 200 by 100 turned a quarter covers 100 by 200 around the same centre: x 150 to 250.
    const turned = el('r', 100, 100, 200, 100, { rot: 90 });
    const patches = alignPatches([turned], slide, 'left');
    expect(patches).toEqual([{ id: 'r', patch: { x: 100 - 150, y: 100 } }]);
  });

  it('leaves a locked object where it is, though others line up to it', () => {
    const t = target([el('a', 100, 0), el('b', 400, 0, 100, 100, { locked: true })], ['a', 'b']);
    align(t, 'right');
    expect(at(t, 'a').x).toBe(400);
    expect(at(t, 'b').x).toBe(400);
    const u = target([el('l', 10, 10, 100, 100, { locked: true })], ['l']);
    expect(align(u, 'left')).toBe(false);
    expect(at(u, 'l').x).toBe(10);
  });

  it('rounds to a hundredth, so an odd width leaves a clean centre', () => {
    const t = target([el('a', 0, 0, 101, 100)], ['a']);
    align(t, 'centre');
    expect(at(t, 'a').x).toBe(909.5);
  });

  it('moves a group’s children with it', () => {
    const t = target([el('a', 100, 100), el('b', 300, 100)], ['a', 'b']);
    const g = group(t)!;
    align(t, 'left');
    expect(at(t, g).x).toBe(0);
    expect([at(t, 'a').x, at(t, 'b').x]).toEqual([0, 200]);
  });
});

describe('distribute', () => {
  it('puts equal gaps between three, the outer two staying', () => {
    const boxes = [
      { x: 0, y: 0, w: 100, h: 10 },
      { x: 120, y: 0, w: 100, h: 10 },
      { x: 600, y: 0, w: 100, h: 10 }
    ];
    // The span is 700 and the boxes take 300, so each gap is 200.
    expect(distributeDeltas(boxes, 'horizontal')).toEqual([0, 180, 0]);
    expect(distributeDeltas(boxes, 'vertical')).toEqual([0, 0, 0]);
  });

  it('works from position, not from the order the boxes were given in', () => {
    const boxes = [
      { x: 600, y: 0, w: 100, h: 10 },
      { x: 0, y: 0, w: 100, h: 10 },
      { x: 120, y: 0, w: 100, h: 10 }
    ];
    expect(distributeDeltas(boxes, 'horizontal')).toEqual([0, 0, 180]);
  });

  it('handles different sizes: the gaps are equal, the centres are not', () => {
    const boxes = [
      { x: 0, y: 0, w: 50, h: 10 },
      { x: 100, y: 0, w: 200, h: 10 },
      { x: 450, y: 0, w: 50, h: 10 }
    ];
    // Span 500, boxes 300, gap 100: 0..50, 150..350, 450..500.
    expect(distributeDeltas(boxes, 'horizontal')).toEqual([0, 50, 0]);
  });

  it('does nothing for fewer than three', () => {
    expect(distributeDeltas([{ x: 0, y: 0, w: 10, h: 10 }, { x: 500, y: 0, w: 10, h: 10 }], 'horizontal')).toEqual([0, 0]);
  });

  it('distributes chosen objects vertically as one undo entry', () => {
    const t = target([el('a', 0, 0), el('b', 0, 150), el('c', 0, 700), el('d', 0, 900)], ['a', 'b', 'c', 'd']);
    expect(distribute(t, 'vertical')).toBe(true);
    // Span 1000, boxes 400, three gaps of 200.
    expect(['a', 'b', 'c', 'd'].map((i) => at(t, i).y)).toEqual([0, 300, 600, 900]);
    undone(t);
    expect(['a', 'b', 'c', 'd'].map((i) => at(t, i).y)).toEqual([0, 150, 700, 900]);
    expect(t.model.canUndo()).toBe(false);
  });

  it('refuses two objects, and a locked one stays', () => {
    const two = target([el('a', 0, 0), el('b', 500, 0)], ['a', 'b']);
    expect(distribute(two, 'horizontal')).toBe(false);
    const els = [el('a', 0, 0), el('b', 100, 0, 100, 100, { locked: true }), el('c', 900, 0)];
    const patches = distributePatches(els, 'horizontal');
    expect(patches.some((p) => p.id === 'b')).toBe(false);
  });
});

describe('turn and flip', () => {
  it('turns each object a quarter and takes the field away when it comes back upright', () => {
    const t = target([el('a', 0, 0), el('b', 0, 0, 100, 100, { rot: 270 })], ['a', 'b']);
    expect(turn(t, 'right')).toBe(true);
    expect([at(t, 'a').rot, at(t, 'b').rot]).toEqual([90, undefined]);
    turn(t, 'left');
    turn(t, 'left');
    expect([at(t, 'a').rot, at(t, 'b').rot]).toEqual([270, 180]);
    undone(t);
    undone(t);
    undone(t);
    expect([at(t, 'a').rot, at(t, 'b').rot]).toEqual([undefined, 270]);
  });

  it('flips by switching the flag, and a turned object is turned the other way', () => {
    expect(flipPatches([el('a', 0, 0)], 'horizontal')).toEqual([{ id: 'a', patch: { rot: null, flipH: true } }]);
    expect(flipPatches([el('a', 0, 0, 100, 100, { rot: 30, flipH: true })], 'horizontal')).toEqual([{ id: 'a', patch: { rot: 330, flipH: null } }]);
    expect(flipPatches([el('a', 0, 0, 100, 100, { rot: 30 })], 'vertical')).toEqual([{ id: 'a', patch: { rot: 330, flipV: true } }]);
  });

  it('flipping twice is where it started, and each flip is one undo entry', () => {
    const t = target([el('a', 0, 0, 100, 100, { rot: 30 })], ['a']);
    flip(t, 'horizontal');
    expect(at(t, 'a')).toMatchObject({ flipH: true, rot: 330 });
    flip(t, 'horizontal');
    expect(at(t, 'a').flipH).toBeUndefined();
    expect(at(t, 'a').rot).toBe(30);
    undone(t);
    expect(at(t, 'a')).toMatchObject({ flipH: true, rot: 330 });
    undone(t);
    expect(at(t, 'a').flipH).toBeUndefined();
  });

  it('skips a locked object', () => {
    expect(turnPatches([el('a', 0, 0, 100, 100, { locked: true })], 'right')).toEqual([]);
    expect(flipPatches([el('a', 0, 0, 100, 100, { locked: true })], 'vertical')).toEqual([]);
  });
});

describe('what is chosen', () => {
  it('counts the chosen and those that can move', () => {
    const t = target([el('a', 0, 0), el('b', 0, 0, 100, 100, { locked: true })], ['a', 'b']);
    expect(chosenCount(t)).toEqual({ count: 2, movable: 1 });
    t.selection.set({ els: [] });
    expect(chosenCount(t)).toEqual({ count: 0, movable: 0 });
  });
});
