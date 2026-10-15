/**
 * One colour per person, from a hash of their id.
 *
 * It has to be the same on every screen and in every tab, with nothing stored
 * and nobody choosing it, so it is a pure function of the id. Cursors, avatars
 * and the author on a comment all call this and agree.
 *
 * The palette is ten hues that stay apart from each other at cursor size and
 * all carry white text at 4.5:1 or better (color.test.ts measures it), because
 * the label above a cursor is white on the person's colour. Four are the design
 * system's own stops (violet 700, danger 600, teal 700, indigo 500); the rest
 * are derived the same way the system derives its status hues, since a brand of
 * five ramps cannot tell ten people apart.
 *
 * Six-digit hex only: Tiptap's caret extension replaces anything else with
 * `transparent`.
 */

export const PRESENCE_COLORS: readonly string[] = [
  '#5d5294',
  '#b93c59',
  '#0f736d',
  '#8f5a0a',
  '#2b6aa3',
  '#9b3f86',
  '#3c7a2a',
  '#a8461f',
  '#46588a',
  '#6b6a14'
];

/** FNV-1a, 32 bit. Small, and spreads short ids that differ in one character. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export const colorFor = (id: string): string =>
  PRESENCE_COLORS[hashString(id) % PRESENCE_COLORS.length]!;

// ── contrast ────────────────────────────────────────────────────────────────

function channel(v: number): number {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** WCAG relative luminance of a `#rrggbb` colour. */
export function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

/** WCAG contrast ratio, 1 to 21. */
export function contrast(a: string, b: string): number {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** Initials for an avatar: "AR" for "Ada Rowe", one letter for one word. */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = [...parts[0]!][0] ?? '?';
  if (parts.length === 1) return first.toUpperCase();
  const last = [...parts[parts.length - 1]!][0] ?? '';
  return (first + last).toUpperCase();
}
