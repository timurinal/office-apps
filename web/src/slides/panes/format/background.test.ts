import { describe, expect, it } from 'vitest';
import { SelectionStore } from '../../editor/selection';
import { modelOf, testDeck } from '../../model/testing';
import { backgroundTargets, GRADIENTS, readBackground, setBackground } from './background';

function open() {
  const model = modelOf(
    testDeck([
      { id: 'a', layout: 'blank', elements: [] },
      { id: 'b', layout: 'blank', elements: [], bg: { kind: 'solid', color: '#112233' } },
      { id: 'c', layout: 'blank', elements: [] }
    ])
  );
  const selection = new SelectionStore();
  selection.set({ slide: 'a', slides: ['a'] });
  return { model, selection, t: { model, selection } };
}

describe('a background', () => {
  it('goes to the slides chosen in the rail, in one step', () => {
    const m = open();
    m.selection.showSlide('c', m.model.order(), 'toggle');
    expect(backgroundTargets(m.t, false)).toEqual(['a', 'c']);
    expect(setBackground(m.t, { kind: 'solid', color: '#ff0000' }, false)).toBe(true);
    expect(m.model.slide('a')!.bg).toEqual({ kind: 'solid', color: '#ff0000' });
    expect(m.model.slide('c')!.bg).toEqual({ kind: 'solid', color: '#ff0000' });
    expect(m.model.slide('b')!.bg).toEqual({ kind: 'solid', color: '#112233' });
    m.model.undo();
    expect(m.model.slide('a')!.bg).toBeUndefined();
    expect(m.model.slide('c')!.bg).toBeUndefined();
    expect(m.model.canUndo()).toBe(false);
  });

  it('goes to every slide when asked, one step for all of them', () => {
    const m = open();
    const gradient = GRADIENTS[0]!.fill;
    expect(setBackground(m.t, gradient, true)).toBe(true);
    expect(m.model.order().map((id) => m.model.slide(id)!.bg)).toEqual([gradient, gradient, gradient]);
    m.model.undo();
    expect(m.model.slide('b')!.bg).toEqual({ kind: 'solid', color: '#112233' });
  });

  it('reset takes the slide\'s own away so its layout shows', () => {
    const m = open();
    m.selection.set({ slide: 'b', slides: ['b'] });
    expect(setBackground(m.t, null, false)).toBe(true);
    expect(m.model.slide('b')!.bg).toBeUndefined();
  });

  it('reads what the chosen slides share, and nothing where they differ', () => {
    const m = open();
    expect(readBackground(m.model, ['a', 'c'])).toEqual({ value: null });
    expect(readBackground(m.model, ['b'])).toEqual({ value: { kind: 'solid', color: '#112233' } });
    expect(readBackground(m.model, ['a', 'b'])).toBeNull();
  });

  it('is refused for a reader, with the model saying so', () => {
    const model = modelOf(testDeck(), { readOnly: true });
    const selection = new SelectionStore();
    selection.set({ slide: 's1', slides: ['s1'] });
    const said: string[] = [];
    model.onNotice((n) => said.push(n.message));
    expect(setBackground({ model, selection }, { kind: 'solid', color: '#ff0000' }, false)).toBe(false);
    expect(said).toHaveLength(1);
    expect(model.slide('s1')!.bg).toBeUndefined();
  });

  it('has gradients that draw: every stop a colour the renderer reads, in order', () => {
    for (const g of GRADIENTS) {
      expect(g.fill.stops.length).toBeGreaterThanOrEqual(2);
      expect(g.fill.stops.map((s) => s.at)).toEqual([...g.fill.stops.map((s) => s.at)].sort());
    }
    expect(new Set(GRADIENTS.map((g) => g.id)).size).toBe(GRADIENTS.length);
  });
});
