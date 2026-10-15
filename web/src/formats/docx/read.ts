/**
 * docx to a Docs document.
 *
 * The reader is ours (fflate and saxes, no DOM) and produces this editor's ProseMirror JSON
 * directly. It reads what the editor can hold, and says once what it left out:
 *
 *   body             paragraphs, headings, the named styles, lists, tables with merged
 *                    cells, pictures, links, footnotes, page breaks, a table of contents
 *   formatting       fonts, sizes, colours, highlights, bold/italic/underline/strike,
 *                    sub/superscript, alignment, line and paragraph spacing, indent
 *   the page         the first section's paper, orientation and margins, and its headers
 *                    and footers with their page-number fields
 *   review           w:ins and w:del as the editor's suggestion marks; comments, with
 *                    their ranges and replies, for the page to post once the document exists
 *
 * ── Style ───────────────────────────────────────────────────────────────────
 * The editor's paragraph styles are a fixed set, so a Word style is mapped onto one
 * (styles.ts) and, for a paragraph in an ordinary style, what the style looks like is
 * baked into the paragraph. A heading, title or quote keeps the editor's look and only
 * what was written on it directly: Word's blue 16pt Heading 1 does not come across, because
 * the same "Heading 1" in this editor is not that.
 *
 * ── Pictures ────────────────────────────────────────────────────────────────
 * A picture is a block here, so a paragraph with a picture in the middle of its text is cut
 * in three. The node carries `src: "import:<n>"` until the page has stored the picture as
 * an asset of the new document and swapped in its URL.
 *
 * ── Untrusted input ─────────────────────────────────────────────────────────
 * Every address that comes out of the file passes `isSafeHref`; no address goes in; every
 * picture is sniffed by its bytes and kept only if it is PNG, JPEG, GIF or WebP. Nothing is
 * fetched. Text is taken as text: no markup in a file can reach the page as markup.
 */

import { isSafeHref } from '../../docs/core/links';
import { canonicalFamily, DEFAULT_FONT, DEFAULT_SIZE } from '../../docs/core/fonts';
import { safeColor, safeFontSize, safeLineHeight, safeSpace } from '../../docs/core/sanitize';
import { defaultSetup, marginsFit, PAPER, PAPER_SIZES, type PaperSize } from '../../docs/pagination/setup';
import { FormatError } from '../errors';
import { IMAGE_MIMES, MAX_COMMENT_MESSAGES, MAX_IMAGES, MAX_NESTING } from '../limits';
import { doc, headingEntries, mergeText, para, text as textNode } from '../model';
import {
  IMAGE_TOKEN_PREFIX,
  plural,
  Warnings,
  type HeaderFooterModel,
  type ImageData,
  type ImportedComment,
  type ImportResult,
  type JSONContent,
  type MarkJSON,
  type PageModel
} from '../types';
import { assetMimeOf } from '../images';
import { child, childrenNamed, descendants, elements, textContent, type XNode } from '../xml';
import { Numbering, type LevelInfo } from './numbering';
import { Package, type Rel } from './package';
import { merge, onOff, parsePPr, parseRPr, twipsToMm, twipsToPt, emuToPx, type ParaProps, type RunProps, type ThemeFonts } from './props';
import { StyleSheet, themeFonts, type BlockClass } from './styles';

// ── context ─────────────────────────────────────────────────────────────────

interface Field {
  instr: string;
  phase: 'instr' | 'result';
  kind: 'hyperlink' | 'toc' | 'page' | 'pages' | 'date' | 'title' | 'other';
  href: string | null;
  hideResult: boolean;
  /** A legacy form checkbox: ticked or not. */
  checkbox?: boolean;
}

interface Change {
  kind: 'ins' | 'del';
  author: string;
  at: number | null;
  id: string;
}

interface Section {
  page: PageModel;
  titlePg: boolean;
  headers: Partial<Record<'default' | 'first', string>>;
  footers: Partial<Record<'default' | 'first', string>>;
}

interface CommentRecord {
  id: string;
  author: string;
  at: number | null;
  paragraphs: string[];
  paraId: string | null;
}

interface Ctx {
  pkg: Package;
  /** The part being read, for resolving relationship ids. */
  part: string;
  rels: Map<string, Rel>;
  styles: StyleSheet;
  numbering: Numbering;
  theme: ThemeFonts;
  warnings: Warnings;
  /** Header and footer parts use a smaller schema and have fields. */
  mode: 'body' | 'hf';
  images: Map<string, ImageData>;
  imageTokens: Map<string, string>;
  footnotes: Map<string, string>;
  comments: Map<string, CommentRecord>;
  commentParents: Map<string, string>;
  commentDone: Set<string>;
  ranges: Map<string, { start?: number; end?: number }>;
  fields: Field[];
  /** Characters of text written so far. */
  offset: number;
  sections: Section[];
  /** The page break after a section's last paragraph, until the next section says how it begins. */
  pendingBreak: Item | null;
  lastDel: Change | null;
  changeSeq: number;
  /** Nesting of tables and quotes being read, against `MAX_NESTING`. */
  depth: number;
}

// ── small helpers ───────────────────────────────────────────────────────────

const attr = (n: XNode | null | undefined, name: string): string | undefined => n?.attrs[name];

/** The branch of `mc:AlternateContent` to read: the first choice, else the fallback. */
function alternate(n: XNode): XNode[] {
  const choice = child(n, 'mc:Choice');
  if (choice) return elements(choice);
  const fallback = child(n, 'mc:Fallback');
  return fallback ? elements(fallback) : [];
}

const parseDate = (v: string | undefined): number | null => {
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
};

