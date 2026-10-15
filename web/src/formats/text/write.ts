/**
 * A Docs document as plain text.
 *
 * Paragraphs are separated by a blank line; a list keeps its markers and its nesting; a
 * table is tab-separated rows; a picture is its description in brackets. Suggestions are
 * resolved as if every one were accepted: an insertion is text, a deletion is gone.
 */

import type { DocModel, JSONContent } from '../types';

function inlineText(nodes: readonly JSONContent[] | undefined, notes: string[]): string {
  return (nodes ?? [])
    .map((n) => {
      switch (n.type) {
        case 'text':
          return n.marks?.some((m) => m.type === 'deletion') ? '' : (n.text ?? '');
        case 'hardBreak':
          return '\n';
        case 'footnote': {
          const body = (n.content ?? []).map((c) => c.text ?? '').join('');
          notes.push(body);
          return `[${notes.length}]`;
        }
        case 'mention':
          return `@${String(n.attrs?.label ?? n.attrs?.id ?? '')}`;
        case 'dateChip':
          return String(n.attrs?.date ?? '');
        case 'docLink':
          return String(n.attrs?.title ?? '');
        default:
          return '';
      }
    })
    .join('');
}

function blockLines(nodes: readonly JSONContent[] | undefined, notes: string[], indent = ''): string[] {
  const out: string[] = [];
  const push = (lines: string[]) => {
    if (out.length > 0 && lines.length > 0) out.push('');
    out.push(...lines);
  };
  for (const n of nodes ?? []) {
    switch (n.type) {
      case 'paragraph':
      case 'heading':
        push(inlineText(n.content, notes).split('\n').map((l) => indent + l));
        break;
      case 'blockquote':
        push(blockLines(n.content, notes, `${indent}> `));
        break;
      case 'codeBlock':
        push((n.content ?? []).map((c) => c.text ?? '').join('').split('\n').map((l) => indent + l));
        break;
      case 'horizontalRule':
        push([`${indent}---`]);
        break;
      case 'bulletList':
      case 'orderedList':
      case 'taskList': {
        const lines: string[] = [];
        let k = Number(n.attrs?.start) || 1;
        for (const li of n.content ?? []) {
          const marker = n.type === 'bulletList' ? '• ' : n.type === 'taskList' ? (li.attrs?.checked ? '[x] ' : '[ ] ') : `${k++}. `;
          const [first, ...rest] = li.content ?? [];
          const head = first ? inlineText(first.content, notes) : '';
          lines.push(`${indent}${marker}${head}`);
          for (const r of rest) lines.push(...blockLines([r], notes, `${indent}   `));
        }
        push(lines);
        break;
      }
      case 'table':
        push(
          (n.content ?? []).map(
            (row) =>
              indent +
              (row.content ?? [])
                .map((c) => (c.content ?? []).map((p) => inlineText(p.content, notes)).join(' ').replace(/\s+/g, ' ').trim())
                .join('\t')
          )
        );
        break;
      case 'image':
        push([`${indent}[${String(n.attrs?.alt ?? '') || 'Picture'}]`]);
        break;
      case 'tableOfContents': {
        try {
          const e = JSON.parse(String(n.attrs?.entries ?? '[]')) as { level: number; text: string }[];
          push(e.map((x) => `${indent}${'  '.repeat(Math.max(0, (Number(x.level) || 1) - 1))}${x.text}`));
        } catch {
          /* an unreadable table of contents is nothing */
        }
        break;
      }
      default:
        break;
    }
  }
  return out;
}

export function writeText(model: DocModel): string {
  const notes: string[] = [];
  const lines = blockLines(model.body.content, notes);
  if (notes.length > 0) {
    lines.push('', ...notes.map((t, i) => `[${i + 1}] ${t}`));
  }
  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n')}\n`;
}
