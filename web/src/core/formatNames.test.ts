import { describe, expect, it } from 'vitest';
import { downloadTitle, formatLabel, FORMAT_NAMES, type FormatExtension } from './formatNames';

describe('the names of file formats', () => {
  it('reads what the file is and its extension', () => {
    expect(formatLabel('docx')).toBe('Document (.docx)');
    expect(formatLabel('csv')).toBe('Comma-separated values (.csv)');
    expect(formatLabel('png')).toBe('PNG (.png)');
    expect(downloadTitle('pptx')).toBe('Download a copy as .pptx');
  });

  it('never names another company’s product', () => {
    for (const ext of Object.keys(FORMAT_NAMES) as FormatExtension[]) {
      expect(`${formatLabel(ext)} ${downloadTitle(ext)}`).not.toMatch(/\b(word|excel|powerpoint)\b/i);
    }
  });
});
