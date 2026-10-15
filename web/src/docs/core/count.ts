/**
 * Counting: words, characters and paragraphs of a document or of a selection.
 *
 * A word is a run of characters between spaces, as Word counts it. A chip counts as the
 * text it shows (chipText.ts). A paragraph is a block with something in it: an empty line
 * is spacing, not a paragraph. Counts never cross a block, so `end.` `Start` is two words
 * even with no space between the blocks.
 *
 * One pass over the document and nothing allocated per word, so a 50-page document is a
 * few milliseconds. The footer recounts when typing pauses, not on each keystroke.
 */

import type { Node as PMNode } from '@tiptap/pm/model';
import { chipText } from './chipText';

export interface Counts {
  words: number;
  /** With spaces. */
  characters: number;
  charactersNoSpaces: number;
  paragraphs: number;
}

export const NO_COUNTS: Counts = { words: 0, characters: 0, charactersNoSpaces: 0, paragraphs: 0 };

const WORD = /\S+/g;
const SPACE = /\s/g;

/** The text of a textblock between `from` and `to` (document positions). */
function blockText(block: PMNode, blockPos: number, from: number, to: number): string {
  let out = '';
  block.forEach((child, offset) => {
    const start = blockPos + 1 + offset;
    const end = start + child.nodeSize;
    if (end <= from || start >= to) return;
    if (child.isText) {
      out += (child.text ?? '').slice(Math.max(0, from - start), Math.min(child.nodeSize, to - start));
    } else if (child.isLeaf) {
      // A chip is in the selection only when all of it is.
      const text = chipText(child.type.name, child.attrs) ?? (child.type.name === 'hardBreak' ? ' ' : '');
      if (from <= start && end <= to) out += ` ${text} `;
    }
  });
  return out;
}

export function countRange(doc: PMNode, from = 0, to: number = doc.content.size): Counts {
  const out: Counts = { words: 0, characters: 0, charactersNoSpaces: 0, paragraphs: 0 };
  doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isTextblock) return true;
    const text = blockText(node, pos, from, to);
    const trimmed = text.trim();
    if (trimmed) {
      out.paragraphs += 1;
      out.words += trimmed.match(WORD)?.length ?? 0;
      // Characters are the text's own: the padding a chip was given is not typed.
      const typed = text.replace(/ {2,}/g, ' ').trim();
      out.characters += typed.length;
      out.charactersNoSpaces += typed.replace(SPACE, '').length;
    }
    return false;
  });
  return out;
}

/** `1,284`, grouped the way the rest of the product writes numbers. */
export const formatCount = (n: number): string => n.toLocaleString('en-GB');
