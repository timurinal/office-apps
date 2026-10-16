/**
 * A theme's master: the background and the text styles every slide inherits from.
 *
 * Type is sized for a 1920-wide slide (1 pt is 2 px) and for a room: body starts at 24 pt and
 * steps down by two to 16, a title is 38 to 54. Fonts are written as the theme's own names, not
 * as a reference to them, so the file a deck exports to says them plainly. Colours are theme
 * slots, so a master made for one theme and drawn with another still reads. A `lineHeight` is a
 * multiple of single spacing, which is 1.2 times the size: a title at 0.9 is set tight, body at 1.
 */

import type { MasterJSON, TextStyle, ThemeJSON } from '../model/deck';
import { contrast, resolveColor } from './color';
import { lookOf, tonesOf } from './themes';

/** Body sizes by level, in points. Strictly decreasing: a level reads as a step in. */
export const BODY_SIZES = [24, 22, 20, 18, 16] as const;

/** The bullet at each level. The first is the accent; the rest are quieter marks. */
const BULLETS = ['•', '–', '•', '–', '•'] as const;

/** px from the left of the text to the bullet, and to the text, at level `n`. A level steps in by 52. */
const STEP = 52;
export const bulletIndentOf = (level: number): number => level * STEP;
export const textIndentOf = (level: number): number => level * STEP + 44;

/** No bullet, no indent: for a line of prose in a placeholder that inherits a list's style. */
export const NO_BULLET = { bullet: { kind: 'none' }, indent: 0, bulletIndent: 0 } as const satisfies TextStyle;

export function masterFor(theme: ThemeJSON): MasterJSON {
  const look = lookOf(theme);
  const tones = tonesOf(theme);
  const { major, minor } = theme.fonts;
  // The first bullet is the accent, when the accent shows on the ground; a pale one would not, and
  // a theme brought in from a file can have one.
  const bullet = contrast(resolveColor(tones.accent, theme), resolveColor(tones.ground, theme)) >= 3 ? tones.accent : tones.ink;

  const title: TextStyle = {
    fontFamily: major,
    fontSize: look.title,
    bold: look.bold,
    italic: false,
    color: tones.ink,
    align: 'left',
    ...NO_BULLET,
    spaceBefore: 0,
    spaceAfter: 0,
    lineHeight: 0.9
  };

  const body: TextStyle[] = BODY_SIZES.map((fontSize, level) => ({
    fontFamily: minor,
    fontSize,
    bold: false,
    italic: false,
    color: tones.ink,
    align: 'left',
    bullet: { kind: 'char', char: BULLETS[level]!, color: level === 0 ? bullet : tones.muted },
    indent: textIndentOf(level),
    bulletIndent: bulletIndentOf(level),
    spaceBefore: level === 0 ? 12 : 6,
    spaceAfter: 0,
    lineHeight: 1
  }));

  const other: TextStyle = {
    fontFamily: minor,
    fontSize: 20,
    bold: false,
    italic: false,
    color: tones.ink,
    align: 'left',
    ...NO_BULLET,
    spaceBefore: 0,
    spaceAfter: 0,
    lineHeight: 1
  };

  return {
    bg: { kind: 'solid', color: tones.ground },
    elements: [],
    styles: { title, body, other }
  };
}
