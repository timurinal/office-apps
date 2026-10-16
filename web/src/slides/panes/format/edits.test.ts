import { describe, expect, it } from 'vitest';
import type { ElementJSON, ShapeElement } from '../../model/deck';
import { modelOf, testDeck, txt } from '../../model/testing';
import {
  altPatches,
  common,
  cornerPatches,
  darker,
  fillOfKind,
  fillPatches,
  leaves,
  linePatches,
  lockPatches,
  positionPatches,
  readAlt,
  readFill,
  readFillKind,
  readGradient,
  readSolid,
  readLine,
  readLock,
  readPosition,
  readRotation,
  readSize,
  readSpacing,
  readTextBox,
  rotationPatches,
  sameFormat,
  shapesOf,
  sizePatches,
  textBoxPatches,
  withAlpha,
  withAngle,
  withColor,
  withInset,
  withStop
} from './edits';

const shape = (id: string, over: Partial<ShapeElement> = {}): ShapeElement => ({ type: 'shape', shape: 'rect', id, x: 100, y: 200, w: 400, h: 200, ...over });

describe('a value across a selection', () => {
  it('is the value when every element has it, and blank when two differ or there are none', () => {
    expect(common([3, 3, 3])).toEqual({ value: 3 });
    expect(common([3, 4])).toBeNull();
    expect(common([])).toBeNull();
    expect(common([{ a: 1 }, { a: 1 }])).toEqual({ value: { a: 1 } });
  });

  it('reads size, position, turn and the lock', () => {
    const a = shape('a');
    const b = shape('b', { x: 300, rot: 15, lockAspect: true });
    expect(readSize([a, b], 'w')).toEqual({ value: 400 });
    expect(readSize([a, shape('c', { w: 401 })], 'w')).toBeNull();
    expect(readPosition([a, b], 'x', 'topLeft')).toBeNull();
    expect(readPosition([a, b], 'y', 'topLeft')).toEqual({ value: 200 });
    expect(readPosition([a, b], 'y', 'centre')).toEqual({ value: 300 });
    expect(readRotation([a, b])).toBeNull();
    expect(readRotation([a, shape('c')])).toEqual({ value: 0 });
    expect(readLock([a, b])).toBeNull();
    expect(readLock([b])).toEqual({ value: true });
  });
});

describe('size and position', () => {
  it('sets each element, so one step moves them all', () => {
    const patches = sizePatches([shape('a'), shape('b', { w: 50 })], 'w', 123.456);
    expect(patches).toEqual([
      { id: 'a', patch: { w: 123.46 } },
      { id: 'b', patch: { w: 123.46 } }
    ]);
  });

  it('keeps the proportions of the elements that have their aspect locked, each by its own', () => {
    const [a, b] = sizePatches([shape('a', { lockAspect: true }), shape('b', { w: 100, h: 400, lockAspect: true }), shape('c')].slice(0, 2), 'w', 200);
    expect(a).toEqual({ id: 'a', patch: { w: 200, h: 100 } });
    expect(b).toEqual({ id: 'b', patch: { w: 200, h: 800 } });
    expect(sizePatches([shape('c')], 'h', 50)).toEqual([{ id: 'c', patch: { h: 50 } }]);
  });

  it('never makes a box smaller than a few pixels, but a level line may have no height', () => {
    expect(sizePatches([shape('a')], 'h', 0)[0]!.patch.h).toBe(4);
    expect(sizePatches([{ type: 'line', id: 'l', x: 0, y: 0, w: 100, h: 50, line: { color: '#000000', width: 2 } }], 'h', 0)[0]!.patch.h).toBe(0);
    expect(sizePatches([shape('z', { w: 100, h: 0, lockAspect: true })], 'w', 200)[0]!.patch).toEqual({ w: 200 });
  });

  it('places the top left corner, or the centre', () => {
    expect(positionPatches([shape('a')], 'x', 500, 'topLeft')[0]!.patch).toEqual({ x: 500 });
    expect(positionPatches([shape('a')], 'x', 500, 'centre')[0]!.patch).toEqual({ x: 300 });
    expect(positionPatches([shape('a')], 'y', 500, 'centre')[0]!.patch).toEqual({ y: 400 });
  });

  it('turning to nothing takes the turn away, and the lock is a flag that goes when off', () => {
    expect(rotationPatches([shape('a')], 0)[0]!.patch).toEqual({ rot: null });
    expect(rotationPatches([shape('a')], 45)[0]!.patch).toEqual({ rot: 45 });
    expect(lockPatches([shape('a')], true)[0]!.patch).toEqual({ lockAspect: true });
    expect(lockPatches([shape('a')], false)[0]!.patch).toEqual({ lockAspect: null });
  });

  it('is one model step and one undo entry for all of them, and a group takes its children', () => {
    const m = modelOf(
      testDeck([
        {
          id: 's1',
          layout: 'blank',
          elements: [shape('a'), shape('b', { x: 700 }), { type: 'group', id: 'g', x: 0, y: 0, w: 100, h: 100, children: [shape('k', { x: 0, y: 0, w: 100, h: 100 })] }]
        }
      ])
    );
    expect(m.updateElements('s1', sizePatches([m.element('s1', 'a')!, m.element('s1', 'b')!, m.element('s1', 'g')!], 'w', 200))).toBe(true);
    expect(m.element('s1', 'a')!.w).toBe(200);
    expect(m.element('s1', 'b')!.w).toBe(200);
    expect(m.element('s1', 'k')!.w).toBe(200);
    m.undo();
    expect(m.element('s1', 'a')!.w).toBe(400);
    expect(m.element('s1', 'b')!.w).toBe(400);
    expect(m.element('s1', 'k')!.w).toBe(100);
    expect(m.canUndo()).toBe(false);
  });
});

