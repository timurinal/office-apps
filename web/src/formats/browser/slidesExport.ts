/**
 * A presentation as a .pptx, from the open page.
 *
 *     const file = await buildPptxFile({ deck: model.deck(), title, assetUrl });
 *
 * The page fetches the pictures the deck names (through the document's assets route, with the reader's
 * session), once each, and the export worker (loaded now, not before) writes the file. A picture that
 * cannot be fetched is left out, and the file's warnings say how many.
 */

import type { AssetRef, DeckJSON } from '../../slides/model/deck';
import { writePptxReport, type PptxWriteResult } from '../pptx';
import type { SlidesAsset, SlidesExportReply, SlidesExportRequest } from './protocol';

/** Every asset id a deck names, once each, wherever it is: pictures, fills, backgrounds, the master and layouts. */
export function deckAssetIds(deck: DeckJSON): string[] {
  const out = new Set<string>();
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) for (const v of value) walk(v);
    else if (value && typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) {
        const id = k === 'asset' && v && typeof v === 'object' ? (v as AssetRef).id : undefined;
        if (typeof id === 'string' && id) out.add(id);
        else walk(v);
      }
    }
  };
  walk(deck);
  return [...out];
}

/** The pictures a deck names, fetched from `url`. One that does not come is left out. */
export async function fetchDeckAssets(deck: DeckJSON, url: (assetId: string) => string | null, get: typeof fetch = fetch): Promise<SlidesAsset[]> {
  const ids = deckAssetIds(deck);
  const fetched = await Promise.all(
    ids.map(async (id): Promise<SlidesAsset | null> => {
      const at = url(id);
      if (!at) return null;
      try {
        const res = await get(at, { credentials: 'same-origin' });
        if (!res.ok) return null;
        return { id, bytes: new Uint8Array(await res.arrayBuffer()), mime: (res.headers.get('content-type') ?? '').split(';')[0]!.trim() };
      } catch {
        return null;
      }
    })
  );
  return fetched.filter((a): a is SlidesAsset => a !== null);
}

/** Write the file from a deck and the pictures already fetched. What the worker runs. */
export function buildPptx(deck: DeckJSON, assets: readonly SlidesAsset[], opts: { title: string; now?: number }): Promise<PptxWriteResult> {
  const byId = new Map(assets.map((a) => [a.id, a]));
  return writePptxReport(deck, async (ref) => (ref.id ? (byId.get(ref.id) ?? null) : null), { title: opts.title, ...(opts.now ? { now: opts.now } : {}) });
}

let next = 0;
const TIMEOUT_MS = 120_000;

function inWorker(request: Omit<SlidesExportRequest, 'id'>): Promise<PptxWriteResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./slidesExportWorker.ts', import.meta.url), { type: 'module' });
    const id = ++next;
    const done = () => {
      clearTimeout(timer);
      worker.terminate();
    };
    const timer = setTimeout(() => {
      done();
      reject(new Error('Could not make that file.'));
    }, TIMEOUT_MS);
    worker.onmessage = (e: MessageEvent<SlidesExportReply>) => {
      if (e.data.id !== id) return;
      done();
      if (e.data.ok) resolve({ bytes: e.data.bytes, warnings: e.data.warnings });
      else reject(new Error(e.data.message));
    };
    worker.onerror = () => {
      done();
      reject(new Error('Could not make that file.'));
    };
    worker.postMessage({ ...request, id }, request.assets.map((a) => a.bytes.buffer as ArrayBuffer));
  });
}

export interface BuildPptxInput {
  deck: DeckJSON;
  title: string;
  /** Where a picture is: the editor's `SlideAssets`. */
  assetUrl: (assetId: string) => string | null;
}

/** The whole download: the pictures, then the file, in the export worker where there is one. */
export async function buildPptxFile(input: BuildPptxInput, get: typeof fetch = fetch): Promise<PptxWriteResult> {
  const assets = await fetchDeckAssets(input.deck, input.assetUrl, get);
  const now = Date.now();
  if (typeof Worker !== 'undefined' && !import.meta.env.DEV) return inWorker({ deck: input.deck, assets, title: input.title, now });
  return buildPptx(input.deck, assets, { title: input.title, now });
}
