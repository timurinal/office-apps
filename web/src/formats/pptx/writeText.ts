/**
 * Text to DrawingML: the deck's slide text as `a:p` paragraphs, a `TextBox` as `a:bodyPr`, a
 * `TextStyle` as a level's `a:lvlNpPr`.
 *
 * What the deck leaves to inherit is left to inherit: a paragraph that states no alignment writes
 * none, and a run that states no size writes none. A link is written only when it is a web or mail
 * address; the text stays when it is not. The slide-number text (`‹#›`) is written as the field
 * PowerPoint renumbers.
 */

import { isSafeHref } from '../../docs/core/links';
import type { Bullet, TextBox, TextDoc, TextNode, TextStyle, ThemeJSON } from '../../slides/model/deck';
import { pick } from './part';
import { SLIDE_NUMBER_TEXT } from './text';
import { filePt, fileSpacing, toEmu, type Space } from './units';
import { asColor, clean, colorEl, el, esc, list, obj, solidFill, type Rels } from './xmlOut';

export interface TextOut {
  space: Space;
  /** For the hyperlinks of the part. */
  rels: Rels;
  theme: ThemeJSON;
  /** The number a slide-number field caches. */
  slideNumber: number;
}

const ALIGN: Record<string, string> = { left: 'l', center: 'ctr', right: 'r', justify: 'just' };
const ANCHOR: Record<string, string> = { top: 't', middle: 'ctr', bottom: 'b' };
const NUMBER: Record<string, string> = {
  arabicPeriod: 'arabicPeriod',
  arabicParen: 'arabicParenR',
  alphaLcPeriod: 'alphaLcPeriod',
  alphaUcPeriod: 'alphaUcPeriod',
  romanLcPeriod: 'romanLcPeriod',
  romanUcPeriod: 'romanUcPeriod'
};

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

// ── a body ──────────────────────────────────────────────────────────────────

export function bodyPr(box: TextBox | undefined, space: Space): string {
  const ins = box?.insets;
  const attrs: Record<string, string | number | boolean | undefined> = {
    wrap: box?.wrap === undefined ? undefined : box.wrap ? 'square' : 'none',
    vert: box?.vertical ? 'vert' : undefined,
    lIns: ins ? Math.max(0, toEmu(space, num(ins.l) ?? 0)) : undefined,
    tIns: ins ? Math.max(0, toEmu(space, num(ins.t) ?? 0)) : undefined,
    rIns: ins ? Math.max(0, toEmu(space, num(ins.r) ?? 0)) : undefined,
    bIns: ins ? Math.max(0, toEmu(space, num(ins.b) ?? 0)) : undefined,
    anchor: pick(ANCHOR, box?.anchor)
  };
  const fit = box?.autofit === 'shrink' ? '<a:normAutofit/>' : box?.autofit === 'grow' ? '<a:spAutoFit/>' : box?.autofit === 'none' ? '<a:noAutofit/>' : '';
  return el('a:bodyPr', { rtlCol: false, ...attrs }, fit);
}

// ── a level ─────────────────────────────────────────────────────────────────

function bulletEls(b: Bullet | undefined): string {
  if (!b) return '';
  switch (b.kind) {
    case 'none':
      return '<a:buNone/>';
    case 'char': {
      const color = b.color !== undefined ? asColor(b.color) : null;
      const glyph = [...String(b.char ?? '')][0] ?? '•';
      return (color ? el('a:buClr', {}, colorEl(color)) : '') + el('a:buFont', { typeface: 'Arial' }) + el('a:buChar', { char: clean(glyph) || '•' });
    }
    case 'number': {
      const start = num(b.start);
      return el('a:buFont', { typeface: '+mj-lt' }) + el('a:buAutoNum', { type: pick(NUMBER, b.style) ?? 'arabicPeriod', startAt: start !== undefined && start > 1 ? Math.round(start) : undefined });
    }
  }
}

function fontRef(family: string | undefined, theme: ThemeJSON): string | undefined {
  if (!family) return undefined;
  if (family === theme.fonts.major) return '+mj-lt';
  if (family === theme.fonts.minor) return '+mn-lt';
  return clean(family);
}

