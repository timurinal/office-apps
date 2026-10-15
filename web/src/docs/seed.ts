/**
 * Making a document's content without an editor: ProseMirror JSON in, a Yjs update out.
 *
 * The converters (docx, markdown, html) and the templates produce a document as
 * ProseMirror JSON in this editor's schema (`{ type: 'doc', content: [...] }`). To make a
 * new document from one, the page does not open an editor and type it in. It turns the
 * JSON into the Yjs update that an editor on the 'default' field would have produced, and
 * sends it with the create call, where the room applies it through its `import:` edit:
 *
 *     const state = seedState(json);                                   // Uint8Array
 *     await documents.create({ kind: 'docs', title, state: toBase64(state) });
 *
 * `seedBase64(json)` is those two steps. The room refuses a state over
 * `LIMITS.docStateMaxBytes`, so `seedState` throws `SeedTooLarge` for one, and the page
 * can say so before it uploads anything.
 *
 * ── The schema ──────────────────────────────────────────────────────────────
 * The schema is the one the editor builds from the base list and every module
 * (docs/extensions.ts), so a node a module adds is accepted here the day it is added,
 * with no second list to keep. JSON that is not valid in it (an unknown node, a node
 * where it may not go) throws, because the alternative is a document that opens
 * differently from what was imported.
 *
 * ── Where it runs ───────────────────────────────────────────────────────────
 * It reads no DOM and writes none, so it runs in a Web Worker, which is where a large
 * import belongs: the same worker that parsed the file builds the update, and the main
 * thread only sends bytes. Checked in a production build, in Chromium's own worker: 25,000
 * words become an update in about 12 ms, and `document` is not defined there.
 *
 * Two things about the bundle. Importing this file pulls in the module list, which draws
 * React, so a worker carries React it never calls (about 290 KB gzipped, in a chunk of its
 * own). And in `vite dev` the React plugin puts its refresh preamble in front of every `.tsx`
 * module, which touches `window`, so a worker that imports this file fails there with
 * "window is not defined". A production build is fine; in development, run the conversion
 * on the main thread or give the worker's bundle a configuration without the React plugin.
 */

import { getSchema, type JSONContent } from '@tiptap/core';
import type { Schema } from '@tiptap/pm/model';
import { prosemirrorToYXmlFragment, yXmlFragmentToProsemirrorJSON } from '@tiptap/y-tiptap';
import * as Y from 'yjs';
import { LIMITS } from '@shared/api';
import { documentExtensions } from './extensions';
import { FIELD } from './room';

export class SeedTooLarge extends Error {
  constructor(readonly bytes: number) {
    super('That document is too large.');
    this.name = 'SeedTooLarge';
  }
}

let schema: Schema | null = null;

/** This editor's schema. Built once: it is the same for every document. */
export function docsSchema(): Schema {
  // The binding and the carets add no nodes, so a scratch document stands in for the room's.
  schema ??= getSchema(documentExtensions({ doc: new Y.Doc(), awareness: null }));
  return schema;
}

/**
 * A document that ends in a table or a picture gets an empty paragraph after it, which is
 * what the editor's trailing-node rule would add the moment it opened the document. Added
 * here instead, because two people opening a fresh import at once would each add one.
 */
function withTrailingParagraph(json: JSONContent): JSONContent {
  const last = json.content?.at(-1);
  if (!json.content || !last || last.type === 'paragraph') return json;
  return { ...json, content: [...json.content, { type: 'paragraph' }] };
}

/** A Yjs update that makes a document of `json` on the editor's field. */
export function seedState(json: JSONContent): Uint8Array {
  const doc = new Y.Doc();
  try {
    // `check` is what turns a node in the wrong place into an error: reading JSON alone
    // accepts a paragraph inside a paragraph.
    const node = docsSchema().nodeFromJSON(withTrailingParagraph(json));
    node.check();
    prosemirrorToYXmlFragment(node, doc.getXmlFragment(FIELD));
    const state = Y.encodeStateAsUpdate(doc);
    if (state.byteLength > LIMITS.docStateMaxBytes) throw new SeedTooLarge(state.byteLength);
    return state;
  } finally {
    doc.destroy();
  }
}

/** The content of a Yjs update, as ProseMirror JSON. The other direction, for a test or an export. */
export function stateJSON(state: Uint8Array): JSONContent {
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, state);
    return yXmlFragmentToProsemirrorJSON(doc.getXmlFragment(FIELD)) as JSONContent;
  } finally {
    doc.destroy();
  }
}

/** Standard base64, in pieces: `btoa(String.fromCharCode(...bytes))` overflows the stack on a large update. */
export function toBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(out);
}

/** The `state` field of `CreateDocumentRequest` for `json`. */
export const seedBase64 = (json: JSONContent): string => toBase64(seedState(json));
