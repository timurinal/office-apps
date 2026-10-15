/**
 * A file to a new document: the one entry point the page and the Worker call.
 *
 *     const out = importDocument('Report.docx', bytes);
 *
 * `out.state` is the Yjs update to send with the create call (`state`, base64), `out.images`
 * are the pictures to store once the document exists and `out.threads` the comments to post.
 * Everything is worked out here, off the main thread when the page calls it from its
 * worker: the file is read, the document is built and checked against the editor's schema,
 * encoded, measured against the room's cap, and the comments are anchored in the encoded
 * state, so the page's part is only to send what it is handed.
 */

import { prepareThreads, type PreparedThread } from './anchors';
import { readDocx } from './docx/read';
import { FormatError } from './errors';
import { readHtml } from './html/read';
import { MAX_FILE_BYTES, MAX_TEXT_BYTES } from './limits';
import { readMarkdown } from './markdown/read';
import { bytesToBase64 } from './images';
import type { ImageData, ImportResult, Warning } from './types';
import { buildState } from './ydoc';

export type ImportFormat = 'docx' | 'markdown' | 'html';

const EXTENSIONS: Record<string, ImportFormat> = {
  docx: 'docx',
  md: 'markdown',
  markdown: 'markdown',
  html: 'html',
  htm: 'html'
};

/** What a file is, by its extension. Null for anything this does not open. */
export function importFormatOf(fileName: string): ImportFormat | null {
  const dot = fileName.lastIndexOf('.');
  return dot < 0 ? null : (EXTENSIONS[fileName.slice(dot + 1).toLowerCase()] ?? null);
}

/** The file's name as a title: no extension, no path, no stray whitespace. */
export function titleOf(fileName: string, fromFile: string | null = null): string {
  const base = fileName.replace(/^.*[\\/]/, '').replace(/\.[A-Za-z0-9]{1,8}$/, '').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim();
  return (base || fromFile?.trim() || 'Untitled').slice(0, 200);
}

export interface ImportedImage extends ImageData {
  token: string;
}

export interface ImportOutcome {
  title: string;
  format: ImportFormat;
  state: Uint8Array;
  /** `state`, base64: the create call's `state` field. */
  stateBase64: string;
  images: ImportedImage[];
  threads: PreparedThread[];
  warnings: Warning[];
}

function decodeText(bytes: Uint8Array): string {
  if (bytes.length > MAX_TEXT_BYTES) throw new FormatError('too_large', `${bytes.length} bytes of text`);
  // Invalid sequences become the replacement character; a Latin-1 file reads with a few of them.
  return new TextDecoder('utf-8').decode(bytes);
}

export function readFile(fileName: string, bytes: Uint8Array): { format: ImportFormat; result: ImportResult } {
  const format = importFormatOf(fileName);
  if (!format) throw new FormatError('unsupported');
  if (bytes.length === 0) throw new FormatError('empty');
  if (bytes.length > MAX_FILE_BYTES) throw new FormatError('too_large', `${bytes.length} bytes`);
  switch (format) {
    case 'docx':
      return { format, result: readDocx(bytes) };
    case 'markdown':
      return { format, result: readMarkdown(decodeText(bytes)) };
    case 'html':
      return { format, result: readHtml(decodeText(bytes)) };
  }
}

export function importDocument(fileName: string, bytes: Uint8Array): ImportOutcome {
  const { format, result } = readFile(fileName, bytes);
  const state = buildState(result.model);
  return {
    title: titleOf(fileName, result.title),
    format,
    state,
    stateBase64: bytesToBase64(state),
    images: [...result.images].map(([token, img]) => ({ token, ...img })),
    threads: prepareThreads(state, result.comments),
    warnings: result.warnings
  };
}
