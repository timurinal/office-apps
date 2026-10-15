/**
 * DrawingML colours: `srgbClr`, `schemeClr`, `sysClr`, `prstClr`, `hslClr`, `scrgbClr`, each with
 * its transforms (`lumMod`, `lumOff`, `tint`, `shade`, `alpha`, ...), as the deck's `Color`.
 *
 * A theme colour stays a theme colour: `{ theme, lum, alpha }`, where `lum` is PowerPoint's own
 * tint (lumMod 60 % + lumOff 40 % is `lum: 0.4`, lumMod 75 % is `lum: -0.25`), so a deck that
 * changes its theme changes its colours. A colour written as `#rrggbb` has its transforms applied
 * (in HSL, as PowerPoint does) and comes out as a plain hex. The colours of a slide master whose
 * theme is not the deck's are baked to hex for the same reason: the deck has one theme.
 *
 * `bg1`, `tx1`, `bg2` and `tx2` are not slots; the master's `clrMap` says which slot each is, and
 * a dark master maps `bg1` to `dk1`.
 */

import type { Color, ThemeSlot } from '../../slides/model/deck';
import { elements, type XNode } from '../xml';
import { pick } from './part';

export type SlotName = ThemeSlot | 'folHlink';

export const SLOT_NAMES: readonly SlotName[] = ['dk1', 'lt1', 'dk2', 'lt2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink'];

/** The slot each of the four scheme aliases points at. */
export interface ClrMap {
  bg1: SlotName;
  tx1: SlotName;
  bg2: SlotName;
  tx2: SlotName;
}

export const IDENTITY_MAP: ClrMap = { bg1: 'lt1', tx1: 'dk1', bg2: 'lt2', tx2: 'dk2' };

export type ThemeHex = Record<SlotName, string>;

/** Office's own theme, for a file that has none. */
export const OFFICE_HEX: ThemeHex = {
  dk1: '#000000',
  lt1: '#ffffff',
  dk2: '#44546a',
  lt2: '#e7e6e6',
  accent1: '#4472c4',
  accent2: '#ed7d31',
  accent3: '#a5a5a5',
  accent4: '#ffc000',
  accent5: '#5b9bd5',
  accent6: '#70ad47',
  hlink: '#0563c1',
  folHlink: '#954f72'
};

/** What a colour is read against. */
export interface ColorEnv {
  hex: ThemeHex;
  map: ClrMap;
  /** Theme slots are replaced by their colours: this part's theme is not the deck's. */
  bake: boolean;
  /** `phClr`: the colour a theme's format scheme asks the shape to supply. */
  phClr?: ReadColor | null;
}

export interface ReadColor {
  color: Color;
  /** Alpha of a `#rrggbb` colour. A theme colour carries its own inside `color`. */
  alpha?: number;
}

// ── hex and HSL ─────────────────────────────────────────────────────────────

const HEX6 = /^[0-9a-f]{6}$/i;
export const isHex6 = (v: string | undefined): v is string => v !== undefined && HEX6.test(v);

const rgbOf = (hex: string): [number, number, number] => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
const h2 = (n: number): string => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, '0');
export const hexOf = (r: number, g: number, b: number): string => `#${h2(r)}${h2(g)}${h2(b)}`;

function toHsl(hex: string): [number, number, number] {
  const [r, g, b] = rgbOf(hex).map((v) => v / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h * 60, s, l];
}

function fromHsl(h: number, s: number, l: number): string {
  const hue = (((h % 360) + 360) % 360) / 360;
  if (s === 0) return hexOf(l * 255, l * 255, l * 255);
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t0: number): number => {
    let t = t0;
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return hexOf(f(hue + 1 / 3) * 255, f(hue) * 255, f(hue - 1 / 3) * 255);
}

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

/** `hex` mixed toward black (lum < 0) or white (lum > 0), as the deck's `lum` means it. */
export function applyLum(hex: string, lum: number): string {
  if (!lum) return hex;
  const [h, s, l] = toHsl(hex);
  return fromHsl(h, s, lum < 0 ? l * (1 + lum) : l + (1 - l) * lum);
}

// ── transforms ──────────────────────────────────────────────────────────────

interface Transforms {
  lumMod: number;
  lumOff: number;
  satMod: number;
  satOff: number;
  hueOff: number;
  tint?: number;
  shade?: number;
  alpha?: number;
}

function transformsOf(n: XNode): Transforms {
  const t: Transforms = { lumMod: 1, lumOff: 0, satMod: 1, satOff: 0, hueOff: 0 };
  for (const c of elements(n)) {
    const v = Number(c.attrs.val);
    if (!Number.isFinite(v)) continue;
    const f = v / 100_000;
    switch (c.name) {
      case 'a:lumMod':
        t.lumMod *= f;
        break;
      case 'a:lumOff':
        t.lumOff += f;
        break;
      case 'a:lum':
        t.lumMod = 0;
        t.lumOff = f;
        break;
      case 'a:satMod':
        t.satMod *= f;
        break;
      case 'a:satOff':
        t.satOff += f;
        break;
      case 'a:hueOff':
        t.hueOff += v / 60_000;
        break;
      case 'a:tint':
        t.tint = f;
        break;
      case 'a:shade':
        t.shade = f;
        break;
      case 'a:alpha':
        t.alpha = clamp01(f);
        break;
      case 'a:alphaMod':
        t.alpha = clamp01((t.alpha ?? 1) * f);
        break;
      case 'a:alphaOff':
        t.alpha = clamp01((t.alpha ?? 1) + f);
        break;
      default:
        break;
    }
  }
  return t;
}