function suggestionId(ctx: Ctx, author: string, wid: string | undefined): string {
  // Stable for the same change in the same file, so a re-import gives the same ids.
  let h = 2166136261;
  for (const ch of `${author}|${wid ?? ctx.changeSeq}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  ctx.changeSeq++;
  return `s${h.toString(36).padStart(7, '0')}${ctx.changeSeq.toString(36).padStart(3, '0')}`.slice(0, 12);
}

function changeOf(ctx: Ctx, n: XNode, kind: 'ins' | 'del'): Change {
  const author = attr(n, 'w:author') ?? 'Unknown';
  const at = parseDate(attr(n, 'w:date'));
  // A replacement is a deletion and an insertion by the same hand at the same moment; the
  // editor calls that one suggestion ("Replaced").
  const pair = kind === 'ins' && ctx.lastDel && ctx.lastDel.author === author && ctx.lastDel.at === at ? ctx.lastDel : null;
  const id = pair ? pair.id : suggestionId(ctx, author, attr(n, 'w:id'));
  const change = { kind, author, at, id };
  ctx.lastDel = kind === 'del' ? change : null;
  return change;
}

// ── marks ───────────────────────────────────────────────────────────────────

/** In this order, so equal sets of marks compare equal and neighbouring text merges. */
const MARK_ORDER = ['link', 'bold', 'italic', 'underline', 'strike', 'subscript', 'superscript', 'textStyle', 'highlight', 'insertion', 'deletion'];

function marksFor(ctx: Ctx, eff: RunProps, link: string | null, change: Change | null): MarkJSON[] {
  const marks: MarkJSON[] = [];
  const push = (m: MarkJSON) => marks.push(m);
  if (ctx.mode === 'hf') {
    if (eff.bold) push({ type: 'bold' });
    if (eff.italic) push({ type: 'italic' });
    if (eff.underline) push({ type: 'underline' });
    return marks;
  }
  if (link) push({ type: 'link', attrs: { href: link } });
  if (eff.bold) push({ type: 'bold' });
  if (eff.italic) push({ type: 'italic' });
  if (eff.underline) push({ type: 'underline' });
  if (eff.strike) push({ type: 'strike' });
  if (eff.vertAlign === 'subscript') push({ type: 'subscript' });
  if (eff.vertAlign === 'superscript') push({ type: 'superscript' });

  const style: Record<string, string> = {};
  const family = eff.font ? canonicalFamily(eff.font) : null;
  if (family && family !== DEFAULT_FONT) style.fontFamily = family;
  const size = eff.size !== undefined && eff.size !== DEFAULT_SIZE ? safeFontSize(`${eff.size}pt`) : null;
  if (size) style.fontSize = size;
  const color = eff.color ? safeColor(eff.color) : null;
  // Black is "automatic" in almost every document, and a mark for it would fight the theme.
  if (color && color !== '#000000') style.color = color;
  if (Object.keys(style).length > 0) push({ type: 'textStyle', attrs: style });

  const hl = eff.highlight ? safeColor(eff.highlight) : null;
  if (hl) push({ type: 'highlight', attrs: { color: hl } });

  if (change) {
    push({
      type: change.kind === 'ins' ? 'insertion' : 'deletion',
      attrs: { id: change.id, authorId: `imported:${change.author}`.slice(0, 80), authorName: change.author.slice(0, 80), at: change.at ?? 0 }
    });
  }
  return marks.sort((a, b) => MARK_ORDER.indexOf(a.type ?? '') - MARK_ORDER.indexOf(b.type ?? ''));
}

// ── fields ──────────────────────────────────────────────────────────────────

function classifyField(instr: string): { kind: Field['kind']; href: string | null } {
  const text = instr.trim();
  const word = text.split(/\s+/)[0]?.toUpperCase() ?? '';
  if (word === 'HYPERLINK') {
    // HYPERLINK "https://…" \o "tip"; `\l` is a place in this document.
    if (/\\l\s/i.test(`${text} `)) return { kind: 'hyperlink', href: null };
    const quoted = /HYPERLINK\s+"([^"]*)"/i.exec(text);
    const bare = /HYPERLINK\s+([^\s\\"]+)/i.exec(text);
    return { kind: 'hyperlink', href: quoted?.[1] ?? bare?.[1] ?? null };
  }
  if (word === 'TOC') return { kind: 'toc', href: null };
  if (word === 'PAGE') return { kind: 'page', href: null };
  if (word === 'NUMPAGES' || word === 'SECTIONPAGES') return { kind: 'pages', href: null };
  if (word === 'DATE' || word === 'TIME' || word === 'SAVEDATE' || word === 'CREATEDATE' || word === 'PRINTDATE') return { kind: 'date', href: null };
  if (word === 'TITLE' || (word === 'DOCPROPERTY' && /title/i.test(text))) return { kind: 'title', href: null };
  return { kind: 'other', href: null };
}

const insideToc = (ctx: Ctx): boolean => ctx.fields.some((f) => f.kind === 'toc' && f.phase === 'result');
/** Text that is a field's instruction, or a result we replace with a node, is not text. */
const hidden = (ctx: Ctx): boolean => ctx.fields.some((f) => f.phase === 'instr' || (f.phase === 'result' && (f.kind === 'toc' || f.hideResult)));
const activeLink = (ctx: Ctx): string | null => {
  for (let i = ctx.fields.length - 1; i >= 0; i--) {
    const f = ctx.fields[i]!;
    if (f.kind === 'hyperlink' && f.phase === 'result') return f.href && isSafeHref(f.href) ? f.href : null;
  }
  return null;
};

// ── paragraphs: inline content ──────────────────────────────────────────────

/** What a paragraph is being built from. */
interface Para {
  cls: BlockClass;
  /** Run properties every run starts from. */
  base: RunProps;
  /** Finished pieces: runs of inline content, and block nodes (a picture, a page break) between them. */
  pieces: (JSONContent[] | JSONContent)[];
  cur: JSONContent[];
  /** Blocks to place after the paragraph: the paragraphs of a text box. */
  after: JSONContent[];
  /** The paragraph began inside a table-of-contents field. */
  inToc: boolean;
  /** A node made the paragraph worth keeping even with no text. */
  kept: boolean;
  /** Characters of text in `after`, not yet counted. */
  deferred: number;
}

function flush(p: Para): void {
  if (p.cur.length > 0) p.pieces.push(mergeText(p.cur));
  p.cur = [];
}

function pushBlock(p: Para, block: JSONContent): void {
  flush(p);
  p.pieces.push(block);
}

function emitText(ctx: Ctx, p: Para, value: string, marks: MarkJSON[]): void {
  if (value === '') return;
  p.cur.push(textNode(value, marks));
  ctx.offset += value.length;
}

interface RunContext {
  link: string | null;
  change: Change | null;
}

function inlineChildren(ctx: Ctx, n: XNode, p: Para, rc: RunContext): void {
  for (const c of elements(n)) inlineNode(ctx, c, p, rc);
}

function inlineNode(ctx: Ctx, n: XNode, p: Para, rc: RunContext): void {
  switch (n.name) {
    case 'w:r':
      return run(ctx, n, p, rc);
    case 'w:hyperlink': {
      const rel = attr(n, 'r:id') ? ctx.rels.get(attr(n, 'r:id')!) : undefined;
      // Only an external address that passes the policy is a link; an anchor is a place in
      // this document, and the editor has no bookmarks to point at.
      const href = rel?.external && isSafeHref(rel.target) ? rel.target : null;
      if (rel?.external && !href) ctx.warnings.add('link', (c) => `${plural(c, 'link')} to addresses that are not web or mail addresses ${c === 1 ? 'was' : 'were'} left as text.`);
      return inlineChildren(ctx, n, p, { ...rc, link: href });
    }
    case 'w:ins':
    case 'w:moveTo':
      return inlineChildren(ctx, n, p, { ...rc, change: changeOf(ctx, n, 'ins') });
    case 'w:del':
    case 'w:moveFrom':
      return inlineChildren(ctx, n, p, { ...rc, change: changeOf(ctx, n, 'del') });
    case 'w:fldSimple': {
      const { kind, href } = classifyField(attr(n, 'w:instr') ?? '');
      if (ctx.mode === 'hf' && (kind === 'page' || kind === 'pages' || kind === 'date' || kind === 'title')) {
        p.cur.push({ type: 'pageField', attrs: { kind } });
        return;
      }
      if (kind === 'toc') return;
      return inlineChildren(ctx, n, p, kind === 'hyperlink' ? { ...rc, link: href && isSafeHref(href) ? href : null } : rc);
    }
    case 'w:smartTag':
    case 'w:customXml':
    case 'w:bdo':
    case 'w:dir':
      return inlineChildren(ctx, n, p, rc);
    case 'w:sdt': {
      const content = child(n, 'w:sdtContent');
      if (content) inlineChildren(ctx, content, p, rc);
      return;
    }
    case 'mc:AlternateContent':
      for (const c of alternate(n)) inlineNode(ctx, c, p, rc);
      return;
    case 'w:commentRangeStart': {
      const id = attr(n, 'w:id');
      if (id !== undefined) ctx.ranges.set(id, { ...ctx.ranges.get(id), start: ctx.offset });
      return;
    }
    case 'w:commentRangeEnd': {
      const id = attr(n, 'w:id');
      if (id !== undefined) ctx.ranges.set(id, { ...ctx.ranges.get(id), end: ctx.offset });
      return;
    }
    case 'm:oMath':
    case 'm:oMathPara': {
      const t = descendants(n, 'm:t').map(textContent).join('');
      if (t) {
        ctx.warnings.add('math', (c) => `${plural(c, 'equation')} ${c === 1 ? 'was' : 'were'} imported as plain text.`);
        emitText(ctx, p, t, []);
      }
      return;
    }
    default:
      return;
  }
}

/** The run's effective properties, and the marks they come to. */
function runMarks(ctx: Ctx, r: XNode, p: Para, rc: RunContext, link: string | null): MarkJSON[] | null {
  const rPr = child(r, 'w:rPr');
  const direct = parseRPr(rPr, ctx.theme);
  const styleId = attr(child(rPr, 'w:rStyle'), 'w:val');
  let fromStyle = styleId ? ctx.styles.characterRun(styleId) : {};
  // The Hyperlink character style paints text blue and underlined; the editor draws links
  // itself, and text whose link was refused should not look like one.
  if (link || (styleId && /^hyperlink$/i.test(styleId))) fromStyle = { ...fromStyle, color: undefined, underline: undefined };
  const eff = merge(merge(p.base, fromStyle), direct);
  if (eff.hidden) return null;
  return marksFor(ctx, eff, link, rc.change);
}

function run(ctx: Ctx, r: XNode, p: Para, rc: RunContext): void {
  const link = rc.link ?? activeLink(ctx);
  let marks: MarkJSON[] | null | undefined;
  const getMarks = (): MarkJSON[] | null => (marks === undefined ? (marks = runMarks(ctx, r, p, rc, link)) : marks);

  for (const c of elements(r)) {
    switch (c.name) {
      case 'w:fldChar': {
        const t = attr(c, 'w:fldCharType');
        if (t === 'begin') {
          const box = child(child(c, 'w:ffData'), 'w:checkBox');
          const ticked = box ? (onOff(child(box, 'w:checked')) ?? onOff(child(box, 'w:default')) ?? false) : undefined;
          ctx.fields.push({ instr: '', phase: 'instr', kind: 'other', href: null, hideResult: false, ...(ticked !== undefined ? { checkbox: ticked } : {}) });
        }
        else if (t === 'separate') settleField(ctx, p);
        else if (t === 'end') {
          // A field with no result part (the `docx` package writes them so) is settled where it ends.
          if (ctx.fields[ctx.fields.length - 1]?.phase === 'instr') settleField(ctx, p);
          ctx.fields.pop();
        }
        break;
      }
      case 'w:instrText':
      case 'w:delInstrText': {
        const f = ctx.fields[ctx.fields.length - 1];
        if (f && f.phase === 'instr') f.instr += textContent(c);
        break;
      }
      case 'w:t':
      case 'w:delText': {
        if (hidden(ctx)) break;
        const m = getMarks();
        if (m) emitText(ctx, p, textContent(c), m);
        break;
      }
      case 'w:tab':
      case 'w:ptab': {
        if (hidden(ctx)) break;
        const m = getMarks();
        if (m) emitText(ctx, p, '\t', m);
        break;
      }
      case 'w:noBreakHyphen': {
        if (hidden(ctx)) break;
        const m = getMarks();
        if (m) emitText(ctx, p, '‑', m);
        break;
      }
      case 'w:sym': {
        if (hidden(ctx)) break;
        const ch = symbolChar(attr(c, 'w:char'));
        const m = getMarks();
        if (ch && m) emitText(ctx, p, ch, m);
        break;
      }
      case 'w:br':
      case 'w:cr': {
        if (hidden(ctx)) break;
        const type = attr(c, 'w:type');
        if (c.name === 'w:br' && type === 'page') {
          if (ctx.mode === 'body') pushBlock(p, { type: 'pageBreak' });
        } else {
          p.cur.push({ type: 'hardBreak' });
        }
        break;
      }
      case 'w:drawing':
      case 'w:pict':
      case 'w:object':
        if (!hidden(ctx)) drawing(ctx, c, p);
        break;
      case 'mc:AlternateContent':
        for (const a of alternate(c)) {
          if (a.name === 'w:drawing' || a.name === 'w:pict') {
            if (!hidden(ctx)) drawing(ctx, a, p);
          }
        }
        break;
      case 'w:footnoteReference':
      case 'w:endnoteReference': {
        if (hidden(ctx) || ctx.mode !== 'body') break;
        const id = attr(c, 'w:id');
        const noteText = id !== undefined ? ctx.footnotes.get(`${c.name === 'w:endnoteReference' ? 'e' : ''}${id}`) : undefined;
        if (noteText) {
          p.cur.push({ type: 'footnote', content: [textNode(noteText)] });
          ctx.offset += noteText.length;
        }
        break;
      }
      default:
        break;
    }
  }
}

/** The instruction is complete: say what the field is, and put a node where a field of ours stands. */
function settleField(ctx: Ctx, p: Para): void {
  const f = ctx.fields[ctx.fields.length - 1];
  if (!f) return;
  f.phase = 'result';
  const info = classifyField(f.instr);
  f.kind = info.kind;
  f.href = info.href;
  if (f.checkbox !== undefined && ctx.mode === 'body') {
    // A form checkbox is its box: ☐ or ☒.
    emitText(ctx, p, f.checkbox ? '☒' : '☐', []);
    f.hideResult = true;
  } else if (info.kind === 'toc' && ctx.mode === 'body') {
    pushBlock(p, { type: 'tableOfContents', attrs: { entries: '[]' } });
    p.kept = true;
  } else if (ctx.mode === 'hf' && (info.kind === 'page' || info.kind === 'pages' || info.kind === 'date' || info.kind === 'title')) {
    p.cur.push({ type: 'pageField', attrs: { kind: info.kind } });
    f.hideResult = true;
  }
}

/** Word's Symbol and Wingdings bullets live in the private-use area. A few are common. */
const SYMBOLS: Record<number, string> = { 0xf0b7: '•', 0xf0a7: '▪', 0xf076: '❖', 0xf0d8: '➢', 0xf0fc: '✓', 0xf0a8: '○', 0xf06c: '●', 0xf0a0: ' ' };
function symbolChar(hex: string | undefined): string | null {
  if (!hex || !/^[0-9a-f]{4}$/i.test(hex)) return null;
  const code = parseInt(hex, 16);
  return SYMBOLS[code] ?? (code >= 0x20 && code < 0xf000 ? String.fromCodePoint(code) : null);
}

// ── pictures ────────────────────────────────────────────────────────────────

function drawing(ctx: Ctx, d: XNode, p: Para): void {
  if (ctx.mode === 'hf') {
    ctx.warnings.add('hf-image', (c) => `${plural(c, 'picture')} in headers or footers ${c === 1 ? 'was' : 'were'} left out.`);
    return;
  }
  const blips = [...descendants(d, 'a:blip').map((b) => ({ rel: attr(b, 'r:embed') })), ...descendants(d, 'v:imagedata').map((b) => ({ rel: attr(b, 'r:id') }))];
  if (blips.length === 0) {
    const boxes = descendants(d, 'w:txbxContent');
    if (boxes.length > 0) {
      // A text box's paragraphs come out in order, after the paragraph it was anchored in.
      for (const box of boxes) {
        // The box's paragraphs come after this one in the document, so their text is counted then.
        const start = ctx.offset;
        p.after.push(...blocks(ctx, box));
        p.deferred += ctx.offset - start;
        ctx.offset = start;
      }
      ctx.warnings.add('textbox', (c) => `${plural(c, 'text box', 'text boxes')} ${c === 1 ? 'was' : 'were'} imported as ordinary paragraphs.`);
    } else {
      ctx.warnings.add('shape', (c) => `${plural(c, 'shape or chart', 'shapes and charts')} ${c === 1 ? 'was' : 'were'} left out.`);
    }
    return;
  }
  const extent = descendants(d, 'wp:extent')[0];
  const cx = Number(attr(extent, 'cx'));
  const cy = Number(attr(extent, 'cy'));
  const docPr = descendants(d, 'wp:docPr')[0];
  const alt = (attr(docPr, 'descr') || attr(docPr, 'title') || '').trim();

  for (const b of blips) {
    const rel = b.rel ? ctx.rels.get(b.rel) : undefined;
    const target = ctx.pkg.target(ctx.part, rel);
    if (!target) {
      // An image that lives elsewhere on the web is never fetched.
      ctx.warnings.add('external-image', (c) => `${plural(c, 'picture')} linked from elsewhere ${c === 1 ? 'was' : 'were'} left out.`);
      continue;
    }
    const token = imageToken(ctx, target);
    if (!token) continue;
    const attrs: Record<string, unknown> = { src: token };
    if (alt) attrs.alt = alt.slice(0, 500);
    if (Number.isFinite(cx) && Number.isFinite(cy) && cx > 0 && cy > 0) {
      const w = Math.round(emuToPx(cx));
      const h = Math.round(emuToPx(cy));
      if (w >= 8 && h >= 8 && w <= 6000 && h <= 6000) {
        attrs.width = w;
        attrs.height = h;
      }
    }
    pushBlock(p, { type: 'image', attrs });
    p.kept = true;
  }
}

/** The token for the picture at `path`, reading it once. Null if it cannot be used. */
function imageToken(ctx: Ctx, path: string): string | null {
  const known = ctx.imageTokens.get(path);
  if (known) return known;
  if (ctx.images.size >= MAX_IMAGES) {
    ctx.warnings.add('image-count', (c) => `${plural(c, 'picture')} beyond the first ${MAX_IMAGES} ${c === 1 ? 'was' : 'were'} left out.`);
    return null;
  }
  const bytes = ctx.pkg.bytes(path);
  const mime = bytes ? assetMimeOf(bytes) : null;
  if (!bytes || !mime || !IMAGE_MIMES.includes(mime)) {
    ctx.warnings.add('image-format', (c) => `${plural(c, 'picture')} in a format that cannot be shown ${c === 1 ? 'was' : 'were'} left out.`);
    return null;
  }
  const token = `${IMAGE_TOKEN_PREFIX}${ctx.images.size + 1}`;
  ctx.images.set(token, { bytes, mime, name: path.split('/').pop() ?? 'image' });
  ctx.imageTokens.set(path, token);
  return token;
}

// ── paragraphs ──────────────────────────────────────────────────────────────

interface ListRef {
  /** Which list the paragraph is in. Word's "List Bullet 2" is a list of its own that is meant as a level of "List Bullet". */
  key: string;
  numId: string;
  /** The level in the numbering definition, which says how it counts. */
  ilvl: number;
  /** How deep it nests. */
  level: number;
  /** An indent the paragraph sets itself, which beats the level's. */
  indent: number | undefined;
}

/** A paragraph's blocks, with the list it belongs to. */
interface Item {
  node: JSONContent;
  cls: BlockClass['kind'];
  list?: ListRef;
  /** The paragraph is a section's last: a page break follows unless the next section is continuous. */
  sectionBreak?: boolean;
  /** The next section began continuously, so this section's page break is not one. */
  dropped?: boolean;
  /** The paragraph's style, and whether it asks for no space between paragraphs of that style. */
  style?: { id: string; contextual: boolean };
}

/** A header's paragraph has only an alignment. */
function hfAttrs(eff: ParaProps): Record<string, unknown> {
  return eff.align && eff.align !== 'left' ? { textAlign: eff.align } : {};
}

function paragraphAttrs(eff: ParaProps, fontPt: number, list: boolean): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (eff.align && eff.align !== 'left') out.textAlign = eff.align;
  if (eff.line !== undefined) {
    const h = eff.lineRule === 'auto' || eff.lineRule === undefined ? eff.line / 240 : twipsToPt(eff.line) / fontPt;
    const v = safeLineHeight(Math.round(h * 100) / 100);
    // Single spacing is the editor's own.
    if (v !== null && v !== 1) out.lineHeight = v;
  }
  if (eff.spacingBefore !== undefined && eff.spacingBefore > 0) {
    const v = safeSpace(twipsToPt(eff.spacingBefore));
    if (v !== null && v > 0) out.spaceBefore = v;
  }
  if (eff.spacingAfter !== undefined && eff.spacingAfter > 0) {
    const v = safeSpace(twipsToPt(eff.spacingAfter));
    if (v !== null && v > 0) out.spaceAfter = v;
  }
  // Indent is whole levels of half an inch. A list's own indent is the list's.
  if (!list && eff.indentLeft !== undefined && eff.indentLeft > 0) {
    const levels = Math.min(8, Math.round(eff.indentLeft / 720));
    if (levels > 0) out.indent = levels;
  }
  return out;
}

/** Word's built-in list styles: "List Bullet", "List Number 2". The number is the nesting level. */
const LIST_STYLE = /^list\s*(bullet|number)\s*([2-9])?$/i;

function listRef(ctx: Ctx, styleId: string | null, direct: ParaProps, source: ParaProps): ListRef {
  const ilvl = source.ilvl ?? 0;
  const style = styleId ? ctx.styles.byId.get(styleId) : undefined;
  const m = LIST_STYLE.exec(style?.name ?? styleId ?? '');
  // The list comes from the style, not from the paragraph, when the paragraph names no list of its own.
  if (m && direct.numId === undefined) {
    const nested = m[2] ? Number(m[2]) - 1 : 0;
    return { key: `style:${m[1]!.toLowerCase()}`, numId: source.numId!, ilvl, level: Math.max(ilvl, nested), indent: direct.indentLeft };
  }
  return { key: source.numId!, numId: source.numId!, ilvl, level: ilvl, indent: direct.indentLeft };
}

function paragraph(ctx: Ctx, pn: XNode): { items: Item[]; markChange: Change | null } {
  const pPr = child(pn, 'w:pPr');
  const styleId = attr(child(pPr, 'w:pStyle'), 'w:val') ?? null;
  const direct = parsePPr(pPr);
  const cls: BlockClass = ctx.mode === 'hf' ? { kind: 'normal' } : ctx.styles.classify(styleId);
  const named = cls.kind !== 'normal';

  // Normal text takes everything the style says; a heading or a title keeps the editor's
  // look, and only its font family (so a document set in Georgia stays in Georgia).
  const chainRun = ctx.styles.paragraphRun(styleId);
  const base: RunProps = named
    ? { font: merge(ctx.styles.docRun, chainRun).font ?? null }
    : merge(ctx.styles.docRun, chainRun);
  const effPara = named ? direct : merge(merge(ctx.styles.docPara, ctx.styles.paragraphProps(styleId)), direct);
  // Numbering comes from the paragraph or, failing that, its style.
  const numSource = merge(ctx.styles.paragraphProps(styleId), direct);

  const p: Para = { cls, base, pieces: [], cur: [], after: [], inToc: insideToc(ctx), kept: false, deferred: 0 };
  const startedInToc = p.inToc;
  inlineChildren(ctx, pn, p, { link: null, change: null });
  flush(p);
  ctx.offset += p.deferred;

  const items: Item[] = [];
  const fontPt = base.size ?? DEFAULT_SIZE;

  if (direct.pageBreakBefore && ctx.mode === 'body') items.push({ node: { type: 'pageBreak' }, cls: 'normal' });

  const hasContent = p.pieces.some((x) => (Array.isArray(x) ? x.length > 0 : true));
  const hasBlocks = p.pieces.some((x) => !Array.isArray(x));
  if (startedInToc && !p.kept && !hasContent) return { items, markChange: null };

  const list: ListRef | null =
    ctx.mode === 'body' && numSource.numId !== undefined && numSource.numId !== '0' && (cls.kind === 'normal' || cls.kind === 'quote')
      ? listRef(ctx, styleId, direct, numSource)
      : null;
  const attrs = ctx.mode === 'hf' ? hfAttrs(effPara) : paragraphAttrs(effPara, fontPt, list !== null);
  if (cls.kind === 'title' || cls.kind === 'subtitle' || cls.kind === 'nospacing') attrs.paraStyle = cls.kind;

  const make = (inline: JSONContent[]): JSONContent => {
    if (cls.kind === 'heading') return { type: 'heading', attrs: { level: cls.level, ...attrs }, ...(inline.length ? { content: inline } : {}) };
    return para(inline, attrs);
  };

  if (!hasBlocks) {
    const inline = (p.pieces[0] as JSONContent[] | undefined) ?? [];
    const node = make(inline);
    items.push({ node, cls: cls.kind, ...(list ? { list } : {}), style: { id: styleId ?? '', contextual: effPara.contextual === true } });
  } else {
    // A picture or a page break in the middle: the text on either side is a paragraph of its own.
    const align = attrs.textAlign;
    for (const piece of p.pieces) {
      if (Array.isArray(piece)) {
        if (piece.length > 0) items.push({ node: make(piece), cls: cls.kind });
      } else {
        const node = piece.type === 'image' && align ? { ...piece, attrs: { ...piece.attrs, align } } : piece;
        items.push({ node, cls: 'normal' });
      }
    }
  }
  for (const block of p.after) items.push({ node: block, cls: 'normal' });

  const sect = child(pPr, 'w:sectPr');
  if (sect && ctx.mode === 'body') {
    recordSection(ctx, sect);
    // How a section *begins* is its own `w:type`; this break is decided by the next one.
    const brk: Item = { node: { type: 'pageBreak' }, cls: 'normal', sectionBreak: true };
    items.push(brk);
    ctx.pendingBreak = brk;
  }

  const rPr = child(pPr, 'w:rPr');
  const insMark = child(rPr, 'w:ins');
  const delMark = child(rPr, 'w:del');
  const markChange = insMark ? changeOf(ctx, insMark, 'ins') : delMark ? changeOf(ctx, delMark, 'del') : null;
  return { items, markChange };
}

// ── tables ──────────────────────────────────────────────────────────────────

function table(ctx: Ctx, tbl: XNode): JSONContent | null {
  if (ctx.depth >= MAX_NESTING) {
    ctx.warnings.add('nesting', (c) => `${plural(c, 'table')} nested too deeply ${c === 1 ? 'was' : 'were'} left out.`);
    return null;
  }
  const grid = childrenNamed(child(tbl, 'w:tblGrid'), 'w:gridCol').map((g) => Number(g.attrs['w:w']) || 0);
  const rows = childrenNamed(tbl, 'w:tr');

  // Which cells a vertical merge continues, so the cell that started it can span them.
  interface Cell {
    node: XNode;
    col: number;
    span: number;
    vmerge: 'restart' | 'continue' | null;
    rowspan: number;
  }
  const grid2: Cell[][] = rows.map((tr) => {
    const trPr = child(tr, 'w:trPr');
    let col = Number(attr(child(trPr, 'w:gridBefore'), 'w:val')) || 0;
    const cells: Cell[] = [];
    for (const tc of childrenNamed(tr, 'w:tc')) {
      const tcPr = child(tc, 'w:tcPr');
      const span = Math.max(1, Number(attr(child(tcPr, 'w:gridSpan'), 'w:val')) || 1);
      const vm = child(tcPr, 'w:vMerge');
      const vmerge = vm ? (attr(vm, 'w:val') === 'restart' ? 'restart' : 'continue') : null;
      cells.push({ node: tc, col, span, vmerge, rowspan: 1 });
      col += span;
    }
    return cells;
  });
  for (let r = 0; r < grid2.length; r++) {
    for (const cell of grid2[r]!) {
      if (cell.vmerge !== 'restart') continue;
      for (let k = r + 1; k < grid2.length; k++) {
        const below = grid2[k]!.find((c) => c.col === cell.col);
        if (!below || below.vmerge !== 'continue') break;
        cell.rowspan++;
      }
    }
  }

  const out: JSONContent[] = [];
  rows.forEach((tr, r) => {
    const header = onOff(child(child(tr, 'w:trPr'), 'w:tblHeader')) === true;
    const cells: JSONContent[] = [];
    for (const cell of grid2[r]!) {
      if (cell.vmerge === 'continue') continue;
      const tcPr = child(cell.node, 'w:tcPr');
      ctx.depth++;
      let content = blocks(ctx, cell.node);
      ctx.depth--;
      if (content.length === 0) content = [{ type: 'paragraph' }];
      // A cell cannot end in a table: the editor needs a paragraph to put a caret in.
      if (content[content.length - 1]?.type === 'table') content.push({ type: 'paragraph' });
      const attrs: Record<string, unknown> = {};
      if (cell.span > 1) attrs.colspan = cell.span;
      if (cell.rowspan > 1) attrs.rowspan = cell.rowspan;
      const widths = grid.slice(cell.col, cell.col + cell.span);
      if (widths.length === cell.span && widths.every((w) => w > 0)) attrs.colwidth = widths.map((w) => Math.max(8, Math.round(w / 15)));
      const fill = attr(child(tcPr, 'w:shd'), 'w:fill');
      const bg = fill && fill !== 'auto' ? safeColor(`#${fill.toLowerCase()}`) : null;
      if (bg) attrs.backgroundColor = bg;
      cells.push({ type: header ? 'tableHeader' : 'tableCell', ...(Object.keys(attrs).length ? { attrs } : {}), content });
    }
    if (cells.length > 0) out.push({ type: 'tableRow', content: cells });
  });
  if (out.length === 0) return null;
  return { type: 'table', content: out };
}

