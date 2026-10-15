/**
 * What a slide show is showing, and how each key changes it.
 *
 * One `ShowState` is the whole show: the slide on screen, whether the screen is blanked, whether
 * the laser is on. A presenter's window and an audience window each hold one and keep them equal
 * through `protocol.ts`; every change here has a `rev` one higher than the state it came from and
 * the id of the window that made it, so two windows that act at once settle on the same one
 * (`wins`). Pure, over a `DeckView` read when the key was pressed.
 */

import { firstVisible, lastVisible, nearest, nextVisible, numberIndex, prevVisible, startIndex, type DeckView } from './stepping';

/** What fills the screen: the slide, a black or white screen (B and W), or the end of the show. */
export type Screen = 'none' | 'black' | 'white' | 'end';

export interface ShowState {
  /** One more than the state this came from. Whichever is higher is the later. */
  rev: number;
  /** The window that made this state. Breaks a tie between two windows that acted at once. */
  by: string;
  /** The slide on screen. Null only in a deck with no slides. */
  slide: string | null;
  /** Where `slide` was in the deck, to go to the nearest slide when it is deleted. */
  index: number;
  screen: Screen;
  laser: boolean;
}

export type ShowAction =
  | { type: 'next' }
  | { type: 'prev' }
  | { type: 'first' }
  | { type: 'last' }
  /** A slide number as typed, from 1. */
  | { type: 'goto'; n: number }
  | { type: 'screen'; screen: 'black' | 'white' }
  | { type: 'laser' }
  | { type: 'fullscreen' }
  | { type: 'exit' };

export interface Step {
  state: ShowState;
  /** The show is over. */
  exit?: true;
  /** The window should toggle full screen. Nothing in the state changes. */
  fullscreen?: true;
}

/** The state a show starts in, or null for a deck with no slides. */
export function startState(v: DeckView, from: number, by: string, rev: number): ShowState | null {
  const at = startIndex(v, from);
  if (at === null) return null;
  return { rev, by, slide: v.ids[at]!, index: at, screen: 'none', laser: false };
}

/** The place of the slide on screen: its own, or where it was if it has been taken out. */
export function indexOfShown(s: ShowState, v: DeckView): number {
  const at = s.slide ? v.ids.indexOf(s.slide) : -1;
  return at >= 0 ? at : Math.max(0, Math.min(v.ids.length - 1, s.index));
}

const to = (s: ShowState, at: number, v: DeckView, by: string): ShowState =>
  s.slide === v.ids[at] && s.screen === 'none' ? s : { ...s, rev: s.rev + 1, by, slide: v.ids[at]!, index: at, screen: 'none' };

const patch = (s: ShowState, by: string, p: Partial<ShowState>): ShowState => ({ ...s, ...p, rev: s.rev + 1, by });

/**
 * One key's worth of change. A state that does not change comes back as the same object, so the
 * caller sends nothing.
 *
 * Next and Previous on a blanked screen only bring the slide back, as PowerPoint's do; the keys
 * that name a place (first, last, a number) go there. Next past the last slide that is not hidden
 * shows the end of the show, and Next again leaves it.
 */
export function step(s: ShowState, a: ShowAction, v: DeckView, by: string): Step {
  switch (a.type) {
    case 'exit':
      return { state: s, exit: true };
    case 'fullscreen':
      return { state: s, fullscreen: true };
    case 'laser':
      return { state: patch(s, by, { laser: !s.laser }) };
    case 'screen':
      return { state: patch(s, by, { screen: s.screen === a.screen ? 'none' : a.screen }) };
    case 'first': {
      const at = firstVisible(v);
      return { state: at === null ? s : to(s, at, v, by) };
    }
    case 'last': {
      const at = lastVisible(v);
      return { state: at === null ? s : to(s, at, v, by) };
    }
    case 'goto': {
      const at = numberIndex(v, a.n);
      return { state: at === null ? s : to(s, at, v, by) };
    }
    case 'next': {
      if (s.screen === 'end') return { state: s, exit: true };
      if (s.screen !== 'none') return { state: patch(s, by, { screen: 'none' }) };
      const at = nextVisible(v, indexOfShown(s, v));
      return { state: at === null ? patch(s, by, { screen: 'end' }) : to(s, at, v, by) };
    }
    case 'prev': {
      if (s.screen !== 'none') return { state: patch(s, by, { screen: 'none' }) };
      const at = prevVisible(v, indexOfShown(s, v));
      return { state: at === null ? s : to(s, at, v, by) };
    }
  }
}

/** Whether a state that arrived from another window replaces this one. */
export function wins(incoming: ShowState, local: ShowState): boolean {
  return incoming.rev > local.rev || (incoming.rev === local.rev && incoming.by > local.by);
}

/**
 * The state after the deck changed under it: the slide on screen is where it is now, or, if it was
 * deleted, the slide that has its place. Not a new revision: every window reads the same deck and
 * repairs the same way, so nothing is sent. Null when the deck has no slides left.
 */
export function repair(s: ShowState, v: DeckView): ShowState | null {
  if (!v.ids.length) return null;
  const at = s.slide ? v.ids.indexOf(s.slide) : -1;
  if (at >= 0) return at === s.index ? s : { ...s, index: at };
  const near = nearest(v, s.index)!;
  return { ...s, slide: v.ids[near]!, index: near };
}
