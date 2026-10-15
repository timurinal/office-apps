/**
 * What an xlsx may be before the importer builds a workbook from it, on top of the zip and XML
 * limits every converter shares (`../limits.ts`). Each number is the room's own cap or a
 * consequence of one; a file past one is refused or loses the excess, and says which.
 */

import { CELL_LIMITS } from '@shared/cells';

/** Sheets in one workbook. Each is two id lists in the structure document and a tab in the footer. */
export const MAX_SHEETS = 200;

/**
 * `<c>` elements across every sheet, empty and formatted-only ones included, counted on the text
 * before ExcelJS sees it. ExcelJS holds an object for each, so this bounds its memory; the cells
 * that survive are further held to the room's own cap (`CELL_LIMITS.cellsPerDocument`).
 */
export const MAX_RAW_CELLS = 2 * CELL_LIMITS.cellsPerDocument;

/**
 * Rows and columns, summed over the sheets, that the structure document can hold. Its cap is
 * 3 MiB (`LIMITS.docStateMaxBytes`) and an id costs about six bytes, so this is a little under
 * what would fit; it exists so that a file claiming a million rows is refused before a million
 * ids are made, and not after.
 */
export const MAX_LINES = 450_000;

/** Merged areas in one sheet. */
export const MAX_MERGES = 20_000;

/** Conditional formats, and validations, in one sheet. Real files carry thousands from copy and paste. */
export const MAX_RULES = 1_000;

/** Defined names in one workbook. */
export const MAX_NAMES = 2_000;

/** Entries of a literal validation list. Excel's own limit is 255 characters of them. */
export const MAX_LIST_ITEMS = 255;
