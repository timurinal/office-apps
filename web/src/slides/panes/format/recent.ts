/**
 * The colours a person chose last, newest first, kept in the browser for the next presentation. It is
 * a convenience of this viewer's and never reaches the deck or another person, so every read and write
 * is wrapped: private windows and blocked storage answer nothing, and the picker works without it.
 */

import type { Color } from '../../model/deck';
import { safeColor } from '../../model/safe';
import { normal } from './palette';

const KEY = 'mv.slides.recent-colours';
export const RECENT_MAX = 8;

export function readRecent(): Color[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    if (!Array.isArray(raw)) return [];
    return raw.map((c) => safeColor(c)).filter((c): c is Color => c !== null).slice(0, RECENT_MAX);
  } catch {
    return [];
  }
}

/** `color` first, and nothing twice. Answers the new list. */
export function pushRecent(color: Color): Color[] {
  const next = [color, ...readRecent().filter((c) => normal(c) !== normal(color))].slice(0, RECENT_MAX);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Not kept; it is shown for the rest of the visit by the caller.
  }
  return next;
}
