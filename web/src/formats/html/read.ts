/**
 * HTML to a Docs document, through an allowlist.
 *
 * The page is parsed (parse.ts) and walked, and a document is *built* from what the walk
 * recognises. Nothing is copied through: an element not on the list contributes its text
 * and nothing else, an attribute not read is gone, and the values that are read go through
 * the same checks the editor applies to a paste (docs/core/sanitize.ts). So there is no
 * sanitising pass that could miss something. What a document may contain is what this file
 * can write.
 *
 *   elements   p h1-h6 div blockquote pre ul ol li table tr th td img hr br a
 *              b strong i em u s del ins sub sup code mark span font
 *   dropped    script style iframe object svg head, with their contents; every other
 *              element keeps its text
 *   links      http, https and mailto only (`isSafeHref`)
 *   pictures   a `data:` URL of PNG, JPEG, GIF or WebP only. Anything at another address is
 *              not fetched, and is left out
 *   styles     font family, size, colour, background, weight, slant, underline, strike,
 *              alignment, line height, spacing and indent: each parsed, none copied
 */

import { canonicalFamily, DEFAULT_SIZE } from '../../docs/core/fonts';
import { isSafeHref } from '../../docs/core/links';
import { safeColor, safeFontSize, safeLineHeight, safeSpace, toPoints } from '../../docs/core/sanitize';
import { decodeDataImage } from '../images';
import { IMAGE_MIMES, MAX_IMAGES, MAX_NESTING } from '../limits';
import { doc, mergeText, para, text as textNode } from '../model';
import { IMAGE_TOKEN_PREFIX, Warnings, plural, type ImageData, type ImportResult, type JSONContent, type MarkJSON } from '../types';
import { decodeEntities, elementsOf, findFirst, isNode, parseHtml, parseStyle, textOfNode, type HNode } from './parse';

export interface HtmlCtx {
  warnings: Warnings;
  images: Map<string, ImageData>;
  depth: number;
}

export const newHtmlCtx = (): HtmlCtx => ({ warnings: new Warnings(), images: new Map(), depth: 0 });

const BLOCK = new Set([
  'address', 'article', 'aside', 'blockquote', 'body', 'center', 'dd', 'details', 'div', 'dl', 'dt', 'fieldset', 'figcaption', 'figure', 'footer', 'form',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'html', 'li', 'main', 'nav', 'ol', 'p', 'pre', 'section', 'summary', 'table', 'tbody', 'td', 'tfoot',
  'th', 'thead', 'tr', 'ul', 'img'
]);

const NAMED_COLORS: Record<string, string> = {
  black: '#000000', white: '#ffffff', red: '#ff0000', green: '#008000', blue: '#0000ff', yellow: '#ffff00', orange: '#ffa500', purple: '#800080',
  gray: '#808080', grey: '#808080', silver: '#c0c0c0', maroon: '#800000', navy: '#000080', teal: '#008080', lime: '#00ff00', aqua: '#00ffff',
  fuchsia: '#ff00ff', olive: '#808000', pink: '#ffc0cb', brown: '#a52a2a'
};

/** A CSS colour as hex or rgb, the only forms the editor stores. */
function cssColor(v: string | undefined): string | null {
  if (!v) return null;
  const s = v.trim().toLowerCase();
  if (s === 'transparent' || s === 'inherit' || s === 'initial' || s === 'currentcolor' || s === 'windowtext') return null;
  return safeColor(s) ?? NAMED_COLORS[s] ?? null;
}

// ── marks ───────────────────────────────────────────────────────────────────

const MARK_ORDER = ['link', 'bold', 'italic', 'underline', 'strike', 'code', 'subscript', 'superscript', 'textStyle', 'highlight', 'insertion', 'deletion'];

function withMark(marks: readonly MarkJSON[], mark: MarkJSON): MarkJSON[] {
  // Code takes no other mark; a span inside it keeps it code.
  if (marks.some((m) => m.type === 'code')) return [...marks];
  if (mark.type === 'code') return [mark];
  if (mark.type === 'textStyle') {
    const prev = marks.find((m) => m.type === 'textStyle');
    const merged = { type: 'textStyle', attrs: { ...(prev?.attrs ?? {}), ...(mark.attrs ?? {}) } };
    return [...marks.filter((m) => m.type !== 'textStyle'), merged].sort(byOrder);
  }
  return [...marks.filter((m) => m.type !== mark.type), mark].sort(byOrder);
}

