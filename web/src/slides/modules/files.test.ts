import { describe, expect, it, vi } from 'vitest';
import { fileSections, searchCommands } from '../../core/shell/registry';

const downloadPptx = vi.fn(async (_: { assetUrl: (id: string) => string | null }) => undefined);
vi.mock('../../formats/browser/slidesDownload', () => ({ downloadPptx }));

import { filesModule } from './files';
import type { SlidesContext } from './types';

const ctx = (kind: 'cloud' | 'local', can: Record<string, boolean> = { download: true }) =>
  ({
    source: { kind },
    meta: { id: 'd1', title: 'Deck', templateScope: null },
    model: { deck: () => ({}) },
    assets: (id: string) => (id === 'import-0' ? 'blob:office-local://editors/1' : null),
    notify: () => undefined,
    can
  }) as unknown as SlidesContext;

describe('Download a copy', () => {
  it('lists a presentation by what it is and its extension, and nothing by a trademark', () => {
    const row = fileSections(filesModule.fileItems!, ctx('cloud')).flatMap((s) => s.items).find((i) => i.id === 'file.download')!;
    expect(row.label).toBe('Download a copy');
    expect(row.submenu!.map((c) => c.label)).toEqual(['Presentation (.pptx)']);
    expect(JSON.stringify(row)).not.toMatch(/powerpoint/i);
  });

  it('keeps its Ctrl+K entry, found by the format’s old name too', () => {
    expect(searchCommands(filesModule.commands!, 'download', ctx('cloud'), 10).map((c) => c.title)).toEqual(['Download a copy as .pptx']);
    expect(searchCommands(filesModule.commands!, 'powerpoint', ctx('cloud'), 10).map((c) => c.title)).toEqual(['Download a copy as .pptx']);
  });

  // The pictures of a deck that is open from the computer stay in the page: the download finds them where the editor does.
  it('takes each picture from where the editor finds it', async () => {
    const row = filesModule.fileItems!.find((i) => i.id === 'file.download')!.submenu![0]!;
    row.run(ctx('cloud'));
    await vi.waitFor(() => expect(downloadPptx).toHaveBeenCalledTimes(1));
    expect(downloadPptx.mock.calls[0]![0].assetUrl('import-0')).toBe('blob:office-local://editors/1');
  });

  it('is not on the page for a file on the computer, which has Save as, and not for a reader without downloads', () => {
    expect(fileSections(filesModule.fileItems!, ctx('local')).flatMap((s) => s.items).map((i) => i.id)).not.toContain('file.download');
    expect(searchCommands(filesModule.commands!, 'download', ctx('local'), 10)).toEqual([]);
    expect(fileSections(filesModule.fileItems!, ctx('cloud', { download: false })).flatMap((s) => s.items).map((i) => i.id)).not.toContain('file.download');
  });
});
