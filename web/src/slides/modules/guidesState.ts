/**
 * Whether smart guides are on: this person's own choice, kept in this browser (`localStorage`, which
 * can be missing or refuse, so every read and write is guarded and the guides are on without it).
 * It is not in the deck and not in the context, because a snap rule and a ribbon button both read
 * it and neither re-renders the page; a button follows it with `useGuides`.
 */

import { useSyncExternalStore } from 'react';

const KEY = 'oa-slides-guides';

function stored(): boolean {
  try {
    return localStorage.getItem(KEY) !== 'off';
  } catch {
    return true;
  }
}

let on = stored();
const listeners = new Set<() => void>();

export const guidesOn = (): boolean => on;

export function setGuides(next: boolean): void {
  if (next === on) return;
  on = next;
  try {
    if (next) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, 'off');
  } catch {
    // Not remembered; still changed for this visit.
  }
  for (const l of [...listeners]) l();
}

export const toggleGuides = (): void => setGuides(!on);

const subscribe = (cb: () => void): (() => void) => {
  listeners.add(cb);
  return () => void listeners.delete(cb);
};

export function useGuides(): boolean {
  return useSyncExternalStore(subscribe, guidesOn, () => true);
}
