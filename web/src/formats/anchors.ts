/**
 * Comments from a file, ready to post.
 *
 * A comment's anchor is a Yjs relative position: the identity of a character, not its
 * offset. The identities are the ones the new document's state already carries, because the
 * room applies that state as it is. So the anchors can be worked out here, from the state
 * the converter just built, before the document exists, and posted once it does.
 */

import { absolutePositionToRelativePosition, initProseMirrorDoc } from '@tiptap/y-tiptap';
import * as Y from 'yjs';
import { docsSchema } from '../docs/seed';
import { FIELD } from '../docs/room';
import { bytesToBase64 } from './images';
import { MAX_COMMENT_MESSAGES } from './limits';
import { offsetMap } from './textOffsets';
import type { ImportedComment } from './types';

/** The longest quote kept for display. The server keeps 500; the page shows 200. */
const QUOTE_MAX = 200;

export interface PreparedMessage {
  author: string;
  at: number | null;
  text: string;
}

export interface PreparedThread {
  relpos: string;
  relposEnd: string;
  quote: string;
  resolved: boolean;
  /** The first message is the comment; the rest are replies. */
  messages: PreparedMessage[];
}

/**
 * Threads for `comments`, anchored in `state`. A comment whose text is gone, or a document
 * with no text at all, is left out. A reply joins its parent's thread.
 */
export function prepareThreads(state: Uint8Array, comments: readonly ImportedComment[]): PreparedThread[] {
  if (comments.length === 0) return [];
  const ydoc = new Y.Doc();
  try {
    Y.applyUpdate(ydoc, state);
    const fragment = ydoc.getXmlFragment(FIELD);
    const { doc, mapping } = initProseMirrorDoc(fragment, docsSchema());
    const map = offsetMap(doc);
    if (map.total === 0) return [];

    const byId = new Map(comments.map((c) => [c.id, c]));
    const threads = new Map<string, PreparedThread>();
    let messages = 0;
    for (const c of comments) {
      if (messages >= MAX_COMMENT_MESSAGES) break;
      const rootId = c.parent && byId.has(c.parent) ? c.parent : c.id;
      const message: PreparedMessage = { author: c.author, at: c.at, text: c.text };
      const existing = threads.get(rootId);
      if (existing) {
        existing.messages.push(message);
        messages++;
        continue;
      }
      const root = byId.get(rootId)!;
      // A point comment has no range; it takes the character beside it so there is text to mark.
      let start = root.start;
      let end = root.end;
      if (end <= start) {
        if (start < map.total) end = start + 1;
        else start = Math.max(0, end - 1);
      }
      const from = map.posOf(start);
      const to = map.posOf(end);
      if (from === null || to === null || to <= from) continue;
      const relpos = absolutePositionToRelativePosition(from, fragment, mapping);
      const relposEnd = absolutePositionToRelativePosition(to, fragment, mapping);
      const quote = doc.textBetween(from, to, ' ').replace(/\s+/g, ' ').trim().slice(0, QUOTE_MAX);
      threads.set(rootId, {
        relpos: bytesToBase64(Y.encodeRelativePosition(relpos)),
        relposEnd: bytesToBase64(Y.encodeRelativePosition(relposEnd)),
        quote,
        resolved: root.resolved,
        messages: [message]
      });
      messages++;
    }
    return [...threads.values()];
  } finally {
    ydoc.destroy();
  }
}