describe('fill', () => {
  it('reads the kind the shapes share, mixed when they differ, nothing for no shapes', () => {
    expect(readFill([])).toBeNull();
    expect(readFill([shape('a')])).toMatchObject({ kind: 'none' });
    const red = { kind: 'solid', color: '#ff0000' } as const;
    expect(readFill([shape('a', { fill: red }), shape('b', { fill: red })])).toMatchObject({ kind: 'solid' });
    expect(readFill([shape('a', { fill: red }), shape('b')])).toEqual({ kind: 'mixed', fill: null });
  });

  it('reads the kind apart from the colour: two solid fills of different colours are both solid', () => {
    const red = shape('a', { fill: { kind: 'solid', color: '#ff0000', alpha: 0.5 } });
    const blue = shape('b', { fill: { kind: 'solid', color: '#0000ff', alpha: 0.5 } });
    expect(readFillKind([red, blue])).toEqual({ value: 'solid' });
    expect(readSolid([red, blue])).toEqual({ color: null, alpha: { value: 0.5 } });
    expect(readSolid([red])).toEqual({ color: { value: '#ff0000' }, alpha: { value: 0.5 } });
    expect(readFillKind([red, shape('c')])).toBeNull();
    const g1 = shape('g', { fill: { kind: 'gradient', angle: 90, stops: [{ at: 0, color: '#111111' }, { at: 1, color: '#222222' }] } });
    expect(readGradient([g1])).toEqual({ start: { value: '#111111' }, end: { value: '#222222' }, angle: { value: 90 } });
    expect(readGradient([red])).toEqual({ start: null, end: null, angle: null });
  });

  it('changing the kind keeps the colour: solid from none is the accent, gradient from solid starts where it was', () => {
    expect(fillOfKind('solid', undefined)).toEqual({ kind: 'solid', color: { theme: 'accent1' } });
    const g = fillOfKind('gradient', { kind: 'solid', color: { theme: 'accent2' } });
    expect(g).toMatchObject({ kind: 'gradient', angle: 90, stops: [{ at: 0, color: { theme: 'accent2' } }, { at: 1, color: { theme: 'accent2', lum: -0.3 } }] });
    expect(fillOfKind('solid', g)).toEqual({ kind: 'solid', color: { theme: 'accent2' } });
    expect(fillOfKind('none', g)).toEqual({ kind: 'none' });
    expect(darker('#808080')).toBe('#5a5a5a');
  });

  it('a colour keeps the transparency, and a transparency keeps the colour', () => {
    const s = { kind: 'solid', color: '#ff0000', alpha: 0.5 } as const;
    expect(withColor(s, '#00ff00')).toEqual({ kind: 'solid', color: '#00ff00', alpha: 0.5 });
    expect(withAlpha(s, 0.25)).toEqual({ kind: 'solid', color: '#ff0000', alpha: 0.25 });
    expect(withAlpha(s, 1)).toEqual({ kind: 'solid', color: '#ff0000' });
    expect(withColor({ kind: 'none' }, '#00ff00')).toEqual({ kind: 'solid', color: '#00ff00' });
  });

  it('sets a gradient stop and its angle, making a gradient first where there is none', () => {
    const g = withStop({ kind: 'solid', color: '#ff0000' }, 1, '#0000ff');
    expect(g).toMatchObject({ kind: 'gradient', stops: [{ at: 0, color: '#ff0000' }, { at: 1, color: '#0000ff' }] });
    expect(withAngle(g, 45)).toMatchObject({ angle: 45 });
    expect(withStop(g, 0, '#00ff00')).toMatchObject({ stops: [{ at: 0, color: '#00ff00' }, { at: 1, color: '#0000ff' }] });
  });

  it('is built from each shape\'s own fill', () => {
    const a = shape('a', { fill: { kind: 'solid', color: '#ff0000', alpha: 0.4 } });
    const b = shape('b', { fill: { kind: 'solid', color: '#0000ff', alpha: 0.8 } });
    expect(fillPatches([a, b], (f) => withColor(f, '#00ff00')).map((p) => p.patch.fill)).toEqual([
      { kind: 'solid', color: '#00ff00', alpha: 0.4 },
      { kind: 'solid', color: '#00ff00', alpha: 0.8 }
    ]);
  });
});

