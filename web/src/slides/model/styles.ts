/**
 * What a paragraph and a run look like when they do not say: the text style cascade.
 *
 *   the theme      fonts (major for a title, minor for the rest), ink dk1, 18 pt
 *   the master     styles.title, styles.body[level], styles.other
 *   the layout     styles[ph.type][level], for the slide element's placeholder type
 *   the paragraph  align, bullet, spaceBefore, spaceAfter, lineHeight
 *   the run        marks: bold, italic, textStyle { color, fontSize, fontFamily }
 *
 * A level past the end of the master's body styles takes the last one; a level a layout's list does
 * not name takes nothing from the layout (as slides/themes/styles.ts reads it). Every value read from the deck goes
 * through safe.ts first, so a style somebody else wrote can only be one of the shapes deck.ts allows.
 *
 * Also here, because the renderer and the editor must agree on them: a bullet's or a number's label
 * (`bulletLabels`), and the placeholder a slide element stands for on its layout (`layoutPlaceholder`).
 *
 * Pure: no DOM.
 */

import type { Bullet, Color, LayoutJSON, MasterJSON, Placeholder, PlaceholderType, TextDoc, TextNode, TextStyle, ThemeJSON } from './deck';
import { num, safeBullet, safeColor, safeFamily, safePt } from './safe';
import { paraAttrs, type Align } from './schema';

export interface Design {
  theme: ThemeJSON;
  master: MasterJSON;
  layouts: readonly LayoutJSON[];
}

/** Every field set: what a paragraph at a level draws with before its own attributes and marks. */
export interface ResolvedStyle {
  fontFamily: string;
  /** pt */
  fontSize: number;
  color: Color;
  bold: boolean;
  italic: boolean;
  align: Align;
  bullet: Bullet;
  /** px from the left inset to the text, and to the bullet. */
  indent: number;
  bulletIndent: number;
  /** pt */
  spaceBefore: number;
  spaceAfter: number;
  /** A multiple of single spacing (schema.ts `LINE_FACTOR`). */
  lineHeight: number;
}

export type StyleKind = 'title' | 'body' | 'other';

export function styleKind(ph: Placeholder | null | undefined): StyleKind {
  if (!ph) return 'other';
  if (ph.type === 'title' || ph.type === 'ctrTitle') return 'title';
  if (ph.type === 'body' || ph.type === 'subTitle') return 'body';
  return 'other';
}

const ALIGN = new Set<string>(['left', 'center', 'right', 'justify']);

/** Lays the safe fields of `s` over `into`. */
function over(into: ResolvedStyle, s: TextStyle | null | undefined): void {
  if (!s || typeof s !== 'object') return;
  const family = safeFamily(s.fontFamily);
  if (family) into.fontFamily = family;
  const size = safePt(s.fontSize);
  if (size !== null) into.fontSize = size;
  const color = safeColor(s.color);
  if (color !== null) into.color = color;
  if (typeof s.bold === 'boolean') into.bold = s.bold;
  if (typeof s.italic === 'boolean') into.italic = s.italic;
  if (typeof s.align === 'string' && ALIGN.has(s.align)) into.align = s.align;
  const bullet = safeBullet(s.bullet);
  if (bullet) into.bullet = bullet;
  const indent = num(s.indent, 0, 1920);
  if (indent !== null) into.indent = indent;
  const bulletIndent = num(s.bulletIndent, 0, 1920);
  if (bulletIndent !== null) into.bulletIndent = bulletIndent;
  const before = num(s.spaceBefore, 0, 400);
  if (before !== null) into.spaceBefore = before;
  const after = num(s.spaceAfter, 0, 400);
  if (after !== null) into.spaceAfter = after;
  const lh = num(s.lineHeight, 0.5, 5);
  if (lh !== null) into.lineHeight = lh;
}

const at = <T>(list: readonly T[] | null | undefined, level: number): T | undefined =>
  Array.isArray(list) && list.length ? list[Math.min(level, list.length - 1)] : undefined;

export function layoutById(design: Design, id: string): LayoutJSON | undefined {
  return design.layouts.find((l) => l.id === id);
}

/** The layout's own placeholder for `ph`: the same type and index, else the first of the type. */
export function layoutPlaceholder(layout: LayoutJSON | undefined, ph: Placeholder | null | undefined) {
  if (!layout || !ph) return undefined;
  const same = layout.elements.filter((e) => e.ph?.type === ph.type);
  return same.find((e) => (e.ph?.idx ?? null) === (ph.idx ?? null)) ?? same[0];
}

