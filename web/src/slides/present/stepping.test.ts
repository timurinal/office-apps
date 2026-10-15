import { describe, expect, it } from 'vitest';
import { firstVisible, lastVisible, nearest, nextVisible, numberIndex, prevVisible, startIndex, type DeckView } from './stepping';

const deck = (n: number, hidden: number[] = []): DeckView => ({
  ids: Array.from({ length: n }, (_, i) => `s${i + 1}`),
  hidden: (id) => hidden.includes(Number(id.slice(1)) - 1)
});

describe('stepping past hidden slides', () => {
  it('goes to the next slide, and skips every hidden one in a row', () => {
    const v = deck(6, [1, 2, 3]);
    expect(nextVisible(v, 0)).toBe(4);
    expect(nextVisible(v, 4)).toBe(5);
    expect(nextVisible(v, 5)).toBeNull();
  });

  it('goes back past hidden slides, and stops at the first', () => {
    const v = deck(6, [1, 2, 3]);
    expect(prevVisible(v, 4)).toBe(0);
    expect(prevVisible(v, 0)).toBeNull();
  });

  it('steps from a slide that is itself hidden', () => {
    const v = deck(5, [2]);
    expect(nextVisible(v, 2)).toBe(3);
    expect(prevVisible(v, 2)).toBe(1);
  });

  it('finds the first and the last visible slide', () => {
    const v = deck(5, [0, 4]);
    expect(firstVisible(v)).toBe(1);
    expect(lastVisible(v)).toBe(3);
    expect(firstVisible(deck(2, [0, 1]))).toBeNull();
    expect(lastVisible(deck(2, [0, 1]))).toBeNull();
  });

  it('has no next in an empty deck', () => {
    expect(nextVisible(deck(0), -1)).toBeNull();
    expect(prevVisible(deck(0), 0)).toBeNull();
  });
});

describe('where a show starts', () => {
  it('from the beginning skips a hidden first slide', () => {
    expect(startIndex(deck(4, [0, 1]), 0)).toBe(2);
  });

  it('from a slide that was chosen starts there, hidden or not', () => {
    expect(startIndex(deck(4, [2]), 2)).toBe(2);
  });

  it('shows the first slide of a deck whose every slide is hidden', () => {
    expect(startIndex(deck(2, [0, 1]), 0)).toBe(0);
  });

  it('keeps a start inside the deck, and is null without slides', () => {
    expect(startIndex(deck(3), 9)).toBe(2);
    expect(startIndex(deck(3), -4)).toBe(0);
    expect(startIndex(deck(0), 0)).toBeNull();
  });
});

describe('a typed slide number', () => {
  it('counts from 1 over every slide and reaches a hidden one', () => {
    const v = deck(6, [2]);
    expect(numberIndex(v, 3)).toBe(2);
    expect(numberIndex(v, 1)).toBe(0);
  });

  it('is kept inside the deck', () => {
    const v = deck(6);
    expect(numberIndex(v, 0)).toBe(0);
    expect(numberIndex(v, 99)).toBe(5);
    expect(numberIndex(deck(0), 1)).toBeNull();
  });
});

describe('a slide taken out of the deck', () => {
  it('moves the show to the slide that has its place, or the last', () => {
    expect(nearest(deck(5), 2)).toBe(2);
    expect(nearest(deck(3), 7)).toBe(2);
    expect(nearest(deck(0), 0)).toBeNull();
  });
});
