/**
 * Themes, masters and layouts for Slides, as data.
 *
 * Pure: no DOM, no Yjs. A deck's theme, master and layouts are written together, so to apply a
 * theme to a deck, write `theme`, `masterFor(theme)` and `layoutsFor(theme)`; its slides keep the
 * layout ids they have.
 */

import type { DeckJSON, ElementJSON, LayoutJSON, SlideJSON } from '../model/deck';
import { withIds } from './build';
import { FOOTER_TYPES, layoutsFor } from './layouts';
import { masterFor } from './master';
import { DEFAULT_THEME_ID, previewOf, THEMES, themeById } from './themes';

export { THEMES, DEFAULT_THEME_ID, themeById, previewOf, type ThemePreview } from './themes';
export { masterFor, BODY_SIZES } from './master';
export { layoutsFor, LAYOUT_IDS, FOOTER_TYPES, SLIDE_NUMBER_TEXT, type LayoutId } from './layouts';

/** What the Design tab's gallery draws, one per theme, in the order of `THEMES`. */
export const THEME_PREVIEWS = THEMES.map(previewOf);

/**
 * What a new slide gets from `layout`: a copy of each of its placeholders with no text, so the
 * layout's prompt shows. The footer, date and slide number are not copied, and neither are the
 * layout's decorations, which draw on the slide from the layout.
 */
export function newSlideElements(layout: LayoutJSON): ElementJSON[] {
  const copies: ElementJSON[] = [];
  for (const el of layout.elements) {
    if (!el.ph || FOOTER_TYPES.includes(el.ph.type)) continue;
    if (el.type === 'shape') {
      const { id: _id, text: _text, ...rest } = el;
      copies.push(rest);
    } else {
      const { id: _id, ...rest } = el;
      copies.push(rest as ElementJSON);
    }
  }
  return withIds(copies);
}

/** A deck with one title slide, in `themeId` (the default, and for an id nobody has, Violet). */
export function blankDeck(themeId: string = DEFAULT_THEME_ID): DeckJSON {
  const theme = themeById(themeId) ?? themeById(DEFAULT_THEME_ID)!;
  const layouts = layoutsFor(theme);
  const first = layouts.find((l) => l.id === 'title')!;
  const slide: SlideJSON = { id: 's1', layout: first.id, elements: newSlideElements(first) };
  return { v: 1, size: '16:9', theme, master: masterFor(theme), layouts, slides: [slide] };
}
