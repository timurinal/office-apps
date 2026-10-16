/**
 * Slides' "Save as picture": the chosen elements as a PNG or an SVG, cropped to their bounds on no
 * background. The right-click menu (modules/menus.tsx) loads this when a format is chosen, so the
 * editor opens without it.
 *
 * The SVG is `picture.tsx`'s. The PNG is that same SVG drawn on a canvas at twice its size
 * (sheets/charts/export.ts, which the chart's own PNG is drawn by too), so the two files show the
 * same thing. Nothing is uploaded: the file is made here and saved through the browser, as a chart's is.
 */

import { fileNameOf, save } from '../../formats/browser/saveFile';
import { pngBytes } from '../../sheets/charts/export';
import type { Toast } from '../../core/ui';
import type { SlideModel } from '../model/model';
import type { AssetUrl } from '../render/assets';
import { buildPicture } from './picture';

export type PictureFormat = 'png' | 'svg';

/** The PNG is drawn at this many pixels to a slide px. */
export const PNG_SCALE = 2;

export interface PictureHost {
  model: SlideModel;
  /** The deck's title, which names the file. */
  title: string;
  assets: AssetUrl;
  notify: (toast: Toast) => void;
}

/** "Quarterly review picture", or "Quarterly review Logo" for a single element that has a name. */
export function pictureName(title: string, names: readonly (string | undefined)[]): string {
  const name = names.length === 1 ? names[0]?.trim() : '';
  return `${title.trim() || 'Untitled'} ${name || 'picture'}`;
}

const pictures = (n: number): string => (n === 1 ? '1 picture' : `${n} pictures`);

/** Saves the elements `ids` of the slide `slideId`; says so in a notice when it cannot, or when a picture in them was left out. */
export async function savePicture(host: PictureHost, slideId: string, ids: readonly string[], format: PictureFormat): Promise<void> {
  try {
    const slide = host.model.slide(slideId);
    const wanted = new Set(ids);
    const elements = slide ? slide.elements.filter((e) => e.id !== undefined && wanted.has(e.id)) : [];
    const picture = slide && elements.length
      ? await buildPicture({
          elements,
          design: host.model.design(),
          layoutId: slide.layout,
          number: host.model.indexOf(slideId) + 1,
          assetUrl: host.assets
        })
      : null;
    if (!picture) {
      host.notify({ text: 'Could not save the picture.', tone: 'danger' });
      return;
    }
    const name = fileNameOf(pictureName(host.title, elements.map((e) => e.name)), format);
    if (format === 'svg') {
      save(new TextEncoder().encode(picture.svg), 'image/svg+xml', name);
    } else {
      const bytes = await pngBytes(picture.svg, picture.width, picture.height, PNG_SCALE, null);
      if (!bytes) {
        host.notify({ text: 'Could not save the picture.', tone: 'danger' });
        return;
      }
      save(bytes, 'image/png', name);
    }
    if (picture.missing > 0) host.notify({ text: `${pictures(picture.missing)} could not be included.` });
  } catch {
    host.notify({ text: 'Could not save the picture.', tone: 'danger' });
  }
}
