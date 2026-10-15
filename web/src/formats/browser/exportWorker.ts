/**
 * The export worker: a document model in, a file out. Building a docx is as much work as
 * reading one, and it is loaded only when somebody downloads.
 */

import { exportDocument } from '../export';
import type { ExportReply, ExportRequest } from './protocol';

const scope = self as unknown as {
  onmessage: ((e: MessageEvent<ExportRequest>) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
};

scope.onmessage = async (e) => {
  const { id, format, model, title, origin, now, images, comments } = e.data;
  try {
    const out = await exportDocument(format, model, {
      title,
      origin,
      now,
      comments,
      resolveImage: (src) => images[src] ?? null
    });
    const reply: ExportReply = { id, ok: true, bytes: out.bytes, mime: out.mime, extension: out.extension, warnings: out.warnings };
    scope.postMessage(reply, [out.bytes.buffer as ArrayBuffer]);
  } catch (err) {
    console.error('[export]', err);
    const reply: ExportReply = { id, ok: false, message: 'Could not make that file.' };
    scope.postMessage(reply);
  }
};
