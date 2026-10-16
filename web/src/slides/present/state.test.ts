import { describe, expect, it } from 'vitest';
import { repair, startState, step, wins, type ShowState } from './state';
import type { DeckView } from './stepping';

const deck = (n: number, hidden: number[] = []): DeckView => ({
  ids: Array.from({ length: n }, (_, i) => `s${i + 1}`),
  hidden: (id) => hidden.includes(Number(id.slice(1)) - 1)
});

const at = (v: DeckView, i: number): ShowState => ({ rev: 1, by: 'a', slide: v.ids[i]!, index: i, screen: 'none', laser: false });

describe('starting a show', () => {
  it('starts on the slide asked for, with nothing blanked', () => {
    const s = startState(deck(5), 2, 'a', 1)!;
    expect(s).toMatchObject({ slide: 's3', index: 2, screen: 'none', laser: false, rev: 1, by: 'a' });
  });

  it('has no show in a deck with no slides', () => {
    expect(startState(deck(0), 0, 'a', 1)).toBeNull();
  });
});

describe('next and previous', () => {
  it('step one visible slide, skipping the hidden ones, and count each as one change', () => {
    const v = deck(5, [1, 2]);
    const s0 = at(v, 0);
    const s1 = step(s0, { type: 'next' }, v, 'a').state;
    expect(s1).toMatchObject({ slide: 's4', index: 3, rev: 2 });
    const s2 = step(s1, { type: 'prev' }, v, 'a').state;
    expect(s2).toMatchObject({ slide: 's1', index: 0, rev: 3 });
  });

  it('stay on the first slide going back, and change nothing', () => {
    const v = deck(3);
    const s = at(v, 0);
    expect(step(s, { type: 'prev' }, v, 'a').state).toBe(s);
  });

  it('show the end of the show after the last slide, and leave it on the next press', () => {
    const v = deck(2);
    const last = at(v, 1);
    const end = step(last, { type: 'next' }, v, 'a');
    expect(end.state).toMatchObject({ screen: 'end', slide: 's2' });
    expect(end.exit).toBeUndefined();
    expect(step(end.state, { type: 'next' }, v, 'a').exit).toBe(true);
  });

  it('come back from the end to the last slide', () => {
    const v = deck(2);
    const end = step(at(v, 1), { type: 'next' }, v, 'a').state;
    expect(step(end, { type: 'prev' }, v, 'a').state).toMatchObject({ screen: 'none', slide: 's2' });
  });

  it('treat a trailing hidden slide as the end', () => {
    const v = deck(3, [2]);
    expect(step(at(v, 1), { type: 'next' }, v, 'a').state.screen).toBe('end');
  });
});

describe('first, last and a typed number', () => {
  it('go to the first and the last visible slide', () => {
    const v = deck(5, [0, 4]);
    expect(step(at(v, 2), { type: 'first' }, v, 'a').state.slide).toBe('s2');
    expect(step(at(v, 2), { type: 'last' }, v, 'a').state.slide).toBe('s4');
  });

  it('go to a number, hidden slide included, and stay inside the deck', () => {
    const v = deck(5, [2]);
    expect(step(at(v, 0), { type: 'goto', n: 3 }, v, 'a').state.slide).toBe('s3');
    expect(step(at(v, 0), { type: 'goto', n: 40 }, v, 'a').state.slide).toBe('s5');
  });

  it('change nothing for the slide already on screen', () => {
    const v = deck(5);
    const s = at(v, 2);
    expect(step(s, { type: 'goto', n: 3 }, v, 'a').state).toBe(s);
  });
});

