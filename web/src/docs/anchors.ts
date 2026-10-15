/**
 * Where a comment is attached in a Docs page, and finding that place again.
 *
 * A thread's anchor is a Yjs relative position: it names the character it sits
 * beside by that character's identity, not its offset, so it follows the text
 * as people type before it and survives a restore of the content around it. The
 * server stores the base64 and knows nothing else about it (`CommentAnchor` in
 * shared/api.ts), so whether a position still exists is the page's question,
 * answered here. A thread whose text has been deleted resolves to null and is
 * drawn as detached.
 */

import * as Y from 'yjs';
import type { Editor } from '@tiptap/core';
import { absolutePositionToRelativePosition, relativePositionToAbsolutePosition, ySyncPluginKey } from '@tiptap/y-tiptap';
import type { CommentAnchor } from '@shared/api';
import { fromBase64, toBase64 } from '../crypto/primitives';

export type DocsAnchor = Extract<CommentAnchor, { kind: 'docs' }>;

/** What a thread needs, before it has an id. */
export type AnchorDraft = Pick<DocsAnchor, 'relpos' | 'relposEnd' | 'quote'>;

export const encodeRelativePosition = (rp: Y.RelativePosition): string =>
  toBase64(Y.encodeRelativePosition(rp));

export function decodeRelativePosition(b64: string): Y.RelativePosition | null {
  try {
    return Y.decodeRelativePosition(fromBase64(b64));
  } catch {
    return null;
  }
}

/** The longest quote kept for display. The server keeps 500. */
const QUOTE_MAX = 200;

/** The selection as an anchor, or null when nothing is selected. */
export function captureSelection(editor: Editor): AnchorDraft | null {
  const { from, to, empty } = editor.state.selection;
  if (empty) return null;
  const sync = ySyncPluginKey.getState(editor.state);
  if (!sync?.binding) return null;

  const start = absolutePositionToRelativePosition(from, sync.type, sync.binding.mapping);
  const end = absolutePositionToRelativePosition(to, sync.type, sync.binding.mapping);
  const quote = editor.state.doc.textBetween(from, to, ' ').replace(/\s+/g, ' ').trim().slice(0, QUOTE_MAX);

  return {
    relpos: encodeRelativePosition(start),
    relposEnd: encodeRelativePosition(end),
    ...(quote ? { quote } : {})
  };
}

/** Where the anchor is in the page now, or null when its text is gone. */
export function resolveAnchor(editor: Editor, anchor: DocsAnchor): { from: number; to: number } | null {
  const sync = ySyncPluginKey.getState(editor.state);
  if (!sync?.binding) return null;

  const at = (b64: string | undefined): number | null => {
    const rp = b64 ? decodeRelativePosition(b64) : null;
    return rp ? relativePositionToAbsolutePosition(sync.doc, sync.type, rp, sync.binding.mapping) : null;
  };

  const from = at(anchor.relpos);
  if (from === null) return null;
  const to = anchor.relposEnd ? (at(anchor.relposEnd) ?? from) : from;
  const size = editor.state.doc.content.size;
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  // A range whose ends have collapsed together has had its text deleted.
  if (anchor.relposEnd && lo === hi) return null;
  return { from: Math.min(lo, size), to: Math.min(hi, size) };
}