// ── blocks ──────────────────────────────────────────────────────────────────

/** The blocks inside `container`: a body, a cell, a text box. Lists are folded together at the end. */
function blocks(ctx: Ctx, container: XNode): JSONContent[] {
  const items: Item[] = [];
  collect(ctx, container, items);
  tighten(items);
  return fold(ctx, items);
}

function collect(ctx: Ctx, container: XNode, items: Item[]): void {
  let pending: Change | null = null;
  for (const n of elements(container)) {
    switch (n.name) {
      case 'w:p': {
        const r = paragraph(ctx, n);
        if (pending) {
          // The break before this paragraph was proposed (or proposed away) by the previous one's mark.
          const first = r.items.find((i) => i.node.type === 'paragraph' || i.node.type === 'heading');
          if (first) {
            first.node = {
              ...first.node,
              attrs: {
                ...first.node.attrs,
                suggest: {
                  kind: pending.kind === 'ins' ? 'split' : 'join',
                  id: pending.id,
                  authorId: `imported:${pending.author}`.slice(0, 80),
                  authorName: pending.author.slice(0, 80),
                  at: pending.at ?? 0
                }
              }
            };
          }
        }
        pending = r.markChange;
        items.push(...r.items);
        break;
      }
      case 'w:tbl': {
        const t = table(ctx, n);
        if (t) items.push({ node: t, cls: 'normal' });
        pending = null;
        break;
      }
      case 'w:sdt': {
        const content = child(n, 'w:sdtContent');
        if (!content) break;
        const gallery = attr(descendants(child(n, 'w:sdtPr') ?? n, 'w:docPartGallery')[0], 'w:val');
        if (ctx.mode === 'body' && gallery === 'Table of Contents') {
          items.push({ node: { type: 'tableOfContents', attrs: { entries: '[]' } }, cls: 'normal' });
          break;
        }
        collect(ctx, content, items);
        break;
      }
      case 'w:ins':
      case 'w:del':
      case 'w:moveFrom':
      case 'w:moveTo':
      case 'w:customXml':
      case 'w:smartTag':
        collect(ctx, n, items);
        break;
      case 'mc:AlternateContent': {
        const holder: XNode = { name: 'x', attrs: {}, children: alternate(n), parent: null };
        collect(ctx, holder, items);
        break;
      }
      case 'w:sectPr':
        if (ctx.mode === 'body') recordSection(ctx, n);
        break;
      case 'w:altChunk':
        ctx.warnings.add('altchunk', (c) => `${plural(c, 'embedded document')} ${c === 1 ? 'was' : 'were'} left out.`);
        break;
      default:
        break;
    }
  }
}

