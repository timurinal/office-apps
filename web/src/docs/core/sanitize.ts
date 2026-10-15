/**
 * What a document's formatting attributes may hold.
 *
 * A mark's or a block's attributes come from the shared Yjs state, so any editor on the
 * document can write any string into them, and every reader renders it as an inline
 * `style`. A colour of `red; background: url(//…)` would be a stylesheet injection read
 * by everyone who opens the page. So each attribute is parsed on the way in (paste) and
 * checked again on the way out (render), and anything that is not exactly the shape this
 * editor writes is dropped.
 *
 * The functions answer `null` for a refusal, never a repaired guess.
 */

const HEX = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const RGB = /^rgba?\(\s*\d{1,3}\s*(?:,\s*\d{1,3}\s*){2}(?:,\s*(?:0|1|0?\.\d+)\s*)?\)$/i;

/** `#3d6cd0`, `rgb(61, 108, 208)` and `rgba(…)`. No names, no `var()`, no `url()`. */
export function safeColor(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (s.length > 40) return null;
  return HEX.test(s) || RGB.test(s) ? s : null;
}

/** A size in points, `11pt` or `10.5pt`, between 1 and 400. */
export function safeFontSize(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const m = /^(\d{1,3}(?:\.\d{1,2})?)pt$/.exec(v.trim());
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 1 && n <= 400 ? `${n}pt` : null;
}

/**
 * A pasted size as points. Browsers report `font-size` in px, Word's HTML in pt; other
 * units (em, %, keywords) depend on a parent we do not have, so they are not guessed.
 */
export function toPoints(css: string | null | undefined): string | null {
  if (!css) return null;
  const m = /^\s*(\d+(?:\.\d+)?)(px|pt)\s*$/i.exec(css);
  if (!m) return null;
  const n = Number(m[1]);
  const pt = m[2]!.toLowerCase() === 'px' ? n * 0.75 : n;
  // Half a point is the finest step the size box offers.
  return safeFontSize(`${Math.round(pt * 2) / 2}pt`);
}

/** The first family of a CSS `font-family` list, without quotes: `"Times New Roman", serif`. */
export function firstFamily(css: string | null | undefined): string | null {
  if (!css) return null;
  const first = css.split(',')[0]?.trim().replace(/^["']|["']$/g, '').trim();
  return first ? safeFamilyName(first) : null;
}

/** A font's name: letters, digits, spaces and a few marks. It is written into a `font-family`. */
export function safeFamilyName(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return /^[\p{L}\p{N} ._-]{1,60}$/u.test(s) ? s : null;
}

/** A line height as a multiple of the font size, from 0.5 to 5. */
export function safeLineHeight(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d+(\.\d+)?$/.test(v) ? Number(v) : NaN;
  return Number.isFinite(n) && n >= 0.5 && n <= 5 ? Math.round(n * 100) / 100 : null;
}

/** Space before or after a paragraph, in points, 0 to 200. */
export function safeSpace(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d+(\.\d+)?$/.test(v) ? Number(v) : NaN;
  return Number.isFinite(n) && n >= 0 && n <= 200 ? Math.round(n * 10) / 10 : null;
}

/** An indent as a whole number of levels, 0 to 8. */
export function safeIndent(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : NaN;
  return Number.isInteger(n) && n >= 0 && n <= 8 ? n : null;
}

/** One indent level is Word's default tab stop, half an inch. */
export const INDENT_PT = 36;
export const INDENT_MAX = 8;

/**
 * Where an image may come from. A document's own uploads (`/api/office/documents/<id>/assets/<id>`)
 * and a raster data URL, which is how a file that has no server keeps its pictures. Anything
 * else, a page's `<img src="https://…">` on paste included, is not an image of this document:
 * the page's policy would refuse to load it, and a tracking pixel is not content.
 */
export function safeImageSrc(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  if (/^\/api\/office\/documents\/[A-Za-z0-9_-]+\/assets\/[A-Za-z0-9_-]+$/.test(v)) return v;
  return /^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(v) ? v : null;
}
