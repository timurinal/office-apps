/**
 * The presentation export worker: a deck and its pictures in, a .pptx out. Writing one is an XML string
 * per slide and a zip; for a deck of a hundred slides that is a long task the page should not have.
 */

import { buildPptx } from './slidesExport';
import type { SlidesExportReply, SlidesExportRequest } from './protocol';

const scope = self as unknown as {
  onmessage: ((e: MessageEvent<SlidesExportRequest>) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
};

scope.onmessage = async (e) => {
  const { id, deck, assets, title, now } = e.data;
  try {
    const out = await buildPptx(deck, assets, { title, now });
    const reply: SlidesExportReply = { id, ok: true, bytes: out.bytes, warnings: out.warnings };
    scope.postMessage(reply, [out.bytes.buffer as ArrayBuffer]);
  } catch (err) {
    console.error('[export]', err);
    const reply: SlidesExportReply = { id, ok: false, message: 'Could not make that file.' };
    scope.postMessage(reply);
  }
};
