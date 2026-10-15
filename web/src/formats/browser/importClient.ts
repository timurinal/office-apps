/**
 * Converting a file from the page: a worker where there is one, the page's own thread where
 * there is not (the Vite dev server, whose React plugin cannot be part of a worker, and
 * tests).
 */

import { FormatError } from '../errors';
import type { ImportReply, WorkerReply } from './protocol';

let next = 0;

/** A worker started ahead of the file, so its script is loaded and parsed by the time one arrives. */
let warm: { worker: Worker; timer: ReturnType<typeof setTimeout> } | null = null;

const supported = (): boolean => typeof Worker !== 'undefined' && !import.meta.env.DEV;

/**
 * Start the import worker now. Called when a file is about to come (the picker opens, a drag
 * enters the page), so reading the file does not wait on the worker's own load: that is the
 * better part of a second on a cold cache. One that is not used is put away after a minute.
 */
export function warmUp(): void {
  if (!supported() || warm) return;
  const worker = new Worker(new URL('./importWorker.ts', import.meta.url), { type: 'module' });
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
  return new Worker(new URL('./importWorker.ts', import.meta.url), { type: 'module' });
}

function inWorker(name: string, bytes: Uint8Array): Promise<ImportReply> {
  return new Promise((resolve, reject) => {
    const worker = takeWorker();
    const id = ++next;
    const done = () => worker.terminate();
    worker.onmessage = (e: MessageEvent<WorkerReply>) => {
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
    worker.postMessage({ id, name, bytes }, [bytes.buffer as ArrayBuffer]);
  });
}

async function onThisThread(name: string, bytes: Uint8Array): Promise<ImportReply> {
  const { importDocument } = await import('../import');
  const { state: _state, ...out } = importDocument(name, bytes);
  void _state;
  return out;
}

/** Read `bytes` as the file `name` and make everything a new document needs. */
export function convertFile(name: string, bytes: Uint8Array): Promise<ImportReply> {
  return supported() ? inWorker(name, bytes) : onThisThread(name, bytes);
}
