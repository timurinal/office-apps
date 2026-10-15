import { describe, expect, it } from 'vitest';
import { fileNameOf } from './download';

describe('fileNameOf', () => {
  it('names the file after the title, with the right extension', () => {
    expect(fileNameOf('Quarterly report', 'docx')).toBe('Quarterly report.docx');
  });

  it('takes out what a file system does not allow, and nothing else', () => {
    expect(fileNameOf('a/b\\c:d*e?f"g<h>i|j', 'md')).toBe('a b c d e f g h i j.md');
    expect(fileNameOf('Plan: v2 (final)', 'html')).toBe('Plan v2 (final).html');
  });

  it('does not make a hidden file or a path out of a title', () => {
    expect(fileNameOf('..\\..\\etc\\passwd', 'txt')).toBe('etc passwd.txt');
    expect(fileNameOf('.hidden', 'txt')).toBe('hidden.txt');
  });

  it('names an empty title, and cuts a long one', () => {
    expect(fileNameOf('   ', 'docx')).toBe('Untitled.docx');
    expect(fileNameOf('x'.repeat(300), 'docx')).toHaveLength(120 + '.docx'.length);
  });
});
