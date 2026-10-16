/**
 * A link on the whole text of a shape: what the shape menu's Link does when no part of the text is
 * chosen. A link is a mark on a run (`link { href }`, deck.ts), so this lays it over every run of the
 * chosen shapes, or takes it from them. The model writes the result as one step (`setTexts`).
 *
 * Pure: no DOM.
 */

import type { ElementJSON, ShapeElement, TextDoc, TextNode } from '../model/deck';

/** Every shape among `els`, a group's shapes included. */
export function shapesIn(els: readonly (ElementJSON | null)[]): ShapeElement[] {
  const out: ShapeElement[] = [];
  const walk = (e: ElementJSON) => {
    if (e.type === 'shape') out.push(e);
    else if (e.type === 'group') e.children.forEach(walk);
  };
  for (const e of els) if (e) walk(e);
  return out;
}

const runs = (doc: TextDoc): TextNode[] => {
  const out: TextNode[] = [];
  const walk = (n: TextNode) => {
    if (n.type === 'text' && n.text) out.push(n);
    n.content?.forEach(walk);
  };
  doc.content.forEach(walk);
  return out;
};

/** Whether there is any text to link. */
export const hasText = (doc: TextDoc): boolean => runs(doc).length > 0;

/** The address every run of the text links to; null when they differ, or some run has none. */
export function linkOf(doc: TextDoc): string | null {
  const all = runs(doc);
  if (!all.length) return null;
  let href: string | null = null;
  for (const r of all) {
    const h = r.marks?.find((m) => m.type === 'link')?.attrs?.href;
    if (typeof h !== 'string') return null;
    if (href === null) href = h;
    else if (h !== href) return null;
  }
  return href;
}

/** The text with every run linked to `href`, or with no link on any run (null). */
export function setLink(doc: TextDoc, href: string | null): TextDoc {
  const walk = (n: TextNode): TextNode => {
    if (n.type === 'text') {
      const kept = (n.marks ?? []).filter((m) => m.type !== 'link');
      const marks = href === null ? kept : [...kept, { type: 'link', attrs: { href } }];
      const { marks: _drop, ...rest } = n;
      return marks.length ? { ...rest, marks } : rest;
    }
    return n.content ? { ...n, content: n.content.map(walk) } : n;
  };
  return { ...doc, content: doc.content.map(walk) };
}
