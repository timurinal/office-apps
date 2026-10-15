/**
 * Pictures from a file: the document's own intake (docs/core/imageFiles.ts) made smaller in the
 * browser's image pipeline, stored as an asset of the document, and only then put on the slide, so
 * every other person in the room sees a picture and never a placeholder of this tab's.
 *
 * Raster only (the four types the assets API takes); a link is not an address a slide can hold. A
 * file that cannot be stored says why in a toast and the others carry on. The prepare and upload are
 * parameters so a test needs neither a browser's image decoder nor a server.
 */

import { LIMITS } from '@shared/api';
import { errorText } from '../../../api';
import type { Toast } from '../../../core/ui';
import { ImageTooLarge, isImageFile, prepareImage, SERVER_PROFILE, uploadAsset, type PreparedImage } from '../../../docs/core/imageFiles';
import type { Target } from '../../editor/actions';
import type { Size } from './defaults';
import { insertPicture } from './place';

export interface PictureSteps {
  prepare: (file: File) => Promise<PreparedImage>;
  upload: (documentId: string, image: PreparedImage) => Promise<{ id: string; name: string }>;
}

const real: PictureSteps = {
  prepare: (file) => prepareImage(file, SERVER_PROFILE),
  upload: async (documentId, image) => {
    const meta = await uploadAsset(documentId, image);
    return { id: meta.id, name: image.name };
  }
};

/** The desktop app keeps a deck's pictures in its file, and stores them itself. */
export function setPictureUpload(upload: PictureSteps['upload']): void {
  real.upload = upload;
}

export interface StoredPicture {
  asset: { id: string; name: string };
  size: Size;
}

/** A picture made ready and stored as an asset of the document. */
export async function storePicture(documentId: string, file: File, steps: PictureSteps = real): Promise<StoredPicture> {
  const prepared = await steps.prepare(file);
  const asset = await steps.upload(documentId, prepared);
  return { asset, size: { w: prepared.width, h: prepared.height } };
}

/** The toast for a picture that could not be stored. */
export const pictureProblem = (err: unknown, name: string): Toast => ({
  text: err instanceof ImageTooLarge ? `${name || 'That image'} is too large.` : errorText(err, `Could not add ${name || 'that image'}.`),
  tone: 'danger'
});

export interface PictureHost {
  target: Target;
  documentId: string;
  notify: (t: Toast) => void;
}

/**
 * Each picture on the slide that was on the canvas when it was asked for, one after another: one
 * element and one undo entry apiece. Answers how many went in.
 */
export async function addPictures(host: PictureHost, files: readonly File[], steps: PictureSteps = real): Promise<number> {
  const slide = host.target.selection.get().slide;
  let added = 0;
  for (const file of files.filter(isImageFile)) {
    host.notify({ text: `Adding ${file.name || 'picture'}.` });
    try {
      const stored = await storePicture(host.documentId, file, steps);
      if (insertPicture(host.target, stored.asset, stored.size, slide)) added += 1;
    } catch (err) {
      host.notify(pictureProblem(err, file.name));
    }
  }
  return added;
}

/** Ask for picture files: the browser's own picker. */
export function pickPictureFiles(onFiles: (files: File[]) => void, multiple = true): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = LIMITS.assetMimes.join(',');
  input.multiple = multiple;
  input.onchange = () => {
    const files = [...(input.files ?? [])];
    if (files.length > 0) onFiles(files);
  };
  input.click();
}
