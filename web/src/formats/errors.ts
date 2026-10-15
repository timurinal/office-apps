/**
 * Why a file could not be read or written, in words a person can be shown.
 *
 * `code` is what a caller switches on; `message` is the sentence. The messages say what
 * happened to the file and nothing about the parser.
 */

export type FormatErrorCode =
  | 'unsupported'
  | 'not_docx'
  | 'not_xlsx'
  | 'not_pptx'
  | 'too_large'
  | 'zip_limit'
  | 'xml_unsafe'
  | 'xml_invalid'
  | 'document_too_large'
  | 'sheet_too_large'
  | 'deck_too_large'
  | 'empty'
  | 'failed';

const MESSAGES: Record<FormatErrorCode, string> = {
  unsupported: 'That kind of file cannot be opened here.',
  not_docx: 'That is not a Word document.',
  not_xlsx: 'That is not a spreadsheet.',
  not_pptx: 'That is not a presentation.',
  too_large: 'That file is too large.',
  zip_limit: 'That file is too large to open.',
  xml_unsafe: 'That file could not be opened.',
  xml_invalid: 'That file could not be read.',
  document_too_large: 'That document is too large.',
  sheet_too_large: 'That spreadsheet is too large.',
  deck_too_large: 'That presentation is too large.',
  empty: 'That file is empty.',
  failed: 'That file could not be opened.'
};

export class FormatError extends Error {
  constructor(
    readonly code: FormatErrorCode,
    /** What the converter knows, for a log. Never shown. */
    readonly detail?: string
  ) {
    super(MESSAGES[code]);
    this.name = 'FormatError';
  }
}

export const isFormatError = (e: unknown): e is FormatError => e instanceof FormatError;
