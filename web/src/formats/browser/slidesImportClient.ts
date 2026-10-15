/**
 * Reading a presentation file from the page: a worker where there is one, the page's own thread where
 * there is not (the Vite dev server, and tests). The pptx reader is in this worker's chunk and in the
 * Slides editor's, and in no other.
 */

import { FormatError } from '../errors';
import type { SlidesImportOutcome } from '../importSlides';
import type { SlidesWorkerReply } from './protocol';

let next = 0;

/** A package that sends the parser in circles is stopped: the worker is the one thing that can be. */
const TIMEOUT_MS = 120_000;

const supported = (): boolean => typeof Worker !== 'undefined' && !import.meta.env.DEV;

function inWorker(name: string, bytes: Uint8Array): Promise<SlidesImportOutcome> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./slidesImportWorker.ts', import.meta.url), { type: 'module' });
    const id = ++next;
    const done = () => {
      clearTimeout(timer);
      worker.terminate();
    };
    const timer = setTimeout(() => {
      done();
      reject(new FormatError('failed', 'timed out'));
    }, TIMEOUT_MS);
    worker.onmessage = (e: MessageEvent<SlidesWorkerReply>) => {
      if (e.data.id !== id) return;
      done();
      if (e.data.ok) resolve(e.data.out);
      else reject(new FormatError(e.data.code));
    };
    worker.onerror = () => {
      done();
      reject(new FormatError('failed'));
    };
    worker.postMessage({ id, name, bytes }, [bytes.buffer as ArrayBuffer]);
  });
}

/** Read `bytes` as the file `name` and make everything a new presentation needs. */
export async function convertSlidesFile(name: string, bytes: Uint8Array): Promise<SlidesImportOutcome> {
  if (supported()) return inWorker(name, bytes);
  const { importSlides } = await import('../importSlides');
  return importSlides(name, bytes);
}
