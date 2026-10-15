/**
 * What a file may be before the converters will read it, and what they will keep.
 *
 * Every number here exists because the input is a stranger's: a docx somebody emailed,
 * a Markdown file from a download folder. The converters never trust a size, a count or
 * an address the file states about itself. Each limit has a test in `limits.test.ts`.
 */

import { LIMITS } from '@shared/api';

export const MIB = 1024 * 1024;

/**
 * The file itself, as it arrives. A docx is a zip, so this bounds the work of reading the
 * central directory; the next limit bounds what it may expand to.
 */
export const MAX_FILE_BYTES = 64 * MIB;

/** The total size of everything a zip says it holds once unpacked. A zip bomb is small and says a lot. */
export const MAX_UNZIPPED_BYTES = 64 * MIB;

/** Entries in one zip. A document with a thousand pictures has about a thousand and ten. */
export const MAX_ZIP_ENTRIES = 4000;

/** One XML part. The main document of a very long book is a few MiB. */
export const MAX_XML_BYTES = 48 * MIB;

/** Nested elements. OOXML is a dozen deep; a file that nests thousands is attacking the parser. */
export const MAX_XML_DEPTH = 256;

/** Elements in one part. Past this the file is not a document. */
export const MAX_XML_ELEMENTS = 4_000_000;

/** Text formats (Markdown, HTML, plain text) as bytes. */
export const MAX_TEXT_BYTES = 16 * MIB;

/** Nested tables, lists and quotes. Word allows a lot more; nobody has written one. */
export const MAX_NESTING = 12;

/** Pictures taken from one file. The upload route allows 200 an hour. */
export const MAX_IMAGES = 150;

/** Comment messages taken from one file. The comment route allows 300 an hour. */
export const MAX_COMMENT_MESSAGES = 120;

/** A converted document's Yjs state is refused above the room's cap. */
export const MAX_STATE_BYTES = LIMITS.docStateMaxBytes;

/** Only these pictures are taken. SVG can carry script; EMF, WMF and TIFF are not images a browser draws. */
export const IMAGE_MIMES: readonly string[] = LIMITS.assetMimes;

/** Where a link may go. */
export const LINK_SCHEMES: readonly string[] = ['http:', 'https:', 'mailto:'];