/** Applies every transform to a hex colour. */
function bakeHex(hex: string, t: Transforms): string {
  let out = hex;
  if (t.tint !== undefined) out = mix(out, '#ffffff', 1 - t.tint);
  if (t.shade !== undefined) out = mix(out, '#000000', 1 - t.shade);
  if (t.lumMod !== 1 || t.lumOff !== 0 || t.satMod !== 1 || t.satOff !== 0 || t.hueOff !== 0) {
    const [h, s, l] = toHsl(out);
    out = fromHsl(h + t.hueOff, clamp01(s * t.satMod + t.satOff), clamp01(l * t.lumMod + t.lumOff));
  }
  return out;
}

function mix(a: string, b: string, toward: number): string {
  const [r1, g1, b1] = rgbOf(a);
  const [r2, g2, b2] = rgbOf(b);
  const t = clamp01(toward);
  return hexOf(r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t);
}

/** PowerPoint's lumMod/lumOff (and tint, shade) as the deck's single `lum`. */
function lumOf(t: Transforms): number {
  let lum = 0;
  if (t.lumOff > 0) lum = Math.min(1, t.lumOff);
  else if (t.lumMod < 1) lum = t.lumMod - 1;
  else if (t.lumMod > 1) lum = Math.min(1, t.lumMod - 1);
  else if (t.lumOff < 0) lum = Math.max(-1, t.lumOff);
  if (lum === 0 && t.tint !== undefined) lum = 1 - t.tint;
  if (lum === 0 && t.shade !== undefined) lum = t.shade - 1;
  return Math.round(Math.max(-1, Math.min(1, lum)) * 1000) / 1000;
}

// ── preset colours ──────────────────────────────────────────────────────────

const PRESET: Record<string, string> = {
  black: '#000000',
  white: '#ffffff',
  red: '#ff0000',
  green: '#008000',
  blue: '#0000ff',
  yellow: '#ffff00',
  cyan: '#00ffff',
  aqua: '#00ffff',
  magenta: '#ff00ff',
  fuchsia: '#ff00ff',
  gray: '#808080',
  grey: '#808080',
  silver: '#c0c0c0',
  maroon: '#800000',
  olive: '#808000',
  lime: '#00ff00',
  teal: '#008080',
  navy: '#000080',
  purple: '#800080',
  orange: '#ffa500',
  pink: '#ffc0cb',
  brown: '#a52a2a',
  gold: '#ffd700',
  indigo: '#4b0082',
  violet: '#ee82ee',
  tan: '#d2b48c',
  coral: '#ff7f50',
  salmon: '#fa8072',
  khaki: '#f0e68c',
  crimson: '#dc143c',
  darkRed: '#8b0000',
  darkGreen: '#006400',
  darkBlue: '#00008b',
  darkCyan: '#008b8b',
  darkMagenta: '#8b008b',
  darkGray: '#a9a9a9',
  darkGrey: '#a9a9a9',
  lightGray: '#d3d3d3',
  lightGrey: '#d3d3d3',
  lightBlue: '#add8e6',
  lightGreen: '#90ee90',
  lightYellow: '#ffffe0',
  lightPink: '#ffb6c1',
  lightCyan: '#e0ffff',
  dkRed: '#8b0000',
  dkGreen: '#006400',
  dkBlue: '#00008b',
  dkCyan: '#008b8b',
  dkMagenta: '#8b008b',
  dkYellow: '#808000',
  dkGray: '#a9a9a9',
  ltGray: '#d3d3d3',
  ltBlue: '#add8e6',
  ltGreen: '#90ee90',
  ltYellow: '#ffffe0',
  ltPink: '#ffb6c1',
  ltCyan: '#e0ffff',
  medBlue: '#0000cd',
  medGray: '#808080',
  dimGray: '#696969'
};

const SYSTEM: Record<string, string> = {
  windowText: '#000000',
  'window': '#ffffff',
  menuText: '#000000',
  'menu': '#ffffff',
  captionText: '#ffffff',
  highlightText: '#ffffff',
  'highlight': '#3399ff',
  btnFace: '#f0f0f0',
  btnText: '#000000',
  grayText: '#808080'
};

function scrgb(v: string | undefined): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  const lin = clamp01(n / 100_000);
  return (lin <= 0.0031308 ? 12.92 * lin : 1.055 * lin ** (1 / 2.4) - 0.055) * 255;
}

// ── reading ─────────────────────────────────────────────────────────────────