/**
 * "Don't add space between paragraphs of the same style", which is how Word keeps a list's items
 * together although their style has space after. The editor has no such rule, so the space that
 * rule removes is taken out of the paragraphs it removes it between.
 */
function tighten(items: Item[]): void {
  const same = (a: Item | undefined, b: Item | undefined): boolean => !!a?.style && !!b?.style && a.style.id === b.style.id && a.style.contextual && b.style.contextual;
  items.forEach((item, i) => {
    const attrs = item.node.attrs;
    if (!attrs || !item.style) return;
    if (same(item, items[i + 1])) delete attrs.spaceAfter;
    if (same(items[i - 1], item)) delete attrs.spaceBefore;
  });
}

// ── folding items into lists, quotes and code ───────────────────────────────

interface OpenList {
  numId: string;
  level: number;
  /** Where its items sit, in twips. */
  indent: number;
  /** How far in it was put beyond its own level, when it was nested by indent. */
  offset: number;
  bullet: boolean;
  node: JSONContent;
  last: JSONContent | null;
}

function fold(ctx: Ctx, items: Item[]): JSONContent[] {
  const out: JSONContent[] = [];
  const counters = new Map<string, number>();
  let stack: OpenList[] = [];
  let quote = null as JSONContent | null;
  let code = null as string[] | null;

  const closeAll = () => {
    stack = [];
    quote = null;
    code = null;
  };

  for (const item of items) {
    if (item.dropped) continue;
    const node = item.node;

    if (item.cls === 'code' && node.type === 'paragraph') {
      stack = [];
      quote = null;
      const lines = textLines(node);
      if (code) {
        code.push(lines);
        // The open code block is the last node in `out`.
        out[out.length - 1] = codeBlock(code);
      } else {
        code = [lines];
        out.push(codeBlock(code));
      }
      continue;
    }
    code = null;

    if (item.cls === 'quote' && !item.list && node.type === 'paragraph') {
      stack = [];
      if (quote) {
        quote = { ...quote, content: [...(quote.content ?? []), node] };
        out[out.length - 1] = quote;
      } else {
        quote = { type: 'blockquote', content: [node] };
        out.push(quote);
      }
      continue;
    }
    quote = null;

    if (item.list && node.type === 'paragraph') {
      const info = ctx.numbering.level(item.list.numId, item.list.ilvl);
      if (info) {
        listItem(ctx, out, stack, counters, item.list, info, node);
        continue;
      }
    }
    closeAll();
    out.push(node);
  }

  // A section's page break at the very end of the document breaks to nothing.
  while (out.length > 1 && out[out.length - 1]?.type === 'pageBreak' && [...items].reverse().find((i) => !i.dropped)?.sectionBreak) out.pop();
  return out;
}

