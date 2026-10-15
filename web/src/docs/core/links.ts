/**
 * Links: what may be linked to, and putting one on the text.
 *
 * A link is clickable by every reader, so two doors are locked. `normaliseLink`
 * (docs/links.ts) cleans what a person typed into the popover and refuses anything that
 * is not a web or mail address. `isSafeHref` is what the link mark itself accepts
 * (docs/extensions.ts passes it to Tiptap's `isAllowedUri`): the same rule for what
 * arrives by paste, by autolink, or from another person's edit in the shared document. It
 * is deliberately narrower than Tiptap's default, which also lets `tel:`, `ftp:`, `sms:`
 * and relative addresses through.
 */

import { getMarkRange, type Editor } from '@tiptap/core';
import { normaliseLink } from '../links';

const ALLOWED = new Set(['http:', 'https:', 'mailto:']);

/** http, https and mailto, and only absolute ones. */
export function isSafeHref(href: string | null | undefined): boolean {
  if (!href) return false;
  // Whitespace and control characters are how `java\tscript:` slips past a prefix check.
  if (/[\u0000- \u007f-\u009f]/.test(href)) return false;
  try {
    return ALLOWED.has(new URL(href).protocol);
  } catch {
    return false;
  }
}

export interface LinkAt {
  href: string;
  text: string;
  from: number;
  to: number;
}

/** The link the caret or selection is in. */
export function linkAt(editor: Editor): LinkAt | null {
  const type = editor.schema.marks.link;
  if (!type) return null;
  const { $from } = editor.state.selection;
  const range = getMarkRange($from, type) ?? (editor.state.selection.empty ? null : getMarkRange(editor.state.selection.$to, type));
  if (!range) return null;
  const mark = $from.doc.nodeAt(range.from)?.marks.find((m) => m.type === type);
  if (!mark) return null;
  return {
    href: String(mark.attrs.href ?? ''),
    text: editor.state.doc.textBetween(range.from, range.to, ' '),
    from: range.from,
    to: range.to
  };
}

/**
 * Link the selection, or the link the caret is in, to `address`. With no selection and no
 * link under the caret, the link's text is inserted: `text`, or the address itself.
 * Answers false for an address that is not a web or mail address.
 */
export function applyLink(editor: Editor, address: string, text?: string): boolean {
  const href = normaliseLink(address);
  if (!href || !isSafeHref(href)) return false;
  const at = linkAt(editor);
  const label = text?.trim();
  const mark = { type: 'link', attrs: { href } };

  if (at) {
    const chain = editor.chain().focus();
    if (label && label !== at.text) chain.insertContentAt({ from: at.from, to: at.to }, { type: 'text', text: label, marks: [mark] });
    else chain.setTextSelection({ from: at.from, to: at.to }).setLink({ href });
    return chain.run();
  }
  if (editor.state.selection.empty) {
    return editor.chain().focus().insertContent({ type: 'text', text: label || href, marks: [mark] }).run();
  }
  if (label && label !== editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to, ' ')) {
    const { from, to } = editor.state.selection;
    return editor.chain().focus().insertContentAt({ from, to }, { type: 'text', text: label, marks: [mark] }).run();
  }
  return editor.chain().focus().setLink({ href }).run();
}

export function removeLink(editor: Editor): boolean {
  return editor.chain().focus().extendMarkRange('link').unsetLink().run();
}
