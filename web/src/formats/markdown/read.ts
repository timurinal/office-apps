/**
 * Markdown to a Docs document.
 *
 * `markdown-it` (MIT) tokenizes; this file builds the document from the tokens. Raw HTML in
 * the source is never passed on as markup. A block of it is read as HTML through the same
 * allowlist as an imported page (html/read.ts), and an inline tag is honoured only if it is
 * one of the few the editor itself writes into Markdown (`<u>`, `<sub>`, `<sup>`, `<mark>`,
 * `<br>`); any other is dropped. A link is kept if it is http, https or mailto, a picture
 * only if it is a `data:` URL of a raster format, and nothing is fetched.
 *
 * Footnotes are the `[^id]` form: a definition `[^id]: text` and references `[^id]`.
 * Checklists are `- [ ]` and `- [x]`.
 */

import MarkdownIt from 'markdown-it';
import { isSafeHref } from '../../docs/core/links';
import { decodeDataImage } from '../images';
import { IMAGE_MIMES, MAX_IMAGES, MAX_NESTING, MAX_TEXT_BYTES } from '../limits';
import { FormatError } from '../errors';
import { doc, mergeText, para, text as textNode } from '../model';
import { blocksOf, newHtmlCtx, type HtmlCtx } from '../html/read';
import { parseHtml } from '../html/parse';
import { IMAGE_TOKEN_PREFIX, plural, type ImportResult, type JSONContent, type MarkJSON } from '../types';

// `html: true` only so the tokenizer reports raw HTML as tokens we can inspect and filter;
// nothing it reports is ever written out as it was.
const md = new MarkdownIt('default', { html: true, linkify: false, typographer: false, breaks: false });
type Token = ReturnType<typeof md.parse>[number];

const ORDER = ['link', 'bold', 'italic', 'underline', 'strike', 'code', 'subscript', 'superscript', 'highlight'];

function withMark(marks: readonly MarkJSON[], mark: MarkJSON): MarkJSON[] {
  if (marks.some((m) => m.type === 'code')) return [...marks];
  if (mark.type === 'code') return [mark];
  return [...marks.filter((m) => m.type !== mark.type), mark].sort((a, b) => ORDER.indexOf(a.type) - ORDER.indexOf(b.type));
}

const without = (marks: readonly MarkJSON[], type: string): MarkJSON[] => marks.filter((m) => m.type !== type);

interface Ctx extends HtmlCtx {
  footnotes: Map<string, string>;
}

type Atom = { text: string; marks: MarkJSON[] } | { node: JSONContent } | { block: JSONContent };

const INLINE_TAGS: Record<string, string> = { u: 'underline', sub: 'subscript', sup: 'superscript', mark: 'highlight', ins: 'underline', s: 'strike', del: 'strike', b: 'bold', strong: 'bold', i: 'italic', em: 'italic' };

/** `[^id]` in text: the note's reference, with the text from its definition. */
function splitFootnotes(ctx: Ctx, value: string, marks: MarkJSON[], out: Atom[]): void {
  if (!value.includes('[^')) {
    out.push({ text: value, marks });
    return;
  }
  let last = 0;
  for (const m of value.matchAll(/\[\^([^\]\s]{1,40})\]/g)) {
    const note = ctx.footnotes.get(m[1]!);
    if (note === undefined) continue;
    if (m.index! > last) out.push({ text: value.slice(last, m.index), marks });
    out.push({ node: { type: 'footnote', content: note ? [textNode(note)] : [] } });
    last = m.index! + m[0].length;
  }
  if (last < value.length) out.push({ text: value.slice(last), marks });
}

