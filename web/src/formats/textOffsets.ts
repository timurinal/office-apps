/**
 * Where in the document a run of text is, in two currencies.
 *
 * A converter does not know ProseMirror positions: they depend on how deep the nodes
 * nest, and the document is only built at the end. What it does know, as it walks a file in
 * order, is how much text it has written so far. So a comment's range is kept as
 * *characters of text* (counted over the document's text nodes, in document order, a
 * footnote's own text counted where the footnote stands), and this file turns that into
 * ProseMirror positions once the document exists, and back again for an export.
 */

import type { Node as PMNode } from '@tiptap/pm/model';

interface Piece {
  /** Characters of text before this node. */
  offset: number;
  /** ProseMirror position of its first character. */
  pos: number;
  length: number;
}

function pieces(doc: PMNode): Piece[] {
  const out: Piece[] = [];
  let offset = 0;
  doc.descendants((node, pos) => {
    if (node.isText) {
      const length = node.text?.length ?? 0;
      out.push({ offset, pos, length });
      offset += length;
    }
    return true;
  });
  return out;
}

export interface OffsetMap {
  /** Total characters of text. */
  total: number;
  /** The position of the character at `offset` (a position *before* that character). */
  posOf(offset: number): number | null;
  /** The characters of text before position `pos`. */
  offsetOf(pos: number): number;
}

export function offsetMap(doc: PMNode): OffsetMap {
  const list = pieces(doc);
  const total = list.reduce((n, p) => n + p.length, 0);
  return {
    total,
    posOf(offset) {
      if (list.length === 0) return null;
      const o = Math.max(0, Math.min(offset, total));
      // The piece that holds this offset, or the last one for an offset at the very end.
      let lo = 0;
      let hi = list.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (list[mid]!.offset <= o) lo = mid;
        else hi = mid - 1;
      }
      const p = list[lo]!;
      return p.pos + Math.min(o - p.offset, p.length);
    },
    offsetOf(pos) {
      let before = 0;
      for (const p of list) {
        if (pos <= p.pos) return before;
        if (pos < p.pos + p.length) return p.offset + (pos - p.pos);
        before = p.offset + p.length;
      }
      return before;
    }
  };
}