const textLines = (p: JSONContent): string => (p.content ?? []).map((c) => (c.type === 'text' ? (c.text ?? '') : c.type === 'hardBreak' ? '\n' : '')).join('');

/** Code takes no marks and no hard breaks: its lines are text with newlines. */
const codeBlock = (lines: string[]): JSONContent => {
  const value = lines.join('\n');
  return { type: 'codeBlock', ...(value ? { content: [{ type: 'text', text: value }] } : {}) };
};

/**
 * How deep an item is. Word nests most lists by their levels, but a document can also make a
 * sub-list a list of its own that is simply indented further ("List Bullet 2" does), and what
 * says it is nested is how far in it sits.
 */
function levelOf(stack: OpenList[], ref: ListRef, indent: number): number {
  const top = stack[stack.length - 1];
  if (!top) return ref.level;
  if (ref.key === top.numId) return ref.level + top.offset;
  if (ref.ilvl > 0 || indent === 0) return ref.level;
  for (let i = stack.length - 1; i >= 0; i--) {
    // A little give: two lists meant to line up are rarely exactly level.
    if (stack[i]!.indent > 0 && stack[i]!.indent + 100 < indent) return Math.min(8, stack[i]!.level + 1);
  }
  return ref.level;
}

function listItem(ctx: Ctx, out: JSONContent[], stack: OpenList[], counters: Map<string, number>, ref: ListRef, info: LevelInfo, node: JSONContent): void {
  const indent = ref.indent ?? info.indent;
  const level = Math.max(0, Math.min(levelOf(stack, ref, indent), 8));
  while (stack.length > 0 && stack[stack.length - 1]!.level > level) stack.pop();
  const top = stack[stack.length - 1];
  if (top && top.level === level && (top.numId !== ref.key || top.bullet !== info.bullet)) stack.pop();

  let open = stack[stack.length - 1];
  if (!open || open.level !== level) {
    const attrs: Record<string, unknown> = {};
    if (!info.bullet) {
      const key = `${ref.key}:${level}`;
      const seen = level === 0 ? (counters.get(key) ?? 0) : 0;
      const start = info.start + seen;
      if (start !== 1) attrs.start = start;
      // The editor draws 1. a. i. by depth, so a type is only recorded where the list departs from that.
      const drawn = (['decimal', 'lowerLetter', 'lowerRoman'] as const)[level % 3];
      const type = { lowerLetter: 'a', upperLetter: 'A', lowerRoman: 'i', upperRoman: 'I', decimal: null }[info.format];
      if (type && info.format !== drawn) attrs.type = type;
      // The legal kind is declared on the outermost list, where the editor stores it.
      if (level === 0 && ctx.numbering.level(ref.numId, 1)?.legal) attrs.format = 'legal';
    }
    const list: JSONContent = { type: info.bullet ? 'bulletList' : 'orderedList', ...(Object.keys(attrs).length ? { attrs } : {}), content: [] };
    const parent = stack[stack.length - 1];
    if (parent?.last) parent.last.content = [...(parent.last.content ?? []), list];
    else out.push(list);
    open = { numId: ref.key, level, indent, offset: level - ref.level, bullet: info.bullet, node: list, last: null };
    stack.push(open);
  }
  const item: JSONContent = { type: 'listItem', content: [node] };
  open.node.content = [...(open.node.content ?? []), item];
  open.last = item;
  if (level === 0 && !info.bullet) counters.set(`${ref.key}:0`, (counters.get(`${ref.key}:0`) ?? 0) + 1);
}

