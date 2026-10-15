/**
 * A Docs document to a standalone HTML page.
 *
 * Plain markup with inline styles for what the document sets, so the page reads the same
 * with no stylesheet of ours. It uses the data attributes the editor writes for its own
 * clipboard (`data-style`, `data-align`, `data-footnote`, `data-toc`, `data-suggestion`), so
 * this file read back through html/read.ts is the document again. Pictures are embedded as
 * `data:` URLs, because a document's own addresses mean nothing outside the document.
 *
 * Suggestions are kept as `<ins>` and `<del>`. Comments are not exported.
 */

import { stackFor } from '../../docs/core/fonts';
import { safeColor, safeFontSize } from '../../docs/core/sanitize';
import { isSafeHref } from '../../docs/core/links';
import { bytesToBase64 } from '../images';
import { Warnings, plural, type DocModel, type ExportOptions, type JSONContent, type Warning } from '../types';

export const escapeHtml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

interface Ctx {
  opts: ExportOptions;
  warnings: Warnings;
}

const STYLE = `
body { font: 16px/1.6 system-ui, -apple-system, "Segoe UI", sans-serif; color: #1f1f2e; max-width: 46rem; margin: 2rem auto; padding: 0 1rem; }
h1, h2, h3, h4, h5, h6 { line-height: 1.25; }
blockquote { margin: 1em 0; padding-left: 1em; border-left: 3px solid #c9dafd; color: #555; }
pre { background: #f1f3f9; padding: 12px 16px; border-radius: 8px; overflow-x: auto; }
code { background: #f1f3f9; padding: 0.1em 0.35em; border-radius: 4px; font-family: ui-monospace, Menlo, Consolas, monospace; }
pre code { background: none; padding: 0; }
table { border-collapse: collapse; }
th, td { border: 1px solid #c8c8d0; padding: 6px 10px; vertical-align: top; }
th { background: #f1f3f9; }
img { max-width: 100%; height: auto; }
ins { color: #176842; } del { color: #9a4116; }
[data-style="title"] { font-size: 2em; font-weight: 600; }
[data-style="subtitle"] { font-size: 1.25em; color: #666; }
[data-page-break] { border-top: 1px dashed #bbb; margin: 2em 0; }
`.trim();

function inline(ctx: Ctx, nodes: readonly JSONContent[] | undefined): string {
  return (nodes ?? []).map((n) => inlineNode(ctx, n)).join('');
}

function inlineNode(ctx: Ctx, n: JSONContent): string {
  switch (n.type) {
    case 'text':
      return withMarks(escapeHtml(n.text ?? ''), n.marks ?? []);
    case 'hardBreak':
      return '<br>';
    case 'footnote':
      return `<sup data-footnote>${escapeHtml((n.content ?? []).map((c) => c.text ?? '').join(''))}</sup>`;
    case 'mention':
      return `<span>@${escapeHtml(String(n.attrs?.label ?? n.attrs?.id ?? ''))}</span>`;
    case 'dateChip': {
      const raw = String(n.attrs?.date ?? '');
      const d = new Date(raw);
      const shown = Number.isFinite(d.getTime()) ? new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'UTC' }).format(d) : raw;
      return `<time datetime="${escapeHtml(raw)}">${escapeHtml(shown)}</time>`;
    }
    case 'docLink': {
      const title = escapeHtml(String(n.attrs?.title ?? 'Document') || 'Document');
      const origin = ctx.opts.origin;
      const id = String(n.attrs?.docId ?? '');
      return origin && id ? `<a href="${escapeHtml(`${origin}/${String(n.attrs?.kind ?? 'docs')}/${encodeURIComponent(id)}`)}">${title}</a>` : title;
    }
    default:
      return escapeHtml((n.content ?? []).map((c) => c.text ?? '').join(''));
  }
}

