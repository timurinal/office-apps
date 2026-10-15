/**
 * Text: a `txBody` as the deck's slide text (ProseMirror JSON), its `bodyPr` as a `TextBox`, and a
 * `lstStyle` or `lvlNpPr` as `TextStyle`s.
 *
 * PowerPoint's model is the deck's: a bullet is a property of a paragraph, a paragraph has a level,
 * and what a paragraph or a run does not say comes from the placeholder, the layout, the master and
 * the theme. So this reads what the file states and no more. The two exceptions are the ones the
 * deck cannot inherit for itself:
 *
 *   · a shape's own `lstStyle` (Google Slides writes one on text boxes), which has no home on the
 *     deck's side, is laid under the shape's paragraphs and runs, and
 *   · the colour a shape's `p:style` gives its text (`fontRef`), which a shape made in PowerPoint
 *     relies on for its white-on-accent look.
 *
 * A theme font (`+mj-lt`) is written out as the theme's own name, as the deck's themes do.
 */

import { canonicalFamily } from '../../docs/core/fonts';
import { isSafeHref } from '../../docs/core/links';
import type { Bullet, Color, TextBox, TextDoc, TextNode, TextStyle } from '../../slides/model/deck';
import { plural } from '../types';
import { child, elements, textContent, type XNode } from '../xml';
import { colorIn } from './color';
import { MAX_DECK_CHARS, type PartCtx } from './ctx';
import { FormatError } from '../errors';
import { attr, flag, int, pick } from './part';
import { deckPt, deckSpacing, isReferenceScale, toLen } from './units';

/** What a slide-number field holds in the deck: the number is drawn in its place. */
export const SLIDE_NUMBER_TEXT = '‹#›';

const MAX_LEVEL = 8;

// ── a font ──────────────────────────────────────────────────────────────────

export function fontName(typeface: string | undefined, pc: PartCtx): string | undefined {
  const t = typeface?.trim();
  if (!t) return undefined;
  if (t === '+mj-lt') return pc.theme.json.fonts.major;
  if (t === '+mn-lt') return pc.theme.json.fonts.minor;
  if (t.startsWith('+')) return undefined;
  return canonicalFamily(t) ?? undefined;
}

// ── bullets ─────────────────────────────────────────────────────────────────

/** The glyphs PowerPoint's symbol-font bullets are, as characters a browser has. */
const SYMBOL_BULLETS: Record<string, Record<string, string>> = {
  wingdings: { '§': '▪', Ø: '➢', ü: '✓', q: '❑', v: '❖', l: '●', n: '■', u: '◆', w: '◇', o: '□', p: '▫', è: '➔', à: '➔', '¨': '◻', J: '☺' },
  symbol: { '·': '•', '§': '♣', Ø: '⊘', '¨': '♦' }
};

const NUMBER_STYLES: Record<string, Extract<Bullet, { kind: 'number' }>['style']> = {
  arabicPeriod: 'arabicPeriod',
  arabicPlain: 'arabicPeriod',
  arabicParenR: 'arabicParen',
  arabicParenBoth: 'arabicParen',
  alphaLcPeriod: 'alphaLcPeriod',
  alphaLcParenR: 'alphaLcPeriod',
  alphaLcParenBoth: 'alphaLcPeriod',
  alphaUcPeriod: 'alphaUcPeriod',
  alphaUcParenR: 'alphaUcPeriod',
  alphaUcParenBoth: 'alphaUcPeriod',
  romanLcPeriod: 'romanLcPeriod',
  romanLcParenR: 'romanLcPeriod',
  romanLcParenBoth: 'romanLcPeriod',
  romanUcPeriod: 'romanUcPeriod',
  romanUcParenR: 'romanUcPeriod',
  romanUcParenBoth: 'romanUcPeriod'
};