const byOrder = (a: MarkJSON, b: MarkJSON): number => MARK_ORDER.indexOf(a.type) - MARK_ORDER.indexOf(b.type);

const FONT_SIZES_PT = [7.5, 10, 12, 13.5, 18, 24, 36];

/** Marks an element's style and attributes ask for. */
function styleMarks(n: HNode, marks: readonly MarkJSON[]): MarkJSON[] {
  let out = [...marks];
  const st = parseStyle(n.attrs.style);
  const weight = st['font-weight'];
  if (weight && (/^(?:bold|bolder)$/i.test(weight) || Number(weight) >= 600)) out = withMark(out, { type: 'bold' });
  if (/^(?:italic|oblique)/i.test(st['font-style'] ?? '')) out = withMark(out, { type: 'italic' });
  const deco = `${st['text-decoration'] ?? ''} ${st['text-decoration-line'] ?? ''}`.toLowerCase();
  if (deco.includes('underline')) out = withMark(out, { type: 'underline' });
  if (deco.includes('line-through')) out = withMark(out, { type: 'strike' });
  const va = (st['vertical-align'] ?? '').toLowerCase();
  if (va === 'super') out = withMark(out, { type: 'superscript' });
  else if (va === 'sub') out = withMark(out, { type: 'subscript' });

  const style: Record<string, string> = {};
  const family = canonicalFamily(firstFamilyOf(st['font-family'] ?? n.attrs.face));
  if (family && family !== 'Inter') style.fontFamily = family;
  const size = toPoints(st['font-size']);
  if (size && Number.parseFloat(size) !== DEFAULT_SIZE) style.fontSize = size;
  const color = cssColor(st.color ?? n.attrs.color);
  if (color && color !== '#000000') style.color = color;
  if (n.tag === 'font' && n.attrs.size && !st['font-size']) {
    const k = Math.min(7, Math.max(1, Number(n.attrs.size) || 3));
    const pt = safeFontSize(`${FONT_SIZES_PT[k - 1]}pt`);
    if (pt && Number.parseFloat(pt) !== DEFAULT_SIZE) style.fontSize = pt;
  }
  if (Object.keys(style).length > 0) out = withMark(out, { type: 'textStyle', attrs: style });

  const bg = cssColor(st['background-color'] ?? st.background);
  if (bg && bg !== '#ffffff') out = withMark(out, { type: 'highlight', attrs: { color: bg } });
  return out;
}