describe('outline', () => {
  it('lays a change over each element\'s own, and over a default where it had none', () => {
    const a = shape('a', { line: { color: '#ff0000', width: 10, dash: 'dash' } });
    const b = shape('b');
    expect(linePatches([a, b], { width: 6 }).map((p) => p.patch.line)).toEqual([
      { color: '#ff0000', width: 6, dash: 'dash' },
      { color: { theme: 'accent1' }, width: 6 }
    ]);
  });

  it('reaches the pictures, lines and shapes in a group and no one else', () => {
    const els: ElementJSON[] = [
      { type: 'group', id: 'g', x: 0, y: 0, w: 1, h: 1, children: [shape('s'), { type: 'chart', id: 'c', x: 0, y: 0, w: 1, h: 1, chart: 'bar', categories: [], series: [] }] },
      { type: 'image', id: 'i', x: 0, y: 0, w: 1, h: 1, asset: { id: 'a' } }
    ];
    expect(linePatches(els, { width: 2 }).map((p) => p.id)).toEqual(['s', 'i']);
    expect(leaves(els).map((e) => e.id)).toEqual(['s', 'c', 'i']);
    expect(shapesOf(els).map((e) => e.id)).toEqual(['s']);
  });

  it('reads what every outline shares', () => {
    const a = shape('a', { line: { color: '#ff0000', width: 4 } });
    const b = shape('b', { line: { color: '#ff0000', width: 8 } });
    expect(readLine([a, b], 'width', 0)).toBeNull();
    expect(readLine([a, b], 'color', '#000000')).toEqual({ value: '#ff0000' });
    expect(readLine([shape('c')], 'dash', 'solid')).toEqual({ value: 'solid' });
  });
});

