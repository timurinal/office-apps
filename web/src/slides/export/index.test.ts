import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Toast } from '../../core/ui';

const saved: { bytes: Uint8Array; mime: string; name: string }[] = [];
vi.mock('../../formats/browser/saveFile', async (original) => ({
  ...(await original<typeof import('../../formats/browser/saveFile')>()),
  save: (bytes: Uint8Array, mime: string, name: string) => void saved.push({ bytes, mime, name })
}));
const png = vi.fn(async (..._: unknown[]): Promise<Uint8Array | null> => new Uint8Array([0x89, 0x50]));
vi.mock('../../sheets/charts/export', () => ({ pngBytes: (...a: unknown[]) => png(...a) }));
const build = vi.fn();
vi.mock('./picture', () => ({ buildPicture: (...a: unknown[]) => build(...a) }));

import { pictureName, PNG_SCALE, savePicture, type PictureHost } from './index';

const notices: Toast[] = [];
const model = (elements: { id: string; name?: string }[] = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]) =>
  ({
    slide: (id: string) => (id === 's1' ? { layout: 'titleContent', elements } : null),
    design: () => ({ theme: {}, master: {}, layouts: [], size: '16:9' }),
    indexOf: () => 2
  }) as unknown as PictureHost['model'];
const host = (m = model(), title = 'Quarterly review'): PictureHost => ({ model: m, title, assets: (id) => `/a/${id}`, notify: (t) => void notices.push(t) });
const picture = (over: Record<string, unknown> = {}) => ({ svg: '<svg/>', width: 300, height: 120, missing: 0, ...over });

beforeEach(() => {
  saved.length = 0;
  notices.length = 0;
  build.mockReset();
  png.mockClear();
});

describe('the file’s name', () => {
  it('is the deck’s title and "picture", or the name of the one element chosen', () => {
    expect(pictureName('Quarterly review', [undefined])).toBe('Quarterly review picture');
    expect(pictureName('Quarterly review', ['Logo'])).toBe('Quarterly review Logo');
    expect(pictureName('Quarterly review', ['Logo', 'Title'])).toBe('Quarterly review picture');
    expect(pictureName('Quarterly review', ['  '])).toBe('Quarterly review picture');
    expect(pictureName('  ', [])).toBe('Untitled picture');
  });
});

describe('saving a picture', () => {
  it('builds the chosen elements of the slide, back to front, and saves the SVG as it is', async () => {
    build.mockResolvedValue(picture({ svg: '<svg>x</svg>' }));
    await savePicture(host(), 's1', ['c', 'a'], 'svg');
    const src = build.mock.calls[0]![0];
    // The slide's own order, not the order they were chosen in; its layout, and its place in the deck.
    expect(src.elements.map((e: { id: string }) => e.id)).toEqual(['a', 'c']);
    expect(src.layoutId).toBe('titleContent');
    expect(src.number).toBe(3);
    expect(src.assetUrl('x')).toBe('/a/x');
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ mime: 'image/svg+xml', name: 'Quarterly review picture.svg' });
    expect(new TextDecoder().decode(saved[0]!.bytes)).toBe('<svg>x</svg>');
    expect(png).not.toHaveBeenCalled();
    expect(notices).toEqual([]);
  });

  it('draws a PNG from the same SVG at twice its size, on no background', async () => {
    build.mockResolvedValue(picture());
    await savePicture(host(model([{ id: 'a', name: 'Logo' }])), 's1', ['a'], 'png');
    expect(png).toHaveBeenCalledWith('<svg/>', 300, 120, PNG_SCALE, null);
    expect(PNG_SCALE).toBe(2);
    expect(saved[0]).toMatchObject({ mime: 'image/png', name: 'Quarterly review Logo.png' });
  });

  it('says how many pictures in it could not be had', async () => {
    build.mockResolvedValue(picture({ missing: 1 }));
    await savePicture(host(), 's1', ['a'], 'svg');
    build.mockResolvedValue(picture({ missing: 3 }));
    await savePicture(host(), 's1', ['a'], 'svg');
    expect(saved).toHaveLength(2);
    expect(notices.map((n) => n.text)).toEqual(['1 picture could not be included.', '3 pictures could not be included.']);
  });

  it('says it could not, and saves nothing, when there is nothing to draw, the browser cannot make the PNG, or anything throws', async () => {
    build.mockResolvedValue(null);
    await savePicture(host(), 's1', ['a'], 'svg');
    await savePicture(host(), 'gone', ['a'], 'svg');
    await savePicture(host(), 's1', ['nothing-like-it'], 'svg');
    build.mockResolvedValue(picture());
    png.mockResolvedValueOnce(null);
    await savePicture(host(), 's1', ['a'], 'png');
    build.mockRejectedValue(new Error('boom'));
    await savePicture(host(), 's1', ['a'], 'svg');
    expect(saved).toEqual([]);
    expect(notices).toHaveLength(5);
    expect(new Set(notices.map((n) => n.text))).toEqual(new Set(['Could not save the picture.']));
    expect(notices.every((n) => n.tone === 'danger')).toBe(true);
  });
});
