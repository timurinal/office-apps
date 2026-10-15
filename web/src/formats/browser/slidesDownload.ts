/**
 * File > Export as PowerPoint, from the open page.
 *
 *     downloadPptx({ deck: () => model.deck(), title, assetUrl, notify });
 *
 * The deck is taken as the model has it when the row is pressed, so a download of a version being
 * previewed is that version. Saved through a link with a `download` attribute (saveFile.ts).
 */

import { errorText } from '../../api';
import type { Toast } from '../../core/ui';
import type { DeckJSON } from '../../slides/model/deck';
import { PPTX_EXTENSION, PPTX_MIME } from '../pptx';
import { fileNameOf, save } from './saveFile';
import { buildPptxFile } from './slidesExport';

export interface PptxDownloadHost {
  deck: () => DeckJSON;
  title: string;
  assetUrl: (assetId: string) => string | null;
  notify: (toast: Toast) => void;
}

export async function downloadPptx(host: PptxDownloadHost): Promise<void> {
  try {
    const file = await buildPptxFile({ deck: host.deck(), title: host.title, assetUrl: host.assetUrl });
    const name = fileNameOf(host.title, PPTX_EXTENSION);
    save(file.bytes, PPTX_MIME, name);
    const first = file.warnings[0];
    host.notify({ text: first ? `Saved ${name}. ${first.message}` : `Saved ${name}.` });
  } catch (err) {
    host.notify({ text: errorText(err, 'Could not make that file.'), tone: 'danger' });
  }
}
