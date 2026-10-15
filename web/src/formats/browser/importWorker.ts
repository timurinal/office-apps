/**
 * The import worker: a file in, a document's state out, with the page free in between.
 *
 * Reading a docx is an unzip, an XML parse and a walk, and encoding the result is a pass
 * over the whole document; for a long file that is long enough to drop frames. So it runs
 * here, and the page only sends bytes and receives bytes.
 */

import { isFormatError } from '../errors';
import { importDocument } from '../import';
import type { WorkerReply, WorkerRequest } from './protocol';

const scope = self as unknown as {
  onmessage: ((e: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
};

scope.onmessage = (e) => {
  const { id, name, bytes } = e.data;
  try {
    const { state: _state, ...out } = importDocument(name, bytes);
    void _state;
    const reply: WorkerReply = { id, ok: true, out };
    scope.postMessage(reply, out.images.map((i) => i.bytes.buffer as ArrayBuffer));
  } catch (err) {
    // A message a person can read; anything else is ours to log and theirs to be told as little as possible.
    const reply: WorkerReply = isFormatError(err)
      ? { id, ok: false, code: err.code, message: err.message }
      : { id, ok: false, code: 'failed', message: 'That file could not be opened.' };
    if (!isFormatError(err)) console.error('[import]', err);
    scope.postMessage(reply);
  }
};
