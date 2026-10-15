/**
 * The format painter's state: a format lifted from a cell, waiting for the selection it is to be laid
 * on. A tiny store, because the ribbon button that arms it and the overlay that applies it (when the
 * pointer comes up on the grid) are not parent and child.
 */

import { useSyncExternalStore } from 'react';
import type { StoredStyle } from '../model';

let lifted: StoredStyle | null = null;
const listeners = new Set<() => void>();
const emit = () => {
  for (const l of [...listeners]) l();
};

export const arm = (style: StoredStyle): void => {
  lifted = style;
  emit();
};

export const disarm = (): void => {
  if (lifted === null) return;
  lifted = null;
  emit();
};

export const painterNow = (): StoredStyle | null => lifted;

export function usePainter(): StoredStyle | null {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => lifted,
    () => null
  );
}