/**
 * A level or paragraph's properties element. `tag` is `a:pPr` for a paragraph (with its `lvl`) or
 * `a:lvl3pPr` and the like for a style, which also carries the style's type as `a:defRPr`.
 */
export function levelEl(tag: string, s: TextStyle, out: TextOut, opts: { level?: number; defRPr?: boolean; marL?: number } = {}): string {
  const space = out.space;
  const marL = opts.marL ?? (num(s.indent) !== undefined ? Math.max(0, toEmu(space, s.indent!)) : undefined);
  const indent = marL !== undefined && num(s.bulletIndent) !== undefined ? Math.round(toEmu(space, s.bulletIndent!) - marL) : undefined;
  const attrs = {
    marL,
    indent,
    lvl: opts.level && opts.level > 0 ? Math.min(8, Math.round(opts.level)) : undefined,
    algn: pick(ALIGN, s.align)
  };
  let kids = '';
  const lh = num(s.lineHeight);
  if (lh !== undefined && lh > 0) kids += el('a:lnSpc', {}, el('a:spcPct', { val: Math.round(lh * 100_000) }));
  const before = num(s.spaceBefore);
  if (before !== undefined) kids += el('a:spcBef', {}, el('a:spcPts', { val: fileSpacing(space, before) }));
  const after = num(s.spaceAfter);
  if (after !== undefined) kids += el('a:spcAft', {}, el('a:spcPts', { val: fileSpacing(space, after) }));
  kids += bulletEls(s.bullet);
  if (opts.defRPr) {
    const size = num(s.fontSize);
    const color = s.color !== undefined ? asColor(s.color) : null;
    const family = fontRef(s.fontFamily, out.theme);
    const def = el(
      'a:defRPr',
      { sz: size !== undefined ? filePt(space, size) : undefined, b: s.bold === undefined ? undefined : s.bold ? '1' : '0', i: s.italic === undefined ? undefined : s.italic ? '1' : '0' },
      (color ? solidFill(color) : '') + (family ? el('a:latin', { typeface: family }) : '')
    );
    if (def !== '<a:defRPr/>') kids += def;
  }
  return el(tag, attrs, kids);
}

/** A style's levels as the children of an `lstStyle`, `titleStyle` or `bodyStyle`. */
export function levelsEl(levels: readonly TextStyle[] | undefined, out: TextOut): string {
  return list<TextStyle>(levels).slice(0, 9).map((s, i) => levelEl(`a:lvl${i + 1}pPr`, obj<TextStyle>(s) ?? {}, out, { defRPr: true })).join('');
}

// ── runs and paragraphs ─────────────────────────────────────────────────────

interface Format {
  b?: boolean;
  i?: boolean;
  u?: boolean;
  strike?: boolean;
  baseline?: number;
  color?: ReturnType<typeof asColor>;
  size?: number;
  family?: string;
  highlight?: ReturnType<typeof asColor>;
  href?: string;
}

function formatOf(marks: TextNode['marks']): Format {
  const f: Format = {};
  for (const m of list<NonNullable<TextNode['marks']>[number]>(marks)) {
    if (!m || typeof m !== 'object') continue;
    const a = obj<Record<string, unknown>>(m.attrs) ?? {};
    switch (m.type) {
      case 'bold':
        f.b = true;
        break;
      case 'italic':
        f.i = true;
        break;
      case 'underline':
        f.u = true;
        break;
      case 'strike':
        f.strike = true;
        break;
      case 'sup':
        f.baseline = 30_000;
        break;
      case 'sub':
        f.baseline = -25_000;
        break;
      case 'textStyle': {
        const c = a.color !== undefined && a.color !== null ? asColor(a.color) : null;
        if (c) f.color = c;
        const s = num(a.fontSize);
        if (s !== undefined && s > 0) f.size = s;
        if (typeof a.fontFamily === 'string' && a.fontFamily.trim()) f.family = a.fontFamily.trim();
        break;
      }
      case 'highlight': {
        const c = a.color !== undefined && a.color !== null ? asColor(a.color) : null;
        if (c) f.highlight = c;
        break;
      }
      case 'link':
        if (typeof a.href === 'string' && isSafeHref(a.href)) f.href = a.href;
        break;
      default:
        break;
    }
  }
  return f;
}

