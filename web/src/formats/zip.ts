/**
 * Reading a zip that someone else made.
 *
 * A docx is a zip, and a zip is where the cheap attacks live: a few kilobytes that say
 * they hold gigabytes, a million tiny entries, a path that climbs out of its folder. So
 * nothing is inflated until the whole directory has been counted and found reasonable:
 * the first pass asks `unzipSync` for each entry's declared sizes and extracts none, and
 * the second extracts only the entries the caller names.
 *
 * A zip can lie about its sizes. That does not help the attacker here: fflate inflates
 * into a buffer of the *declared* size, so an entry that says it is small and is not comes
 * out cut short, and a cut-short XML part does not parse. The declared total, which the
 * first pass has already bounded, is therefore a bound on the memory the second pass uses.
 *
 * No entry is ever written to disk, so a hostile name has nowhere to go. Names are
 * normalised (backslashes, a leading slash, `./`) so the lookup finds what Word wrote.
 */

import { unzipSync } from 'fflate';
import { FormatError } from './errors';
import { MAX_UNZIPPED_BYTES, MAX_ZIP_ENTRIES } from './limits';

export interface ZipEntry {
  name: string;
  size: number;
  compressed: number;
}

export interface Zip {
  names: string[];
  has(name: string): boolean;
  /** The entry's bytes, or null if there is no such entry. */
  read(name: string): Uint8Array | null;
}

/** `word\document.xml`, `/word/document.xml` and `./word/document.xml` are one entry. */
export function normaliseName(name: string): string {
  return name.replace(/\\/g, '/').replace(/^(?:\.?\/)+/, '');
}

const SIGNATURE = [0x50, 0x4b];

/** Whether the bytes begin the way a zip does. A docx that does not is not worth a second look. */
export const looksLikeZip = (bytes: Uint8Array): boolean => bytes.length > 22 && bytes[0] === SIGNATURE[0] && bytes[1] === SIGNATURE[1];

/**
 * The directory of a zip, with its limits checked and nothing extracted.
 * Throws `zip_limit` past either limit, `not_docx` when it is not a zip at all.
 */
export function listZip(bytes: Uint8Array): ZipEntry[] {
  if (!looksLikeZip(bytes)) throw new FormatError('not_docx', 'no zip signature');
  const entries: ZipEntry[] = [];
  let total = 0;
  try {
    unzipSync(bytes, {
      filter: (f) => {
        if (entries.length >= MAX_ZIP_ENTRIES) throw new FormatError('zip_limit', `more than ${MAX_ZIP_ENTRIES} entries`);
        total += f.originalSize;
        // Checked as it accumulates, so a directory of a million entries is refused at the limit and not at the end.
        if (total > MAX_UNZIPPED_BYTES) throw new FormatError('zip_limit', `declares more than ${MAX_UNZIPPED_BYTES} bytes`);
        entries.push({ name: normaliseName(f.name), size: f.originalSize, compressed: f.size });
        return false;
      }
    });
  } catch (err) {
    if (err instanceof FormatError) throw err;
    throw new FormatError('not_docx', String(err));
  }
  return entries;
}

/**
 * Open a zip for reading. `want` narrows what is inflated to the entries that match; the
 * rest are never touched. Called once, because each call walks the directory again.
 */
export function openZip(bytes: Uint8Array, want: (name: string) => boolean): Zip {
  const entries = listZip(bytes);
  const names = entries.map((e) => e.name);
  const wanted = new Set(entries.filter((e) => want(e.name)).map((e) => e.name));
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, { filter: (f) => wanted.has(normaliseName(f.name)) });
  } catch (err) {
    if (err instanceof FormatError) throw err;
    throw new FormatError('not_docx', String(err));
  }
  const byName = new Map<string, Uint8Array>();
  for (const [name, data] of Object.entries(files)) byName.set(normaliseName(name), data);
  return {
    names,
    has: (name) => byName.has(normaliseName(name)) || names.includes(normaliseName(name)),
    read: (name) => byName.get(normaliseName(name)) ?? null
  };
}