describe('the black and the white screen', () => {
  const v = deck(3);

  it('toggle: B blanks, B again brings the slide back, W swaps one for the other', () => {
    const s0 = at(v, 1);
    const black = step(s0, { type: 'screen', screen: 'black' }, v, 'a').state;
    expect(black.screen).toBe('black');
    expect(step(black, { type: 'screen', screen: 'white' }, v, 'a').state.screen).toBe('white');
    expect(step(black, { type: 'screen', screen: 'black' }, v, 'a').state.screen).toBe('none');
  });

  it('are left by next or previous without moving, and by a named place with moving', () => {
    const black = step(at(v, 1), { type: 'screen', screen: 'black' }, v, 'a').state;
    expect(step(black, { type: 'next' }, v, 'a').state).toMatchObject({ screen: 'none', slide: 's2' });
    expect(step(black, { type: 'prev' }, v, 'a').state).toMatchObject({ screen: 'none', slide: 's2' });
    expect(step(black, { type: 'last' }, v, 'a').state).toMatchObject({ screen: 'none', slide: 's3' });
  });
});

describe('the laser, full screen and leaving', () => {
  const v = deck(2);
  it('the laser toggles in the state, so the other window shows it too', () => {
    const on = step(at(v, 0), { type: 'laser' }, v, 'a').state;
    expect(on.laser).toBe(true);
    expect(step(on, { type: 'laser' }, v, 'a').state.laser).toBe(false);
  });

  it('full screen changes no state, and exit says the show is over', () => {
    const s = at(v, 0);
    expect(step(s, { type: 'fullscreen' }, v, 'a')).toEqual({ state: s, fullscreen: true });
    expect(step(s, { type: 'exit' }, v, 'a')).toEqual({ state: s, exit: true });
  });
});

describe('two windows acting at once', () => {
  it('the higher revision wins, and equal ones are settled by the window id, the same in both', () => {
    const a = { ...at(deck(3), 1), rev: 4, by: 'a' };
    const b = { ...at(deck(3), 2), rev: 4, by: 'b' };
    expect(wins(b, a)).toBe(true);
    expect(wins(a, b)).toBe(false);
    expect(wins({ ...a, rev: 5 }, b)).toBe(true);
    expect(wins(a, a)).toBe(false);
  });

  it('a change made after adopting the other window’s state is later than both', () => {
    const v = deck(4);
    const mine = at(v, 0);
    const theirs: ShowState = { ...at(v, 2), rev: 7, by: 'z' };
    expect(wins(theirs, mine)).toBe(true);
    const next = step(theirs, { type: 'next' }, v, 'a').state;
    expect(next.rev).toBe(8);
    expect(wins(next, theirs)).toBe(true);
  });
});

describe('the deck changing while it is shown', () => {
  it('follows the slide when others move it', () => {
    const v: DeckView = { ids: ['s9', 's1', 's2', 's3'], hidden: () => false };
    const s = repair({ ...at(deck(3), 1), slide: 's2' }, v)!;
    expect(s).toMatchObject({ slide: 's2', index: 2 });
  });

  it('goes to the slide that took the place of one that was deleted', () => {
    const v: DeckView = { ids: ['s1', 's3', 's4'], hidden: () => false };
    expect(repair({ ...at(deck(4), 1), slide: 's2' }, v)).toMatchObject({ slide: 's3', index: 1 });
  });

  it('goes to the last slide when the last was deleted', () => {
    const v: DeckView = { ids: ['s1', 's2'], hidden: () => false };
    expect(repair({ ...at(deck(3), 2), slide: 's3' }, v)).toMatchObject({ slide: 's2', index: 1 });
  });

  it('is not a new revision, so no window sends it', () => {
    const v: DeckView = { ids: ['s1', 's3'], hidden: () => false };
    const s = at(deck(3), 1);
    expect(repair({ ...s, slide: 's2' }, v)!.rev).toBe(s.rev);
  });

  it('keeps showing a slide that was hidden meanwhile', () => {
    const v = deck(3, [1]);
    const s = at(v, 1);
    expect(repair(s, v)).toBe(s);
  });

  it('has nothing to show once every slide is gone', () => {
    expect(repair(at(deck(2), 0), deck(0))).toBeNull();
  });
});
