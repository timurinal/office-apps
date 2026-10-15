/**
 * What a deck's stored values may hold, read on the way out.
 *
 * Everything in the room was written by some client, and every reader draws it: a colour
 * becomes inline CSS, a size becomes a transform, a font name becomes `font-family`. So the
 * renderer and the editor read each value through one of these, and anything that is not the
 * shape deck.ts describes is dropped (null), never repaired into a guess. The same rule as
 * docs/core/sanitize.ts, for the deck's own shapes.
 *
 * Pure: no DOM, so it runs in a Web Worker and in the Worker.
 */

import type { Bullet, Color, Fill, Line, ThemeSlot } from './deck';

export const THEME_SLOTS: readonly ThemeSlot[] = ['dk1', 'lt1', 'dk2', 'lt2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink'];
const SLOTS = new Set<string>(THEME_SLOTS);

const HEX6 = /^#[0-9a-f]{6}$/;

/** A finite number, clamped to a range, or null. */
export function num(v: unknown, min = -1e6, max = 1e6): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : null;
}

/** `#rrggbb` (any case, stored lowercase) or `{ theme, lum?, alpha? }`. */
export function safeColor(v: unknown): Color | null {
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    return HEX6.test(s) ? s : null;
  }
  if (typeof v !== 'object' || v === null) return null;
  const o = v as { theme?: unknown; lum?: unknown; alpha?: unknown };
  if (typeof o.theme !== 'string' || !SLOTS.has(o.theme)) return null;
  const out: { theme: ThemeSlot; lum?: number; alpha?: number } = { theme: o.theme as ThemeSlot };
  const lum = num(o.lum, -1, 1);
  const alpha = num(o.alpha, 0, 1);
  if (lum !== null && lum !== 0) out.lum = lum;
  if (alpha !== null && alpha !== 1) out.alpha = alpha;
  return out;
}

export function safeFill(v: unknown): Fill | null {
  if (typeof v !== 'object' || v === null) return null;
  const f = v as Record<string, unknown>;
  switch (f.kind) {
    case 'none':
      return { kind: 'none' };
    case 'solid': {
      const color = safeColor(f.color);
      const alpha = num(f.alpha, 0, 1);
      if (color === null) return null;
      return alpha === null || alpha === 1 ? { kind: 'solid', color } : { kind: 'solid', color, alpha };
    }
    case 'gradient': {
      if (!Array.isArray(f.stops)) return null;
      const stops: { at: number; color: Color }[] = [];
      for (const s of f.stops.slice(0, 16)) {
        const at = num((s as { at?: unknown })?.at, 0, 1);
        const color = safeColor((s as { color?: unknown })?.color);
        if (at !== null && color !== null) stops.push({ at, color });
      }
      return stops.length >= 1 ? { kind: 'gradient', angle: num(f.angle, -3600, 3600) ?? 0, stops } : null;
    }
    case 'image': {
      const asset = f.asset as { id?: unknown } | undefined;
      if (!asset || typeof asset.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(asset.id)) return null;
      const fit = f.fit === 'contain' || f.fit === 'stretch' ? f.fit : 'cover';
      return { kind: 'image', asset: { id: asset.id }, fit };
    }
    default:
      return null;
  }
}

const DASHES = new Set(['solid', 'dash', 'dot', 'dashDot']);
const HEADS = new Set(['none', 'arrow', 'triangle', 'oval']);

export function safeLine(v: unknown): Line | null {
  if (typeof v !== 'object' || v === null) return null;
  const l = v as Record<string, unknown>;
  const color = safeColor(l.color);
  const width = num(l.width, 0, 400);
  if (color === null || width === null) return null;
  const out: Line = { color, width };
  if (typeof l.dash === 'string' && DASHES.has(l.dash)) out.dash = l.dash as Line['dash'];
  if (typeof l.head === 'string' && HEADS.has(l.head)) out.head = l.head as Line['head'];
  if (typeof l.tail === 'string' && HEADS.has(l.tail)) out.tail = l.tail as Line['tail'];
  return out;
}

const NUMBER_STYLES = new Set(['arabicPeriod', 'arabicParen', 'alphaLcPeriod', 'alphaUcPeriod', 'romanLcPeriod', 'romanUcPeriod']);

export function safeBullet(v: unknown): Bullet | null {
  if (typeof v !== 'object' || v === null) return null;
  const b = v as Record<string, unknown>;
  if (b.kind === 'none') return { kind: 'none' };
  if (b.kind === 'char') {
    // One visible character (a surrogate pair counts as one), never markup.
    if (typeof b.char !== 'string' || [...b.char].length !== 1 || /[<>&"'\\\u0000-\u001f]/.test(b.char)) return null;
    const color = safeColor(b.color);
    return color === null ? { kind: 'char', char: b.char } : { kind: 'char', char: b.char, color };
  }
  if (b.kind === 'number' && typeof b.style === 'string' && NUMBER_STYLES.has(b.style)) {
    const start = num(b.start, 1, 9999);
    return { kind: 'number', style: b.style as Extract<Bullet, { kind: 'number' }>['style'], ...(start !== null ? { start: Math.round(start) } : {}) };
  }
  return null;
}

/** A font family's name: letters, digits, spaces and `._-`, at most 60. Never a stack, never CSS. */
export function safeFamily(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return /^[\p{L}\p{N} ._-]{1,60}$/u.test(s) ? s : null;
}

/** A size in points, 1 to 400, to the half point. */
export function safePt(v: unknown): number | null {
  const n = num(v, 1, 400);
  return n === null ? null : Math.round(n * 2) / 2;
}

/** An asset id as the assets API makes them. */
export function safeAssetId(v: unknown): string | null {
  return typeof v === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(v) ? v : null;
}
