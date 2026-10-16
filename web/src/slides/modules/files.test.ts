import { describe, expect, it, vi } from 'vitest';

const downloadPptx = vi.fn(async (_: { assetUrl: (id: string) => string | null }) => undefined);
vi.mock('../../formats/browser/slidesDownload', () => ({ downloadPptx }));

import { filesModule } from './files';
import type { SlidesContext } from './types';

describe('Export as PowerPoint', () => {
  // A deck on this computer keeps its pictures in the page: the download finds them where the editor does.
  it('takes each picture from where the editor finds it', async () => {
    const row = filesModule.fileItems!.find((i) => i.id === 'file.download-pptx')!;
    const ctx = {
      source: { kind: 'local' },
      meta: { id: 'local', title: 'Deck' },
      model: { deck: () => ({}) },
      assets: (id: string) => (id === 'import-0' ? 'blob:office-local://editors/1' : null),
      notify: () => undefined,
      can: { download: true }
    } as unknown as SlidesContext;
    row.run(ctx);
    await vi.waitFor(() => expect(downloadPptx).toHaveBeenCalledTimes(1));
    expect(downloadPptx.mock.calls[0]![0].assetUrl('import-0')).toBe('blob:office-local://editors/1');
  });
});