describe('the text box', () => {
  it('lays a change over each shape\'s own, an inset keeping the other three', () => {
    const a = shape('a', { textBox: { anchor: 'top', insets: { l: 1, t: 2, r: 3, b: 4 } } });
    const b = shape('b');
    const patches = textBoxPatches([a, b], (box) => withInset(box, 'l', 30));
    expect(patches[0]!.patch.textBox).toEqual({ anchor: 'top', insets: { l: 30, t: 2, r: 3, b: 4 } });
    expect(patches[1]!.patch.textBox).toEqual({ insets: { l: 30, t: 7.2, r: 14.4, b: 7.2 } });
    expect(withInset({}, 'r', -5).insets!.r).toBe(0);
    expect(readTextBox([a, b], (x) => x.anchor ?? 'top')).toEqual({ value: 'top' });
    expect(readTextBox([a, shape('c', { textBox: { anchor: 'middle' } })], (x) => x.anchor ?? 'top')).toBeNull();
  });

  it('alt text is a string, or nothing', () => {
    expect(altPatches([shape('a')], '  A chart of sales ')[0]!.patch.alt).toBe('  A chart of sales ');
    expect(altPatches([shape('a')], '   ')[0]!.patch.alt).toBeNull();
    expect(readAlt([shape('a', { alt: 'x' }), shape('b')])).toBeNull();
    expect(readAlt([shape('a')])).toEqual({ value: '' });
  });

  it('a corner is for rounded rectangles only, as a fraction up to a half', () => {
    const patches = cornerPatches([shape('a', { shape: 'roundRect' }), shape('b')], 0.9);
    expect(patches).toEqual([{ id: 'a', patch: { adjust: 0.5 } }]);
  });
});

describe('paragraph spacing', () => {
  it('reads what the paragraphs resolve to, through the cascade', () => {
    const a = shape('a', { text: txt('one', 'two') });
    const m = modelOf(testDeck([{ id: 's1', layout: 'blank', elements: [{ ...a, text: { type: 'doc', content: [{ type: 'paragraph', attrs: { spaceBefore: 12, lineHeight: 1.5 }, content: [{ type: 'text', text: 'x' }] }, { type: 'paragraph', attrs: { spaceBefore: 12 } }] } }] }]));
    const el = m.element('s1', 'a') as ShapeElement;
    const r = readSpacing([el], (id, level) => m.styleAt('s1', id, level));
    expect(r.before).toEqual({ value: 12 });
    expect(r.after).toEqual({ value: 0 });
    expect(r.line).toBeNull();
  });
});

describe('knowing when the pane need not redraw', () => {
  it('typing in a chosen shape changes nothing the pane shows, unless it shows the text', () => {
    const a = shape('a', { text: txt('x') });
    const b = shape('a', { text: txt('xy') });
    expect(sameFormat([a], [b], false)).toBe(true);
    expect(sameFormat([a], [b], true)).toBe(false);
    expect(sameFormat([a], [{ ...b, w: 5 }], false)).toBe(false);
    expect(sameFormat([a], [a, b], false)).toBe(false);
    expect(sameFormat([a], [shape('z')], false)).toBe(false);
  });

  it('a table\'s text is left out, its structure and looks are not', () => {
    const cell = (t: string, extra = {}) => ({ text: txt(t), ...extra });
    const t1: ElementJSON = { type: 'table', id: 't', x: 0, y: 0, w: 1, h: 1, cols: [1], rows: [{ h: 1, cells: [cell('a')] }] };
    const t2: ElementJSON = { type: 'table', id: 't', x: 0, y: 0, w: 1, h: 1, cols: [1], rows: [{ h: 1, cells: [cell('ab')] }] };
    const t3: ElementJSON = { type: 'table', id: 't', x: 0, y: 0, w: 1, h: 1, cols: [1], rows: [{ h: 1, cells: [cell('a', { fill: { kind: 'none' } })] }] };
    expect(sameFormat([t1], [t2], false)).toBe(true);
    expect(sameFormat([t1], [t3], false)).toBe(false);
    expect(sameFormat([t1], [t2], true)).toBe(false);
  });

  it('a group is the same when its children are', () => {
    const g = (w: number): ElementJSON => ({ type: 'group', id: 'g', x: 0, y: 0, w: 1, h: 1, children: [shape('k', { w })] });
    expect(sameFormat([g(1)], [g(1)], false)).toBe(true);
    expect(sameFormat([g(1)], [g(2)], false)).toBe(false);
  });
});