// ── page setup and sections ─────────────────────────────────────────────────

/**
 * The paper this editor has that is nearest. Its shape counts for more than its size: a
 * page that is A3 is an A4 that is a size larger, and a page that is Letter is not a Legal
 * that is a little shorter.
 */
function nearestPaper(wMm: number, hMm: number): { size: PaperSize; exact: boolean } {
  const short = Math.min(wMm, hMm);
  const long = Math.max(wMm, hMm);
  let best: PaperSize = 'A4';
  let bestScore = Infinity;
  let bestExact = false;
  for (const s of PAPER_SIZES) {
    const p = PAPER[s];
    const shape = Math.abs(Math.log(long / short / (p.h / p.w)));
    const size = Math.abs(Math.log((short * long) / (p.w * p.h)));
    const score = shape * 4 + size;
    if (score < bestScore) {
      bestScore = score;
      best = s;
      bestExact = Math.abs(p.w - short) / p.w < 0.015 && Math.abs(p.h - long) / p.h < 0.015;
    }
  }
  return { size: best, exact: bestExact };
}

function recordSection(ctx: Ctx, sect: XNode): void {
  if (ctx.pendingBreak) {
    if (attr(child(sect, 'w:type'), 'w:val') === 'continuous') ctx.pendingBreak.dropped = true;
    ctx.pendingBreak = null;
  }
  const pgSz = child(sect, 'w:pgSz');
  const pgMar = child(sect, 'w:pgMar');
  const w = Number(attr(pgSz, 'w:w'));
  const h = Number(attr(pgSz, 'w:h'));
  const d = defaultSetup('A4');
  let size: PaperSize = d.size;
  let orientation: PageModel['orientation'] = 'portrait';
  if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
    const mm = { w: twipsToMm(w), h: twipsToMm(h) };
    const found = nearestPaper(mm.w, mm.h);
    size = found.size;
    if (!found.exact) ctx.warnings.add('paper', () => `The page size was changed to ${size}.`);
    orientation = w > h ? 'landscape' : 'portrait';
  }
  const margin = (name: string, fallback: number): number => {
    const v = Number(attr(pgMar, name));
    return Number.isFinite(v) ? Math.round(twipsToMm(Math.abs(v)) * 10) / 10 : fallback;
  };
  const margins = {
    top: margin('w:top', d.margins.top),
    right: margin('w:right', d.margins.right),
    bottom: margin('w:bottom', d.margins.bottom),
    left: margin('w:left', d.margins.left)
  };
  const fits = marginsFit({ size, orientation }, margins);
  const refs = (name: 'w:headerReference' | 'w:footerReference'): Partial<Record<'default' | 'first', string>> => {
    const out: Partial<Record<'default' | 'first', string>> = {};
    for (const r of childrenNamed(sect, name)) {
      const type = attr(r, 'w:type');
      const id = attr(r, 'r:id');
      if (id && (type === 'default' || type === 'first')) out[type] = id;
    }
    return out;
  };
  ctx.sections.push({
    page: {
      size,
      orientation,
      margins: fits ? margins : { ...d.margins },
      headerDistance: Math.min(100, margin('w:header', d.headerDistance)),
      footerDistance: Math.min(100, margin('w:footer', d.footerDistance)),
      differentFirst: onOff(child(sect, 'w:titlePg')) === true
    },
    titlePg: onOff(child(sect, 'w:titlePg')) === true,
    headers: refs('w:headerReference'),
    footers: refs('w:footerReference')
  });
}