const SCHEME_ALIASES = new Set(['bg1', 'tx1', 'bg2', 'tx2']);

function slotOf(val: string, map: ClrMap): SlotName | null {
  if (SCHEME_ALIASES.has(val)) return map[val as keyof ClrMap];
  return (SLOT_NAMES as readonly string[]).includes(val) ? (val as SlotName) : null;
}

/** A deck colour from a slot, with a tint. `folHlink` has no slot of its own in the deck: it is its colour. */
function themeColor(slot: SlotName, t: Transforms, env: ColorEnv): ReadColor {
  if (slot === 'folHlink' || env.bake) {
    const hex = bakeHex(env.hex[slot], t);
    return { color: hex, ...(t.alpha !== undefined && t.alpha < 1 ? { alpha: t.alpha } : {}) };
  }
  const lum = lumOf(t);
  const out: { theme: ThemeSlot; lum?: number; alpha?: number } = { theme: slot };
  if (lum) out.lum = lum;
  if (t.alpha !== undefined && t.alpha < 1) out.alpha = Math.round(t.alpha * 1000) / 1000;
  return { color: out };
}

/** Puts a colour's transforms on top of `base`, which `phClr` stands for. */
function onTop(base: ReadColor, t: Transforms, env: ColorEnv): ReadColor {
  if (typeof base.color === 'string') {
    const hex = bakeHex(base.color, t);
    const alpha = t.alpha ?? base.alpha;
    return { color: hex, ...(alpha !== undefined && alpha < 1 ? { alpha } : {}) };
  }
  const own = base.color;
  if (env.bake) return { color: bakeHex(env.hex[own.theme], t) };
  const lum = own.lum ? own.lum : lumOf(t);
  const out: { theme: ThemeSlot; lum?: number; alpha?: number } = { theme: own.theme };
  if (lum) out.lum = lum;
  const alpha = t.alpha ?? own.alpha;
  if (alpha !== undefined && alpha < 1) out.alpha = alpha;
  return { color: out };
}

/**
 * The colour a colour element names (`a:srgbClr` and its kin). Null when it names nothing the
 * deck can hold: `phClr` with nothing to stand for, or a value that is not a colour.
 */
export function readColor(n: XNode | null | undefined, env: ColorEnv): ReadColor | null {
  if (!n) return null;
  switch (n.name) {
    case 'a:srgbClr': {
      const v = n.attrs.val;
      if (!isHex6(v)) return null;
      const t = transformsOf(n);
      const hex = bakeHex(`#${v.toLowerCase()}`, t);
      return { color: hex, ...(t.alpha !== undefined && t.alpha < 1 ? { alpha: t.alpha } : {}) };
    }
    case 'a:schemeClr': {
      const val = n.attrs.val ?? '';
      const t = transformsOf(n);
      if (val === 'phClr') return env.phClr ? onTop(env.phClr, t, env) : null;
      const slot = slotOf(val, env.map);
      return slot ? themeColor(slot, t, env) : null;
    }
    case 'a:sysClr': {
      const last = n.attrs.lastClr;
      const base = isHex6(last) ? `#${last.toLowerCase()}` : (pick(SYSTEM, n.attrs.val) ?? '#000000');
      const t = transformsOf(n);
      return { color: bakeHex(base, t), ...(t.alpha !== undefined && t.alpha < 1 ? { alpha: t.alpha } : {}) };
    }
    case 'a:prstClr': {
      const base = pick(PRESET, n.attrs.val);
      if (!base) return null;
      const t = transformsOf(n);
      return { color: bakeHex(base, t), ...(t.alpha !== undefined && t.alpha < 1 ? { alpha: t.alpha } : {}) };
    }
    case 'a:hslClr': {
      const h = Number(n.attrs.hue) / 60_000;
      const s = Number(n.attrs.sat) / 100_000;
      const l = Number(n.attrs.lum) / 100_000;
      if (![h, s, l].every(Number.isFinite)) return null;
      const t = transformsOf(n);
      return { color: bakeHex(fromHsl(h, clamp01(s), clamp01(l)), t), ...(t.alpha !== undefined && t.alpha < 1 ? { alpha: t.alpha } : {}) };
    }
    case 'a:scrgbClr': {
      const t = transformsOf(n);
      return { color: bakeHex(hexOf(scrgb(n.attrs.r), scrgb(n.attrs.g), scrgb(n.attrs.b)), t), ...(t.alpha !== undefined && t.alpha < 1 ? { alpha: t.alpha } : {}) };
    }
    default:
      return null;
  }
}

const COLOR_NAMES = new Set(['a:srgbClr', 'a:schemeClr', 'a:sysClr', 'a:prstClr', 'a:hslClr', 'a:scrgbClr']);

/** The colour inside a fill-like element (`a:solidFill`, `a:buClr`, `a:fgClr`): its first colour child. */
export function colorIn(n: XNode | null | undefined, env: ColorEnv): ReadColor | null {
  if (!n) return null;
  for (const c of elements(n)) if (COLOR_NAMES.has(c.name)) return readColor(c, env);
  return null;
}
