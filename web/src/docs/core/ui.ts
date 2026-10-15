/**
 * Which of the core module's own panels are open: the link popover, the special
 * characters dialog, the word count, and the date being edited.
 *
 * They are drawn by `CoreHost` (overlays.tsx) and opened from three places that have
 * nothing in common: a ribbon button, a keystroke in the page (Ctrl+K), and a chip that
 * was clicked. So the state is not any one component's. It is a store on the editor
 * (env.ts holds it), and `CoreHost` subscribes with `useSyncExternalStore`.
 */

import type { Editor } from '@tiptap/core';
import { storageOf } from './storage';

export interface UiState {
  link: boolean;
  chars: boolean;
  count: boolean;
  /** The position of the date chip being edited. */
  dateAt: number | null;
}

export const UI_CLOSED: UiState = { link: false, chars: false, count: false, dateAt: null };

export interface UiStore {
  get: () => UiState;
  set: (next: Partial<UiState>) => void;
  subscribe: (cb: () => void) => () => void;
}

export function createUiStore(): UiStore {
  let state = UI_CLOSED;
  const subs = new Set<() => void>();
  return {
    get: () => state,
    set: (next) => {
      state = { ...state, ...next };
      subs.forEach((cb) => cb());
    },
    subscribe: (cb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    }
  };
}

export const uiOf = (editor: Editor): UiStore => storageOf<{ ui: UiStore }>(editor, 'oaCore').ui;

export const openLink = (editor: Editor): void => uiOf(editor).set({ link: true });
export const openChars = (editor: Editor): void => uiOf(editor).set({ chars: true });
export const openCount = (editor: Editor): void => uiOf(editor).set({ count: true });