// ── footnotes, comments, headers ────────────────────────────────────────────

/** A paragraph's text with no formatting: footnotes and comments are read as plain text. */
function plainText(n: XNode): string {
  let out = '';
  const visit = (x: XNode): void => {
    for (const c of elements(x)) {
      switch (c.name) {
        case 'w:t':
          out += textContent(c);
          break;
        case 'w:tab':
          out += ' ';
          break;
        case 'w:br':
        case 'w:cr':
          out += ' ';
          break;
        case 'w:del':
        case 'w:moveFrom':
        case 'w:instrText':
        case 'w:delText':
          break;
        case 'mc:AlternateContent':
        case 'w:drawing':
        case 'w:pict':
          break;
        default:
          visit(c);
      }
    }
  };
  visit(n);
  return out;
}

function readFootnotes(ctx: Ctx, pkg: Package, mainPart: string): void {
  for (const type of ['footnotes', 'endnotes']) {
    const rel = [...ctx.rels.values()].find((r) => r.type === type);
    const part = pkg.target(mainPart, rel);
    const root = part ? pkg.xml(part) : null;
    if (!root) continue;
    for (const f of childrenNamed(root, type === 'footnotes' ? 'w:footnote' : 'w:endnote')) {
      const id = attr(f, 'w:id');
      const kind = attr(f, 'w:type');
      if (id === undefined || (kind && kind !== 'normal')) continue;
      const t = childrenNamed(f, 'w:p')
        .map(plainText)
        .map((s) => s.replace(/\s+/g, ' ').trim())
        .filter(Boolean)
        .join(' ');
      if (t) ctx.footnotes.set(`${type === 'endnotes' ? 'e' : ''}${id}`, t);
    }
  }
}