function withMarks(html: string, marks: readonly NonNullable<JSONContent['marks']>[number][]): string {
  let out = html;
  const style: string[] = [];
  const wrap: ((s: string) => string)[] = [];
  for (const m of marks) {
    const a = m.attrs ?? {};
    switch (m.type) {
      case 'bold':
        wrap.push((s) => `<strong>${s}</strong>`);
        break;
      case 'italic':
        wrap.push((s) => `<em>${s}</em>`);
        break;
      case 'underline':
        wrap.push((s) => `<u>${s}</u>`);
        break;
      case 'strike':
        wrap.push((s) => `<s>${s}</s>`);
        break;
      case 'code':
        wrap.push((s) => `<code>${s}</code>`);
        break;
      case 'subscript':
        wrap.push((s) => `<sub>${s}</sub>`);
        break;
      case 'superscript':
        wrap.push((s) => `<sup>${s}</sup>`);
        break;
      case 'highlight': {
        const color = safeColor(a.color) ?? '#fff2a8';
        wrap.push((s) => `<mark data-color="${escapeHtml(color)}" style="background-color: ${escapeHtml(color)}">${s}</mark>`);
        break;
      }
      case 'link':
        if (typeof a.href === 'string' && isSafeHref(a.href)) {
          const href = escapeHtml(a.href);
          wrap.push((s) => `<a href="${href}">${s}</a>`);
        }
        break;
      case 'textStyle': {
        const stack = typeof a.fontFamily === 'string' ? stackFor(a.fontFamily) : null;
        if (stack) style.push(`font-family: ${stack.replace(/"/g, "'")}`);
        const size = safeFontSize(a.fontSize);
        if (size) style.push(`font-size: ${size}`);
        const color = safeColor(a.color);
        if (color) style.push(`color: ${color}`);
        break;
      }
      case 'insertion':
      case 'deletion': {
        const tag = m.type === 'insertion' ? 'ins' : 'del';
        const attrs = ` data-suggestion="${escapeHtml(String(a.id ?? ''))}" data-author-id="${escapeHtml(String(a.authorId ?? ''))}" data-author="${escapeHtml(String(a.authorName ?? ''))}" data-at="${Number(a.at) || 0}"`;
        wrap.push((s) => `<${tag}${attrs}>${s}</${tag}>`);
        break;
      }
      default:
        break;
    }
  }
  if (style.length > 0) wrap.push((s) => `<span style="${escapeHtml(style.join('; '))}">${s}</span>`);
  // The first mark is the outermost, so a link (first in the document's order) wraps the rest.
  for (let i = wrap.length - 1; i >= 0; i--) out = wrap[i]!(out);
  return out;
}

function blockStyle(a: Record<string, unknown>): string {
  const s: string[] = [];
  if (typeof a.textAlign === 'string' && a.textAlign !== 'left') s.push(`text-align: ${a.textAlign}`);
  if (typeof a.lineHeight === 'number') s.push(`line-height: ${a.lineHeight}`);
  if (typeof a.spaceBefore === 'number') s.push(`margin-top: ${a.spaceBefore}pt`);
  if (typeof a.spaceAfter === 'number') s.push(`margin-bottom: ${a.spaceAfter}pt`);
  if (typeof a.indent === 'number' && a.indent > 0) s.push(`margin-left: ${a.indent * 36}pt`);
  return s.length ? ` style="${escapeHtml(s.join('; '))}"` : '';
}

function blocks(ctx: Ctx, nodes: readonly JSONContent[] | undefined): string {
  return (nodes ?? []).map((n) => block(ctx, n)).join('\n');
}