function inlineAtoms(ctx: Ctx, children: readonly Token[]): Atom[] {
  const out: Atom[] = [];
  let marks: MarkJSON[] = [];
  const stack: MarkJSON[][] = [];
  for (const t of children) {
    switch (t.type) {
      case 'text':
        splitFootnotes(ctx, t.content, marks, out);
        break;
      case 'softbreak':
        out.push({ text: ' ', marks });
        break;
      case 'hardbreak':
        out.push({ node: { type: 'hardBreak' } });
        break;
      case 'code_inline':
        out.push({ text: t.content, marks: withMark(marks, { type: 'code' }) });
        break;
      case 'strong_open':
      case 'em_open':
      case 's_open':
      case 'link_open': {
        stack.push(marks);
        if (t.type === 'strong_open') marks = withMark(marks, { type: 'bold' });
        else if (t.type === 'em_open') marks = withMark(marks, { type: 'italic' });
        else if (t.type === 's_open') marks = withMark(marks, { type: 'strike' });
        else {
          const href = String(t.attrGet('href') ?? '');
          if (isSafeHref(href)) marks = withMark(marks, { type: 'link', attrs: { href } });
          else ctx.warnings.add('link', (c) => `${plural(c, 'link')} to addresses that are not web or mail addresses ${c === 1 ? 'was' : 'were'} left as text.`);
        }
        break;
      }
      case 'strong_close':
      case 'em_close':
      case 's_close':
      case 'link_close':
        marks = stack.pop() ?? [];
        break;
      case 'image': {
        const src = String(t.attrGet('src') ?? '');
        const decoded = src.startsWith('data:') ? decodeDataImage(src) : null;
        if (!decoded || !IMAGE_MIMES.includes(decoded.mime)) {
          ctx.warnings.add('external-image', (c) => `${plural(c, 'picture')} that could not be taken from the file ${c === 1 ? 'was' : 'were'} left out.`);
          break;
        }
        if (ctx.images.size >= MAX_IMAGES) {
          ctx.warnings.add('image-count', (c) => `${plural(c, 'picture')} beyond the first ${MAX_IMAGES} ${c === 1 ? 'was' : 'were'} left out.`);
          break;
        }
        const token = `${IMAGE_TOKEN_PREFIX}${ctx.images.size + 1}`;
        ctx.images.set(token, { bytes: decoded.bytes, mime: decoded.mime, name: 'image' });
        const alt = t.content.trim();
        out.push({ block: { type: 'image', attrs: { src: token, ...(alt ? { alt: alt.slice(0, 500) } : {}) } } });
        break;
      }
      case 'html_inline': {
        const m = /^<(\/?)([a-z]+)\s*\/?>$/i.exec(t.content.trim());
        const tag = m?.[2]?.toLowerCase();
        if (tag === 'br') out.push({ node: { type: 'hardBreak' } });
        else if (m && tag && tag in INLINE_TAGS) {
          if (m[1]) marks = without(marks, INLINE_TAGS[tag]!);
          else marks = withMark(marks, { type: INLINE_TAGS[tag]!, ...(INLINE_TAGS[tag] === 'highlight' ? { attrs: { color: '#fff2a8' } } : {}) });
        }
        break;
      }
      default:
        break;
    }
  }
  return out;
}

function paragraphsOf(atoms: Atom[], make: (content: JSONContent[]) => JSONContent): JSONContent[] {
  const out: JSONContent[] = [];
  let cur: JSONContent[] = [];
  const flush = () => {
    const merged = mergeText(cur);
    if (merged.length > 0) out.push(make(merged));
    cur = [];
  };
  for (const a of atoms) {
    if ('block' in a) {
      flush();
      out.push(a.block);
    } else if ('node' in a) cur.push(a.node);
    else if (a.text !== '') cur.push(textNode(a.text, a.marks));
  }
  flush();
  // An empty paragraph (a heading with no text) still counts.
  return out;
}

interface Cursor {
  tokens: Token[];
  i: number;
}

function closeOf(c: Cursor, open: string, close: string): number {
  // The index of the token that closes the one at c.i.
  let depth = 0;
  for (let k = c.i; k < c.tokens.length; k++) {
    const t = c.tokens[k]!;
    if (t.type === open) depth++;
    else if (t.type === close && --depth === 0) return k;
  }
  return c.tokens.length - 1;
}

