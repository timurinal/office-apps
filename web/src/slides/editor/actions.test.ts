import { describe, expect, it } from 'vitest';
import { box, modelOf, testDeck } from '../model/testing';
import type { SlideJSON } from '../model/deck';
import {
  chosenHidden,
  deleteSlides,
  duplicate,
  insertTextBox,
  newSlide,
  nextLayout,
  nudge,
  resetSlides,
  selectAll,
  stepSlide,
  toggleHidden,
  type Target
} from './actions';
import { SelectionStore } from './selection';

const blank = (id: string, extra: Partial<SlideJSON> = {}): SlideJSON => ({ id, layout: 'blank', elements: [], ...extra });

function target(slides: SlideJSON[], slide = slides[0]!.id!): Target {
  const model = modelOf(testDeck(slides));
  const selection = new SelectionStore();
  selection.set({ slide, slides: [slide] });
  return { model, selection };
}

describe('new slides', () => {
  it('follows a title slide with title and content, and any other with its own layout', () => {
    const t = target([blank('a', { layout: 'title' }), blank('b', { layout: 'twoContent' }), blank('c', { layout: 'gone' })]);
    expect(nextLayout(t.model, 'a')).toBe('titleContent');
    expect(nextLayout(t.model, 'b')).toBe('twoContent');
    expect(nextLayout(t.model, 'c')).toBe('titleContent');
    expect(nextLayout(t.model, null)).toBe('titleContent');
  });

  it('goes after the slide on the canvas and is shown', () => {
    const t = target([blank('a'), blank('b'), blank('c')], 'b');
    const id = newSlide(t, 'titleContent')!;
    expect(t.model.order()).toEqual(['a', 'b', id, 'c']);
    expect(t.selection.get()).toMatchObject({ slide: id, slides: [id], els: [] });
    expect(t.model.slide(id)!.layout).toBe('titleContent');
  });
});

describe('the chosen slides', () => {
  it('deleting moves the canvas to the slide after them', () => {
    const t = target([blank('a'), blank('b'), blank('c'), blank('d')], 'b');
    t.selection.showSlide('c', t.model.order(), 'range');
    expect(deleteSlides(t)).toBe(true);
    expect(t.model.order()).toEqual(['a', 'd']);
    expect(t.selection.get().slide).toBe('d');
  });

  it('deleting the last ones moves to the one before', () => {
    const t = target([blank('a'), blank('b'), blank('c')], 'c');
    deleteSlides(t);
    expect(t.selection.get().slide).toBe('b');
  });

  it('hide hides them all, and shows them when all are hidden', () => {
    const t = target([blank('a', { hidden: true }), blank('b')], 'a');
    t.selection.showSlide('b', t.model.order(), 'range');
    expect(chosenHidden(t)).toBe(false);
    toggleHidden(t);
    expect(t.model.order().map((id) => t.model.slide(id)!.hidden)).toEqual([true, true]);
    toggleHidden(t);
    expect(t.model.order().map((id) => t.model.slide(id)!.hidden ?? false)).toEqual([false, false]);
  });

  it('Ctrl+D copies slides from the rail and elements from the slide', () => {
    const t = target([blank('a', { elements: [{ ...box(10, 10), id: 'e' }] })]);
    t.selection.set({ els: ['e'], focus: 'canvas' });
    duplicate(t);
    const els = t.model.slide('a')!.elements;
    expect(els.map((e) => [e.x, e.y])).toEqual([[10, 10], [30, 30]]);
    expect(t.selection.get().els).toEqual([els[1]!.id]);
    t.selection.set({ focus: 'rail' });
    duplicate(t);
    expect(t.model.order()).toHaveLength(2);
  });

  it('arrows step through the slides and stop at the ends', () => {
    const t = target([blank('a'), blank('b')]);
    stepSlide(t, 1);
    expect(t.selection.get().slide).toBe('b');
    stepSlide(t, 1);
    expect(t.selection.get().slide).toBe('b');
    stepSlide(t, -5);
    expect(t.selection.get().slide).toBe('a');
  });

  it('reset is one step over every chosen slide', () => {
    const t = target([blank('a', { layout: 'titleContent' })]);
    expect(resetSlides(t)).toBe(true);
    expect(t.model.slide('a')!.elements.map((e) => e.ph?.type)).toEqual(['title', 'body']);
  });
});

describe('elements', () => {
  it('a nudge moves what is not locked', () => {
    const t = target([blank('a', { elements: [{ ...box(0, 0), id: 'e' }, { ...box(0, 0), id: 'l', locked: true }] })]);
    t.selection.set({ els: ['e', 'l'] });
    expect(nudge(t, 10, -1)).toBe(true);
    expect(t.model.slide('a')!.elements.map((e) => [e.x, e.y])).toEqual([[10, -1], [0, 0]]);
  });

  it('a text box goes in the middle with the caret in it', () => {
    const t = target([blank('a')]);
    const id = insertTextBox(t)!;
    const el = t.model.element('a', id)!;
    expect([el.x + el.w / 2, el.y + el.h / 2]).toEqual([960, 540]);
    expect(t.selection.get()).toMatchObject({ els: [id], editing: id });
  });

  it('select all takes the unlocked elements, or every slide from the rail', () => {
    const t = target([blank('a', { elements: [{ ...box(0, 0), id: 'e' }, { ...box(0, 0), id: 'l', locked: true }] }), blank('b')]);
    selectAll(t);
    expect(t.selection.get().els).toEqual(['e']);
    t.selection.set({ focus: 'rail' });
    selectAll(t);
    expect(t.selection.get().slides).toEqual(['a', 'b']);
  });

  it('a reader changes nothing and the selection stays', () => {
    const model = modelOf(testDeck([blank('a', { elements: [{ ...box(0, 0), id: 'e' }] })]), { readOnly: true });
    const selection = new SelectionStore();
    selection.set({ slide: 'a', slides: ['a'], els: ['e'] });
    const t = { model, selection };
    expect(nudge(t, 1, 1)).toBe(false);
    expect(newSlide(t)).toBeNull();
    expect(selection.get().slide).toBe('a');
  });
});