function block(ctx: Ctx, n: JSONContent): string {
  const a = n.attrs ?? {};
  switch (n.type) {
    case 'paragraph': {
      const ds = typeof a.paraStyle === 'string' ? ` data-style="${escapeHtml(a.paraStyle)}"` : '';
      return `<p${ds}${blockStyle(a)}>${inline(ctx, n.content)}</p>`;
    }
    case 'heading': {
      const level = Math.min(6, Math.max(1, Number(a.level) || 1));
      return `<h${level}${blockStyle(a)}>${inline(ctx, n.content)}</h${level}>`;
    }
    case 'blockquote':
      return `<blockquote>\n${blocks(ctx, n.content)}\n</blockquote>`;
    case 'codeBlock': {
      const lang = typeof a.language === 'string' && /^[a-z0-9+#.-]{1,30}$/i.test(a.language) ? ` class="language-${escapeHtml(a.language)}"` : '';
      return `<pre><code${lang}>${escapeHtml((n.content ?? []).map((c) => c.text ?? '').join(''))}</code></pre>`;
    }
    case 'horizontalRule':
      return '<hr>';
    case 'pageBreak':
      return '<div data-page-break style="break-after: page"></div>';
    case 'tableOfContents':
      return `<div data-toc data-entries="${escapeHtml(String(a.entries ?? '[]'))}"></div>`;
    case 'bulletList':
      return `<ul>\n${(n.content ?? []).map((li) => item(ctx, li)).join('\n')}\n</ul>`;
    case 'orderedList': {
      const attrs = [
        typeof a.start === 'number' && a.start !== 1 ? ` start="${a.start}"` : '',
        typeof a.type === 'string' ? ` type="${escapeHtml(a.type)}"` : '',
        a.format === 'legal' ? ' data-format="legal"' : ''
      ].join('');
      return `<ol${attrs}>\n${(n.content ?? []).map((li) => item(ctx, li)).join('\n')}\n</ol>`;
    }
    case 'taskList':
      return `<ul data-type="taskList">\n${(n.content ?? []).map((li) => item(ctx, li, true)).join('\n')}\n</ul>`;
    case 'image': {
      const img = ctx.opts.resolveImage?.(String(a.src ?? '')) ?? null;
      if (!img) {
        ctx.warnings.add('picture', (c) => `${plural(c, 'picture')} could not be included.`);
        return '';
      }
      const dims = `${typeof a.width === 'number' ? ` width="${a.width}"` : ''}${typeof a.height === 'number' ? ` height="${a.height}"` : ''}`;
      const align = a.align === 'center' || a.align === 'right' ? ` data-align="${a.align}"` : '';
      return `<img src="data:${img.mime};base64,${bytesToBase64(img.bytes)}" alt="${escapeHtml(String(a.alt ?? ''))}"${dims}${align}>`;
    }
    case 'table':
      return `<table>\n${(n.content ?? []).map((r) => `<tr>${(r.content ?? []).map((c) => cell(ctx, c)).join('')}</tr>`).join('\n')}\n</table>`;
    default:
      return n.content ? `<p>${escapeHtml((n.content ?? []).map((c) => c.text ?? '').join(''))}</p>` : '';
  }
}

function item(ctx: Ctx, li: JSONContent, task = false): string {
  const checked = li.attrs?.checked === true;
  const kids = li.content ?? [];
  // A paragraph in an item is its text; anything else (a nested list) is a block.
  const inner = kids.map((k) => (k.type === 'paragraph' && !k.attrs?.paraStyle ? inline(ctx, k.content) : block(ctx, k))).join('\n');
  return task
    ? `<li data-checked="${checked}"><input type="checkbox"${checked ? ' checked' : ''} disabled> ${inner}</li>`
    : `<li>${inner}</li>`;
}

function cell(ctx: Ctx, c: JSONContent): string {
  const a = c.attrs ?? {};
  const tag = c.type === 'tableHeader' ? 'th' : 'td';
  const bg = safeColor(a.backgroundColor);
  const attrs = [
    Number(a.colspan) > 1 ? ` colspan="${Number(a.colspan)}"` : '',
    Number(a.rowspan) > 1 ? ` rowspan="${Number(a.rowspan)}"` : '',
    bg ? ` data-bg="${escapeHtml(bg)}" style="background-color: ${escapeHtml(bg)}"` : ''
  ].join('');
  return `<${tag}${attrs}>${blocks(ctx, c.content)}</${tag}>`;
}

export function writeHtml(model: DocModel, opts: ExportOptions): { html: string; warnings: Warning[] } {
  const ctx: Ctx = { opts, warnings: new Warnings() };
  const body = blocks(ctx, model.body.content);
  const html = `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>${escapeHtml(opts.title)}</title>\n<style>\n${STYLE}\n</style>\n</head>\n<body>\n${body}\n</body>\n</html>\n`;
  return { html, warnings: ctx.warnings.list() };
}
