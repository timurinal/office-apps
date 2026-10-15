/**
 * The outline: a document's headings, for the pane on the left and for jumping.
 *
 * Headings only, Heading 1 to 6, in document order. Title and Subtitle are styles of a
 * paragraph and are not in it, as in Word's navigation pane.
 */

import type { Node as PMNode } from '@tiptap/pm/model';

export interface OutlineItem {
  level: number;
  text: string;
  /** The document position of the heading's first character. */
  pos: number;
}

export function outlineOf(doc: PMNode): OutlineItem[] {
  const out: OutlineItem[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === 'heading') {
      const text = node.textContent.trim();
      if (text) out.push({ level: Math.min(6, Math.max(1, Number(node.attrs.level) || 1)), text, pos: pos + 1 });
      return false;
    }
    // Headings sit at the top, in a list item, or in a table cell; a code block's text is not one.
    return !node.isTextblock;
  });
  return out;
}

/** The last heading at or before `pos`: the section the caret is in. -1 before the first. */
export function sectionAt(items: readonly OutlineItem[], pos: number): number {
  let at = -1;
  for (let i = 0; i < items.length; i++) {
    if (items[i]!.pos <= pos) at = i;
    else break;
  }
  return at;
}
