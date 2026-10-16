/**
 * What a key does in a slide show.
 *
 *   → ↓ Space PageDown Enter N       next            ← ↑ PageUp Backspace P   previous
 *   Home, End                        first, last     a number, then Enter     that slide
 *   B or . · W or ,                  a black or a white screen
 *   L or Ctrl+P                      the laser pointer
 *   F                                full screen
 *   Esc                              leave
 *
 * Pure: a key and the digits typed so far in, what to do and the digits now out. While a show is
 * on screen it owns the keyboard, so `handled` is true for every key except the browser's own
 * shortcuts (Ctrl, Cmd and Alt with a key, F11, F12): a letter must not be typed into the text box
 * under the show, nor Delete take the shape that is chosen there.
 */

import type { ShowAction } from './state';

export type KeyLike = Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey' | 'repeat'>;

export interface KeyOutcome {
  /** The show took the key: stop it reaching the page and the browser. */
  handled: boolean;
  action: ShowAction | null;
  /** The digits typed towards a slide number. */
  digits: string;
}

/** Slide numbers have at most this many digits: a deck is at most 500 slides. */
export const MAX_DIGITS = 3;

const NEXT = new Set(['ArrowRight', 'ArrowDown', ' ', 'Spacebar', 'PageDown', 'n', 'N']);
const PREV = new Set(['ArrowLeft', 'ArrowUp', 'PageUp', 'p', 'P']);
/** The browser's own: left alone, so the person can still open the tools or leave full screen. */
const BROWSER = new Set(['F11', 'F12', 'Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'AltGraph']);

const act = (action: ShowAction): KeyOutcome => ({ handled: true, action, digits: '' });

export function onKey(e: KeyLike, digits: string): KeyOutcome {
  const { key } = e;
  if (BROWSER.has(key)) return { handled: false, action: null, digits };
  // Ctrl+P is the laser here and not the browser's print. Every other chord is the browser's.
  if (e.ctrlKey && !e.metaKey && !e.altKey && (key === 'p' || key === 'P')) return act({ type: 'laser' });
  if (e.ctrlKey || e.metaKey || e.altKey) return { handled: false, action: null, digits };

  if (key >= '0' && key <= '9' && key.length === 1) {
    return { handled: true, action: null, digits: (digits + key).slice(-MAX_DIGITS) };
  }
  if (key === 'Enter') {
    if (digits) return act({ type: 'goto', n: Number(digits) });
    return act({ type: 'next' });
  }
  if (key === 'Backspace') {
    if (digits) return { handled: true, action: null, digits: digits.slice(0, -1) };
    return act({ type: 'prev' });
  }
  if (key === 'Escape') return act({ type: 'exit' });
  if (NEXT.has(key)) return act({ type: 'next' });
  if (PREV.has(key)) return act({ type: 'prev' });
  if (key === 'Home') return act({ type: 'first' });
  if (key === 'End') return act({ type: 'last' });
  // A held key repeats; only moving along the deck should.
  if (e.repeat) return { handled: true, action: null, digits };
  if (key === 'b' || key === 'B' || key === '.') return act({ type: 'screen', screen: 'black' });
  if (key === 'w' || key === 'W' || key === ',') return act({ type: 'screen', screen: 'white' });
  if (key === 'l' || key === 'L') return act({ type: 'laser' });
  if (key === 'f' || key === 'F') return act({ type: 'fullscreen' });
  return { handled: true, action: null, digits };
}
