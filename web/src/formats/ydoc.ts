/**
 * A document model to its Yjs state, and back.
 *
 * What a converter makes is a `DocModel`: a body in the editor's schema, the page setup, the
 * headers and footers. What the room holds is a Yjs document with the body on the field
 * `default` (Tiptap's own), the page setup in the `page` map and the headers and footers in
 * four fragments beside it (docs/pagination/). This is the join between the two, and it is
 * the same join `docs/seed.ts` makes for a body alone: the schema is the one the editor
 * builds, so a node a module adds is accepted here the day it is added.
 *
 * It reads no DOM and writes none, so it runs in the import worker, and the Worker that
 * exports for the assistant can run it too.
 */

import { prosemirrorToYXmlFragment, yXmlFragmentToProseMirrorRootNode, yXmlFragmentToProsemirrorJSON } from '@tiptap/y-tiptap';
import * as Y from 'yjs';
import { docsSchema } from '../docs/seed';
import { HF_FRAGMENTS, fragmentName, hfSchema, type HFKind, type HFVariant } from '../docs/pagination/headerFooter';
import { PAGE_MAP, PAGE_ORIGIN, readSetup, writeSetup } from '../docs/pagination/setup';
import { FIELD } from '../docs/room';
import { FormatError } from './errors';
import { MAX_STATE_BYTES } from './limits';
import type { DocModel, HeaderFooterModel, JSONContent, PageModel } from './types';

/** An editor adds an empty paragraph after a table or a picture at the end; added here, it is added once. */
function withTrailingParagraph(body: JSONContent): JSONContent {
  const last = body.content?.at(-1);
  if (!body.content || !last || last.type === 'paragraph') return body;
  return { ...body, content: [...body.content, { type: 'paragraph' }] };
}

/**
 * The Yjs update that makes `model` the content of a new document. Throws `document_too_large`
 * past the room's cap, and a plain error for JSON that is not valid in the schema: a converter
 * that produces one has a bug, and the document it would have made would open differently
 * from the file.
 */
export function buildState(model: DocModel): Uint8Array {
  const ydoc = new Y.Doc();
  try {
    const node = docsSchema().nodeFromJSON(withTrailingParagraph(model.body));
    node.check();
    prosemirrorToYXmlFragment(node, ydoc.getXmlFragment(FIELD));

    if (model.page) {
      writeSetup(ydoc, {
        size: model.page.size,
        orientation: model.page.orientation,
        margins: model.page.margins,
        headerDistance: model.page.headerDistance,
        footerDistance: model.page.footerDistance,
        differentFirst: model.page.differentFirst,
        // A file is its pages: it opens in print layout.
        paged: true
      });
    }
    const put = (kind: HFKind, variant: HFVariant, json: JSONContent | undefined) => {
      if (!json) return;
      const hf = hfSchema().nodeFromJSON(json);
      hf.check();
      prosemirrorToYXmlFragment(hf, ydoc.getXmlFragment(fragmentName(kind, variant)));
    };
    put('header', 'default', model.header.default);
    put('header', 'first', model.header.first);
    put('footer', 'default', model.footer.default);
    put('footer', 'first', model.footer.first);

    const state = Y.encodeStateAsUpdate(ydoc);
    if (state.byteLength > MAX_STATE_BYTES) throw new FormatError('document_too_large', `${state.byteLength} bytes`);
    return state;
  } finally {
    ydoc.destroy();
  }
}

/** ProseMirror writes every attribute a node has, set or not; a model says only what is set. */
function withoutNulls(n: JSONContent): JSONContent {
  const attrs = n.attrs ? Object.fromEntries(Object.entries(n.attrs).filter(([, v]) => v !== null && v !== undefined)) : undefined;
  const { attrs: _drop, ...rest } = n;
  void _drop;
  return {
    ...rest,
    ...(attrs && Object.keys(attrs).length > 0 ? { attrs } : {}),
    ...(n.content ? { content: n.content.map(withoutNulls) } : {})
  };
}

/** The model a document holds, read from a live or loaded `Y.Doc`. */
export function modelFromDoc(ydoc: Y.Doc): DocModel {
  const body = yXmlFragmentToProsemirrorJSON(ydoc.getXmlFragment(FIELD)) as JSONContent;
  const map = ydoc.getMap<unknown>(PAGE_MAP);
  let page: PageModel | null = null;
  if (map.size > 0) {
    const s = readSetup(map);
    page = {
      size: s.size,
      orientation: s.orientation,
      margins: s.margins,
      headerDistance: s.headerDistance,
      footerDistance: s.footerDistance,
      differentFirst: s.differentFirst
    };
  }
  const read = (kind: HFKind, variant: HFVariant): JSONContent | undefined => {
    if (!HF_FRAGMENTS.includes(fragmentName(kind, variant) as (typeof HF_FRAGMENTS)[number])) return undefined;
    const fragment = ydoc.getXmlFragment(fragmentName(kind, variant));
    if (fragment.length === 0) return undefined;
    try {
      return withoutNulls(yXmlFragmentToProseMirrorRootNode(fragment, hfSchema()).toJSON() as JSONContent);
    } catch {
      return undefined;
    }
  };
  const group = (kind: HFKind): HeaderFooterModel => {
    const out: HeaderFooterModel = {};
    const d = read(kind, 'default');
    const f = read(kind, 'first');
    if (d) out.default = d;
    if (f) out.first = f;
    return out;
  };
  return { body: body.type ? body : { type: 'doc', content: [{ type: 'paragraph' }] }, page, header: group('header'), footer: group('footer') };
}

/** The model of a Yjs update. For an export from stored state. */
export function modelFromState(state: Uint8Array): DocModel {
  const ydoc = new Y.Doc();
  try {
    Y.applyUpdate(ydoc, state);
    return modelFromDoc(ydoc);
  } finally {
    ydoc.destroy();
  }
}

export { PAGE_ORIGIN };