/** The style a paragraph at `level` inherits in an element with placeholder `ph` on layout `layoutId`. */
export function inheritedStyle(design: Design, layoutId: string, ph: Placeholder | null | undefined, level: number): ResolvedStyle {
  const kind = styleKind(ph);
  const fonts = design.theme?.fonts;
  const out: ResolvedStyle = {
    fontFamily: safeFamily(kind === 'title' ? fonts?.major : fonts?.minor) ?? 'Inter',
    fontSize: 18,
    color: { theme: 'dk1' },
    bold: false,
    italic: false,
    align: 'left',
    bullet: { kind: 'none' },
    indent: 0,
    bulletIndent: 0,
    spaceBefore: 0,
    spaceAfter: 0,
    lineHeight: 1
  };
  const styles = design.master?.styles;
  if (styles) over(out, kind === 'title' ? styles.title : kind === 'body' ? at(styles.body, level) : styles.other);
  if (ph) {
    // A layout's list is not stretched: a level it does not name is the master's alone.
    const byType = layoutById(design, layoutId)?.styles?.[ph.type as PlaceholderType];
    over(out, Array.isArray(byType) ? byType[level] : undefined);
  }
  return out;
}

/** A paragraph's style: the inherited one with its own attributes laid over it. */
export function paragraphStyle(base: (level: number) => ResolvedStyle, attrs: Record<string, unknown> | undefined): ResolvedStyle {
  const p = paraAttrs(attrs);
  const s = { ...base(p.level) };
  if (p.align) s.align = p.align;
  if (p.bullet) s.bullet = p.bullet;
  if (p.spaceBefore !== null) s.spaceBefore = p.spaceBefore;
  if (p.spaceAfter !== null) s.spaceAfter = p.spaceAfter;
  if (p.lineHeight !== null) s.lineHeight = p.lineHeight;
  if (p.indent !== null) s.indent = p.indent;
  if (p.bulletIndent !== null) s.bulletIndent = p.bulletIndent;
  return s;
}

// ── bullets and numbers ─────────────────────────────────────────────────────

const ROMAN: [number, string][] = [
  [1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'],
  [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']
];

function roman(n: number): string {
  let s = '';
  let left = Math.min(3999, Math.max(1, n));
  for (const [v, r] of ROMAN) while (left >= v) { s += r; left -= v; }
  return s;
}

function alpha(n: number): string {
  let s = '';
  let left = Math.max(1, n);
  while (left > 0) {
    left -= 1;
    s = String.fromCharCode(97 + (left % 26)) + s;
    left = Math.floor(left / 26);
  }
  return s;
}

export function numberLabel(style: Extract<Bullet, { kind: 'number' }>['style'], n: number): string {
  switch (style) {
    case 'arabicParen': return `${n})`;
    case 'alphaLcPeriod': return `${alpha(n)}.`;
    case 'alphaUcPeriod': return `${alpha(n).toUpperCase()}.`;
    case 'romanLcPeriod': return `${roman(n)}.`;
    case 'romanUcPeriod': return `${roman(n).toUpperCase()}.`;
    default: return `${n}.`;
  }
}

const isEmptyPara = (p: TextNode): boolean => !(p.content ?? []).some((n) => (n.type === 'text' && n.text) || n.type === 'hardBreak');

export interface BulletLabel {
  text: string;
  /** The bullet's own colour when it has one, else the paragraph's. */
  color: Color | null;
}

/**
 * The label each paragraph draws before its text, or null. A number counts on through the
 * paragraphs of its level with the same scheme, and starts again after a paragraph at the same or
 * a shallower level without one; a deeper paragraph does not interrupt it. An empty paragraph
 * draws nothing and counts nothing, unless `showEmpty` (the editor, where the caret sits in it).
 */
export function bulletLabels(
  paras: readonly { attrs?: Record<string, unknown>; empty: boolean }[],
  styleOf: (attrs: Record<string, unknown> | undefined) => ResolvedStyle,
  showEmpty = false
): (BulletLabel | null)[] {
  const counters: ({ style: string; n: number } | null)[] = [];
  return paras.map((p) => {
    const s = styleOf(p.attrs);
    const level = paraAttrs(p.attrs).level;
    counters.length = Math.min(counters.length, level + 1);
    if (p.empty && !showEmpty) return null;
    const b = s.bullet;
    if (b.kind === 'number') {
      const prev = counters[level];
      const n = prev && prev.style === b.style ? prev.n + 1 : b.start ?? 1;
      if (!p.empty) counters[level] = { style: b.style, n };
      return { text: numberLabel(b.style, n), color: null };
    }
    counters[level] = null;
    if (b.kind === 'char') return { text: b.char, color: b.color ?? null };
    return null;
  });
}

/** The paragraphs of a body, as `bulletLabels` takes them. */
export function parasOf(doc: TextDoc | null | undefined): { attrs?: Record<string, unknown>; empty: boolean }[] {
  return (doc?.content ?? []).map((p) => ({ attrs: p.attrs, empty: isEmptyPara(p) }));
}
