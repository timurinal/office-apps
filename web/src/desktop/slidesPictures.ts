/**
 * The Slides editor's pictures, pointed at the window's `PictureStore`: drawing one
 * (`documentAssets`) and adding one (the insert module's upload step). In its own module so the
 * Docs and Sheets windows, which read the same files, never load the Slides editor's code.
 */

import { LIMITS } from '@shared/api';
import { setPictureUpload } from '../slides/modules/insert/picture';
import { setLocalAssets } from '../slides/render/assets';
import { newPictureId, type PictureStore } from './pictures';

const stores = new Map<string, PictureStore>();
let installed = false;

/** Point the Slides editor's pictures at the stores here: once, before the first deck opens. */
export function installLocalPictures(): void {
  if (installed) return;
  installed = true;
  setLocalAssets((docId) => {
    const store = stores.get(docId);
    return store ? (id) => store.url(id) : null;
  });
  setPictureUpload(async (docId, image) => {
    const store = stores.get(docId);
    if (!store) throw new Error('This presentation is not open.');
    const bytes = new Uint8Array(await image.blob.arrayBuffer());
    if (bytes.byteLength > LIMITS.assetMaxBytes) throw new Error(`${image.name || 'That image'} is too large.`);
    const id = newPictureId();
    store.add({ id, mime: image.mime, name: image.name, bytes });
    return { id, name: image.name };
  });
}

/** The document `docId`'s pictures are `store`'s until the returned function is called. */
export function registerPictureStore(docId: string, store: PictureStore): () => void {
  installLocalPictures();
  stores.set(docId, store);
  return () => {
    if (stores.get(docId) === store) stores.delete(docId);
  };
}
