/**
 * The spreadsheet import worker: a file in, a workbook's state and cells out, with the page free
 * in between. Reading a workbook is an unzip, an XML parse, a pass over every cell and one over
 * every formula; for a large one that is seconds, and none of it belongs on the page's thread.
 */

import { isFormatError } from '../errors';
import { importSheet } from '../importSheets';
import type { SheetsWorkerReply, SheetsWorkerRequest } from './protocol';

const scope = self as unknown as {
  onmessage: ((e: MessageEvent<SheetsWorkerRequest>) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
};

scope.onmessage = async (e) => {
  const { id, name, bytes, dateOrder } = e.data;
  try {
    const out = await importSheet(name, bytes, dateOrder ? { dateOrder } : {});
    const reply: SheetsWorkerReply = { id, ok: true, out };
    scope.postMessage(reply);
  } catch (err) {
    // A message a person can read; anything else is ours to log and theirs to be told as little as possible.
    const reply: SheetsWorkerReply = isFormatError(err)
      ? { id, ok: false, code: err.code, message: err.message }
      : { id, ok: false, code: 'failed', message: 'That file could not be opened.' };
    if (!isFormatError(err)) console.error('[import]', err);
    scope.postMessage(reply);
  }
};
