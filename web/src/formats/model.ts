/**
 * Small helpers over `JSONContent` that every converter needs.
 */

import type { JSONContent, MarkJSON } from './types';

export const text = (value: string, marks?: MarkJSON[]): JSONContent =>
  marks && marks.length > 0 ? { type: 'text', text: value, marks } : { type: 'text', text: value };

export const para = (content: JSONContent[] = [], attrs?: Record<string, unknown>): JSONContent => ({
  type: 'paragraph',
  ...(attrs && Object.keys(attrs).length > 0 ? { attrs } : {}),
  ...(content.length > 0 ? { content } : {})
});

export const doc = (content: JSONContent[]): JSONContent => ({
  type: 'doc',
  content: content.length > 0 ? content : [{ type: 'paragraph' }]
});

/** Marks are equal when they are the same marks with the same attributes. */
export function sameMarks(a: readonly MarkJSON[] | undefined, b: readonly MarkJSON[] | undefined): boolean {
  const x = a ?? [];
  const y = b ?? [];
  if (x.length !== y.length) return false;
  return x.every((m, i) => m.type === y[i]?.type && JSON.stringify(m.attrs ?? {}) === JSON.stringify(y[i]?.attrs ?? {}));
}

/**
 * Join neighbouring text nodes that carry the same marks. A reader emits a text node per run
 * and Word breaks a sentence into a dozen runs; the editor would merge them on its first
 * transaction anyway, and the Yjs state is smaller if they arrive merged.
 */
export function mergeText(nodes: JSONContent[]): JSONContent[] {
  const out: JSONContent[] = [];
  for (const n of nodes) {
    const last = out[out.length - 1];
    if (n.type === 'text' && last?.type === 'text' && sameMarks(last.marks, n.marks)) {
      out[out.length - 1] = { ...last, text: `${last.text ?? ''}${n.text ?? ''}` };
    } else if (n.type !== 'text' || (n.text ?? '') !== '') {
      out.push(n);
    }
  }
  return out;
}

/** The text of a node and everything in it. Leaf nodes contribute nothing. */
export function textOf(node: JSONContent): string {
  if (node.type === 'text') return node.text ?? '';
  return (node.content ?? []).map(textOf).join('');
}

/** Visit every node, parents first. Return false to skip a node's children. */
export function walk(node: JSONContent, visit: (n: JSONContent, parent: JSONContent | null) => boolean | void, parent: JSONContent | null = null): void {
  if (visit(node, parent) === false) return;
  for (const child of node.content ?? []) walk(child, visit, node);
}

/** Headings 1 to 3, as the table of contents node lists them. */
export function headingEntries(body: JSONContent): { level: number; text: string }[] {
  const out: { level: number; text: string }[] = [];
  walk(body, (n) => {
    if (n.type === 'heading') {
      const level = Number(n.attrs?.level) || 1;
      const t = textOf(n).trim();
      if (level <= 3 && t) out.push({ level, text: t });
      return false;
    }
    return true;
  });
  return out;
}

/** The document is nothing but one empty paragraph. */
export function isBlank(body: JSONContent): boolean {
  const c = body.content ?? [];
  return c.length === 0 || (c.length === 1 && c[0]?.type === 'paragraph' && !(c[0].content?.length ?? 0));
}
