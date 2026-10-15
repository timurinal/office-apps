// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PATHS } from '@shared/api';
import type { DocsContext } from '../modules/types';
import { provideCtx } from './env';
import { fitWithin, displaySize, isImageFile, prepareImage, INLINE_PROFILE, SERVER_PROFILE } from './imageFiles';
import { insertImageFiles, pendingCount } from './images';
import { safeImageSrc } from './sanitize';
import { docOf, makeEditor, p, type TestEditor, jsonOf } from './testing';

let t: TestEditor;
afterEach(() => {
  t?.destroy();
  vi.unstubAllGlobals();
});

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const png = (name = 'chart.png', bytes: Uint8Array = PNG) => new File([bytes as BlobPart], name, { type: 'image/png' });
const images = (t: TestEditor) => jsonOf(t.editor).content!.filter((n) => n.type === 'image');

function ctx(kind: 'cloud' | 'local', notify = vi.fn()): DocsContext {
  return { source: { kind }, meta: { id: 'doc_1' }, notify } as unknown as DocsContext;
}

describe('where a picture may come from', () => {
  it('is a picture of this document, or a raster data URL, and nothing else', () => {
    for (const ok of ['/api/office/documents/d1/assets/a1', 'data:image/png;base64,iVBORw0KGgo=', 'data:image/webp;base64,AAAA']) expect(safeImageSrc(ok), ok).toBe(ok);
    for (const no of ['https://evil.example/x.png', '//evil.example/x.png', 'javascript:alert(1)', 'data:image/svg+xml;base64,PHN2Zz4=', 'data:text/html;base64,AAAA', '/api/office/documents/d1/assets/a1/../../x', '/api/office/documents/d1/assets/a1?x=1', 'blob:https://office.test/1', '', null, 3]) {
      expect(safeImageSrc(no), String(no)).toBeNull();
    }
  });

  it('keeps a pasted web picture out of the document rather than store a broken one', () => {
    t = makeEditor(docOf(p('')));
    t.editor.commands.insertContent('<p>before</p><img src="https://tracker.example/pixel.png"><img src="/api/office/documents/d1/assets/a1" width="300" height="200">');
    expect(images(t)).toHaveLength(1);
    expect(images(t)[0]!.attrs).toMatchObject({ src: '/api/office/documents/d1/assets/a1', width: 300, height: 200 });
  });

  it('draws no source for a picture whose source another editor made unsafe', () => {
    t = makeEditor(docOf({ type: 'image', attrs: { src: 'https://tracker.example/pixel.png' } }));
    expect(t.editor.getHTML()).not.toContain('tracker');
  });
});

describe('a picture, aligned and sized', () => {
  it('stores an alignment and a width', () => {
    t = makeEditor(docOf({ type: 'image', attrs: { src: 'data:image/png;base64,iVBORw0KGgo=', width: 320, height: 200, align: 'center' } }, p('after')));
    expect(t.editor.getHTML()).toContain('data-align="center"');
    expect(jsonOf(t.editor).content![0]!.attrs).toMatchObject({ width: 320, height: 200, align: 'center' });
  });

  it('ignores an alignment it does not know and a size it cannot use', () => {
    t = makeEditor(docOf({ type: 'image', attrs: { src: 'data:image/png;base64,iVBORw0KGgo=', align: 'diagonal' } }));
    expect(t.editor.getHTML()).not.toContain('data-align');
    t.destroy();
    t = makeEditor(docOf(p('')));
    t.editor.commands.insertContent('<img src="/api/office/documents/d1/assets/a1" width="-5" height="999999">');
    expect(images(t)[0]!.attrs).toMatchObject({ width: null, height: null });
  });
});

