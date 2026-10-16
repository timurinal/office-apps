/**
 * Appearance: System, Light or Dark, the reader's own choice.
 *
 * It is kept in this browser (`localStorage`, which can be missing or refuse, so every read and
 * write is guarded and the choice lasts until the tab closes without it), never in a document
 * and never on the server: two people in one document can read it in two themes.
 *
 * ── How the theme reaches the page ──────────────────────────────────────────
 * `<html data-theme>` is always the *resolved* theme, `light` or `dark`, and
 * `<html data-appearance>` is the choice. The token blocks in styles.css therefore need only
 * `[data-theme='dark']`: System is settled here, by `matchMedia`, instead of by a second copy of
 * the dark tokens inside a media query. `web/public/theme-init.js` makes the same decision before
 * the first paint, so a reader on Dark does not see a white frame. It is a file and not an inline
 * script because the policy is `script-src 'self'`.
 *
 * Slides follows the same choice, but says so on its own element: its stylesheet's unmarked roles are
 * the dark ones. See `editorTheme`.
 */

import { useCallback, useSyncExternalStore } from 'react';
import type { DocKind } from '@shared/api';

export type Appearance = 'system' | 'light' | 'dark';
export type Theme = 'light' | 'dark';

export const APPEARANCES: readonly Appearance[] = ['system', 'light', 'dark'];
/** Also spelled in web/public/theme-init.js, whose test reads this constant. */
export const APPEARANCE_KEY = 'office.appearance';

export function parseAppearance(v: unknown): Appearance {
  return v === 'light' || v === 'dark' ? v : 'system';
}

type ReadStore = Pick<Storage, 'getItem'> | null;
type WriteStore = Pick<Storage, 'setItem'> | null;

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function readAppearance(storage: ReadStore = safeStorage()): Appearance {
  try {
    return parseAppearance(storage?.getItem(APPEARANCE_KEY));
  } catch {
    return 'system';
  }
}

/** Whether the choice was kept. A refusing browser still gets the theme, until the tab closes. */
export function writeAppearance(appearance: Appearance, storage: WriteStore = safeStorage()): boolean {
  try {
    if (!storage) return false;
    storage.setItem(APPEARANCE_KEY, appearance);
    return true;
  } catch {
    return false;
  }
}

export const resolveTheme = (appearance: Appearance, systemDark: boolean): Theme =>
  appearance === 'dark' || (appearance === 'system' && systemDark) ? 'dark' : 'light';

export function systemPrefersDark(): boolean {
  try {
    return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    return false;
  }
}

export function applyTheme(root: Element, appearance: Appearance, systemDark: boolean): Theme {
  const theme = resolveTheme(appearance, systemDark);
  root.setAttribute('data-theme', theme);
  root.setAttribute('data-appearance', appearance);
  return theme;
}

/**
 * The theme an editor's own chrome names, or undefined when it simply takes the page's. Slides names
 * the page's resolved theme, because its stylesheet's unmarked roles are the dark ones; Docs and
 * Sheets set nothing.
 */
export function editorTheme(kind: DocKind | null | undefined, theme: Theme): Theme | undefined {
  return kind === 'slides' ? theme : undefined;
}

// ── the store ───────────────────────────────────────────────────────────────

export interface AppearanceState {
  appearance: Appearance;
  theme: Theme;
}

let state: AppearanceState | null = null;
const listeners = new Set<() => void>();

const settle = (appearance: Appearance): AppearanceState => ({ appearance, theme: resolveTheme(appearance, systemPrefersDark()) });

/** The same object until something changes, which is what `useSyncExternalStore` needs. */
export function appearanceState(): AppearanceState {
  return (state ??= settle(readAppearance()));
}

function put(next: AppearanceState): void {
  if (state && state.appearance === next.appearance && state.theme === next.theme) return;
  state = next;
  if (typeof document !== 'undefined') applyTheme(document.documentElement, next.appearance, next.theme === 'dark');
  for (const l of [...listeners]) l();
}

export function setAppearance(appearance: Appearance): void {
  const had = appearanceState().appearance;
  if (appearance !== had) writeAppearance(appearance);
  put(settle(appearance));
}

export function subscribeAppearance(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/**
 * Apply the kept choice and follow the world: the system's own switch while the choice is System,
 * and a choice made in another tab. Called once, before the first render.
 */
export function initAppearance(): () => void {
  state = null;
  const now = appearanceState();
  if (typeof document !== 'undefined') applyTheme(document.documentElement, now.appearance, now.theme === 'dark');

  const cleanups: (() => void)[] = [];
  try {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onSystem = () => {
      if (appearanceState().appearance === 'system') put(settle('system'));
    };
    mq.addEventListener('change', onSystem);
    cleanups.push(() => mq.removeEventListener('change', onSystem));
  } catch {
    // No matchMedia: the theme is what it was at load.
  }
  if (typeof window !== 'undefined') {
    const onStorage = (e: StorageEvent) => {
      if (e.key === APPEARANCE_KEY) put(settle(parseAppearance(e.newValue)));
    };
    window.addEventListener('storage', onStorage);
    cleanups.push(() => window.removeEventListener('storage', onStorage));
  }
  return () => cleanups.forEach((c) => c());
}

const SERVER: AppearanceState = { appearance: 'system', theme: 'light' };

export function useAppearance(): AppearanceState & { setAppearance: (a: Appearance) => void } {
  const s = useSyncExternalStore(subscribeAppearance, appearanceState, () => SERVER);
  return { ...s, setAppearance: useCallback((a: Appearance) => setAppearance(a), []) };
}

/** The theme an editor's chrome wears, for the kind of document open in it. */
export function useEditorTheme(kind: DocKind | null | undefined): Theme | undefined {
  const { theme } = useSyncExternalStore(subscribeAppearance, appearanceState, () => SERVER);
  return editorTheme(kind, theme);
}
