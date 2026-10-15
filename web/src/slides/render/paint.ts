/**
 * What a slide's text and fills look like as CSS, for the static renderer and for the text editor's
 * decorations alike, so a box being typed in looks like the same box drawn.
 *
 * A paragraph follows PowerPoint's model of a bullet: the text's left edge is `indent` from the
 * inset, the first line (and its bullet) starts at `bulletIndent`, and the bullet takes the room
 * between the two. So with no bullet a hanging first line still hangs, as it does there.
 *
 * Pure: no DOM, no React. Styles are `{ 'kebab-case': value }`; `cssText` and `reactStyle` turn
 * one into what each side takes.
 */

import { stackFor } from '../../docs/core/fonts';
import type { AssetRef, Color, Fill, TextBox, ThemeJSON } from '../model/deck';
import { PX_PER_PT, SLIDE_NUMBER_TEXT } from '../model/deck';
import { resolveColor } from '../model/color';
import { safeAssetId, safeColor, safeFamily, safePt } from '../model/safe';
import { LINE_FACTOR } from '../model/schema';
import type { BulletLabel, ResolvedStyle } from '../model/styles';

export type Css = Record<string, string>;

const px = (n: number): string => `${Math.round(n * 100) / 100}px`;

/** The family as `font-family`, with its stand-ins. */
export function fontStack(family: string): string {
  return stackFor(family) ?? stackFor('Inter')!;
}

/** A paragraph's box: its type, its spacing and its indents. `first` drops the space above, as PowerPoint does. */
export function paragraphCss(s: ResolvedStyle, theme: ThemeJSON, first: boolean): Css {
  return {
    'font-family': fontStack(s.fontFamily),
    'font-size': px(s.fontSize * PX_PER_PT),
    color: resolveColor(s.color, theme) ?? '#000000',
    'font-weight': s.bold ? '700' : '400',
    'font-style': s.italic ? 'italic' : 'normal',
    'text-align': s.align,
    'line-height': String(Math.round(s.lineHeight * LINE_FACTOR * 1000) / 1000),
    'margin-top': px(first ? 0 : s.spaceBefore * PX_PER_PT),
    'margin-bottom': px(s.spaceAfter * PX_PER_PT),
    'padding-left': px(s.indent),
    'text-indent': px(s.bulletIndent - s.indent)
  };
}

/** The bullet before a paragraph's first line: it fills the room from `bulletIndent` to `indent`. */
export function bulletCss(label: BulletLabel, s: ResolvedStyle, theme: ThemeJSON): Css {
  const gap = s.indent - s.bulletIndent;
  const out: Css = {
    display: 'inline-block',
    'text-indent': '0',
    'white-space': 'nowrap',
    'font-style': 'normal',
    'min-width': px(Math.max(0, gap))
  };
  if (gap <= 0) out['padding-right'] = '0.4em';
  const color = label.color ? resolveColor(label.color, theme) : null;
  if (color) out.color = color;
  return out;
}

export interface MarkLike {
  type: string;
  attrs?: Record<string, unknown>;
}

/** One run's own look, from its marks: bold, italic, lines, size, family, colour, highlight, sup and sub. */
export function runCss(marks: readonly MarkLike[] | undefined, theme: ThemeJSON): { css: Css; href: string | null } {
  const css: Css = {};
  let href: string | null = null;
  const lines: string[] = [];
  let size: number | null = null;
  let shift: 'super' | 'sub' | null = null;
  for (const m of marks ?? []) {
    const a = m.attrs ?? {};
    switch (m.type) {
      case 'bold':
        css['font-weight'] = '700';
        break;
      case 'italic':
        css['font-style'] = 'italic';
        break;
      case 'underline':
        lines.push('underline');
        break;
      case 'strike':
        lines.push('line-through');
        break;
      case 'link':
        href = typeof a.href === 'string' ? a.href : null;
        if (!lines.includes('underline')) lines.push('underline');
        css.color = resolveColor({ theme: 'hlink' }, theme) ?? '#0563c1';
        break;
      case 'textStyle': {
        const color = resolveColor(safeColor(a.color), theme);
        if (color) css.color = color;
        size = safePt(a.fontSize);
        const family = safeFamily(a.fontFamily);
        if (family) css['font-family'] = fontStack(family);
        break;
      }
      case 'highlight':
        css['background-color'] = resolveColor(safeColor(a.color), theme) ?? '#fff59d';
        break;
      case 'sup':
        shift = 'super';
        break;
      case 'sub':
        shift = 'sub';
        break;
    }
  }
  if (lines.length) css['text-decoration-line'] = lines.join(' ');
  if (shift) {
    css['vertical-align'] = shift;
    css['font-size'] = size !== null ? px(size * PX_PER_PT * 0.65) : '0.65em';
  } else if (size !== null) {
    css['font-size'] = px(size * PX_PER_PT);
  }
  return { css, href };
}

