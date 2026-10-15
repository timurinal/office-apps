/**
 * The shapes the converters exchange.
 *
 * Every reader produces a `DocModel` (this editor's ProseMirror JSON, plus the page setup
 * and the headers and footers that live beside the body in the Yjs document) and every
 * writer takes one. Nothing here knows about zip, XML, Markdown or the DOM, which is what
 * lets the browser's worker and the Worker run the same code.
 */

import type { JSONContent } from '@tiptap/core';
import type { PaperSize, Orientation } from '../docs/pagination/setup';

export type { JSONContent };

/** A mark as it appears in `JSONContent.marks`. */
export type MarkJSON = NonNullable<JSONContent['marks']>[number];

/** The page setup as the Yjs `page` map holds it: millimetres. `paged` is the reader's view, not the file's. */
export interface PageModel {
  size: PaperSize;
  orientation: Orientation;
  margins: { top: number; right: number; bottom: number; left: number };
  headerDistance: number;
  footerDistance: number;
  differentFirst: boolean;
}

/** A header or footer: a `doc` in the small schema of docs/pagination/headerFooter.ts. */
export interface HeaderFooterModel {
  default?: JSONContent;
  first?: JSONContent;
}

export interface DocModel {
  /** A `doc` node in the editor's schema. */
  body: JSONContent;
  /** Null where the file says nothing: the editor then writes its own default on first edit. */
  page: PageModel | null;
  header: HeaderFooterModel;
  footer: HeaderFooterModel;
}

/** A picture taken from a file. The document refers to it by `token`; the page stores it as an asset. */
export interface ImageData {
  bytes: Uint8Array;
  /** One of `IMAGE_MIMES`. */
  mime: string;
  name: string;
}

/** `src` of an image node that is waiting for its asset. `import:<n>`; the page swaps it for the asset's URL. */
export const IMAGE_TOKEN_PREFIX = 'import:';
export const isImageToken = (src: unknown): src is string => typeof src === 'string' && src.startsWith(IMAGE_TOKEN_PREFIX);

/**
 * One comment from a file. Positions are in characters of the body's text, counted over its
 * text nodes in document order (`textOffsets.ts`), because the converter cannot know a
 * ProseMirror position until the document is built.
 */
export interface ImportedComment {
  id: string;
  author: string;
  /** Unix milliseconds, or null. */
  at: number | null;
  /** Paragraphs, joined with newlines. */
  text: string;
  /** The id of the comment this replies to. */
  parent: string | null;
  resolved: boolean;
  start: number;
  end: number;
}

/** Something the converter left out or changed, said once per kind. */
export interface Warning {
  code: string;
  /** "3 pictures in a format that cannot be shown were left out." */
  message: string;
  count: number;
}

export interface ImportResult {
  model: DocModel;
  /** Token to picture. */
  images: Map<string, ImageData>;
  comments: ImportedComment[];
  /** What the file calls itself, if it says. The page names the document after the file. */
  title: string | null;
  warnings: Warning[];
}

/** A comment to put in an export: a thread, anchored by text offsets like an import. */
export interface ExportComment {
  id: string;
  author: string;
  at: number | null;
  text: string;
  resolved: boolean;
  start: number;
  end: number;
  replies: { author: string; at: number | null; text: string }[];
}

/** What a writer needs besides the model. */
export interface ExportOptions {
  title: string;
  /** A picture's bytes by the `src` the document uses. Missing means the picture is left out. */
  resolveImage?: (src: string) => ImageData | null;
  comments?: ExportComment[];
  /** The site's origin, for links to other documents. */
  origin?: string;
  /** Unix milliseconds: the date the file says it was made, and the date field's value. */
  now?: number;
}

/** A collector the readers share, so the same kind of loss is counted once and said once. */
export class Warnings {
  private readonly by = new Map<string, { message: (n: number) => string; count: number }>();

  add(code: string, message: (n: number) => string, by = 1): void {
    const w = this.by.get(code);
    if (w) w.count += by;
    else this.by.set(code, { message, count: by });
  }

  list(): Warning[] {
    return [...this.by.entries()].map(([code, w]) => ({ code, message: w.message(w.count), count: w.count }));
  }
}

export const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;
