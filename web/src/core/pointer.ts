/** Whether the main pointer is a finger. A phone keeps the platform's own dropdown, which is a sheet it draws well. */

import { useSyncExternalStore } from 'react';

const COARSE = '(pointer: coarse)';

const subscribe = (cb: () => void): (() => void) => {
  if (typeof matchMedia !== 'function') return () => undefined;
  const mql = matchMedia(COARSE);
  mql.addEventListener?.('change', cb);
  return () => mql.removeEventListener?.('change', cb);
};

export const coarsePointer = (): boolean => typeof matchMedia === 'function' && matchMedia(COARSE).matches;

export function useCoarsePointer(): boolean {
  return useSyncExternalStore(subscribe, coarsePointer, () => false);
}
