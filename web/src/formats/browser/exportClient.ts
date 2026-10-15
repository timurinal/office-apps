/** Building a file from the page: the export worker, or this thread where there is none. */

import type { ExportFormat } from '../formats';
import type { DocModel, ExportComment, ImageData, Warning } from '../types';
import type { ExportReply, ExportRequest } from './protocol';

export interface BuiltFile {
  bytes: Uint8Array;
  mime: string;
  extension: string;
  warnings: Warning[];
}

export interface BuildInput {
  format: ExportFormat;
  model: DocModel;
  title: string;
  origin: string;
  images: Record<string, ImageData>;
  comments: ExportComment[];
}

let next = 0;

function inWorker(input: BuildInput): Promise<BuiltFile> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./exportWorker.ts', import.meta.url), { type: 'module' });
    const id = ++next;
    worker.onmessage = (e: MessageEvent<ExportReply>) => {
      if (e.data.id !== id) return;
      worker.terminate();
      if (e.data.ok) resolve({ bytes: e.data.bytes, mime: e.data.mime, extension: e.data.extension, warnings: e.data.warnings });
      else reject(new Error(e.data.message));
    };
    worker.onerror = () => {
      worker.terminate();
      reject(new Error('Could not make that file.'));
    };
    const request: ExportRequest = { id, ...input, now: Date.now() };
    worker.postMessage(request);
  });
}

async function onThisThread(input: BuildInput): Promise<BuiltFile> {
  const { exportDocument } = await import('../export');
  const out = await exportDocument(input.format, input.model, {
    title: input.title,
    origin: input.origin,
    now: Date.now(),
    comments: input.comments,
    resolveImage: (src) => input.images[src] ?? null
  });
  return out;
}

export function buildFile(input: BuildInput): Promise<BuiltFile> {
  return typeof Worker !== 'undefined' && !import.meta.env.DEV ? inWorker(input) : onThisThread(input);
}
