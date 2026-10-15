/**
 * The text style a paragraph gets from the layout and the master.
 *
 * `deck.ts` has the order: the element's placeholder's style on the layout, then the master's style
 * for that placeholder type and level. What a run or a paragraph sets itself is over both, and what
 * none of them sets is the theme's. The tests that hold every layout to a contrast and the template
 * sketches both read a style through this.
 */

import type { LayoutJSON, MasterJSON, PlaceholderType, TextStyle } from '../model/deck';

/** A stored `lineHeight` is a multiple of single spacing, which is this many times the type's size (`model/schema.ts`). */
export const LINE_FACTOR = 1.2;

/**
 * The style of a paragraph at `level` in a placeholder of `type` (no `type`: a text box or a table
 * cell). A layout that names one level for a type (a caption, a figure) gives its first to level 0
 * and leaves the rest to the master.
 */
export function resolveStyle(master: MasterJSON, layout: LayoutJSON | undefined, type: PlaceholderType | undefined, level: number): TextStyle {
  const { title, body, other } = master.styles;
  const isTitle = type === 'title' || type === 'ctrTitle';
  const isBody = type === 'body' || type === 'subTitle';
  const base = isTitle ? title : isBody ? (body[Math.max(0, Math.min(level, body.length - 1))] ?? other) : other;
  const over = type ? layout?.styles?.[type] : undefined;
  return { ...base, ...over?.[level] };
}