/** PowerPoint's default text insets: 0.1 in at the sides, 0.05 in above and below. */
export const DEFAULT_INSETS = { l: 14.4, t: 7.2, r: 14.4, b: 7.2 } as const;

export function insetsOf(box: TextBox | undefined): { l: number; t: number; r: number; b: number } {
  const i = box?.insets;
  const ok = (n: unknown, d: number) => (typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1920 ? n : d);
  return i ? { l: ok(i.l, 14.4), t: ok(i.t, 7.2), r: ok(i.r, 14.4), b: ok(i.b, 7.2) } : { ...DEFAULT_INSETS };
}

/** The flex alignment of a text body's anchor. */
export function anchorCss(anchor: TextBox['anchor'] | undefined): string {
  return anchor === 'middle' ? 'center' : anchor === 'bottom' ? 'flex-end' : 'flex-start';
}

/** The slide-number placeholder's text, with this slide's number in it. */
export const withNumber = (text: string, n: number | undefined): string =>
  n === undefined || !text.includes(SLIDE_NUMBER_TEXT) ? text : text.split(SLIDE_NUMBER_TEXT).join(String(n));

// ── fills and pictures ──────────────────────────────────────────────────────

const INLINE_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

/**
 * A picture's address: the document's asset through `assetUrl`, or a picture still inline (an
 * imported deck before its upload) as a data URL of one of the four kinds the assets API takes.
 */
export function pictureUrl(ref: AssetRef | null | undefined, assetUrl: (assetId: string) => string | null): string | null {
  if (!ref) return null;
  const id = safeAssetId(ref.id);
  if (id) return assetUrl(id);
  if (typeof ref.data === 'string' && typeof ref.mime === 'string' && INLINE_MIMES.has(ref.mime) && /^[A-Za-z0-9+/=]+$/.test(ref.data)) {
    return `data:${ref.mime};base64,${ref.data}`;
  }
  return null;
}

/** A gradient as CSS, PowerPoint's angle (0 is left to right, clockwise) as CSS's (0 is bottom to top). */
export function gradientCss(fill: Extract<Fill, { kind: 'gradient' }>, theme: ThemeJSON): string | null {
  const stops = (Array.isArray(fill.stops) ? fill.stops : [])
    .map((s) => ({ at: Math.min(1, Math.max(0, Number(s.at) || 0)), color: resolveColor(s.color, theme) }))
    .filter((s): s is { at: number; color: string } => s.color !== null)
    .sort((a, b) => a.at - b.at);
  if (stops.length === 0) return null;
  if (stops.length === 1) stops.push({ ...stops[0]! });
  const angle = (Number.isFinite(fill.angle) ? fill.angle : 0) + 90;
  return `linear-gradient(${Math.round(angle * 100) / 100}deg, ${stops.map((s) => `${s.color} ${Math.round(s.at * 1000) / 10}%`).join(', ')})`;
}

/** A solid fill's colour with its alpha, as CSS. */
export function solidCss(fill: Extract<Fill, { kind: 'solid' }>, theme: ThemeJSON): string | null {
  const color = resolveColor(fill.color, theme);
  if (!color) return null;
  const a = typeof fill.alpha === 'number' && Number.isFinite(fill.alpha) ? Math.min(1, Math.max(0, fill.alpha)) : 1;
  if (a >= 1 || !color.startsWith('#')) return color;
  const n = Number.parseInt(color.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/** A slide's background as CSS. Pictures by URL, quoted; `pictureUrl` makes only URLs without quotes. */
export function backgroundCss(fill: Fill | null | undefined, theme: ThemeJSON, assetUrl: (assetId: string) => string | null): Css {
  if (!fill || typeof fill !== 'object') return { background: '#ffffff' };
  switch (fill.kind) {
    case 'solid':
      return { background: solidCss(fill, theme) ?? '#ffffff' };
    case 'gradient':
      return { background: gradientCss(fill, theme) ?? '#ffffff' };
    case 'image': {
      const url = pictureUrl(fill.asset, assetUrl);
      if (!url || /["\\\n]/.test(url)) return { background: '#ffffff' };
      const size = fill.fit === 'contain' ? 'contain' : fill.fit === 'stretch' ? '100% 100%' : 'cover';
      return { background: `#ffffff url("${url}") center / ${size} no-repeat` };
    }
    default:
      return { background: 'transparent' };
  }
}

/** A colour for a table's or a chart's parts, from the theme. */
export const themed = (c: Color, theme: ThemeJSON, fallback: string): string => resolveColor(c, theme) ?? fallback;

// ── turning a style into what each side takes ───────────────────────────────

export function cssText(css: Css): string {
  return Object.entries(css)
    .map(([k, v]) => `${k}: ${v}`)
    .join('; ');
}

/** `font-size` as `fontSize`, for React's `style`. */
export function reactStyle(css: Css): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(css)) out[k.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())] = v;
  return out;
}
