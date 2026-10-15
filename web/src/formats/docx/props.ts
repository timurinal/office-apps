/**
 * Run and paragraph properties, parsed from `w:rPr` and `w:pPr` into plain values.
 *
 * Properties cascade: the document's defaults, then the paragraph's style and the styles
 * it is based on, then the character style of a run, then what is written on the run
 * itself. Each layer is parsed into the same shape, with `undefined` for "not said", and
 * `merge` lays one over another, so the cascade is a fold.
 *
 * Units are converted where they are read: half-points and twentieths of a point to points,
 * EMU to pixels.
 */

import { child, type XNode } from '../xml';

export type VertAlign = 'superscript' | 'subscript' | 'baseline';

export interface RunProps {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  vertAlign?: VertAlign;
  /** `#rrggbb`, or null for "automatic". */
  color?: string | null;
  /** Points. */
  size?: number;
  /** A font name, once any theme reference is resolved; null for "none said". */
  font?: string | null;
  /** `#rrggbb`, or null for "none". */
  highlight?: string | null;
  hidden?: boolean;
}

export type Align = 'left' | 'center' | 'right' | 'justify';

export interface ParaProps {
  align?: Align;
  /** Twips. */
  indentLeft?: number;
  spacingBefore?: number;
  spacingAfter?: number;
  /** `w:line` and its rule. */
  line?: number;
  lineRule?: 'auto' | 'exact' | 'atLeast';
  /** 0-based outline level. 9 is body text. */
  outline?: number;
  numId?: string;
  ilvl?: number;
  pageBreakBefore?: boolean;
  /** No space between paragraphs of the same style: how Word tightens a list. */
  contextual?: boolean;
}

export interface ThemeFonts {
  major: string | null;
  minor: string | null;
}

/** `w:b` present with no value, or any value but off, is on. */
export function onOff(n: XNode | null | undefined): boolean | undefined {
  if (!n) return undefined;
  const v = n.attrs['w:val'];
  if (v === undefined) return true;
  return !/^(?:0|false|off)$/i.test(v);
}

const HEX6 = /^[0-9a-f]{6}$/i;
export const hexColor = (v: string | undefined): string | null => (v && HEX6.test(v) ? `#${v.toLowerCase()}` : null);

/** Word's sixteen highlighter colours. */
const HIGHLIGHTS: Record<string, string> = {
  yellow: '#ffff00',
  green: '#00ff00',
  cyan: '#00ffff',
  magenta: '#ff00ff',
  blue: '#0000ff',
  red: '#ff0000',
  darkBlue: '#000080',
  darkCyan: '#008080',
  darkGreen: '#008000',
  darkMagenta: '#800080',
  darkRed: '#800000',
  darkYellow: '#808000',
  darkGray: '#808080',
  lightGray: '#c0c0c0',
  black: '#000000',
  white: '#ffffff'
};