function readComments(ctx: Ctx, pkg: Package, mainPart: string): void {
  const rel = [...ctx.rels.values()].find((r) => r.type === 'comments');
  const part = pkg.target(mainPart, rel);
  const root = part ? pkg.xml(part) : null;
  if (!root) return;
  const paraIdToComment = new Map<string, string>();
  for (const c of childrenNamed(root, 'w:comment')) {
    const id = attr(c, 'w:id');
    if (id === undefined) continue;
    const ps = childrenNamed(c, 'w:p');
    const paraId = attr(ps[ps.length - 1], 'w14:paraId') ?? null;
    if (paraId) paraIdToComment.set(paraId, id);
    ctx.comments.set(id, {
      id,
      author: (attr(c, 'w:author') ?? '').trim(),
      at: parseDate(attr(c, 'w:date')),
      paragraphs: ps.map((p) => plainText(p).trim()).filter((s, i, all) => s !== '' || i < all.length - 1),
      paraId
    });
  }
  // Replies and "resolved" are in a separate part, keyed by the comment's last paragraph.
  const extRel = [...ctx.rels.values()].find((r) => r.type === 'commentsExtended');
  const extPart = pkg.target(mainPart, extRel);
  const ext = extPart ? pkg.xml(extPart) : null;
  if (ext) {
    for (const e of childrenNamed(ext, 'w15:commentEx')) {
      const own = paraIdToComment.get(attr(e, 'w15:paraId') ?? '');
      if (!own) continue;
      const parent = paraIdToComment.get(attr(e, 'w15:paraIdParent') ?? '');
      if (parent && parent !== own) ctx.commentParents.set(own, parent);
      if (attr(e, 'w15:done') === '1') ctx.commentDone.add(own);
    }
  }
}

function readHeaderFooter(ctx: Ctx, pkg: Package, mainPart: string, relId: string | undefined): JSONContent | null {
  const rel = relId ? ctx.rels.get(relId) : undefined;
  const part = pkg.target(mainPart, rel);
  const root = part ? pkg.xml(part) : null;
  if (!part || !root) return null;
  const saved = { part: ctx.part, rels: ctx.rels, mode: ctx.mode, fields: ctx.fields, offset: ctx.offset };
  ctx.part = part;
  ctx.rels = pkg.rels(part);
  ctx.mode = 'hf';
  ctx.fields = [];
  const out: JSONContent[] = [];
  const walk = (container: XNode): void => {
    for (const n of elements(container)) {
      if (n.name === 'w:p') {
        const r = paragraph(ctx, n);
        for (const it of r.items) if (it.node.type === 'paragraph') out.push(it.node);
      } else if (n.name === 'w:tbl') {
        // A header laid out as a table: its cells' paragraphs, in order.
        for (const tc of descendants(n, 'w:tc')) walk(tc);
      } else if (n.name === 'w:sdt') {
        const c = child(n, 'w:sdtContent');
        if (c) walk(c);
      }
    }
  };
  walk(root);
  const hadContent = (n: JSONContent): boolean => (n.content ?? []).some((c) => c.type === 'pageField' || (c.type === 'text' && (c.text ?? '').trim() !== ''));
  Object.assign(ctx, saved);
  // The comment offset counter is the body's: a header's text must not move it.
  if (!out.some(hadContent)) return null;
  // The editor's header has no page of its own to hold trailing empties.
  while (out.length > 1 && !hadContent(out[out.length - 1]!)) out.pop();
  return doc(out);
}

// ── entry point ─────────────────────────────────────────────────────────────

export function readDocx(bytes: Uint8Array): ImportResult {
  const pkg = Package.open(bytes);
  const mainPart = pkg.mainPart();
  const root = pkg.xml(mainPart);
  if (!root || root.name !== 'w:document') throw new FormatError('not_docx', 'main part is not a document');
  const body = child(root, 'w:body');
  if (!body) throw new FormatError('not_docx', 'no body');

  const rels = pkg.rels(mainPart);
  const themeRel = [...rels.values()].find((r) => r.type === 'theme');
  const themePart = pkg.target(mainPart, themeRel) ?? 'word/theme/theme1.xml';
  const theme = themeFonts(pkg.xml(themePart));
  const stylesRel = [...rels.values()].find((r) => r.type === 'styles');
  const stylesPart = pkg.target(mainPart, stylesRel) ?? 'word/styles.xml';
  const numberingRel = [...rels.values()].find((r) => r.type === 'numbering');
  const numberingPart = pkg.target(mainPart, numberingRel) ?? 'word/numbering.xml';

  const ctx: Ctx = {
    pkg,
    part: mainPart,
    rels,
    styles: new StyleSheet(pkg.xml(stylesPart), theme),
    numbering: new Numbering(pkg.xml(numberingPart)),
    theme,
    warnings: new Warnings(),
    mode: 'body',
    images: new Map(),
    imageTokens: new Map(),
    footnotes: new Map(),
    comments: new Map(),
    commentParents: new Map(),
    commentDone: new Set(),
    ranges: new Map(),
    fields: [],
    offset: 0,
    sections: [],
    pendingBreak: null,
    lastDel: null,
    changeSeq: 0,
    depth: 0
  };

  readFootnotes(ctx, pkg, mainPart);
  readComments(ctx, pkg, mainPart);

  const content = blocks(ctx, body);

  // The table of contents lists the headings the document has, as Word's would on update.
  const entries = JSON.stringify(headingEntries({ type: 'doc', content }));
  const withToc = content.map((n) => (n.type === 'tableOfContents' ? { ...n, attrs: { entries } } : n));
  const bodyDoc = doc(withToc);

  // Page setup and headers come from the first section; later ones that differ are noted.
  const first = ctx.sections[0];
  const header: HeaderFooterModel = {};
  const footer: HeaderFooterModel = {};
  if (first) {
    const set = (target: HeaderFooterModel, key: 'default' | 'first', value: JSONContent | null) => {
      if (value) target[key] = value;
    };
    set(header, 'default', readHeaderFooter(ctx, pkg, mainPart, first.headers.default));
    set(footer, 'default', readHeaderFooter(ctx, pkg, mainPart, first.footers.default));
    if (first.titlePg) {
      set(header, 'first', readHeaderFooter(ctx, pkg, mainPart, first.headers.first));
      set(footer, 'first', readHeaderFooter(ctx, pkg, mainPart, first.footers.first));
    }
    const differs = ctx.sections.some((s) => s.page.size !== first.page.size || s.page.orientation !== first.page.orientation);
    if (differs) ctx.warnings.add('sections', () => 'Later sections use the first section’s paper and orientation.');
  }

  const comments = commentsOf(ctx);
  return {
    model: { body: bodyDoc, page: first ? first.page : null, header, footer },
    images: ctx.images,
    comments,
    title: pkg.coreTitle(),
    warnings: ctx.warnings.list()
  };
}

function commentsOf(ctx: Ctx): ImportedComment[] {
  const out: ImportedComment[] = [];
  let messages = 0;
  for (const c of ctx.comments.values()) {
    if (messages >= MAX_COMMENT_MESSAGES) {
      ctx.warnings.add('comments', (n) => `${plural(n, 'comment')} beyond the first ${MAX_COMMENT_MESSAGES} ${n === 1 ? 'was' : 'were'} left out.`);
      continue;
    }
    const parent = ctx.commentParents.get(c.id) ?? null;
    const range = ctx.ranges.get(c.id) ?? ctx.ranges.get(parent ?? '');
    const start = range?.start ?? range?.end ?? 0;
    const end = range?.end ?? start;
    out.push({
      id: c.id,
      author: c.author,
      at: c.at,
      text: c.paragraphs.join('\n').trim(),
      parent,
      resolved: ctx.commentDone.has(c.id),
      start: Math.min(start, end),
      end: Math.max(start, end)
    });
    messages++;
  }
  return out.filter((c) => c.text !== '');
}