function firstFamilyOf(css: string | undefined): string | null {
  if (!css) return null;
  const first = css.split(',')[0]?.trim().replace(/^["']|["']$/g, '').trim();
  return first || null;
}

// ── inline ──────────────────────────────────────────────────────────────────

type Atom = { text: string; marks: MarkJSON[] } | { node: JSONContent } | { block: JSONContent };

interface Inline {
  atoms: Atom[];
}

function suggestionMark(n: HNode, type: 'insertion' | 'deletion'): MarkJSON | null {
  const id = n.attrs['data-suggestion'];
  if (!id) return null;
  return {
    type,
    attrs: {
      id: id.slice(0, 40),
      authorId: (n.attrs['data-author-id'] ?? '').slice(0, 80),
      authorName: (n.attrs['data-author'] ?? '').slice(0, 80),
      at: Number(n.attrs['data-at']) || 0
    }
  };
}

function inlineOf(ctx: HtmlCtx, n: HNode | string, marks: MarkJSON[], out: Inline, pre: boolean): void {
  if (typeof n === 'string') {
    if (n !== '') out.atoms.push({ text: pre ? n : n, marks });
    return;
  }
  switch (n.tag) {
    case 'br':
      out.atoms.push({ node: { type: 'hardBreak' } });
      return;
    case 'img': {
      const block = imageBlock(ctx, n);
      if (block) out.atoms.push({ block });
      return;
    }
    case 'sup':
      if ('data-footnote' in n.attrs) {
        const body = textOfNode(n).replace(/\s+/g, ' ').trim();
        if (body) out.atoms.push({ node: { type: 'footnote', content: [textNode(body)] } });
        return;
      }
      break;
    case 'input':
      return;
    default:
      break;
  }

  let next = marks;
  switch (n.tag) {
    case 'b':
    case 'strong':
      next = withMark(next, { type: 'bold' });
      break;
    case 'i':
    case 'em':
    case 'cite':
    case 'dfn':
    case 'var':
      next = withMark(next, { type: 'italic' });
      break;
    case 'u':
      next = withMark(next, { type: 'underline' });
      break;
    case 's':
    case 'strike':
      next = withMark(next, { type: 'strike' });
      break;
    case 'ins': {
      const m = suggestionMark(n, 'insertion');
      next = withMark(next, m ?? { type: 'underline' });
      break;
    }
    case 'del': {
      const m = suggestionMark(n, 'deletion');
      next = withMark(next, m ?? { type: 'strike' });
      break;
    }
    case 'sub':
      next = withMark(next, { type: 'subscript' });
      break;
    case 'sup':
      next = withMark(next, { type: 'superscript' });
      break;
    case 'code':
    case 'kbd':
    case 'samp':
    case 'tt':
      next = withMark(next, { type: 'code' });
      break;
    case 'mark': {
      const color = cssColor(n.attrs['data-color']) ?? cssColor(parseStyle(n.attrs.style)['background-color']) ?? '#fff2a8';
      next = withMark(next, { type: 'highlight', attrs: { color } });
      break;
    }
    case 'a': {
      const href = n.attrs.href?.trim();
      // Only the three schemes the editor allows. An anchor to a place in the page is just text.
      if (href && isSafeHref(href)) next = withMark(next, { type: 'link', attrs: { href } });
      else if (href && !href.startsWith('#')) ctx.warnings.add('link', (c) => `${plural(c, 'link')} to addresses that are not web or mail addresses ${c === 1 ? 'was' : 'were'} left as text.`);
      break;
    }
    default:
      break;
  }
  next = styleMarks(n, next);
  for (const c of n.children) inlineOf(ctx, c, next, out, pre);
}

function imageBlock(ctx: HtmlCtx, n: HNode): JSONContent | null {
  const src = n.attrs.src?.trim() ?? '';
  const decoded = src.startsWith('data:') ? decodeDataImage(src) : null;
  if (!decoded) {
    if (src) ctx.warnings.add('external-image', (c) => `${plural(c, 'picture')} that could not be taken from the file ${c === 1 ? 'was' : 'were'} left out.`);
    return null;
  }
  if (ctx.images.size >= MAX_IMAGES) {
    ctx.warnings.add('image-count', (c) => `${plural(c, 'picture')} beyond the first ${MAX_IMAGES} ${c === 1 ? 'was' : 'were'} left out.`);
    return null;
  }
  if (!IMAGE_MIMES.includes(decoded.mime)) return null;
  const token = `${IMAGE_TOKEN_PREFIX}${ctx.images.size + 1}`;
  ctx.images.set(token, { bytes: decoded.bytes, mime: decoded.mime, name: 'image' });
  const attrs: Record<string, unknown> = { src: token };
  const alt = (n.attrs.alt ?? '').trim();
  if (alt) attrs.alt = alt.slice(0, 500);
  const w = Number(n.attrs.width);
  const h = Number(n.attrs.height);
  if (Number.isFinite(w) && Number.isFinite(h) && w >= 8 && h >= 8 && w <= 6000 && h <= 6000) {
    attrs.width = Math.round(w);
    attrs.height = Math.round(h);
  }
  const align = n.attrs['data-align'];
  if (align === 'center' || align === 'right') attrs.align = align;
  return { type: 'image', attrs };
}

/**
 * Inline atoms as paragraphs: whitespace collapsed as a browser would, and a picture in the
 * middle cutting the paragraph in two (a picture is a block here).
 */
function paragraphs(atoms: Atom[], attrs: Record<string, unknown>, pre: boolean, kind: 'paragraph' | { heading: number } = 'paragraph'): JSONContent[] {
  const out: JSONContent[] = [];
  let cur: JSONContent[] = [];
  let prevSpace = true;
  const make = (content: JSONContent[]): JSONContent | null => {
    const merged = mergeText(content);
    // Trailing collapsible space goes.
    const last = merged[merged.length - 1];
    if (!pre && last?.type === 'text' && (last.text ?? '').endsWith(' ')) {
      const trimmed = (last.text ?? '').replace(/ +$/, '');
      if (trimmed) merged[merged.length - 1] = { ...last, text: trimmed };
      else merged.pop();
    }
    if (merged.length === 0) return null;
    return kind === 'paragraph' ? para(merged, attrs) : { type: 'heading', attrs: { level: kind.heading, ...attrs }, content: merged };
  };
  const flush = () => {
    const p = make(cur);
    if (p) out.push(p);
    cur = [];
    prevSpace = true;
  };
  for (const a of atoms) {
    if ('block' in a) {
      flush();
      out.push(a.block);
    } else if ('node' in a) {
      cur.push(a.node);
      prevSpace = a.node.type === 'hardBreak';
    } else {
      let t = pre ? a.text : a.text.replace(/[ \t\r\n\f]+/g, ' ');
      if (!pre && prevSpace && t.startsWith(' ')) t = t.slice(1);
      if (t === '') continue;
      cur.push(textNode(t, a.marks));
      prevSpace = !pre && t.endsWith(' ');
    }
  }
  flush();
  return out;
}

// ── block attributes ────────────────────────────────────────────────────────

function lineHeightOf(v: string | undefined): number | null {
  if (!v) return null;
  const pct = /^(\d+(?:\.\d+)?)%$/.exec(v.trim());
  if (pct) return safeLineHeight(Number(pct[1]) / 100);
  return safeLineHeight(v.trim());
}

function spaceOf(v: string | undefined): number | null {
  const m = v ? /^(\d+(?:\.\d+)?)(pt|px)$/.exec(v.trim()) : null;
  if (!m) return null;
  return safeSpace(Math.round((m[2] === 'px' ? Number(m[1]) * 0.75 : Number(m[1])) * 2) / 2);
}

function blockAttrs(n: HNode, inherited: Record<string, unknown>): Record<string, unknown> {
  const st = parseStyle(n.attrs.style);
  const out: Record<string, unknown> = { ...inherited };
  const align = (st['text-align'] ?? n.attrs.align ?? '').toLowerCase();
  if (align === 'center' || align === 'right' || align === 'justify') out.textAlign = align;
  else if (align === 'left') delete out.textAlign;
  const lh = lineHeightOf(st['line-height']);
  if (lh !== null && lh !== 1) out.lineHeight = lh;
  const before = spaceOf(st['margin-top']);
  if (before !== null && before > 0) out.spaceBefore = before;
  const after = spaceOf(st['margin-bottom']);
  if (after !== null && after > 0) out.spaceAfter = after;
  const left = /^(\d+(?:\.\d+)?)pt$/.exec((st['margin-left'] ?? '').trim());
  if (left) {
    const levels = Math.min(8, Math.round(Number(left[1]) / 36));
    if (levels > 0) out.indent = levels;
  }
  const ps = n.attrs['data-style'];
  if (ps === 'title' || ps === 'subtitle' || ps === 'nospacing') out.paraStyle = ps;
  return out;
}

// ── blocks ──────────────────────────────────────────────────────────────────

/** The blocks in `nodes`: runs of inline content become paragraphs, block elements become blocks. */
export function blocksOf(ctx: HtmlCtx, nodes: readonly (HNode | string)[], inherited: Record<string, unknown> = {}): JSONContent[] {
  const out: JSONContent[] = [];
  let run: Inline = { atoms: [] };
  const flushRun = () => {
    if (run.atoms.length > 0) out.push(...paragraphs(run.atoms, inherited, false));
    run = { atoms: [] };
  };
  for (const n of nodes) {
    if (typeof n === 'string' || !BLOCK.has(n.tag) || n.tag === 'img') {
      inlineOf(ctx, n, [], run, false);
      continue;
    }
    flushRun();
    out.push(...blockOf(ctx, n, inherited));
  }
  flushRun();
  return out;
}

function blockOf(ctx: HtmlCtx, n: HNode, inherited: Record<string, unknown>): JSONContent[] {
  const attrs = blockAttrs(n, inherited);
  const own = (): Inline => {
    const inl: Inline = { atoms: [] };
    for (const c of n.children) inlineOf(ctx, c, styleMarks(n, []), inl, false);
    return inl;
  };
  switch (n.tag) {
    case 'h1':
    case 'h2':
    case 'h3':
    case 'h4':
    case 'h5':
    case 'h6': {
      const level = Number(n.tag[1]);
      const { paraStyle: _p, ...rest } = attrs;
      void _p;
      return paragraphs(own().atoms, rest, false, { heading: level });
    }
    case 'p':
    case 'dt':
    case 'dd':
    case 'summary':
    case 'figcaption':
      return paragraphs(own().atoms, attrs, false);
    case 'pre': {
      const code = elementsOf(n).find((c) => c.tag === 'code');
      const value = textOfNode(code ?? n).replace(/\r\n?/g, '\n').replace(/\n$/, '');
      const cls = (code ?? n).attrs.class ?? '';
      const lang = /(?:^|\s)language-([a-z0-9+#-]{1,30})/i.exec(cls)?.[1];
      return [{ type: 'codeBlock', ...(lang ? { attrs: { language: lang } } : {}), ...(value ? { content: [{ type: 'text', text: value }] } : {}) }];
    }
    case 'blockquote': {
      if (ctx.depth >= MAX_NESTING) return blocksOf(ctx, n.children, attrs);
      ctx.depth++;
      const inner = blocksOf(ctx, n.children, attrs);
      ctx.depth--;
      return inner.length > 0 ? [{ type: 'blockquote', content: inner }] : [];
    }
    case 'hr':
      return [{ type: 'horizontalRule' }];
    case 'img': {
      const b = imageBlock(ctx, n);
      return b ? [b] : [];
    }
    case 'ul':
    case 'ol':
      return listOf(ctx, n);
    case 'table':
      return tableOf(ctx, n);
    case 'div':
    case 'section':
    case 'article':
    case 'aside':
    case 'main':
    case 'header':
    case 'footer':
    case 'nav':
    case 'figure':
    case 'form':
    case 'fieldset':
    case 'details':
    case 'address':
    case 'center':
    case 'dl':
    case 'body':
    case 'html':
    case 'li':
    case 'tbody':
    case 'thead':
    case 'tfoot':
    case 'tr':
    case 'td':
    case 'th': {
      if ('data-page-break' in n.attrs || /page-break-(?:after|before)\s*:\s*always/i.test(n.attrs.style ?? '') || /break-(?:after|before)\s*:\s*page/i.test(n.attrs.style ?? '')) {
        return [{ type: 'pageBreak' }, ...blocksOf(ctx, n.children, attrs)];
      }
      if ('data-toc' in n.attrs) return [{ type: 'tableOfContents', attrs: { entries: tocEntries(n.attrs['data-entries']) } }];
      const inherit = n.tag === 'center' ? { ...attrs, textAlign: 'center' } : attrs;
      return blocksOf(ctx, n.children, inherit);
    }
    default:
      return blocksOf(ctx, n.children, attrs);
  }
}

function tocEntries(raw: string | undefined): string {
  try {
    const v: unknown = JSON.parse(raw ?? '[]');
    if (!Array.isArray(v)) return '[]';
    return JSON.stringify(
      v
        .filter((e): e is { level: unknown; text: string } => !!e && typeof e === 'object' && typeof (e as { text?: unknown }).text === 'string')
        .slice(0, 500)
        .map((e) => ({ level: Math.min(3, Math.max(1, Number(e.level) || 1)), text: e.text.slice(0, 500) }))
    );
  } catch {
    return '[]';
  }
}

function listOf(ctx: HtmlCtx, n: HNode): JSONContent[] {
  if (ctx.depth >= MAX_NESTING) {
    ctx.warnings.add('nesting', (c) => `${plural(c, 'list')} nested too deeply ${c === 1 ? 'was' : 'were'} flattened.`);
    return elementsOf(n).flatMap((li) => blocksOf(ctx, li.children));
  }
  const items = elementsOf(n).filter((c) => c.tag === 'li');
  if (items.length === 0) return [];
  const task = n.attrs['data-type'] === 'taskList' || items.every((li) => hasCheckbox(li));
  ctx.depth++;
  const content: JSONContent[] = items.map((li) => {
    let kids = blocksOf(ctx, li.children.filter((c) => !(isNode(c) && c.tag === 'input')));
    // A list item starts with a paragraph. One that starts with a nested list gets an empty one first.
    if (kids.length === 0 || kids[0]!.type !== 'paragraph') kids = [{ type: 'paragraph' }, ...kids];
    if (task) {
      const checked = li.attrs['data-checked'] === 'true' || li.attrs['data-checked'] === '' || findFirst(li, 'input')?.attrs.checked !== undefined;
      return { type: 'taskItem', attrs: { checked }, content: kids };
    }
    return { type: 'listItem', content: kids };
  });
  ctx.depth--;
  if (task) return [{ type: 'taskList', content }];
  if (n.tag === 'ul') return [{ type: 'bulletList', content }];
  const attrs: Record<string, unknown> = {};
  const start = Number(n.attrs.start);
  if (Number.isInteger(start) && start > 0 && start !== 1) attrs.start = start;
  if (['a', 'A', 'i', 'I'].includes(n.attrs.type ?? '')) attrs.type = n.attrs.type;
  if (n.attrs['data-format'] === 'legal') attrs.format = 'legal';
  return [{ type: 'orderedList', ...(Object.keys(attrs).length ? { attrs } : {}), content }];
}

const hasCheckbox = (li: HNode): boolean => li.attrs['data-checked'] !== undefined || elementsOf(li).some((c) => c.tag === 'input' && c.attrs.type === 'checkbox');

function tableOf(ctx: HtmlCtx, t: HNode): JSONContent[] {
  if (ctx.depth >= MAX_NESTING) {
    ctx.warnings.add('nesting', (c) => `${plural(c, 'table')} nested too deeply ${c === 1 ? 'was' : 'were'} left out.`);
    return [];
  }
  const rows: HNode[] = [];
  const gather = (n: HNode) => {
    for (const c of elementsOf(n)) {
      if (c.tag === 'tr') rows.push(c);
      else if (c.tag === 'thead' || c.tag === 'tbody' || c.tag === 'tfoot') gather(c);
    }
  };
  gather(t);
  ctx.depth++;
  const out: JSONContent[] = [];
  for (const tr of rows) {
    const cells: JSONContent[] = [];
    for (const td of elementsOf(tr)) {
      if (td.tag !== 'td' && td.tag !== 'th') continue;
      let content = blocksOf(ctx, td.children);
      if (content.length === 0) content = [{ type: 'paragraph' }];
      if (content[content.length - 1]?.type === 'table') content.push({ type: 'paragraph' });
      const attrs: Record<string, unknown> = {};
      const cs = Number(td.attrs.colspan);
      const rs = Number(td.attrs.rowspan);
      if (Number.isInteger(cs) && cs > 1 && cs <= 100) attrs.colspan = cs;
      if (Number.isInteger(rs) && rs > 1 && rs <= 1000) attrs.rowspan = rs;
      const bg = cssColor(td.attrs['data-bg'] ?? parseStyle(td.attrs.style)['background-color'] ?? td.attrs.bgcolor);
      if (bg && bg !== '#ffffff') attrs.backgroundColor = bg;
      cells.push({ type: td.tag === 'th' ? 'tableHeader' : 'tableCell', ...(Object.keys(attrs).length ? { attrs } : {}), content });
    }
    if (cells.length > 0) out.push({ type: 'tableRow', content: cells });
  }
  ctx.depth--;
  return out.length > 0 ? [{ type: 'table', content: out }] : [];
}

// ── entry point ─────────────────────────────────────────────────────────────

export function readHtml(source: string): ImportResult {
  const { root, title } = parseHtml(source);
  const ctx = newHtmlCtx();
  const body = findFirst(root, 'body') ?? root;
  const content = blocksOf(ctx, body.children);
  void decodeEntities;
  return {
    model: { body: doc(content), page: null, header: {}, footer: {} },
    images: ctx.images,
    comments: [],
    title,
    warnings: ctx.warnings.list()
  };
}
