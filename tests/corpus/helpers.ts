/**
 * Helpers the corpus tests share: where the files are, how to read them, and a model
 * flattened to lines so two models can be compared and a person can read the difference.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DocModel, JSONContent } from '../../web/src/formats/types';

export const CORPUS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'docx');
export const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), 'out');

export const bytesOf = (path: string): Uint8Array => new Uint8Array(readFileSync(path));

/** Every docx in a corpus folder, by path. */
export function listDocx(dir: string): string[] {
  return existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => f.endsWith('.docx'))
        .sort()
        .map((f) => join(dir, f))
    : [];
}

const MARKS_SHOWN = new Set(['bold', 'italic', 'underline', 'strike', 'subscript', 'superscript', 'link', 'highlight', 'insertion', 'deletion', 'code']);

/** Spacing a writer's own defaults supply when a paragraph has none; a re-import reads them back as set. */
const IMPLIED = { lineHeight: 1.08, spaceAfter: 8 } as const;

function attrsLine(n: JSONContent, drop: readonly string[] = []): string {
  const a = { ...(n.attrs ?? {}) } as Record<string, unknown>;
  for (const k of drop) delete a[k];
  for (const [k, v] of Object.entries(a)) {
    if (v === null || v === undefined || v === false || (k === 'indent' && v === 0)) delete a[k];
    if (k in IMPLIED && v === IMPLIED[k as keyof typeof IMPLIED]) delete a[k];
    if (k === 'suggest' || k === 'entries') delete a[k];
    if (k === 'colwidth') delete a[k];
  }
  const keys = Object.keys(a).sort();
  return keys.length ? ` {${keys.map((k) => `${k}=${JSON.stringify(a[k])}`).join(' ')}}` : '';
}

function markLabel(m: NonNullable<JSONContent['marks']>[number]): string | null {
  if (m.type === 'textStyle') {
    const a = (m.attrs ?? {}) as Record<string, unknown>;
    // The document's own font is not formatting; any other is.
    const parts = ['fontFamily', 'fontSize', 'color'].filter((k) => a[k] && !(k === 'fontFamily' && a[k] === 'Calibri')).map((k) => `${k}:${String(a[k])}`);
    return parts.length ? `style(${parts.join(',')})` : null;
  }
  if (m.type === 'link') return `link(${String(m.attrs?.href)})`;
  if (m.type === 'highlight') return `highlight(${String(m.attrs?.color)})`;
  if (m.type === 'insertion' || m.type === 'deletion') return `${m.type}(${String(m.attrs?.authorName)})`;
  return MARKS_SHOWN.has(m.type) ? m.type : null;
}

/** The model as lines: one per block, text runs with the marks that matter, in a stable order. */
export function outline(node: JSONContent, depth = 0, out: string[] = []): string[] {
  const pad = '  '.repeat(depth);
  switch (node.type) {
    case 'doc':
      for (const c of node.content ?? []) outline(c, depth, out);
      return out;
    case 'paragraph':
    case 'heading':
    case 'codeBlock': {
      const runs: string[] = [];
      for (const c of node.content ?? []) {
        if (c.type === 'text') {
          const marks = (c.marks ?? []).map(markLabel).filter(Boolean).sort();
          const prev = runs[runs.length - 1];
          const label = `${JSON.stringify(c.text)}${marks.length ? `[${marks.join(',')}]` : ''}`;
          void prev;
          runs.push(label);
        } else if (c.type === 'footnote') runs.push(`<footnote ${JSON.stringify((c.content ?? []).map((x) => x.text).join(''))}>`);
        else if (c.type === 'hardBreak') runs.push('<br>');
        else if (c.type === 'pageField') runs.push(`<field ${String(c.attrs?.kind)}>`);
        else runs.push(`<${c.type}>`);
      }
      out.push(`${pad}${node.type}${attrsLine(node)} ${runs.join(' ')}`.trimEnd());
      return out;
    }
    default: {
      out.push(`${pad}${node.type}${attrsLine(node)}`);
      for (const c of node.content ?? []) outline(c, depth + 1, out);
      return out;
    }
  }
}

/** Merge neighbouring runs that carry the same marks, so a different run split is not a difference. */
export function mergedOutline(node: JSONContent): string[] {
  const merge = (n: JSONContent): JSONContent => {
    if (!n.content) return n;
    const content: JSONContent[] = [];
    for (const c of n.content.map(merge)) {
      const last = content[content.length - 1];
      if (c.type === 'text' && last?.type === 'text' && JSON.stringify(last.marks ?? []) === JSON.stringify(c.marks ?? [])) {
        content[content.length - 1] = { ...last, text: (last.text ?? '') + (c.text ?? '') };
      } else content.push(c);
    }
    return { ...n, content };
  };
  return outline(merge(node));
}

export const countNodes = (n: JSONContent, type: string): number =>
  (n.type === type ? 1 : 0) + (n.content ?? []).reduce((sum, c) => sum + countNodes(c, type), 0);

export const allText = (n: JSONContent): string => (n.type === 'text' ? (n.text ?? '') : (n.content ?? []).map(allText).join(''));

export const modelOutline = (m: DocModel): string[] => mergedOutline(m.body);

/**
 * A model with the differences that are not differences removed: neighbouring bullet lists
 * are one list (the writer gives a document one bullet definition, so adjacent lists made of
 * separate definitions come back as one), and a table of contents is its entries.
 */
export function normalised(node: JSONContent): JSONContent {
  const kids = (node.content ?? []).map(normalised);
  const content: JSONContent[] = [];
  for (const k of kids) {
    const last = content[content.length - 1];
    if (k.type === 'bulletList' && last?.type === 'bulletList') {
      content[content.length - 1] = { ...last, content: [...(last.content ?? []), ...(k.content ?? [])] };
    } else content.push(k);
  }
  return node.content ? { ...node, content } : node;
}

export const normalisedOutline = (m: DocModel): string[] => mergedOutline(normalised(m.body)).map((l) => l.replace(/src="import:\d+"/g, 'src=<picture>'));

/** The words of a model, one text node at a time, so blocks do not run together. */
export function wordsOf(n: JSONContent, out: string[] = [], skipDeleted = false): string[] {
  if (n.type === 'text' && !(skipDeleted && n.marks?.some((m) => m.type === 'deletion'))) out.push(...(n.text ?? '').split(/\s+/).filter(Boolean));
  for (const c of n.content ?? []) wordsOf(c, out, skipDeleted);
  return out;
}
