/**
 * The app's own file: a zip, so it can be looked into, holding exactly what the editor holds.
 *
 *     mimetype        stored, first: what kind of file this is, for anything that sniffs
 *     manifest.json   { format, version, kind, id, title, app, savedAt }
 *     state.bin       the document's Yjs state (a Sheets workbook's structure)
 *     cells.bin       Sheets only: the cell list (`encodeCellList`)
 *     pictures/<id>   Slides only: each picture the deck names, as its bytes; the manifest's
 *                     `pictures` says what each is
 *
 * Nothing is converted on the way in or out, so a save loses nothing the editor has. The id is
 * kept from save to save; the title on screen is always the file's name, and `title` here is
 * only what it was called when it was written.
 */

import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import { KINDS, type Kind } from './kinds';
import { isPictureId, isPictureMime, type StoredPicture } from './pictures';

export const FORMAT = 'office';
export const VERSION = 1;

export interface Manifest {
  format: typeof FORMAT;
  version: number;
  kind: Kind;
  id: string;
  title: string;
  app: string;
  savedAt: string;
  /** Slides: the pictures in `pictures/`. */
  pictures?: { id: string; mime: string; name: string }[];
}

export interface ContainerContent {
  manifest: Manifest;
  state: Uint8Array;
  /** Sheets: the encoded cell list. */
  cells: Uint8Array | null;
  /** Slides: its pictures. */
  pictures: StoredPicture[];
}

export class ContainerError extends Error {
  constructor(readonly detail: string) {
    super('This file could not be opened.');
    this.name = 'ContainerError';
  }
}

/** The few entries of a document, and a presentation's pictures. */
const MAX_ENTRIES = 4096;
const MAX_UNZIPPED = 256 * 1024 * 1024;

export function writeContainer(input: {
  kind: Kind;
  id: string;
  title: string;
  app: string;
  state: Uint8Array;
  cells?: Uint8Array | null;
  pictures?: readonly StoredPicture[];
  now?: Date;
}): Uint8Array {
  const manifest: Manifest = {
    format: FORMAT,
    version: VERSION,
    kind: input.kind,
    id: input.id,
    title: input.title,
    app: input.app,
    savedAt: (input.now ?? new Date()).toISOString()
  };
  const pictures = input.kind === 'slides' ? (input.pictures ?? []) : [];
  if (input.kind === 'slides') manifest.pictures = pictures.map((p) => ({ id: p.id, mime: p.mime, name: p.name }));
  // Insertion order is the order in the zip; `mimetype` must be first and stored.
  const files: Zippable = {
    mimetype: [strToU8(KINDS[input.kind].mime), { level: 0 }],
    'manifest.json': strToU8(JSON.stringify(manifest, null, 2)),
    'state.bin': input.state
  };
  if (input.kind === 'sheets') files['cells.bin'] = input.cells ?? new Uint8Array();
  // Pictures are compressed already.
  for (const p of pictures) files[`pictures/${p.id}`] = [p.bytes, { level: 0 }];
  return zipSync(files, { level: 6, mtime: input.now ?? new Date() });
}

export function readContainer(bytes: Uint8Array, expected?: Kind): ContainerContent {
  let entries: Record<string, Uint8Array>;
  let total = 0;
  let count = 0;
  try {
    entries = unzipSync(bytes, {
      filter: (f) => {
        count += 1;
        total += f.originalSize;
        if (count > MAX_ENTRIES) throw new ContainerError(`more than ${MAX_ENTRIES} entries`);
        if (total > MAX_UNZIPPED) throw new ContainerError('too large unzipped');
        return true;
      }
    });
  } catch (e) {
    if (e instanceof ContainerError) throw e;
    throw new ContainerError(`not a zip: ${String(e)}`);
  }

  const raw = entries['manifest.json'];
  if (!raw) throw new ContainerError('no manifest');
  let manifest: Manifest;
  try {
    manifest = JSON.parse(strFromU8(raw)) as Manifest;
  } catch {
    throw new ContainerError('manifest is not JSON');
  }
  if (manifest.format !== FORMAT) throw new ContainerError(`format ${String(manifest.format)}`);
  if (typeof manifest.version !== 'number' || manifest.version > VERSION) throw new ContainerError(`version ${String(manifest.version)}`);
  if (!(manifest.kind in KINDS)) throw new ContainerError(`kind ${String(manifest.kind)}`);
  if (expected && manifest.kind !== expected) throw new ContainerError(`a ${manifest.kind} file, not ${expected}`);
  if (typeof manifest.id !== 'string' || !manifest.id) throw new ContainerError('no id');

  const state = entries['state.bin'];
  if (!state) throw new ContainerError('no state');
  const cells = entries['cells.bin'] ?? null;
  if (manifest.kind === 'sheets' && !cells) throw new ContainerError('no cells');
  return { manifest, state, cells, pictures: readPictures(manifest, entries) };
}

/** The pictures the manifest lists and the file has. One that is not there, or not a picture, is left out. */
function readPictures(manifest: Manifest, entries: Record<string, Uint8Array>): StoredPicture[] {
  if (manifest.kind !== 'slides' || !Array.isArray(manifest.pictures)) return [];
  const out: StoredPicture[] = [];
  for (const p of manifest.pictures) {
    if (!p || !isPictureId(p.id) || !isPictureMime(p.mime)) continue;
    const bytes = entries[`pictures/${p.id}`];
    if (bytes) out.push({ id: p.id, mime: p.mime, name: typeof p.name === 'string' ? p.name.slice(0, 200) : '', bytes });
  }
  return out;
}

/** A new document's id: kept in the file from then on. */
export function newId(): string {
  const b = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}
