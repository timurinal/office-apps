/**
 * A template's content as the Yjs state of a new document.
 *
 * The body is `seedState`'s (seed.ts): validated against the editor's schema, so a node that
 * does not belong fails here and in the template's test, not in front of a reader. This adds
 * what a template has beside the body and `seedState` does not: the header and footer
 * fragments and the page setup (pagination/), written the way the page view writes them.
 *
 * Heavy, and only for a card that was pressed: it carries the schema. `create.ts` loads it
 * on demand, so Home never does.
 */

import * as Y from 'yjs';
import { prosemirrorToYXmlFragment } from '@tiptap/y-tiptap';
import { LIMITS } from '@shared/api';
import { fragmentName, hfSchema } from '../pagination/headerFooter';
import { writeSetup } from '../pagination/setup';
import { seedState, SeedTooLarge, toBase64 } from '../seed';
import type { DocsTemplate } from './types';

export function templateState(t: DocsTemplate): Uint8Array {
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, seedState({ type: 'doc', content: t.body }));

    for (const [kind, blocks] of [['header', t.header], ['footer', t.footer]] as const) {
      if (!blocks?.length) continue;
      const node = hfSchema().nodeFromJSON({ type: 'doc', content: blocks });
      node.check();
      prosemirrorToYXmlFragment(node, doc.getXmlFragment(fragmentName(kind, 'default')));
    }
    if (t.page) writeSetup(doc, t.page);

    const state = Y.encodeStateAsUpdate(doc);
    if (state.byteLength > LIMITS.docStateMaxBytes) throw new SeedTooLarge(state.byteLength);
    return state;
  } finally {
    doc.destroy();
  }
}

/** The `state` field of the create call. */
export const templateBase64 = (t: DocsTemplate): string => toBase64(templateState(t));
