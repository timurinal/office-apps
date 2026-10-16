import { describe, expect, it } from 'vitest';
import { fileSections, searchCommands } from '../../core/shell/registry';
import { filesModule } from './files';
import type { DocsContext } from './types';

const ctx = (kind: 'cloud' | 'local' | 'locked' = 'cloud', print = true): DocsContext =>
  ({ editor: {}, source: { kind }, meta: { id: 'd1', title: 'Letter' }, can: { print } }) as unknown as DocsContext;

const rows = (c: DocsContext) => fileSections(filesModule.fileItems!, c).flatMap((s) => s.items);

describe('Download a copy', () => {
  it('is one row in Export, listing four formats by what they are and their extension', () => {
    expect(rows(ctx()).map((i) => i.label)).toEqual(['Download a copy']);
    const row = rows(ctx())[0]!;
    expect(row.section).toBe('Export');
    expect(row.submenu!.map((c) => c.label)).toEqual(['Document (.docx)', 'Markdown (.md)', 'Web page (.html)', 'Plain text (.txt)']);
    expect(JSON.stringify(row)).not.toMatch(/word/i);
  });

  it('keeps the four Ctrl+K entries, found by the old names of the formats too', () => {
    expect(searchCommands(filesModule.commands!, 'download', ctx(), 10).map((c) => c.title)).toEqual([
      'Download a copy as .docx',
      'Download a copy as .md',
      'Download a copy as .html',
      'Download a copy as .txt'
    ]);
    expect(searchCommands(filesModule.commands!, 'word', ctx(), 10).map((c) => c.title)).toEqual(['Download a copy as .docx']);
    expect(searchCommands(filesModule.commands!, 'markdown', ctx(), 10).map((c) => c.title)).toEqual(['Download a copy as .md']);
  });

  it('is on a locked document, and not on a file on the computer, which has Save as, nor for a reader without downloads', () => {
    expect(rows(ctx('locked'))).toHaveLength(1);
    expect(rows(ctx('local'))).toEqual([]);
    expect(searchCommands(filesModule.commands!, 'download', ctx('local'), 10)).toEqual([]);
    expect(rows(ctx('cloud', false))).toEqual([]);
    expect(searchCommands(filesModule.commands!, 'download', ctx('cloud', false), 10)).toEqual([]);
  });
});
