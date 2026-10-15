/**
 * A Docs document to Markdown.
 *
 * CommonMark and the GitHub extensions (tables, strikethrough, task lists, footnotes), so
 * the file reads anywhere. What Markdown has no word for stays as the HTML tag the editor
 * and markdown/read.ts agree on: `<u>`, `<sub>`, `<sup>`, `<mark>`. What it cannot hold
 * at all (fonts, sizes, colours, alignment, spacing, merged cells, comments) is dropped.
 *
 * Suggestions are resolved as if every one were accepted. A picture is embedded as a
 * `data:` URL, which is the only address that means the same thing outside the document.
 */

import { isSafeHref } from '../../docs/core/links';
import { bytesToBase64 } from '../images';
import { Warnings, plural, type DocModel, type ExportOptions, type JSONContent, type MarkJSON, type Warning } from '../types';

interface Ctx {
  opts: ExportOptions;
  warnings: Warnings;
  notes: string[];
}

/** Characters that mean something to Markdown wherever they stand in a line. */
const escapeText = (s: string): string => s.replace(/([\\`*_[\]<>~|])/g, '\\$1');

/** Characters that mean something only at the start of a line. */
const escapeLead = (s: string): string => s.replace(/^(\s*)([#>+-]|\d+[.)])(\s|$)/, (_m, a: string, b: string, c: string) => `${a}${b.replace(/([#>+-]|[.)])/, '\\$1')}${c}`);

function withMarks(text: string, marks: readonly MarkJSON[]): string {
  if (text === '') return '';
  if (marks.some((m) => m.type === 'deletion')) return '';
  const has = (t: string) => marks.find((m) => m.type === t);
  if (has('code')) {
    const fence = '`'.repeat(Math.max(...(text.match(/`+/g) ?? ['']).map((r) => r.length)) + 1);
    return `${fence}${text.startsWith('`') || text.endsWith('`') ? ` ${text} ` : text}${fence}`;
  }
  // Emphasis delimiters cannot touch whitespace, so the space stays outside them.
  const lead = /^\s*/.exec(text)![0];
  const tail = /\s*$/.exec(text.slice(lead.length))![0];
  let core = escapeText(text.slice(lead.length, text.length - tail.length));
  if (core === '') return text;
  if (has('bold')) core = `**${core}**`;
  if (has('italic')) core = `*${core}*`;
  if (has('strike')) core = `~~${core}~~`;
  if (has('underline')) core = `<u>${core}</u>`;
  if (has('subscript')) core = `<sub>${core}</sub>`;
  if (has('superscript')) core = `<sup>${core}</sup>`;
  if (has('highlight')) core = `<mark>${core}</mark>`;
  const link = has('link');
  if (link && typeof link.attrs?.href === 'string' && isSafeHref(link.attrs.href)) core = `[${core}](${link.attrs.href.replace(/[()\s]/g, (c) => encodeURIComponent(c))})`;
  return lead + core + tail;
}

function inline(ctx: Ctx, nodes: readonly JSONContent[] | undefined): string {
  return (nodes ?? [])
    .map((n) => {
      switch (n.type) {
        case 'text':
          return withMarks(n.text ?? '', n.marks ?? []);
        case 'hardBreak':
          return '  \n';
        case 'footnote': {
          ctx.notes.push((n.content ?? []).map((c) => c.text ?? '').join(''));
          return `[^${ctx.notes.length}]`;
        }
        case 'mention':
          return escapeText(`@${String(n.attrs?.label ?? n.attrs?.id ?? '')}`);
        case 'dateChip':
          return escapeText(String(n.attrs?.date ?? ''));
        case 'docLink': {
          const title = escapeText(String(n.attrs?.title ?? 'Document') || 'Document');
          const origin = ctx.opts.origin;
          const id = String(n.attrs?.docId ?? '');
          return origin && id ? `[${title}](${origin}/${String(n.attrs?.kind ?? 'docs')}/${encodeURIComponent(id)})` : title;
        }
        default:
          return '';
      }
    })
    .join('');
}

const LISTS = new Set(['bulletList', 'orderedList', 'taskList']);

/** `tight`: a list item's blocks, where a nested list follows its paragraph with no blank line between. */
function blocks(ctx: Ctx, nodes: readonly JSONContent[] | undefined, tight = false): string[] {
  const out: string[] = [];
  let kind = '';
  const push = (lines: string[]) => {
    if (lines.length === 0) return;
    if (out.length > 0 && !(tight && LISTS.has(kind))) out.push('');
    out.push(...lines);
  };
  for (const n of nodes ?? []) {
    const a = n.attrs ?? {};
    kind = n.type ?? '';
    switch (n.type) {
      case 'heading':
        push([`${'#'.repeat(Math.min(6, Math.max(1, Number(a.level) || 1)))} ${inline(ctx, n.content).replace(/\n/g, ' ')}`]);
        break;
      case 'paragraph': {
        const text = inline(ctx, n.content);
        if (a.paraStyle === 'title') push([`# ${text.replace(/\n/g, ' ')}`]);
        else if (a.paraStyle === 'subtitle') push([`*${text.replace(/\n/g, ' ').trim()}*`]);
        else push(text === '' ? [] : escapeLead(text).split('\n'));
        break;
      }
      case 'blockquote':
        push(blocks(ctx, n.content).map((l) => (l === '' ? '>' : `> ${l}`)));
        break;
      case 'codeBlock': {
        const body = (n.content ?? []).map((c) => c.text ?? '').join('');
        const fence = '`'.repeat(Math.max(2, ...(body.match(/`+/g) ?? ['']).map((r) => r.length)) + 1);
        const lang = typeof a.language === 'string' && /^[a-z0-9+#.-]{1,30}$/i.test(a.language) ? a.language : '';
        push([`${fence}${lang}`, ...body.split('\n'), fence]);
        break;
      }
      case 'horizontalRule':
        push(['---']);
        break;
      case 'bulletList':
      case 'orderedList':
      case 'taskList':
        push(list(ctx, n));
        break;
      case 'table':
        push(table(ctx, n));
        break;
      case 'image': {
        const img = ctx.opts.resolveImage?.(String(a.src ?? '')) ?? null;
        if (!img) {
          ctx.warnings.add('picture', (c) => `${plural(c, 'picture')} could not be included.`);
          break;
        }
        const alt = escapeText(String(a.alt ?? '')).replace(/\n/g, ' ');
        push([`![${alt}](data:${img.mime};base64,${bytesToBase64(img.bytes)})`]);
        break;
      }
      default:
        break;
    }
  }
  return out;
}

function list(ctx: Ctx, n: JSONContent): string[] {
  const out: string[] = [];
  let k = Number(n.attrs?.start) || 1;
  for (const li of n.content ?? []) {
    const marker = n.type === 'orderedList' ? `${k++}. ` : n.type === 'taskList' ? `- [${li.attrs?.checked ? 'x' : ' '}] ` : '- ';
    const pad = ' '.repeat(n.type === 'orderedList' ? marker.length : 2);
    const body = blocks(ctx, li.content, true);
    body.forEach((line, i) => out.push(i === 0 ? marker + line : line === '' ? '' : pad + line));
    if (body.length === 0) out.push(marker.trimEnd());
  }
  return out;
}

function table(ctx: Ctx, t: JSONContent): string[] {
  const rows = (t.content ?? []).map((r) =>
    (r.content ?? []).map((c) =>
      (c.content ?? [])
        .map((p) => inline(ctx, p.content).replace(/\n/g, ' ').trim())
        .filter(Boolean)
        .join('<br>')
        // A pipe ends a cell. The text escaped its own already; a code span did not.
        .replace(/\\?\|/g, '\\|')
    )
  );
  const width = Math.max(1, ...rows.map((r) => r.length));
  const pad = (r: string[]) => `| ${Array.from({ length: width }, (_, i) => r[i] ?? '').join(' | ')} |`;
  if (rows.length === 0) return [];
  return [pad(rows[0]!), `| ${Array.from({ length: width }, () => '---').join(' | ')} |`, ...rows.slice(1).map(pad)];
}

export function writeMarkdown(model: DocModel, opts: ExportOptions): { markdown: string; warnings: Warning[] } {
  const ctx: Ctx = { opts, warnings: new Warnings(), notes: [] };
  const lines = blocks(ctx, model.body.content);
  if (ctx.notes.length > 0) lines.push('', ...ctx.notes.map((t, i) => `[^${i + 1}]: ${t.replace(/\n/g, ' ')}`));
  return { markdown: `${lines.join('\n').replace(/\n{3,}/g, '\n\n')}\n`, warnings: ctx.warnings.list() };
}
