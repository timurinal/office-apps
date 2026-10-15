/**
 * File > Download, from the open page.
 *
 * The page reads the document's model from its live `Y.Doc` (the body, the page setup and
 * the headers), fetches the pictures it refers to (the converters have no network), and
 * hands both to the export worker. What comes back is saved through a link with a `download`
 * attribute: nothing is uploaded and nothing waits on the server.
 *
 * Comments are put in a docx, anchored where their text still is. The other formats have no
 * place for them.
 */

import type { Editor } from '@tiptap/core';
import { ySyncPluginKey } from '@tiptap/y-tiptap';
import { comments as commentsApi } from '../../client';
import { errorText } from '../../api';
import type { Toast } from '../../core/ui';
import { resolveAnchor, type DocsAnchor } from '../../docs/anchors';
import { EXPORT_FORMATS, imageSources, type ExportFormat } from '../formats';
import { assetMimeOf, decodeDataImage } from '../images';
import { offsetMap } from '../textOffsets';
import type { DocModel, ExportComment, ImageData } from '../types';
import { modelFromDoc } from '../ydoc';
import { buildFile } from './exportClient';
import { fileNameOf, save } from './saveFile';

export { fileNameOf, save };

export interface DownloadHost {
  editor: Editor | null;
  title: string;
  /** The cloud document's id; null for a local file. */
  documentId: string | null;
  /** Whether this person may read the document's comments. */
  comments: boolean;
  notify: (toast: Toast) => void;
}

/** The model of what is on the page now. */
export function modelOfEditor(editor: Editor): DocModel {
  const doc = ySyncPluginKey.getState(editor.state)?.doc;
  if (doc) return modelFromDoc(doc);
  return { body: editor.getJSON() as DocModel['body'], page: null, header: {}, footer: {} };
}

/** Word takes PNG, JPEG and GIF. A WebP is drawn to a canvas and kept as PNG. */
async function toPng(bytes: Uint8Array): Promise<Uint8Array | null> {
  if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas !== 'function') return null;
  try {
    const bitmap = await createImageBitmap(new Blob([bytes as BlobPart], { type: 'image/webp' }));
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0);
    bitmap.close();
    return new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer());
  } catch {
    return null;
  }
}

async function fetchImage(src: string, format: ExportFormat): Promise<ImageData | null> {
  let bytes: Uint8Array | null = null;
  if (src.startsWith('data:')) bytes = decodeDataImage(src)?.bytes ?? null;
  else if (src.startsWith('/api/office/')) {
    // Only this document's own pictures: the address is checked by the editor's schema, and again here.
    const res = await fetch(src, { credentials: 'same-origin' }).catch(() => null);
    if (res?.ok) bytes = new Uint8Array(await res.arrayBuffer());
  }
  if (!bytes) return null;
  let mime = assetMimeOf(bytes);
  if (!mime) return null;
  if (mime === 'image/webp' && format === 'docx') {
    const png = await toPng(bytes);
    if (!png) return null;
    bytes = png;
    mime = 'image/png';
  }
  return { bytes, mime, name: src.split('/').pop() ?? 'image' };
}

async function fetchImages(sources: string[], format: ExportFormat): Promise<Record<string, ImageData>> {
  const out: Record<string, ImageData> = {};
  let at = 0;
  // A few at a time: a document with forty pictures should not open forty requests at once.
  await Promise.all(
    Array.from({ length: Math.min(4, sources.length) }, async () => {
      while (at < sources.length) {
        const src = sources[at++]!;
        const img = await fetchImage(src, format);
        if (img) out[src] = img;
      }
    })
  );
  return out;
}

/** The document's threads as a docx wants them: each anchored by characters of text. */
async function exportComments(host: DownloadHost, editor: Editor): Promise<ExportComment[]> {
  if (!host.documentId || !host.comments) return [];
  try {
    const { threads } = await commentsApi.list(host.documentId);
    const map = offsetMap(editor.state.doc);
    const out: ExportComment[] = [];
    for (const t of threads) {
      if (t.anchor.kind !== 'docs') continue;
      const range = resolveAnchor(editor, t.anchor as DocsAnchor);
      const [first, ...replies] = t.messages;
      if (!range || !first) continue;
      out.push({
        id: t.id,
        author: first.authorName,
        at: first.createdAt * 1000,
        text: first.body,
        resolved: t.resolved,
        start: map.offsetOf(range.from),
        end: map.offsetOf(range.to),
        replies: replies.map((r) => ({ author: r.authorName, at: r.createdAt * 1000, text: r.body }))
      });
    }
    return out;
  } catch {
    // The comments are a nicety of the file; the document is not held back for them.
    return [];
  }
}

export async function downloadDocument(host: DownloadHost, format: ExportFormat): Promise<void> {
  const editor = host.editor;
  if (!editor || editor.isDestroyed) return;
  try {
    const model = modelOfEditor(editor);
    const [images, comments] = await Promise.all([
      fetchImages(imageSources(model), format),
      format === 'docx' ? exportComments(host, editor) : Promise.resolve([])
    ]);
    const file = await buildFile({ format, model, title: host.title, origin: location.origin, images, comments });
    save(file.bytes, file.mime, fileNameOf(host.title, file.extension));
    const first = file.warnings[0];
    host.notify(first ? { text: `Saved ${EXPORT_FORMATS[format].extension.toUpperCase()}. ${first.message}` } : { text: `Saved ${fileNameOf(host.title, file.extension)}.` });
  } catch (err) {
    host.notify({ text: errorText(err, 'Could not make that file.'), tone: 'danger' });
  }
}

