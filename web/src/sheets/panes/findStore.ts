/**
 * The find bar's state, kept outside the bar so that closing it and opening it again finds what was
 * typed, a key and a button open it the same way, and a second Ctrl+F puts the caret in the field.
 */

import { useSyncExternalStore } from 'react';
import { DEFAULT_FIND, type FindOptions } from '../modules/findActions';

export interface FindState {
  open: boolean;
  /** The replace row is showing. */
  replace: boolean;
  options: FindOptions;
  replacement: string;
  /** Bumped by each request to open, so a bar that is open takes the caret again. */
  asked: number;
}

let state: FindState = { open: false, replace: false, options: DEFAULT_FIND, replacement: '', asked: 0 };
const listeners = new Set<() => void>();

const set = (next: FindState) => {
  state = next;
  for (const l of [...listeners]) l();
};

export const openFind = (o: { replace?: boolean } = {}): void =>
  set({ ...state, open: true, replace: o.replace ?? state.replace, asked: state.asked + 1 });

export const closeFind = (): void => {
  if (state.open) set({ ...state, open: false });
};

export const setFind = (patch: Partial<Omit<FindState, 'options'>> & { options?: Partial<FindOptions> }): void => {
  const { options, ...rest } = patch;
  set({ ...state, ...rest, options: options ? { ...state.options, ...options } : state.options });
};

export const findNow = (): FindState => state;

export function useFind(): FindState {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => state,
    () => state
  );
}
