/**
 * A real editor for tests: the base list and the core module's list, over a Yjs document,
 * in whatever DOM the test file asked for (`// @vitest-environment happy-dom`).
 *
 * It is the configuration the page runs, not a stand-in, so a test of a command is also a
 * test that the command's attributes survive Yjs, which is where a bad schema fails.
 */

import { Editor, type JSONContent } from '@tiptap/core';
import * as Y from 'yjs';
import { documentExtensions } from '../extensions';

/** Positions in a happy-dom page are all zero; ProseMirror asks for rectangles when it scrolls. */
function shimLayout(): void {
  const rects = () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} }) as unknown as DOMRectList;
  const zero = () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) }) as DOMRect;
  const proto = Range.prototype as unknown as Record<string, unknown>;
  proto.getClientRects ??= rects;
  proto.getBoundingClientRect ??= zero;
  const el = Element.prototype as unknown as Record<string, unknown>;
  el.scrollIntoView ??= () => undefined;
}

export interface TestEditor {
  editor: Editor;
  doc: Y.Doc;
  destroy: () => void;
}

export function makeEditor(content?: JSONContent): TestEditor {
  shimLayout();
  const doc = new Y.Doc();
  // In the page, so that an event in the editor reaches `document` as it would for a person.
  const element = document.body.appendChild(document.createElement('div'));
  const editor = new Editor({ element, extensions: documentExtensions({ doc, awareness: null }), editable: true });
  if (content) editor.commands.setContent(content);
  return { editor, doc, destroy: () => (editor.destroy(), doc.destroy(), element.remove()) };
}

export const p = (text: string, attrs: Record<string, unknown> = {}): JSONContent => ({
  type: 'paragraph',
  ...(Object.keys(attrs).length ? { attrs } : {}),
  content: text ? [{ type: 'text', text }] : []
});

export const h = (level: number, text: string): JSONContent => ({ type: 'heading', attrs: { level }, content: [{ type: 'text', text }] });

/** A looser shape than `JSONContent` for reading a document back in a test. */
export interface J {
  type?: string;
  attrs?: Record<string, any>;
  content?: J[];
  text?: string;
  marks?: Array<{ type: string; attrs?: Record<string, any> }>;
}
export const jsonOf = (editor: Editor): J => editor.getJSON() as unknown as J;

export const docOf = (...blocks: JSONContent[]): JSONContent => ({ type: 'doc', content: blocks });

/** Select all the text between two offsets of the document's text (not positions). */
export function selectText(editor: Editor, from: number, to: number): void {
  editor.commands.setTextSelection({ from, to });
}

/** Where `needle` first appears, as a document range. */
export function rangeOf(editor: Editor, needle: string): { from: number; to: number } {
  let found: { from: number; to: number } | null = null;
  editor.state.doc.descendants((node, pos) => {
    if (found || !node.isText) return;
    const i = (node.text ?? '').indexOf(needle);
    if (i >= 0) found = { from: pos + i, to: pos + i + needle.length };
  });
  if (!found) throw new Error(`"${needle}" is not in the document`);
  return found;
}

export function select(editor: Editor, needle: string): void {
  editor.commands.setTextSelection(rangeOf(editor, needle));
}
