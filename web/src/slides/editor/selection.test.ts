import { describe, expect, it } from 'vitest';
import { SelectionStore } from './selection';

const order = ['a', 'b', 'c', 'd'];

describe('the selection', () => {
  it('the caret’s shape is chosen, and the slide on the canvas is among the chosen slides', () => {
    const s = new SelectionStore();
    s.set({ slide: 'b', editing: 'e1' });
    expect(s.get()).toMatchObject({ slides: ['b'], els: ['e1'] });
  });

  it('tells its listeners only when something changed', () => {
    const s = new SelectionStore();
    let heard = 0;
    s.subscribe(() => heard++);
    s.set({ slide: 'a' });
    s.set({ slide: 'a', slides: ['a'] });
    expect(heard).toBe(1);
  });

  it('Shift chooses a range from the slide on the canvas, Ctrl adds and takes away', () => {
    const s = new SelectionStore();
    s.showSlide('b', order);
    s.showSlide('d', order, 'range');
    expect(s.get()).toMatchObject({ slide: 'd', slides: ['b', 'c', 'd'], focus: 'rail' });
    s.showSlide('c', order, 'toggle');
    expect(s.get().slides).toEqual(['b', 'd']);
    s.showSlide('a', order, 'toggle');
    expect(s.get()).toMatchObject({ slide: 'a', slides: ['a', 'b', 'd'] });
  });

  it('a slide alone keeps its elements when it is the one on the canvas', () => {
    const s = new SelectionStore();
    s.set({ slide: 'a', els: ['x'] });
    s.showSlide('a', order);
    expect(s.get().els).toEqual(['x']);
    s.showSlide('b', order);
    expect(s.get().els).toEqual([]);
  });

  it('repair drops what is gone and stays near the slide that went', () => {
    const s = new SelectionStore();
    s.showSlide('c', order);
    s.set({ els: ['x', 'y'], editing: 'y' });
    s.repair({ order: () => order, hasElement: (_slide, el) => el === 'x' });
    expect(s.get()).toMatchObject({ slide: 'c', els: ['x'], editing: null });
    s.repair({ order: () => ['a', 'b', 'd'], hasElement: () => true });
    expect(s.get()).toMatchObject({ slide: 'd', els: [] });
    s.repair({ order: () => [], hasElement: () => true });
    expect(s.get()).toMatchObject({ slide: null, slides: [] });
  });
});
