/**
 * Where a slide show goes next: through the deck's slides in order, past the hidden ones.
 *
 * Pure, over a `DeckView` read at the moment a key is pressed (the deck is live while a show runs,
 * so a view is never kept). An index is the place in `ids`; an id that is no longer in the deck
 * is the caller's to repair with `nearest`.
 */

export interface DeckView {
  /** Slide ids in deck order. */
  ids: readonly string[];
  hidden: (id: string) => boolean;
}

const visible = (v: DeckView, i: number): boolean => i >= 0 && i < v.ids.length && !v.hidden(v.ids[i]!);

/** The first slide that is not hidden, or null when every slide is. */
export function firstVisible(v: DeckView): number | null {
  for (let i = 0; i < v.ids.length; i++) if (visible(v, i)) return i;
  return null;
}

export function lastVisible(v: DeckView): number | null {
  for (let i = v.ids.length - 1; i >= 0; i--) if (visible(v, i)) return i;
  return null;
}

/** The slide after `at` that is not hidden. Null at the end. */
export function nextVisible(v: DeckView, at: number): number | null {
  for (let i = Math.max(-1, at) + 1; i < v.ids.length; i++) if (visible(v, i)) return i;
  return null;
}

/** The slide before `at` that is not hidden. Null at the start. */
export function prevVisible(v: DeckView, at: number): number | null {
  for (let i = Math.min(v.ids.length, at) - 1; i >= 0; i--) if (visible(v, i)) return i;
  return null;
}

/**
 * Where a show starts. From the beginning (`from` 0) it skips a hidden first slide. From any other
 * slide it starts there, hidden or not: a person who chose it asked for it. A deck with every slide
 * hidden shows the one asked for. Null for a deck with no slides.
 */
export function startIndex(v: DeckView, from: number): number | null {
  if (!v.ids.length) return null;
  const at = Math.max(0, Math.min(v.ids.length - 1, Math.floor(from) || 0));
  if (at === 0 && !visible(v, 0)) return firstVisible(v) ?? 0;
  return at;
}

/** A typed slide number, counted from 1 over every slide, hidden ones too, and kept inside the deck. */
export function numberIndex(v: DeckView, n: number): number | null {
  if (!v.ids.length || !Number.isFinite(n)) return null;
  return Math.max(0, Math.min(v.ids.length - 1, Math.floor(n) - 1));
}

/**
 * Where a show whose slide was taken out of the deck goes: the slide that now has its place, or the
 * last one, as a selection does after a delete.
 */
export function nearest(v: DeckView, lostIndex: number): number | null {
  if (!v.ids.length) return null;
  return Math.max(0, Math.min(v.ids.length - 1, lostIndex));
}
