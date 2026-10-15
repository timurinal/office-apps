/**
 * pptx for Slides: the entry points the import worker, the page and the Worker call.
 *
 *     const { deck, warnings, title } = readPptx(bytes);
 *     const file = await writePptx(deck, getAsset, { title });
 *
 * Both are pure (no DOM, no network), so they run in a Web Worker and in the Worker, and both take and
 * make plain data: a `DeckJSON` goes through `postMessage` and JSON unchanged.
 *
 * ── Reading ─────────────────────────────────────────────────────────────────
 *   · Throws `FormatError`: `not_pptx` ("That is not a presentation."), `unsupported` (a binary .ppt or a
 *     presentation with a password, which are compound files), `zip_limit`, `xml_unsafe`, `too_large`,
 *     `empty`, and `deck_too_large` (more than 500 slides, or more text than a deck can hold). A slide that
 *     cannot be read is still a slide: blank, on its layout, and `warnings` says so. A presentation with no
 *     slides is a deck with none (and a warning); the page decides what to show.
 *   · A picture is `AssetRef { data, mime }` (base64 of the file's bytes). **One object per picture**, shared
 *     by every element that shows it, so the uploader stores each once and swaps `data` and `mime` for `id`
 *     in place. At most 150 different pictures, each up to the asset limit.
 *   · Type is stored in the deck's points (a 10 in slide's 18 pt is 24), to the half point. A slide-number
 *     field is the text `‹#›` (`SLIDE_NUMBER_TEXT`, as slides/themes/layouts.ts has it).
 *   · `warnings` are sentences for a person; `details` has a code and a count for each.
 *   · `.ppsx` (a show) and `.potx` (a template) are the same package and read the same way.
 *
 * ── Writing ─────────────────────────────────────────────────────────────────
 *   · `getAsset(ref)` returns a picture's bytes and type, or null. It is called once per asset id; a ref that
 *     still holds `data` (a deck that was never uploaded) is written from that when `getAsset` has nothing.
 *   · `writePptxReport` is `writePptx` with `warnings`: the pictures that could not be fetched or are not
 *     PNG, JPEG, GIF or WebP, and the charts with no data.
 *   · The same deck is the same bytes. Slides are written at PowerPoint's sizes: 12192000 x 6858000 (16:9),
 *     9144000 x 6858000 (4:3) and 9144000 x 5715000 (16:10), type scaled back to the slide it is on.
 */

export { readPptx, type PptxImport } from './read';
export { writePptx, writePptxReport, type AssetBytes, type PptxWriteOptions, type PptxWriteResult } from './write';
export { SLIDE_NUMBER_TEXT } from './text';

export const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
export const PPTX_EXTENSION = 'pptx';
