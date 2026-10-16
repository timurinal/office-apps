/**
 * One per-reader preference: a value kept in this browser, read once, announced to whoever draws
 * it, and followed across tabs. `localStorage` can be missing, full or refuse to answer (a
 * private window, blocked site data), so every access is guarded and the choice then lasts until
 * the tab closes. It is a convenience of the person looking, never a property of a document.
 */

import { useSyncExternalStore } from 'react';

export interface Pref<T> {
  get: () => T;
  set: (value: T) => void;
  subscribe: (listener: () => void) => () => void;
  /** The value, for a component that redraws when it changes. */
  use: () => T;
}

export function createPref<T>({ key, parse, serialize }: { key: string; parse: (raw: string | null) => T; serialize: (value: T) => string }): Pref<T> {
  let value: T | undefined;
  let read = false;
  const listeners = new Set<() => void>();

  const stored = (): string | null => {
    try {
      return typeof localStorage === 'undefined' ? null : localStorage.getItem(key);
    } catch {
      return null;
    }
  };

  const get = (): T => {
    if (!read) {
      value = parse(stored());
      read = true;
    }
    return value as T;
  };

  const put = (next: T): void => {
    if (read && Object.is(value, next)) return;
    value = next;
    read = true;
    for (const l of [...listeners]) l();
  };

  const onStorage = (e: StorageEvent): void => {
    if (e.key === key) put(parse(e.newValue));
  };

  const subscribe = (listener: () => void): (() => void) => {
    if (listeners.size === 0 && typeof window !== 'undefined') window.addEventListener('storage', onStorage);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0 && typeof window !== 'undefined') window.removeEventListener('storage', onStorage);
    };
  };

  return {
    get,
    set(next) {
      if (read && Object.is(value, next)) return;
      try {
        if (typeof localStorage !== 'undefined') localStorage.setItem(key, serialize(next));
      } catch {
        // Not remembered; still changed for this visit.
      }
      put(next);
    },
    subscribe,
    use: () => useSyncExternalStore(subscribe, get, get)
  };
}
