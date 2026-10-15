import { describe, expect, it } from 'vitest';
import { SelectionStore } from '../editor/selection';
import type { Transition } from '../model/deck';
import { modelOf, testDeck } from '../model/testing';
import { applyToAll, currentTransition, durationSeconds, markedSide, setDuration, setKind, setSide, withKind, type TransitionTarget } from './transitionEdit';

const target = (slides: { id: string; transition?: Transition }[] = [{ id: 's1' }, { id: 's2' }, { id: 's3' }]): TransitionTarget => {
  const model = modelOf(testDeck(slides.map((s) => ({ id: s.id, layout: 'blank', elements: [], ...(s.transition ? { transition: s.transition } : {}) }))));
  const selection = new SelectionStore();
  selection.set({ slide: 's1', slides: ['s1'] });
  return { model, selection };
};
const of = (t: TransitionTarget, id: string) => t.model.slide(id)?.transition;

describe('choosing a kind', () => {
  it('puts it on the slide on the canvas', () => {
    const t = target();
    expect(setKind(t, 'fade')).toBe(true);
    expect(of(t, 's1')).toEqual({ kind: 'fade' });
    expect(of(t, 's2')).toBeUndefined();
  });

  it('puts it on every slide chosen in the rail, as one undo', () => {
    const t = target();
    t.selection.set({ slide: 's1', slides: ['s1', 's2'] });
    setKind(t, 'push');
    expect(of(t, 's1')).toEqual({ kind: 'push' });
    expect(of(t, 's2')).toEqual({ kind: 'push' });
    expect(of(t, 's3')).toBeUndefined();
    t.model.undo();
    expect(of(t, 's1')).toBeUndefined();
    expect(of(t, 's2')).toBeUndefined();
  });

  it('keeps the time and, for push and wipe, the side, and drops a side that does not apply', () => {
    const t = target([{ id: 's1', transition: { kind: 'push', duration: 900, from: 'top' } }]);
    setKind(t, 'wipe');
    expect(of(t, 's1')).toEqual({ kind: 'wipe', duration: 900, from: 'top' });
    setKind(t, 'fade');
    expect(of(t, 's1')).toEqual({ kind: 'fade', duration: 900 });
    setKind(t, 'push');
    expect(of(t, 's1')).toEqual({ kind: 'push', duration: 900 });
  });

  it('removes the transition for none', () => {
    const t = target([{ id: 's1', transition: { kind: 'zoom' } }]);
    setKind(t, 'none');
    expect(of(t, 's1')).toBeUndefined();
    expect(currentTransition(t)).toBeNull();
  });

  it('is refused for a reader, with the model’s own notice', () => {
    const model = modelOf(testDeck(), { readOnly: true });
    const selection = new SelectionStore();
    selection.set({ slide: 's1', slides: ['s1'] });
    expect(setKind({ model, selection }, 'fade')).toBe(false);
    expect(model.slide('s1')?.transition).toBeUndefined();
  });

  it('builds on the canvas slide’s transition when the slides chosen differ', () => {
    const t = target([{ id: 's1', transition: { kind: 'push', duration: 500 } }, { id: 's2', transition: { kind: 'zoom', duration: 1500 } }, { id: 's3' }]);
    t.selection.set({ slide: 's2', slides: ['s1', 's2', 's3'] });
    setKind(t, 'fade');
    for (const id of ['s1', 's2', 's3']) expect(of(t, id), id).toEqual({ kind: 'fade', duration: 1500 });
  });
});

describe('the side', () => {
  it('is set for push and wipe', () => {
    const t = target([{ id: 's1', transition: { kind: 'wipe' } }]);
    expect(setSide(t, 'bottom')).toBe(true);
    expect(of(t, 's1')).toEqual({ kind: 'wipe', from: 'bottom' });
  });

  it('is not set for fade, zoom or none', () => {
    for (const transition of [{ kind: 'fade' }, { kind: 'zoom' }, undefined] as (Transition | undefined)[]) {
      const t = target([{ id: 's1', ...(transition ? { transition } : {}) }]);
      expect(setSide(t, 'left')).toBe(false);
      expect(of(t, 's1')).toEqual(transition);
    }
  });

  it('is marked only where it applies', () => {
    expect(markedSide({ kind: 'push' })).toBe('right');
    expect(markedSide({ kind: 'push', from: 'top' })).toBe('top');
    expect(markedSide({ kind: 'fade' })).toBeNull();
    expect(markedSide(null)).toBeNull();
  });
});

describe('the time', () => {
  it('is set in ms, and kept inside what the field accepts', () => {
    const t = target([{ id: 's1', transition: { kind: 'fade' } }]);
    setDuration(t, 1250);
    expect(of(t, 's1')).toEqual({ kind: 'fade', duration: 1250 });
    setDuration(t, 5);
    expect(of(t, 's1')!.duration).toBe(100);
    setDuration(t, 999_999);
    expect(of(t, 's1')!.duration).toBe(10_000);
  });

  it('is not set for no transition, or for a number that is not one', () => {
    const none = target();
    expect(setDuration(none, 500)).toBe(false);
    const t = target([{ id: 's1', transition: { kind: 'fade' } }]);
    expect(setDuration(t, Number.NaN)).toBe(false);
    expect(of(t, 's1')).toEqual({ kind: 'fade' });
  });

  it('is shown in seconds, and not at all for none', () => {
    expect(durationSeconds({ kind: 'fade', duration: 1250 })).toBe(1.25);
    expect(durationSeconds({ kind: 'fade' })).toBe(0.7);
    expect(durationSeconds(null)).toBeNull();
    expect(durationSeconds({ kind: 'none' })).toBeNull();
  });
});

describe('apply to all slides', () => {
  it('copies the canvas slide’s transition to every slide, as one undo', () => {
    const t = target([{ id: 's1', transition: { kind: 'wipe', duration: 800, from: 'left' } }, { id: 's2', transition: { kind: 'zoom' } }, { id: 's3' }]);
    expect(applyToAll(t)).toBe(true);
    for (const id of ['s1', 's2', 's3']) expect(of(t, id), id).toEqual({ kind: 'wipe', duration: 800, from: 'left' });
    t.model.undo();
    expect(of(t, 's1')).toEqual({ kind: 'wipe', duration: 800, from: 'left' });
    expect(of(t, 's2')).toEqual({ kind: 'zoom' });
    expect(of(t, 's3')).toBeUndefined();
  });

  it('clears every slide when the canvas slide has none', () => {
    const t = target([{ id: 's1' }, { id: 's2', transition: { kind: 'fade' } }]);
    applyToAll(t);
    expect(of(t, 's2')).toBeUndefined();
  });
});

describe('withKind', () => {
  it('stores nothing for none', () => {
    expect(withKind('none', { kind: 'push', duration: 500 })).toBeNull();
  });
});
