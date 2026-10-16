/**
 * The presentation import worker: a file in, a deck's state and its pictures out, with the page free in
 * between. Reading a deck is an unzip, an XML parse per slide, layout and master, and a deck written into Yjs.
 */

import { isFormatError } from '../errors';
import { importSlides } from '../importSlides';
import type { SlidesWorkerReply, SlidesWorkerRequest } from './protocol';

const scope = self as unknown as {
  onmessage: ((e: MessageEvent<SlidesWorkerRequest>) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
};

scope.onmessage = (e) => {
  const { id, name, bytes } = e.data;
  try {
    const out = importSlides(name, bytes);
    const reply: SlidesWorkerReply = { id, ok: true, out };
    scope.postMessage(reply, out.images.map((i) => i.bytes.buffer as ArrayBuffer));
  } catch (err) {
    // A message a person can read; anything else is ours to log and theirs to be told as little as possible.
    const reply: SlidesWorkerReply = isFormatError(err)
      ? { id, ok: false, code: err.code, message: err.message }
      : { id, ok: false, code: 'failed', message: 'That file could not be opened.' };
    if (!isFormatError(err)) console.error('[import]', err);
    scope.postMessage(reply);
  }
};
