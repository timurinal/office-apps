import { describe, expect, it } from 'vitest';
import { createTypeahead, isTypeaheadKey, TYPEAHEAD_MS } from './typeahead';

const LABELS = ['Apple', 'Banana', 'Blueberry', 'Cherry', 'Cranberry', 'date'];

describe('type-ahead', () => {
  it('moves to the first item after the current one that starts with the letter, and wraps', () => {
    const t = createTypeahead(() => 0);
    expect(t.type('b', LABELS, 0)).toBe(1);
    t.reset();
    expect(t.type('b', LABELS, 1)).toBe(2);
    t.reset();
    expect(t.type('b', LABELS, 2)).toBe(1);
  });

  it('narrows as a word is typed, staying on an item that still matches', () => {
    const t = createTypeahead(() => 0);
    expect(t.type('b', LABELS, 0)).toBe(1);
    expect(t.type('l', LABELS, 1)).toBe(2);
    expect(t.type('u', LABELS, 2)).toBe(2);
  });

  it('steps through the items that start with a letter typed again and again', () => {
    const t = createTypeahead(() => 0);
    expect(t.type('c', LABELS, 0)).toBe(3);
    expect(t.type('c', LABELS, 3)).toBe(4);
    expect(t.type('c', LABELS, 4)).toBe(3);
  });

  it('forgets after a pause', () => {
    let now = 0;
    const t = createTypeahead(() => now);
    expect(t.type('b', LABELS, 0)).toBe(1);
    now = TYPEAHEAD_MS + 1;
    expect(t.type('d', LABELS, 1)).toBe(5);
  });

  it('is not case sensitive, and answers -1 for no match', () => {
    const t = createTypeahead(() => 0);
    expect(t.type('D', LABELS, 0)).toBe(5);
    t.reset();
    expect(t.type('z', LABELS, 0)).toBe(-1);
  });

  it('skips items it is told are not usable', () => {
    const t = createTypeahead(() => 0);
    expect(t.type('c', LABELS, 0, (i) => i !== 3)).toBe(4);
  });

  it('answers -1 for no items', () => {
    expect(createTypeahead(() => 0).type('a', [], -1)).toBe(-1);
  });

  it('takes a plain character, and not a shortcut or Space', () => {
    expect(isTypeaheadKey({ key: 'a', ctrlKey: false, metaKey: false, altKey: false })).toBe(true);
    expect(isTypeaheadKey({ key: 'a', ctrlKey: true, metaKey: false, altKey: false })).toBe(false);
    expect(isTypeaheadKey({ key: ' ', ctrlKey: false, metaKey: false, altKey: false })).toBe(false);
    expect(isTypeaheadKey({ key: 'ArrowDown', ctrlKey: false, metaKey: false, altKey: false })).toBe(false);
  });
});
