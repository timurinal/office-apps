/**
 * Writing XML: escaping, the colour/fill/line elements, and the relationships a part collects as
 * it is written.
 *
 * Strings go through `clean` first. A deck's text is anyone's, and a control character or half a
 * surrogate pair in a text node makes a part PowerPoint will not open, so what XML 1.0 forbids is
 * dropped before it is escaped.
 */

import type { Color, Fill, Line, ThemeSlot } from '../../slides/model/deck';
import { pick } from './part';

// eslint-disable-next-line no-control-regex
const FORBIDDEN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/** What XML 1.0 allows, of `s`. A deck from a peer may hold a number where a string should be. */
export const clean = (s: unknown): string => String(s ?? '').replace(FORBIDDEN, '');

export const esc = (s: unknown): string => clean(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export const escAttr = (s: unknown): string => esc(s).replace(/"/g, '&quot;').replace(/\t/g, '&#9;').replace(/\n/g, '&#10;').replace(/\r/g, '&#13;');

/** An array, whatever was stored: a peer's deck may hold anything where a list should be. */
export const list = <T = unknown>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

/** An object, or null. */
export const obj = <T extends object = Record<string, unknown>>(v: unknown): T | null => (typeof v === 'object' && v !== null ? (v as T) : null);

type Attrs = Record<string, string | number | boolean | undefined | null>;

/** `<name a="1" b="2">children</name>`, attributes that are undefined, null or false left out. */
export function el(name: string, attrs: Attrs = {}, children?: string): string {
  let a = '';
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    a += ` ${k}="${v === true ? '1' : escAttr(String(v))}"`;
  }
  return children === undefined || children === '' ? `<${name}${a}/>` : `<${name}${a}>${children}</${name}>`;
}

export const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

export const NS_A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
export const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
export const NS_P = 'http://schemas.openxmlformats.org/presentationml/2006/main';
export const NS_C = 'http://schemas.openxmlformats.org/drawingml/2006/chart';
export const NS_MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
export const NS_P14 = 'http://schemas.microsoft.com/office/powerpoint/2010/main';
export const REL_BASE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';

// ── relationships ───────────────────────────────────────────────────────────

/** The relationships of one part. The same target is one relationship. */
export class Rels {
  private readonly list: { id: string; type: string; target: string; external: boolean }[] = [];

  add(type: string, target: string, external = false): string {
    const hit = this.list.find((r) => r.type === type && r.target === target && r.external === external);
    if (hit) return hit.id;
    const id = `rId${this.list.length + 1}`;
    this.list.push({ id, type, target, external });
    return id;
  }

  get size(): number {
    return this.list.length;
  }

  toXml(): string {
    return (
      XML_DECL +
      el(
        'Relationships',
        { xmlns: 'http://schemas.openxmlformats.org/package/2006/relationships' },
        this.list.map((r) => el('Relationship', { Id: r.id, Type: r.type.startsWith('http') ? r.type : REL_BASE + r.type, Target: r.target, TargetMode: r.external ? 'External' : undefined })).join('')
      )
    );
  }
}

// ── colour ──────────────────────────────────────────────────────────────────

/** The scheme names a master maps with the standard `clrMap`: bg1 is lt1 and tx1 is dk1. */
const SCHEME: Record<ThemeSlot, string> = {
  dk1: 'tx1',
  lt1: 'bg1',
  dk2: 'tx2',
  lt2: 'bg2',
  accent1: 'accent1',
  accent2: 'accent2',
  accent3: 'accent3',
  accent4: 'accent4',
  accent5: 'accent5',
  accent6: 'accent6',
  hlink: 'hlink'
};

const HEX6 = /^#[0-9a-fA-F]{6}$/;
const SLOTS = new Set(Object.keys(SCHEME));

/** A colour the deck holds, or null for anything that is not one. */
export function asColor(v: unknown): Color | null {
  if (typeof v === 'string') return HEX6.test(v) ? v.toLowerCase() : null;
  if (typeof v !== 'object' || v === null) return null;
  const o = v as { theme?: unknown; lum?: unknown; alpha?: unknown };
  if (typeof o.theme !== 'string' || !SLOTS.has(o.theme)) return null;
  const out: { theme: ThemeSlot; lum?: number; alpha?: number } = { theme: o.theme as ThemeSlot };
  if (typeof o.lum === 'number' && Number.isFinite(o.lum) && o.lum !== 0) out.lum = Math.max(-1, Math.min(1, o.lum));
  if (typeof o.alpha === 'number' && Number.isFinite(o.alpha) && o.alpha < 1) out.alpha = Math.max(0, o.alpha);
  return out;
}

const pct = (v: number): number => Math.round(v * 100_000);

/** The colour element (`a:srgbClr` or `a:schemeClr`) with its transforms. `alpha` fades a hex colour. */
export function colorEl(c: Color, alpha?: number): string {
  if (typeof c === 'string') {
    const kids = alpha !== undefined && alpha < 1 ? el('a:alpha', { val: pct(Math.max(0, alpha)) }) : '';
    return el('a:srgbClr', { val: c.slice(1).toUpperCase() }, kids);
  }
  let kids = '';
  const lum = c.lum ?? 0;
  if (lum > 0) kids += el('a:lumMod', { val: pct(1 - lum) }) + el('a:lumOff', { val: pct(lum) });
  else if (lum < 0) kids += el('a:lumMod', { val: pct(1 + lum) });
  if (c.alpha !== undefined && c.alpha < 1) kids += el('a:alpha', { val: pct(c.alpha) });
  return el('a:schemeClr', { val: pick(SCHEME, c.theme) ?? 'tx1' }, kids);
}

export const solidFill = (c: Color, alpha?: number): string => el('a:solidFill', {}, colorEl(c, alpha));

// ── fill and line ───────────────────────────────────────────────────────────

/** How a picture asks for the relationship it needs, and its natural size where that is known. */
export interface ImageSink {
  /** The relationship id of a picture for this part, or null if it cannot be written. */
  embed(asset: unknown): { rId: string; width?: number; height?: number } | null;
}

/** Cropping a picture to cover a box: the fractions to cut from each side. */
export function coverCrop(natural: { width: number; height: number } | undefined, w: number, h: number): { l: number; t: number; r: number; b: number } | null {
  if (!natural || natural.width <= 0 || natural.height <= 0 || w <= 0 || h <= 0) return null;
  const ratio = natural.width / natural.height;
  const box = w / h;
  if (Math.abs(ratio - box) < 0.001) return null;
  if (ratio > box) {
    const cut = (1 - box / ratio) / 2;
    return { l: cut, t: 0, r: cut, b: 0 };
  }
  const cut = (1 - ratio / box) / 2;
  return { l: 0, t: cut, r: 0, b: cut };
}

/** A fill element. `box` is the shape's size, which a picture that covers it is cropped to. */
export function fillEl(f: Fill, images: ImageSink, box?: { w: number; h: number }): string {
  switch (f.kind) {
    case 'none':
      return '<a:noFill/>';
    case 'solid': {
      const c = asColor(f.color);
      return c ? solidFill(c, typeof f.alpha === 'number' ? f.alpha : undefined) : '<a:noFill/>';
    }
    case 'gradient': {
      const stops = (Array.isArray(f.stops) ? f.stops : [])
        .map((s) => ({ at: typeof s.at === 'number' ? Math.min(1, Math.max(0, s.at)) : 0, c: asColor(s.color) }))
        .filter((s): s is { at: number; c: Color } => s.c !== null);
      if (stops.length === 0) return '<a:noFill/>';
      if (stops.length === 1) return solidFill(stops[0]!.c);
      const ang = Math.round((((Number(f.angle) || 0) % 360) + 360) % 360 * 60_000);
      return el(
        'a:gradFill',
        { rotWithShape: true },
        el('a:gsLst', {}, stops.map((s) => el('a:gs', { pos: pct(s.at) }, colorEl(s.c))).join('')) + el('a:lin', { ang, scaled: '0' })
      );
    }
    case 'image': {
      const img = images.embed(f.asset);
      if (!img) return '<a:noFill/>';
      const crop = f.fit === 'cover' && box ? coverCrop(img.width && img.height ? { width: img.width, height: img.height } : undefined, box.w, box.h) : null;
      return el(
        'a:blipFill',
        { dpi: 0, rotWithShape: true },
        el('a:blip', { 'r:embed': img.rId }) + (crop ? srcRect(crop) : '') + el('a:stretch', {}, '<a:fillRect/>')
      );
    }
  }
}

export function srcRect(c: { l: number; t: number; r: number; b: number }): string {
  const v = (n: number): number | undefined => (n > 0 ? pct(Math.min(0.99, n)) : undefined);
  const attrs = { l: v(c.l), t: v(c.t), r: v(c.r), b: v(c.b) };
  return Object.values(attrs).some((x) => x !== undefined) ? el('a:srcRect', attrs) : '';
}

const DASH: Record<string, string> = { solid: 'solid', dash: 'dash', dot: 'sysDot', dashDot: 'dashDot' };
const END: Record<string, string> = { arrow: 'arrow', triangle: 'triangle', oval: 'oval' };

/** `a:ln` for a line; `px` converts its width to EMU. No line at all is `<a:ln><a:noFill/></a:ln>`. */
export function lnEl(line: Line | undefined, emuOf: (px: number) => number, tag = 'a:ln'): string {
  const color = line ? asColor(line.color) : null;
  if (!line || !color || !(line.width > 0)) return `<${tag}><a:noFill/></${tag}>`;
  const dashName = pick(DASH, line.dash);
  const dash = dashName && line.dash !== 'solid' ? el('a:prstDash', { val: dashName }) : '';
  const headName = pick(END, line.head);
  const head = headName ? el('a:headEnd', { type: headName, w: 'med', len: 'med' }) : '';
  const tailName = pick(END, line.tail);
  const tail = tailName ? el('a:tailEnd', { type: tailName, w: 'med', len: 'med' }) : '';
  return el(tag, { w: Math.max(1, Math.min(20_116_800, emuOf(line.width))) }, solidFill(color) + dash + head + tail);
}
