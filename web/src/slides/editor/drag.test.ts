import { describe, expect, it } from 'vitest';
import type { ElementJSON, SlideJSON } from '../model/deck';
import { box, modelOf, peerOf, sync, testDeck } from '../model/testing';
import { clickTarget, elementIndex, movePreview, resizePreview, rotatePreview, withChanges } from './drag';
import { snapBox } from './snap';

const a: ElementJSON = { ...box(100, 100, 200, 100), id: 'a' };
const b: ElementJSON = { ...box(400, 100, 100, 100), id: 'b' };
const kid1: ElementJSON = { ...box(10, 10, 10, 10), id: 'k1' };
const kid2: ElementJSON = { ...box(30, 10, 10, 10), id: 'k2' };
const g: ElementJSON = { type: 'group', id: 'g', x: 10, y: 10, w: 30, h: 10, children: [kid1, kid2] };
const slide: SlideJSON = { id: 's1', layout: 'blank', elements: [a, g] };

describe('what a click chooses', () => {
  const parentOf = (id: string) => (id === 'k1' || id === 'k2' ? 'g' : null);
  it('the outermost element first', () => {
    expect(clickTarget(['g', 'k1'], [], parentOf)).toEqual({ id: 'g', depth: 0 });
    expect(clickTarget(['g', 'k1'], ['a'], parentOf)).toEqual({ id: 'g', depth: 0 });
  });
  it('a sibling of what is chosen inside a group', () => {
    expect(clickTarget(['g', 'k2'], ['k1'], parentOf)).toEqual({ id: 'k2', depth: 1 });
    expect(clickTarget(['g', 'k1'], ['k1'], parentOf)).toEqual({ id: 'k1', depth: 1 });
  });
});

describe('the preview', () => {
  it('replaces elements wherever they sit, and keeps the slide when nothing changed', () => {
    expect(withChanges(slide, new Map())).toBe(slide);
    const next = withChanges(slide, new Map([['k2', { ...kid2, x: 99 }]]));
    expect(next.elements[0]).toBe(a);
    expect((next.elements[1] as Extract<ElementJSON, { type: 'group' }>).children.map((c) => c.x)).toEqual([10, 99]);
    expect(elementIndex(next.elements).get('k2')!.x).toBe(99);
  });

  it('a move carries a group’s children, and Shift keeps it on one axis', () => {
    const p = movePreview([g], { x: 5, y: 2 }, { axis: true });
    expect(p.patches).toEqual([{ id: 'g', patch: { x: 15, y: 10 } }]);
    const moved = p.changed.get('g') as Extract<ElementJSON, { type: 'group' }>;
    expect(moved.children.map((c) => c.x)).toEqual([15, 35]);
  });

  it('a move snaps its union box to the slide’s centre and says where', () => {
    const snap = (bx: Parameters<typeof snapBox>[0]) => snapBox(bx, [], 1920, 1080, 6);
    // a's centre is at 200; moved 757 it is at 957, three short of the slide's 960.
    const p = movePreview([a], { x: 757, y: 0 }, { snap });
    expect(p.patches[0]!.patch.x).toBe(860);
    expect(p.guides[0]).toMatchObject({ axis: 'x', at: 960 });
  });

  it('several elements scale with their union box', () => {
    const p = resizePreview([a, b], 'e', { x: 400, y: 0 }, {});
    // The union is 100..500; dragged to 900 it is twice as wide. Only the sides that change are written.
    expect(p.patches).toEqual([
      { id: 'a', patch: { w: 400 } },
      { id: 'b', patch: { x: 700, w: 200 } }
    ]);
  });

  it('Lock aspect ratio holds the proportions from a corner, as Shift does; a side still stretches', () => {
    const locked: ElementJSON = { ...a, lockAspect: true };
    // a is 200 by 100; its corner pulled 100 right and nothing down is 300 by 150.
    expect(resizePreview([locked], 'se', { x: 100, y: 0 }, {}).patches[0]!.patch).toEqual({ w: 300, h: 150 });
    expect(resizePreview([locked], 'e', { x: 100, y: 0 }, {}).patches[0]!.patch).toEqual({ w: 300 });
    // Pulled in along one axis it shrinks: the axis that moved most leads, not the larger side.
    expect(resizePreview([locked], 'se', { x: -100, y: 0 }, {}).patches[0]!.patch).toEqual({ w: 100, h: 50 });
    expect(resizePreview([a], 'se', { x: 0, y: -50 }, { keepAspect: true }).patches[0]!.patch).toEqual({ w: 100, h: 50 });
    // One locked element in a selection holds the whole selection's proportions.
    const p = resizePreview([locked, b], 'se', { x: 400, y: 0 }, {});
    expect(p.changed.get('a')!.w / p.changed.get('a')!.h).toBeCloseTo(2);
    expect(resizePreview([a], 'se', { x: 100, y: 0 }, {}).patches[0]!.patch).toEqual({ w: 300 });
  });

  it('a line’s end moves on its own', () => {
    const line: ElementJSON = { type: 'line', id: 'l', x: 0, y: 0, w: 100, h: 0, line: { color: '#000000', width: 2 } };
    const p = resizePreview([line], 'se', { x: -150, y: 0 }, {});
    expect(p.patches[0]!.patch).toEqual({ x: -50, y: 0, w: 50, h: 0, flipH: true, flipV: false });
  });

  it('a turn steps by 15 degrees with Shift', () => {
    const p = rotatePreview(a, { x: 400, y: 160 }, true);
    expect(p.patches[0]!.patch.rot! % 15).toBe(0);
  });
});

describe('two people on one element at once', () => {
  // Ada moves the box while Ben pulls its bottom-right corner: the move is Ada's x and y, the pull is
  // Ben's w and h. Each clientID order, since Yjs settles a clash of one key by it.
  for (const first of ['ada', 'ben'] as const) {
    it(`a move by one and a resize by the other both land (${first}'s client id lower)`, () => {
      const ada = modelOf(testDeck([{ id: 's1', layout: 'blank', elements: [{ ...box(100, 100, 400, 300), id: 'a' }] }]));
      const ben = peerOf(ada.doc);
      ada.doc.clientID = first === 'ada' ? 1 : 2;
      ben.doc.clientID = first === 'ada' ? 2 : 1;
      ada.updateElements('s1', movePreview([ada.element('s1', 'a')!], { x: 50, y: 40 }, {}).patches);
      ben.updateElements('s1', resizePreview([ben.element('s1', 'a')!], 'se', { x: 100, y: 60 }, {}).patches);
      sync(ada.doc, ben.doc);
      for (const m of [ada, ben]) {
        const el = m.element('s1', 'a')!;
        expect([el.x, el.y, el.w, el.h]).toEqual([150, 140, 500, 360]);
      }
    });
  }

  it('a pull of the top-left corner still writes where the box starts', () => {
    const p = resizePreview([{ ...box(100, 100, 400, 300), id: 'a' }], 'nw', { x: 20, y: 10 }, {});
    expect(p.patches[0]!.patch).toEqual({ x: 120, y: 110, w: 380, h: 290 });
  });
});
