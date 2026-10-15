/**
 * Reading a spreadsheet file from the page: a worker where there is one, the page's own thread where
 * there is not (the Vite dev server, and tests). ExcelJS is in this worker's chunk and in no other.
 */

import { FormatError } from '../errors';
import type { DateOrder } from '../../sheets/engine';
import type { SheetImportOptions, SheetImportOutcome } from '../importSheets';
import type { SheetsWorkerReply } from './protocol';

let next = 0;

/**
 * A file that will not be read: a formula the engine can never finish (the page, when it opens the
 * result, is where that is felt) is not the importer's, but a package that sends the parser in circles
 * is, and the worker is the one thing that can be stopped.
 */
const TIMEOUT_MS = 120_000;

let warm: { worker: Worker; timer: ReturnType<typeof setTimeout> } | null = null;

const supported = (): boolean => typeof Worker !== 'undefined' && !import.meta.env.DEV;

const start = () => new Worker(new URL('./sheetsImportWorker.ts', import.meta.url), { type: 'module' });

/** Start the worker now, so its script is loaded by the time a file arrives. One not used is put away after a minute. */
export function warmUpSheets(): void {
  if (!supported() || warm) return;
  const worker = start();
  warm = {
    worker,
    timer: setTimeout(() => {
      worker.terminate();
      warm = null;
    }, 60_000)
  };
}

function takeWorker(): Worker {
  if (warm) {
    clearTimeout(warm.timer);
    const { worker } = warm;
    warm = null;
    return worker;
  }
  return start();
}

function inWorker(name: string, bytes: Uint8Array, dateOrder?: DateOrder): Promise<SheetImportOutcome> {
  return new Promise((resolve, reject) => {
    const worker = takeWorker();
    const id = ++next;
    const done = () => {
      clearTimeout(timer);
      worker.terminate();
    };
    const timer = setTimeout(() => {
      done();
      reject(new FormatError('failed', 'timed out'));
    }, TIMEOUT_MS);
    worker.onmessage = (e: MessageEvent<SheetsWorkerReply>) => {
      if (e.data.id !== id) return;
      done();
      if (e.data.ok) resolve(e.data.out);
      else reject(new FormatError(e.data.code));
    };
    worker.onerror = () => {
      done();
      reject(new FormatError('failed'));
    };
    // The bytes move to the worker rather than being copied; the page does not need them again.
    worker.postMessage({ id, name, bytes, ...(dateOrder ? { dateOrder } : {}) }, [bytes.buffer as ArrayBuffer]);
  });
}

/** Read `bytes` as the file `name` and make everything a new workbook needs. */
export async function convertSheetFile(name: string, bytes: Uint8Array, opts: SheetImportOptions = {}): Promise<SheetImportOutcome> {
  if (supported()) return inWorker(name, bytes, opts.dateOrder);
  const { importSheet } = await import('../importSheets');
  return importSheet(name, bytes, opts);
}