describe('sizing a picture for the page', () => {
  it('keeps the proportions, only ever shrinks, and shows a wide one at the text column', () => {
    expect(fitWithin(4000, 2000, 2000)).toEqual({ width: 2000, height: 1000 });
    expect(fitWithin(1000, 3000, 1500)).toEqual({ width: 500, height: 1500 });
    expect(fitWithin(800, 600, 2400)).toEqual({ width: 800, height: 600 });
    expect(displaySize(1296, 648)).toEqual({ width: 648, height: 324 });
    expect(displaySize(300, 200)).toEqual({ width: 300, height: 200 });
    expect(fitWithin(1, 100000, 10).width).toBeGreaterThanOrEqual(1);
  });

  it('takes the four raster types and not an SVG', () => {
    for (const type of ['image/png', 'image/jpeg', 'image/webp', 'image/gif']) expect(isImageFile({ type })).toBe(true);
    for (const type of ['image/svg+xml', 'text/html', 'application/pdf', '']) expect(isImageFile({ type })).toBe(false);
  });

  it('leaves a small picture as it is', async () => {
    const f = png();
    const out = await prepareImage(f, SERVER_PROFILE);
    expect(out.blob).toBe(f);
    expect(out.mime).toBe('image/png');
    expect(out.name).toBe('chart.png');
  });

  it('refuses a picture over the budget it cannot be reduced to (here, no canvas to reduce it with)', async () => {
    const big = new File([new Uint8Array(INLINE_PROFILE.budget + 1)], 'huge.png', { type: 'image/png' });
    await expect(prepareImage(big, INLINE_PROFILE)).rejects.toThrow('too large');
    const gif = new File([new Uint8Array(INLINE_PROFILE.budget + 1)], 'huge.gif', { type: 'image/gif' });
    await expect(prepareImage(gif, INLINE_PROFILE)).rejects.toThrow('too large');
    // A big one is still fine for a document on a server, which has the larger budget.
    const mid = new File([new Uint8Array(INLINE_PROFILE.budget + 1)], 'mid.png', { type: 'image/png' });
    await expect(prepareImage(mid, SERVER_PROFILE)).resolves.toMatchObject({ name: 'mid.png' });
  });

  it('re-encodes a large picture smaller, at the same type, when the browser can', async () => {
    const encoded = new Blob([new Uint8Array(1000)], { type: 'image/jpeg' });
    const closed = vi.fn();
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 6000, height: 4000, close: closed })));
    const drawn: number[][] = [];
    vi.stubGlobal(
      'OffscreenCanvas',
      class {
        constructor(
          public width: number,
          public height: number
        ) {
          drawn.push([width, height]);
        }
        getContext() {
          return { drawImage: () => undefined };
        }
        convertToBlob = vi.fn(async (o: { type: string }) => {
          expect(o.type).toBe('image/jpeg');
          return encoded;
        });
      }
    );
    const photo = new File([new Uint8Array(5_000_000)], 'photo.jpg', { type: 'image/jpeg' });
    const out = await prepareImage(photo, SERVER_PROFILE);
    expect(out.blob).toBe(encoded);
    expect(out).toMatchObject({ width: 2400, height: 1600, mime: 'image/jpeg' });
    expect(drawn).toEqual([[2400, 1600]]);
    expect(closed).toHaveBeenCalled();
  });
});