function rPrEl(tag: string, f: Format, out: TextOut): string {
  const family = fontRef(f.family, out.theme);
  const kids =
    (f.color ? solidFill(f.color) : '') +
    (f.highlight ? el('a:highlight', {}, colorEl(f.highlight)) : '') +
    (family ? el('a:latin', { typeface: family }) : '') +
    (f.href ? el('a:hlinkClick', { 'r:id': out.rels.add('hyperlink', f.href, true) }) : '');
  return el(
    tag,
    {
      lang: 'en-US',
      sz: f.size !== undefined ? filePt(out.space, f.size) : undefined,
      b: f.b ? '1' : undefined,
      i: f.i ? '1' : undefined,
      u: f.u ? 'sng' : undefined,
      strike: f.strike ? 'sngStrike' : undefined,
      baseline: f.baseline,
      dirty: false
    },
    kids
  );
}

function runs(nodes: readonly TextNode[] | undefined, out: TextOut): string {
  let xml = '';
  for (const n of list<TextNode>(nodes)) {
    if (!n || typeof n !== 'object') continue;
    if (n.type === 'hardBreak') {
      xml += el('a:br', {}, '<a:rPr lang="en-US" dirty="0"/>');
      continue;
    }
    if (n.type !== 'text' || typeof n.text !== 'string' || n.text === '') continue;
    const f = formatOf(n.marks);
    const parts = n.text.split(SLIDE_NUMBER_TEXT);
    parts.forEach((part, i) => {
      if (i > 0) xml += el('a:fld', { id: '{B6F15528-21DE-4FAA-801E-634DDDAF4B2B}', type: 'slidenum' }, rPrEl('a:rPr', f, out) + el('a:t', {}, esc(String(out.slideNumber))));
      if (part !== '') xml += el('a:r', {}, rPrEl('a:rPr', f, out) + el('a:t', {}, esc(part)));
    });
  }
  return xml;
}

/** The paragraphs of a text body. A body with none gets one empty paragraph: DrawingML needs it. */
export function paragraphs(doc: TextDoc | undefined, out: TextOut): string {
  const paras = list<TextNode>(obj<TextDoc>(doc)?.content).filter((p) => p && typeof p === 'object' && p.type === 'paragraph');
  if (paras.length === 0) return '<a:p><a:endParaRPr lang="en-US" dirty="0"/></a:p>';
  return paras
    .map((p) => {
      const a = obj<Record<string, unknown>>(p.attrs) ?? {};
      const style: TextStyle = {};
      if (typeof a.align === 'string') style.align = a.align as TextStyle['align'];
      if (a.bullet && typeof a.bullet === 'object') style.bullet = a.bullet as Bullet;
      const sb = num(a.spaceBefore);
      if (sb !== undefined) style.spaceBefore = sb;
      const sa = num(a.spaceAfter);
      if (sa !== undefined) style.spaceAfter = sa;
      const lh = num(a.lineHeight);
      if (lh !== undefined) style.lineHeight = lh;
      const ind = num(a.indent);
      if (ind !== undefined) style.indent = ind;
      const bi = num(a.bulletIndent);
      if (bi !== undefined) style.bulletIndent = bi;
      const pPr = levelEl('a:pPr', style, out, { level: num(a.level) });
      return el('a:p', {}, (pPr === '<a:pPr/>' ? '' : pPr) + runs(p.content, out) + '<a:endParaRPr lang="en-US" dirty="0"/>');
    })
    .join('');
}

/** `p:txBody` or `a:txBody` (a table cell's). */
export function txBody(tag: 'p:txBody' | 'a:txBody', doc: TextDoc | undefined, box: TextBox | undefined, out: TextOut, lst = ''): string {
  return el(tag, {}, bodyPr(box, out.space) + (lst ? el('a:lstStyle', {}, lst) : '<a:lstStyle/>') + paragraphs(doc, out));
}
