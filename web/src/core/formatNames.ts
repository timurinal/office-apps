/**
 * What a file format is called wherever the person is shown one: by what it is and its extension,
 * "Document (.docx)", never by the product that made it. File > Download a copy, File > Save as on
 * the desktop's local page, and a picture's PNG and SVG all read their wording from here, so the
 * three apps say it one way.
 */

export const FORMAT_NAMES = {
  docx: 'Document',
  md: 'Markdown',
  html: 'Web page',
  txt: 'Plain text',
  xlsx: 'Workbook',
  csv: 'Comma-separated values',
  tsv: 'Tab-separated values',
  pptx: 'Presentation',
  png: 'PNG',
  svg: 'SVG'
} as const;

export type FormatExtension = keyof typeof FORMAT_NAMES;

/** "Document (.docx)". */
export const formatLabel = (extension: FormatExtension): string => `${FORMAT_NAMES[extension]} (.${extension})`;

/** "Download a copy as .docx": the Ctrl+K box's title for the same act. */
export const downloadTitle = (extension: FormatExtension): string => `Download a copy as .${extension}`;