describe('putting a picture in', () => {
  beforeEach(() => vi.unstubAllGlobals());

  it('uploads it to the document’s assets, then inserts the picture by the URL it was given', async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      expect(init.method).toBe('POST');
      return new Response(JSON.stringify({ id: 'a9', name: 'chart.png', mime: 'image/png', sizeBytes: 12, url: PATHS.asset('doc_1', 'a9') }), {
        status: 201,
        headers: { 'content-type': 'application/json' }
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    t = makeEditor(docOf(p('Intro'), p('Outro')));
    const notify = vi.fn();
    provideCtx(t.editor, ctx('cloud', notify));

    const n = await insertImageFiles(t.editor, [png()]);
    expect(n).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(PATHS.assets('doc_1'));
    expect((init.headers as Record<string, string>)['content-type']).toBe('image/png');
    expect((init.headers as Record<string, string>)['x-asset-name']).toBe('chart.png');
    expect(init.body).toBeInstanceOf(Blob);

    expect(images(t)).toHaveLength(1);
    expect(images(t)[0]!.attrs).toMatchObject({ src: '/api/office/documents/doc_1/assets/a9', alt: 'chart' });
    expect(pendingCount(t.editor)).toBe(0);
    expect(notify).not.toHaveBeenCalled();
  });

  it('shows a placeholder while it uploads, in this tab only, and inserts nothing until it is stored', async () => {
    let finish!: (r: Response) => void;
    const fetchMock = vi.fn(() => new Promise<Response>((r) => (finish = r)));
    vi.stubGlobal('fetch', fetchMock);
    t = makeEditor(docOf(p('Intro')));
    provideCtx(t.editor, ctx('cloud'));

    const done = insertImageFiles(t.editor, [png()]);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(pendingCount(t.editor)).toBe(1);
    expect(images(t)).toHaveLength(0);
    expect(t.editor.view.dom.querySelector('.oa-img-pending')?.textContent).toContain('chart.png');

    finish(new Response(JSON.stringify({ id: 'a1', name: 'x', mime: 'image/png', sizeBytes: 1, url: '/api/office/documents/doc_1/assets/a1' }), { status: 201, headers: { 'content-type': 'application/json' } }));
    expect(await done).toBe(1);
    expect(pendingCount(t.editor)).toBe(0);
    expect(t.editor.view.dom.querySelector('.oa-img-pending')).toBeNull();
  });

  it('goes after the paragraph the caret is in, not through it, and takes the place of an empty one', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ id: 'a1', name: 'x', mime: 'image/png', sizeBytes: 1, url: '/api/office/documents/doc_1/assets/a1' }), { status: 201, headers: { 'content-type': 'application/json' } })));
    t = makeEditor(docOf(p('Intro text'), p('Outro')));
    provideCtx(t.editor, ctx('cloud'));
    t.editor.commands.setTextSelection(5);
    await insertImageFiles(t.editor, [png()]);
    expect(jsonOf(t.editor).content!.map((n) => n.type)).toEqual(['paragraph', 'image', 'paragraph']);
    expect(jsonOf(t.editor).content![0]!.content![0]!.text).toBe('Intro text');

    t.destroy();
    t = makeEditor(docOf(p('Intro'), p(''), p('Outro')));
    provideCtx(t.editor, ctx('cloud'));
    t.editor.commands.setTextSelection(8);
    await insertImageFiles(t.editor, [png()]);
    expect(jsonOf(t.editor).content!.map((n) => n.type)).toEqual(['paragraph', 'image', 'paragraph']);
  });

  it('puts the picture where the placeholder ended up, after other people typed above it', async () => {
    let finish!: (r: Response) => void;
    const fetchMock = vi.fn(() => new Promise<Response>((r) => (finish = r)));
    vi.stubGlobal('fetch', fetchMock);
    t = makeEditor(docOf(p('Intro'), p('Outro')));
    provideCtx(t.editor, ctx('cloud'));
    const outro = t.editor.state.doc.content.size - 1;
    t.editor.commands.setTextSelection(outro);
    const done = insertImageFiles(t.editor, [png()], outro);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(pendingCount(t.editor)).toBe(1);

    // Someone adds a line at the top while the picture uploads.
    t.editor.chain().insertContentAt(0, '<p>Added above</p>').run();
    finish(new Response(JSON.stringify({ id: 'a1', name: 'x', mime: 'image/png', sizeBytes: 1, url: '/api/office/documents/doc_1/assets/a1' }), { status: 201, headers: { 'content-type': 'application/json' } }));
    await done;

    const order = jsonOf(t.editor).content!.map((n) => (n.type === 'paragraph' ? n.content?.[0]?.text : n.type));
    expect(order[0]).toBe('Added above');
    expect(order.indexOf('image')).toBeGreaterThan(order.indexOf('Intro'));
  });

  it('says why when the server refuses, leaves no placeholder, and carries on with the next', async () => {
    const answers = [
      new Response(JSON.stringify({ error: { code: 'rate_limited', message: 'Too many uploads. Try again in a minute.' } }), { status: 429, headers: { 'content-type': 'application/json' } }),
      new Response(JSON.stringify({ id: 'a2', name: 'two.png', mime: 'image/png', sizeBytes: 1, url: '/api/office/documents/doc_1/assets/a2' }), { status: 201, headers: { 'content-type': 'application/json' } })
    ];
    vi.stubGlobal('fetch', vi.fn(async () => answers.shift()!));
    t = makeEditor(docOf(p('Intro')));
    const notify = vi.fn();
    provideCtx(t.editor, ctx('cloud', notify));

    const n = await insertImageFiles(t.editor, [png('one.png'), png('two.png')]);
    expect(n).toBe(1);
    expect(notify).toHaveBeenCalledWith({ text: 'Too many uploads. Try again in a minute.', tone: 'danger' });
    expect(images(t)).toHaveLength(1);
    expect(pendingCount(t.editor)).toBe(0);
  });

  it('embeds the picture in the document when there is no server to store it: a local file, a locked one', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    t = makeEditor(docOf(p('Intro')));
    provideCtx(t.editor, ctx('local'));
    expect(await insertImageFiles(t.editor, [png()])).toBe(1);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(images(t)[0]!.attrs!.src).toMatch(/^data:image\/png;base64,/);
  });

  it('refuses a picture too large to embed, by name, and inserts nothing', async () => {
    t = makeEditor(docOf(p('Intro')));
    const notify = vi.fn();
    provideCtx(t.editor, ctx('local', notify));
    const big = new File([new Uint8Array(INLINE_PROFILE.budget + 1)], 'huge.png', { type: 'image/png' });
    expect(await insertImageFiles(t.editor, [big])).toBe(0);
    expect(notify).toHaveBeenCalledWith({ text: 'huge.png is too large.', tone: 'danger' });
    expect(images(t)).toHaveLength(0);
    expect(pendingCount(t.editor)).toBe(0);
  });

  it('ignores a file that is not a raster picture', async () => {
    t = makeEditor(docOf(p('Intro')));
    provideCtx(t.editor, ctx('local'));
    const svg = new File(['<svg onload=alert(1)/>'], 'x.svg', { type: 'image/svg+xml' });
    expect(await insertImageFiles(t.editor, [svg])).toBe(0);
    expect(images(t)).toHaveLength(0);
  });
});
