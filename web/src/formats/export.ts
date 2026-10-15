/**
 * A document to a file: docx, Markdown, HTML or plain text.
 *
 *     const out = await exportDocument('docx', model, { title, resolveImage });
 *
 * The model is what `modelFromDoc` (ydoc.ts) reads from the document, so the page and the
 * a server-side exporter run the same code and a person gets the file the assistant would
 * have made. Nothing here touches the network or the DOM.
 */

import { writeDocx } from './docx/write';
import { writeHtml } from './html/write';
import { writeMarkdown } from './markdown/write';
import { writeText } from './text/write';
import { EXPORT_FORMATS, type ExportFormat } from './formats';
import type { DocModel, ExportOptions, Warning } from './types';

export { EXPORT_FORMATS, imageSources, type ExportFormat } from './formats';

export interface ExportOutcome {
  bytes: Uint8Array;
  mime: string;
  extension: string;
  warnings: Warning[];
}

export async function exportDocument(format: ExportFormat, model: DocModel, opts: ExportOptions): Promise<ExportOutcome> {
  const meta = EXPORT_FORMATS[format];
  const encode = (s: string) => new TextEncoder().encode(s);
  switch (format) {
    case 'docx': {
      const { bytes, warnings } = await writeDocx(model, opts);
      return { bytes, mime: meta.mime, extension: meta.extension, warnings };
    }
    case 'markdown': {
      const { markdown, warnings } = writeMarkdown(model, opts);
      return { bytes: encode(markdown), mime: meta.mime, extension: meta.extension, warnings };
    }
    case 'html': {
      const { html, warnings } = writeHtml(model, opts);
      return { bytes: encode(html), mime: meta.mime, extension: meta.extension, warnings };
    }
    case 'text':
      return { bytes: encode(writeText(model)), mime: meta.mime, extension: meta.extension, warnings: [] };
  }
}
