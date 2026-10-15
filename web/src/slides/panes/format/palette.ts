/**
 * The colours a picker offers: the theme's ten (as slots, so a theme change recolours them), five
 * tints and shades of each, and a row of standard ones. Stored as a `Color` (deck.ts), a slot with a
 * `lum`, never as the hex it happens to be today; a picker that edits type, whose marks hold hex, asks
 * for them resolved (`resolved`).
 *
 * Pure: no DOM.
 */

import type { Color, ThemeJSON, ThemeSlot } from '../../model/deck';
import { resolveColor } from '../../model/color';
import { safeColor } from '../../model/safe';

export interface Choice {
  color: Color;
  label: string;
}

/** The theme's colours as PowerPoint orders them: backgrounds, texts, then the accents. */
export const THEME_SLOTS_ROW: readonly { slot: ThemeSlot; name: string }[] = [
  { slot: 'lt1', name: 'Background 1' },
  { slot: 'dk1', name: 'Text 1' },
  { slot: 'lt2', name: 'Background 2' },
  { slot: 'dk2', name: 'Text 2' },
  { slot: 'accent1', name: 'Accent 1' },
  { slot: 'accent2', name: 'Accent 2' },
  { slot: 'accent3', name: 'Accent 3' },
  { slot: 'accent4', name: 'Accent 4' },
  { slot: 'accent5', name: 'Accent 5' },
  { slot: 'accent6', name: 'Accent 6' }
];

/** The five steps under a theme colour: a light slot darkens, a dark one lightens, an accent does both. */
export function shadesOf(slot: ThemeSlot): number[] {
  if (slot === 'lt1' || slot === 'lt2') return [-0.05, -0.15, -0.25, -0.35, -0.5];
  if (slot === 'dk1' || slot === 'dk2') return [0.5, 0.35, 0.25, 0.15, 0.05];
  return [0.8, 0.6, 0.4, -0.25, -0.5];
}

const pct = (n: number): string => `${Math.round(Math.abs(n) * 100)}%`;

/** Six rows of ten: the theme's colours, then each one's five steps. */
export function themeGrid(): Choice[][] {
  const rows: Choice[][] = [THEME_SLOTS_ROW.map((s) => ({ color: { theme: s.slot }, label: s.name }))];
  for (let i = 0; i < 5; i++) {
    rows.push(
      THEME_SLOTS_ROW.map((s) => {
        const lum = shadesOf(s.slot)[i]!;
        return { color: { theme: s.slot, lum }, label: `${s.name}, ${lum > 0 ? 'lighter' : 'darker'} ${pct(lum)}` };
      })
    );
  }
  return rows;
}

/** Ten colours that do not change with the theme. */
export const STANDARD: readonly Choice[] = [
  { color: '#c00000', label: 'Dark red' },
  { color: '#ff0000', label: 'Red' },
  { color: '#ffc000', label: 'Orange' },
  { color: '#ffff00', label: 'Yellow' },
  { color: '#92d050', label: 'Light green' },
  { color: '#00b050', label: 'Green' },
  { color: '#00b0f0', label: 'Light blue' },
  { color: '#0070c0', label: 'Blue' },
  { color: '#002060', label: 'Dark blue' },
  { color: '#7030a0', label: 'Purple' }
];

/** A colour in one canonical shape, so two that mean the same compare equal. */
export function normal(c: Color | null | undefined): string {
  const safe = safeColor(c);
  if (safe === null) return '';
  return typeof safe === 'string' ? safe : `${safe.theme}|${safe.lum ?? 0}|${safe.alpha ?? 1}`;
}

export const sameColor = (a: Color | null | undefined, b: Color | null | undefined): boolean => normal(a) !== '' && normal(a) === normal(b);

/** A colour as the theme's own `#rrggbb`: what a picker that edits type, whose marks hold hex, stores. */
export function resolved(c: Color, theme: ThemeJSON): Color {
  return resolveColor(c, theme) ?? '#000000';
}

/** A colour in words, for a screen reader and a tooltip: `Accent 1, lighter 80%`, or its hex. */
export function describeColor(c: Color | null | undefined): string {
  const safe = safeColor(c);
  if (safe === null) return '';
  if (typeof safe === 'string') return STANDARD.find((s) => s.color === safe)?.label ?? safe;
  const name = THEME_SLOTS_ROW.find((s) => s.slot === safe.theme)?.name ?? safe.theme;
  return safe.lum ? `${name}, ${safe.lum > 0 ? 'lighter' : 'darker'} ${pct(safe.lum)}` : name;
}

/** `#rgb` or `#rrggbb`, with or without the `#`, as `#rrggbb`; null for anything else. */
export function parseHex(text: string): string | null {
  const m = /^\s*#?([0-9a-f]{3}|[0-9a-f]{6})\s*$/i.exec(text);
  if (!m) return null;
  const h = m[1]!.toLowerCase();
  return `#${h.length === 3 ? [...h].map((c) => c + c).join('') : h}`;
}