function blockTokens(ctx: Ctx, tokens: Token[], depth: number): JSONContent[] {
  const c: Cursor = { tokens, i: 0 };
  const out: JSONContent[] = [];
  while (c.i < tokens.length) {
    const t = tokens[c.i]!;
    switch (t.type) {
      case 'heading_open': {
        const level = Number(t.tag.slice(1)) || 1;
        const inl = tokens[c.i + 1];
        const atoms = inl?.type === 'inline' ? inlineAtoms(ctx, inl.children ?? []) : [];
        out.push(...paragraphsOf(atoms, (content) => ({ type: 'heading', attrs: { level }, content })));
        c.i += 3;
        break;
      }
      case 'paragraph_open': {
        const inl = tokens[c.i + 1];
        const atoms = inl?.type === 'inline' ? inlineAtoms(ctx, inl.children ?? []) : [];
        out.push(...paragraphsOf(atoms, (content) => para(content)));
        c.i += 3;
        break;
      }
      case 'blockquote_open': {
        const end = closeOf(c, 'blockquote_open', 'blockquote_close');
        const inner = tokens.slice(c.i + 1, end);
        c.i = end + 1;
        if (depth >= MAX_NESTING) out.push(...blockTokens(ctx, inner, depth));
        else {
          const kids = blockTokens(ctx, inner, depth + 1);
          if (kids.length > 0) out.push({ type: 'blockquote', content: kids });
        }
        break;
      }
      case 'bullet_list_open':
      case 'ordered_list_open': {
        const closeType = t.type === 'bullet_list_open' ? 'bullet_list_close' : 'ordered_list_close';
        const end = closeOf(c, t.type, closeType);
        const inner = tokens.slice(c.i + 1, end);
        const list = listFrom(ctx, t, inner, depth);
        c.i = end + 1;
        if (list) out.push(list);
        break;
      }
      case 'fence':
      case 'code_block': {
        const value = t.content.replace(/\n$/, '');
        const lang = (t.info ?? '').trim().split(/\s+/)[0] ?? '';
        out.push({
          type: 'codeBlock',
          ...(lang && /^[a-z0-9+#.-]{1,30}$/i.test(lang) ? { attrs: { language: lang } } : {}),
          ...(value ? { content: [{ type: 'text', text: value }] } : {})
        });
        c.i++;
        break;
      }
      case 'hr':
        out.push({ type: 'horizontalRule' });
        c.i++;
        break;
      case 'table_open': {
        const end = closeOf(c, 'table_open', 'table_close');
        const tbl = tableFrom(ctx, tokens.slice(c.i + 1, end), depth);
        c.i = end + 1;
        if (tbl) out.push(tbl);
        break;
      }
      case 'html_block': {
        // Raw HTML is read as a page, through the allowlist.
        const { root } = parseHtml(t.content);
        out.push(...blocksOf(ctx, root.children));
        c.i++;
        break;
      }
      default:
        c.i++;
    }
  }
  return out;
}

function listFrom(ctx: Ctx, open: Token, tokens: Token[], depth: number): JSONContent | null {
  if (depth >= MAX_NESTING) {
    ctx.warnings.add('nesting', (n) => `${plural(n, 'list')} nested too deeply ${n === 1 ? 'was' : 'were'} flattened.`);
    return null;
  }
  const items: { content: JSONContent[]; checked: boolean | null }[] = [];
  let k = 0;
  while (k < tokens.length) {
    if (tokens[k]!.type !== 'list_item_open') {
      k++;
      continue;
    }
    const c: Cursor = { tokens, i: k };
    const end = closeOf(c, 'list_item_open', 'list_item_close');
    const inner = tokens.slice(k + 1, end);
    // A checkbox is the item's first text: "[ ] " or "[x] ".
    let checked: boolean | null = null;
    const firstInline = inner.find((t) => t.type === 'inline');
    const first = firstInline?.children?.[0];
    if (first?.type === 'text') {
      const m = /^\[([ xX])\]\s+/.exec(first.content);
      if (m) {
        checked = m[1] !== ' ';
        first.content = first.content.slice(m[0].length);
      }
    }
    let content = blockTokens(ctx, inner, depth + 1);
    if (content.length === 0 || content[0]!.type !== 'paragraph') content = [{ type: 'paragraph' }, ...content];
    items.push({ content, checked });
    k = end + 1;
  }
  if (items.length === 0) return null;
  if (items.every((i) => i.checked !== null)) {
    return { type: 'taskList', content: items.map((i) => ({ type: 'taskItem', attrs: { checked: i.checked }, content: i.content })) };
  }
  const content = items.map((i) => ({ type: 'listItem', content: i.content }));
  if (open.type === 'bullet_list_open') return { type: 'bulletList', content };
  const start = Number(open.attrGet('start'));
  return { type: 'orderedList', ...(Number.isInteger(start) && start > 1 ? { attrs: { start } } : {}), content };
}

function tableFrom(ctx: Ctx, tokens: Token[], depth: number): JSONContent | null {
  const rows: JSONContent[] = [];
  let cells: JSONContent[] = [];
  for (let k = 0; k < tokens.length; k++) {
    const t = tokens[k]!;
    if (t.type === 'tr_open') cells = [];
    else if (t.type === 'tr_close') {
      if (cells.length > 0) rows.push({ type: 'tableRow', content: cells });
    } else if (t.type === 'th_open' || t.type === 'td_open') {
      const inl = tokens[k + 1];
      const align = /text-align:\s*(left|center|right)/.exec(String(t.attrGet('style') ?? ''))?.[1];
      const atoms = inl?.type === 'inline' ? inlineAtoms(ctx, inl.children ?? []) : [];
      const attrs = align && align !== 'left' ? { textAlign: align } : undefined;
      let content = paragraphsOf(atoms, (c) => para(c, attrs));
      if (content.length === 0) content = [{ type: 'paragraph' }];
      if (content[content.length - 1]?.type === 'image') content.push({ type: 'paragraph' });
      cells.push({ type: t.type === 'th_open' ? 'tableHeader' : 'tableCell', content });
    }
  }
  void depth;
  return rows.length > 0 ? { type: 'table', content: rows } : null;
}

/** Footnote definitions, taken out of the source: `[^id]: text` and its indented continuation. */
function takeDefinitions(source: string): { text: string; notes: Map<string, string> } {
  const notes = new Map<string, string>();
  const lines = source.split('\n');
  const kept: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^\[\^([^\]\s]{1,40})\]:\s?(.*)$/.exec(lines[i]!);
    if (!m) {
      kept.push(lines[i]!);
      continue;
    }
    let body = m[2]!;
    while (i + 1 < lines.length && /^(?: {2,}|\t)\S/.test(lines[i + 1]!)) body += ` ${lines[++i]!.trim()}`;
    notes.set(m[1]!, body.replace(/\s+/g, ' ').trim());
  }
  return { text: kept.join('\n'), notes };
}

export function readMarkdown(source: string): ImportResult {
  if (source.length > MAX_TEXT_BYTES) throw new FormatError('too_large', 'markdown');
  const { text, notes } = takeDefinitions(source.replace(/\r\n?/g, '\n').replace(/^﻿/, ''));
  const ctx: Ctx = { ...newHtmlCtx(), footnotes: notes };
  const tokens = md.parse(text, {});
  const content = blockTokens(ctx, tokens, 0);
  return {
    model: { body: doc(content), page: null, header: {}, footer: {} },
    images: ctx.images,
    comments: [],
    title: null,
    warnings: ctx.warnings.list()
  };
}