function bulletOf(p: XNode, pc: PartCtx): Bullet | undefined {
  const none = child(p, 'a:buNone');
  if (none) return { kind: 'none' };
  const num = child(p, 'a:buAutoNum');
  if (num) {
    const style = pick(NUMBER_STYLES, num.attrs.type);
    if (!style) return { kind: 'number', style: 'arabicPeriod' };
    const start = int(num, 'startAt', 1);
    return start > 1 ? { kind: 'number', style, start: Math.min(9999, start) } : { kind: 'number', style };
  }
  const ch = child(p, 'a:buChar');
  const blip = child(p, 'a:buBlip');
  if (!ch && !blip) return undefined;
  const font = attr(child(p, 'a:buFont'), 'typeface')?.toLowerCase().replace(/\s+/g, '');
  const raw = ch?.attrs.char ?? '•';
  const first = [...raw][0] ?? '•';
  const symbols = pick(SYMBOL_BULLETS, font);
  let glyph = symbols ? (pick(symbols, first) ?? '•') : first;
  if (/[<>&"'\\\u0000-\u001f\u007f-\u009f]/.test(glyph) || glyph === '') glyph = '•';
  const colour = colorIn(child(p, 'a:buClr'), pc.color);
  return colour ? { kind: 'char', char: glyph, color: colour.color } : { kind: 'char', char: glyph };
}

// ── a level's properties ────────────────────────────────────────────────────

const ALIGN: Record<string, NonNullable<TextStyle['align']>> = {
  l: 'left',
  ctr: 'center',
  r: 'right',
  just: 'justify',
  justLow: 'justify',
  dist: 'justify',
  thaiDist: 'justify'
};

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** The size in points that a spacing given as a percentage is a percentage of: the style's, else 18. */
const HINT_PT = 18;

function spacing(n: XNode | null, hintPt: number, pc: PartCtx): number | undefined {
  if (!n) return undefined;
  const pts = child(n, 'a:spcPts');
  if (pts) {
    const v = int(pts, 'val', NaN);
    return Number.isFinite(v) ? deckSpacing(pc.deck.space, v) : undefined;
  }
  const pct = child(n, 'a:spcPct');
  if (pct) {
    const v = int(pct, 'val', NaN);
    return Number.isFinite(v) ? round2(Math.min(400, ((v / 100_000) * 1.2 * hintPt) * pc.deck.space.font)) : undefined;
  }
  return undefined;
}

/** The properties a level (`a:lvl1pPr`) or a paragraph (`a:pPr`) states, with its default run (`a:defRPr`) as the style's type. */
export function readLevel(n: XNode | null | undefined, pc: PartCtx): TextStyle {
  const s: TextStyle = {};
  if (!n) return s;
  const space = pc.deck.space;
  const align = pick(ALIGN, n.attrs.algn);
  if (align) s.align = align;
  if (n.attrs.marL !== undefined) {
    const marL = int(n, 'marL', 0);
    s.indent = toLen(space, marL);
    if (n.attrs.indent !== undefined) s.bulletIndent = toLen(space, Math.max(0, marL + int(n, 'indent', 0)));
  }
  const def = child(n, 'a:defRPr');
  const run = readRunDefaults(def, pc);
  Object.assign(s, run);
  const hint = run.fontSize !== undefined ? run.fontSize / space.font : HINT_PT;
  const before = spacing(child(n, 'a:spcBef'), hint, pc);
  if (before !== undefined) s.spaceBefore = before;
  const after = spacing(child(n, 'a:spcAft'), hint, pc);
  if (after !== undefined) s.spaceAfter = after;
  const ln = child(n, 'a:lnSpc');
  if (ln) {
    const pct = child(ln, 'a:spcPct');
    const pts = child(ln, 'a:spcPts');
    if (pct) {
      const v = int(pct, 'val', NaN);
      if (Number.isFinite(v) && v > 0) s.lineHeight = round2(Math.min(5, Math.max(0.5, v / 100_000)));
    } else if (pts) {
      const v = int(pts, 'val', NaN);
      if (Number.isFinite(v) && v > 0) s.lineHeight = round2(Math.min(5, Math.max(0.5, v / 100 / (1.2 * hint))));
    }
  }
  const bullet = bulletOf(n, pc);
  if (bullet) s.bullet = bullet;
  return s;
}

/** The type part of a style: from a default run properties element. */
function readRunDefaults(def: XNode | null, pc: PartCtx): TextStyle {
  const s: TextStyle = {};
  if (!def) return s;
  const sz = deckPt(pc.deck.space, int(def, 'sz', NaN));
  if (sz !== undefined) s.fontSize = sz;
  const b = flag(def, 'b');
  if (b !== undefined) s.bold = b;
  const i = flag(def, 'i');
  if (i !== undefined) s.italic = i;
  const fill = child(def, 'a:solidFill');
  const colour = colorIn(fill, pc.color);
  if (colour) s.color = colour.color;
  const family = fontName(attr(child(def, 'a:latin'), 'typeface'), pc);
  if (family) s.fontFamily = family;
  return s;
}

/** A `lstStyle`: the nine levels it states, with `{}` for a level it does not. Trailing empty levels are cut. */
export function readLevels(lst: XNode | null | undefined, pc: PartCtx): TextStyle[] {
  const out: TextStyle[] = [];
  if (!lst) return out;
  for (let i = 0; i <= MAX_LEVEL; i++) {
    const lvl = child(lst, `a:lvl${i + 1}pPr`);
    out.push(lvl ? readLevel(lvl, pc) : {});
  }
  while (out.length > 0 && Object.keys(out[out.length - 1]!).length === 0) out.pop();
  return out;
}

// ── a text body's properties ────────────────────────────────────────────────

/** `TextBox` with insets by edge, so a layout's left inset and a slide's top inset can both stand. */
export interface BoxParts extends Omit<TextBox, 'insets'> {
  insets?: Partial<NonNullable<TextBox['insets']>>;
}

const ANCHORS: Record<string, NonNullable<TextBox['anchor']>> = { t: 'top', ctr: 'middle', b: 'bottom', just: 'middle', dist: 'middle' };

export function readBodyPr(bp: XNode | null | undefined, pc: PartCtx): BoxParts {
  const out: BoxParts = {};
  if (!bp) return out;
  const space = pc.deck.space;
  const anchor = pick(ANCHORS, bp.attrs.anchor);
  if (anchor) out.anchor = anchor;
  const insets: NonNullable<BoxParts['insets']> = {};
  const inset = (name: string, fallback: number): number => Math.min(1000, toLen(space, int(bp, name, fallback)));
  if (bp.attrs.lIns !== undefined) insets.l = inset('lIns', 91440);
  if (bp.attrs.tIns !== undefined) insets.t = inset('tIns', 45720);
  if (bp.attrs.rIns !== undefined) insets.r = inset('rIns', 91440);
  if (bp.attrs.bIns !== undefined) insets.b = inset('bIns', 45720);
  if (Object.keys(insets).length > 0) out.insets = insets;
  if (child(bp, 'a:noAutofit')) out.autofit = 'none';
  else if (child(bp, 'a:normAutofit')) out.autofit = 'shrink';
  else if (child(bp, 'a:spAutoFit')) out.autofit = 'grow';
  if (bp.attrs.wrap === 'none') out.wrap = false;
  else if (bp.attrs.wrap === 'square') out.wrap = true;
  const vert = bp.attrs.vert;
  if (vert !== undefined) out.vertical = vert !== 'horz';
  return out;
}

/** Later parts win, edge by edge. */
export function mergeBoxes(...parts: (BoxParts | undefined)[]): BoxParts {
  const out: BoxParts = {};
  for (const p of parts) {
    if (!p) continue;
    const { insets, ...rest } = p;
    Object.assign(out, rest);
    if (insets) out.insets = { ...out.insets, ...insets };
  }
  return out;
}

/** The deck's `TextBox`: an unstated edge is PowerPoint's own default, in this deck's px. */
export function finishBox(b: BoxParts, pc: PartCtx): TextBox | undefined {
  const out: TextBox = {};
  if (b.anchor) out.anchor = b.anchor;
  if (b.autofit) out.autofit = b.autofit;
  if (b.wrap !== undefined) out.wrap = b.wrap;
  if (b.vertical) out.vertical = true;
  // On the reference scale the renderer's own defaults are PowerPoint's; elsewhere they are not.
  if (b.insets || !isReferenceScale(pc.deck.space)) {
    const space = pc.deck.space;
    out.insets = { l: toLen(space, 91440), t: toLen(space, 45720), r: toLen(space, 91440), b: toLen(space, 45720), ...b.insets };
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

// ── a text body ─────────────────────────────────────────────────────────────

export interface TextEnv {
  pc: PartCtx;
  /** The shape's own `lstStyle` by level, laid under its paragraphs and runs. */
  defaults?: TextStyle[];
  /** What the shape's style (`fontRef`) gives text that states no colour. */
  shapeColor?: Color;
}

type Mark = NonNullable<TextNode['marks']>[number];

const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g;

/** Text as the deck holds it: no control characters, no line breaks inside a run. */
const clean = (s: string): string => s.replace(/\r\n|\r|\n/g, ' ').replace(CONTROL, '');

function underlined(v: string | undefined): boolean {
  return v !== undefined && v !== 'none';
}

function linkOf(rPr: XNode, env: TextEnv): Mark | null {
  const link = child(rPr, 'a:hlinkClick');
  if (!link) return null;
  const rel = env.pc.rels.get(link.attrs['r:id'] ?? '');
  if (!rel || !rel.external) {
    // A jump to another slide, a show or a file inside the presentation.
    if (link.attrs.action) env.pc.deck.warnings.add('link-internal', (n) => `${plural(n, 'link')} to other slides or to files ${n === 1 ? 'was' : 'were'} left out.`);
    return null;
  }
  if (rel.target.length > 2048 || !isSafeHref(rel.target)) {
    env.pc.deck.warnings.add('link-unsafe', (n) => `${plural(n, 'link')} to places other than web and mail addresses ${n === 1 ? 'was' : 'were'} left out.`);
    return null;
  }
  return { type: 'link', attrs: { href: rel.target } };
}

function marksOf(rPr: XNode | null, base: TextStyle, env: TextEnv): Mark[] {
  const pc = env.pc;
  const marks: Mark[] = [];
  const bold = rPr ? (flag(rPr, 'b') ?? base.bold) : base.bold;
  const italic = rPr ? (flag(rPr, 'i') ?? base.italic) : base.italic;
  if (bold) marks.push({ type: 'bold' });
  if (italic) marks.push({ type: 'italic' });
  if (rPr && underlined(rPr.attrs.u)) marks.push({ type: 'underline' });
  if (rPr && (rPr.attrs.strike === 'sngStrike' || rPr.attrs.strike === 'dblStrike')) marks.push({ type: 'strike' });
  const baseline = rPr ? int(rPr, 'baseline', 0) : 0;
  if (baseline > 0) marks.push({ type: 'sup' });
  else if (baseline < 0) marks.push({ type: 'sub' });

  const style: Record<string, unknown> = {};
  const own = readRunDefaults(rPr, pc);
  const color = own.color ?? base.color ?? env.shapeColor;
  if (color !== undefined) style.color = color;
  const size = own.fontSize ?? base.fontSize;
  if (size !== undefined) style.fontSize = size;
  const family = own.fontFamily ?? base.fontFamily;
  if (family !== undefined) style.fontFamily = family;
  if (Object.keys(style).length > 0) marks.push({ type: 'textStyle', attrs: style });

  if (rPr) {
    const hl = colorIn(child(rPr, 'a:highlight'), pc.color);
    if (hl) marks.push({ type: 'highlight', attrs: { color: hl.color } });
    const link = linkOf(rPr, env);
    if (link) marks.push(link);
  }
  return marks;
}

const sameMarks = (a: Mark[] | undefined, b: Mark[] | undefined): boolean => JSON.stringify(a ?? []) === JSON.stringify(b ?? []);

/** Neighbouring runs with the same marks are one run; PowerPoint and Google Slides cut a sentence in dozens. */
function joined(nodes: TextNode[]): TextNode[] {
  const out: TextNode[] = [];
  for (const n of nodes) {
    const last = out[out.length - 1];
    if (n.type === 'text' && last?.type === 'text' && sameMarks(last.marks, n.marks)) last.text = `${last.text ?? ''}${n.text ?? ''}`;
    else out.push(n);
  }
  return out;
}

function paragraph(p: XNode, env: TextEnv): TextNode {
  const pPr = child(p, 'a:pPr');
  const level = Math.min(MAX_LEVEL, Math.max(0, int(pPr, 'lvl', 0)));
  const base: TextStyle = env.defaults?.[level] ?? {};
  const own = readLevel(pPr, env.pc);
  const attrs: Record<string, unknown> = {};
  if (level > 0) attrs.level = level;
  const merged = { ...base, ...own };
  if (merged.align) attrs.align = merged.align;
  if (merged.bullet) attrs.bullet = merged.bullet;
  if (merged.spaceBefore !== undefined) attrs.spaceBefore = merged.spaceBefore;
  if (merged.spaceAfter !== undefined) attrs.spaceAfter = merged.spaceAfter;
  if (merged.lineHeight !== undefined) attrs.lineHeight = merged.lineHeight;
  if (merged.indent !== undefined) attrs.indent = merged.indent;
  if (merged.bulletIndent !== undefined) attrs.bulletIndent = merged.bulletIndent;

  const content: TextNode[] = [];
  for (const c of elements(p)) {
    switch (c.name) {
      case 'a:r': {
        const t = child(c, 'a:t');
        const text = t ? clean(textContent(t)) : '';
        if (text === '') break;
        const marks = marksOf(child(c, 'a:rPr'), base, env);
        content.push(marks.length > 0 ? { type: 'text', text, marks } : { type: 'text', text });
        break;
      }
      case 'a:fld': {
        const t = child(c, 'a:t');
        const text = c.attrs.type === 'slidenum' ? SLIDE_NUMBER_TEXT : t ? clean(textContent(t)) : '';
        if (text === '') break;
        const marks = marksOf(child(c, 'a:rPr'), base, env);
        content.push(marks.length > 0 ? { type: 'text', text, marks } : { type: 'text', text });
        break;
      }
      case 'a:br':
        content.push({ type: 'hardBreak' });
        break;
      default:
        break;
    }
  }
  const node: TextNode = { type: 'paragraph' };
  if (Object.keys(attrs).length > 0) node.attrs = attrs;
  for (const c of content) env.pc.deck.chars += c.text?.length ?? 1;
  if (env.pc.deck.chars > MAX_DECK_CHARS) throw new FormatError('deck_too_large', `${env.pc.deck.chars} characters`);
  const merged_ = joined(content);
  if (merged_.length > 0) node.content = merged_;
  return node;
}

/** The paragraphs of a `txBody` (or `a:txBody` in a cell, `p:txBody` in a shape). One empty paragraph at least. */
export function readTextBody(tx: XNode | null | undefined, env: TextEnv): TextDoc {
  const paras = tx ? elements(tx).filter((c) => c.name === 'a:p').map((p) => paragraph(p, env)) : [];
  return { type: 'doc', content: paras.length > 0 ? paras : [{ type: 'paragraph' }] };
}

/** Whether a text body has any text at all. It takes whatever a deck holds, a peer's included. */
export function hasText(doc: unknown): boolean {
  const walk = (n: unknown): boolean => {
    if (typeof n !== 'object' || n === null) return false;
    const x = n as TextNode;
    if (x.type === 'hardBreak') return false;
    return (typeof x.text === 'string' && x.text.trim() !== '') || (Array.isArray(x.content) && x.content.some(walk));
  };
  return typeof doc === 'object' && doc !== null && Array.isArray((doc as TextDoc).content) && (doc as TextDoc).content.some(walk);
}
