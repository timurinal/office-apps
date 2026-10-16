/**
 * Page colour: the colour of the sheet a document is read on, the reader's own choice.
 *
 * Auto follows the appearance (a dark page in the dark theme, a white one otherwise); White, Sepia
 * and Dark are what they say. It is kept in this browser (core/pref.ts) and is never in the
 * document: two people in one document, or one person with two tabs, can read it on two pages, and
 * a dark page is only ever how the same file is drawn on this screen. Print, PDF and every export
 * draw white, because the CSS that applies a page colour is `@media screen` only (doc.css) and the
 * exports read the document, not the screen.
 *
 * `resolvePageColour` is what `data-page` on `.oa-paper` says: always `white`, `sepia` or `dark`.
 */

import type { Theme } from '../core/appearance';
import { useAppearance } from '../core/appearance';
import { createPref } from '../core/pref';

export type PageColour = 'auto' | 'white' | 'sepia' | 'dark';
export type PageTone = 'white' | 'sepia' | 'dark';

export const PAGE_COLOURS: readonly { id: PageColour; label: string }[] = [
  { id: 'auto', label: 'Auto' },
  { id: 'white', label: 'White' },
  { id: 'sepia', label: 'Sepia' },
  { id: 'dark', label: 'Dark' }
];

export const PAGE_COLOUR_KEY = 'office.docs.page-colour';

export const parsePageColour = (raw: unknown): PageColour => (raw === 'white' || raw === 'sepia' || raw === 'dark' ? raw : 'auto');

export const pageColourPref = createPref<PageColour>({ key: PAGE_COLOUR_KEY, parse: parsePageColour, serialize: (v) => v });

export const resolvePageColour = (colour: PageColour, theme: Theme): PageTone => (colour === 'auto' ? (theme === 'dark' ? 'dark' : 'white') : colour);

/** The page's colour as chosen, as drawn, and how to change it. Redraws when either the choice or the theme does. */
export function usePageColour(): { colour: PageColour; tone: PageTone; set: (c: PageColour) => void } {
  const { theme } = useAppearance();
  const colour = pageColourPref.use();
  return { colour, tone: resolvePageColour(colour, theme), set: pageColourPref.set };
}
