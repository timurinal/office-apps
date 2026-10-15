/**
 * A Word, Markdown, HTML or text file, opened as a new document.
 *
 * The converters are the editor's own (`formats/`, in a Web Worker). Their pictures come back
 * as `import:<n>` placeholders, which the cloud app swaps for uploaded assets; here each goes
 * into the document as a data URL, reduced as a picture pasted into a local document is
 * (`INLINE_PROFILE`). Comment threads have nowhere to live offline, and are counted instead.
 */

import * as Y from 'yjs';
import type { JSONContent } from '@tiptap/core';
import { blobToDataUrl, INLINE_PROFILE, prepareImage } from '../docs/core/imageFiles';
import { IMAGE_TOKEN_PREFIX } from '../formats/types';
import { fromBase64 } from './host';
import { extensionOf } from './kinds';

export interface ImportedDocument {
  state: Uint8Array;
  title: string;
  /** Sentences to show after it opens: what did not come across. */
  notes: string[];
}

const MAX_TEXT = 4 * 1024 * 1024;

export async function importDocsFile(name: string, bytes: Uint8Array): Promise<ImportedDocument> {
  if (extensionOf(name) === 'txt') return importText(name, bytes);

  const { convertFile } = await import('../formats/browser/importClient');
  const out = await convertFile(name, bytes);
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, fromBase64(out.stateBase64));
    const notes = out.warnings.map((w) => w.message);

    const urls = new Map<string, string>();
    let dropped = 0;
    for (const img of out.images) {
      try {
        const prepared = await prepareImage(new File([img.bytes as BlobPart], img.name, { type: img.mime }), INLINE_PROFILE);
        urls.set(img.token, await blobToDataUrl(prepared.blob));
      } catch {
        dropped += 1;
      }
    }
    if (urls.size) setPictureSources(doc, urls);
    if (dropped) notes.push(dropped === 1 ? 'A picture was too large to keep.' : `${dropped} pictures were too large to keep.`);
    if (out.threads.length) notes.push(out.threads.length === 1 ? 'A comment was left out.' : `${out.threads.length} comments were left out.`);

    return { state: Y.encodeStateAsUpdate(doc), title: out.title, notes };
  } finally {
    doc.destroy();
  }
}

async function importText(name: string, bytes: Uint8Array): Promise<ImportedDocument> {
  if (bytes.length > MAX_TEXT) throw new Error('That file is too large.');
  const { seedState } = await import('../docs/seed');
  const text = new TextDecoder('utf-8').decode(bytes).replace(/\r\n?/g, '\n');
  const content: JSONContent[] = text.split('\n').map((line) => ({
    type: 'paragraph',
    ...(line ? { content: [{ type: 'text', text: line }] } : {})
  }));
  const title = name.replace(/^.*[\\/]/, '').replace(/\.[A-Za-z0-9]{1,8}$/, '').trim() || 'Untitled';
  return { state: seedState({ type: 'doc', content }), title, notes: [] };
}

/**
 * Swap each `import:<n>` placeholder in the document's pictures for its source, in one
 * transaction. Answers how many were set; anything else is left as it was.
 */
export function setPictureSources(doc: Y.Doc, urls: ReadonlyMap<string, string>): number {
  let count = 0;
  doc.transact(() => {
    const visit = (node: Y.XmlFragment | Y.XmlElement) => {
      for (const child of node.toArray()) {
        if (!(child instanceof Y.XmlElement)) continue;
        if (child.nodeName === 'image') {
          const src = child.getAttribute('src');
          const url = typeof src === 'string' && src.startsWith(IMAGE_TOKEN_PREFIX) ? urls.get(src) : undefined;
          if (url) {
            child.setAttribute('src', url);
            count++;
          }
        } else visit(child);
      }
    };
    visit(doc.getXmlFragment('default'));
  }, 'import-pictures');
  return count;
}