const num = (v: string | undefined): number | undefined => {
  if (v === undefined) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

export function parseRPr(n: XNode | null | undefined, theme: ThemeFonts): RunProps {
  const out: RunProps = {};
  if (!n) return out;

  const b = onOff(child(n, 'w:b'));
  if (b !== undefined) out.bold = b;
  const i = onOff(child(n, 'w:i'));
  if (i !== undefined) out.italic = i;

  const u = child(n, 'w:u');
  if (u) out.underline = (u.attrs['w:val'] ?? 'single') !== 'none';

  const strike = onOff(child(n, 'w:strike')) ?? onOff(child(n, 'w:dstrike'));
  if (strike !== undefined) out.strike = strike;

  const va = child(n, 'w:vertAlign')?.attrs['w:val'];
  if (va === 'superscript' || va === 'subscript' || va === 'baseline') out.vertAlign = va;

  const color = child(n, 'w:color');
  if (color) out.color = hexColor(color.attrs['w:val']);

  const sz = num(child(n, 'w:sz')?.attrs['w:val']);
  if (sz !== undefined && sz > 0) out.size = sz / 2;

  const fonts = child(n, 'w:rFonts');
  if (fonts) {
    const themed = (attr: string): string | null => {
      const t = fonts.attrs[attr];
      if (!t) return null;
      if (t.startsWith('major')) return theme.major;
      if (t.startsWith('minor')) return theme.minor;
      return null;
    };
    out.font = fonts.attrs['w:ascii'] ?? fonts.attrs['w:hAnsi'] ?? themed('w:asciiTheme') ?? themed('w:hAnsiTheme') ?? fonts.attrs['w:eastAsia'] ?? fonts.attrs['w:cs'] ?? null;
  }

  const hl = child(n, 'w:highlight');
  if (hl) out.highlight = HIGHLIGHTS[hl.attrs['w:val'] ?? ''] ?? null;
  else {
    // Character shading is the other way Word fills behind text.
    const shd = child(n, 'w:shd');
    const fill = shd?.attrs['w:fill'];
    if (shd && fill && fill !== 'auto') out.highlight = hexColor(fill);
  }

  const hidden = onOff(child(n, 'w:vanish'));
  if (hidden !== undefined) out.hidden = hidden;
  return out;
}

export function parsePPr(n: XNode | null | undefined): ParaProps {
  const out: ParaProps = {};
  if (!n) return out;

  const jc = child(n, 'w:jc')?.attrs['w:val'];
  if (jc === 'center') out.align = 'center';
  else if (jc === 'right' || jc === 'end') out.align = 'right';
  else if (jc === 'both' || jc === 'distribute' || jc === 'justify') out.align = 'justify';
  else if (jc === 'left' || jc === 'start') out.align = 'left';

  const ind = child(n, 'w:ind');
  if (ind) {
    const left = num(ind.attrs['w:left'] ?? ind.attrs['w:start']);
    if (left !== undefined) out.indentLeft = left;
  }

  const sp = child(n, 'w:spacing');
  if (sp) {
    // `beforeAutospacing` is HTML's "whatever the browser does": there is no number to keep.
    if (sp.attrs['w:beforeAutospacing'] !== '1') {
      const before = num(sp.attrs['w:before']);
      if (before !== undefined) out.spacingBefore = before;
    }
    if (sp.attrs['w:afterAutospacing'] !== '1') {
      const after = num(sp.attrs['w:after']);
      if (after !== undefined) out.spacingAfter = after;
    }
    const line = num(sp.attrs['w:line']);
    if (line !== undefined && line > 0) {
      out.line = line;
      const rule = sp.attrs['w:lineRule'];
      out.lineRule = rule === 'exact' || rule === 'atLeast' ? rule : 'auto';
    }
  }

  const outline = num(child(n, 'w:outlineLvl')?.attrs['w:val']);
  if (outline !== undefined) out.outline = outline;

  const numPr = child(n, 'w:numPr');
  if (numPr) {
    const id = child(numPr, 'w:numId')?.attrs['w:val'];
    if (id !== undefined) out.numId = id;
    const lvl = num(child(numPr, 'w:ilvl')?.attrs['w:val']);
    if (lvl !== undefined) out.ilvl = lvl;
  }

  const pbb = onOff(child(n, 'w:pageBreakBefore'));
  if (pbb !== undefined) out.pageBreakBefore = pbb;
  const ctx = onOff(child(n, 'w:contextualSpacing'));
  if (ctx !== undefined) out.contextual = ctx;
  return out;
}

/** Lay `over` on `base`: what `over` says wins, what it leaves out stays. */
export function merge<T extends object>(base: T, over: T): T {
  const out = { ...base } as Record<string, unknown>;
  for (const [k, v] of Object.entries(over)) if (v !== undefined) out[k] = v;
  return out as T;
}

export const twipsToPt = (t: number): number => t / 20;
export const emuToPx = (e: number): number => e / 9525;
export const twipsToMm = (t: number): number => (t * 25.4) / 1440;
export const twipsToPx = (t: number): number => t / 15;
