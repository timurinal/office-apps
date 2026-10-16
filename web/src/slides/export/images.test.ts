import { describe, expect, it } from 'vitest';
import { inlineImages, sniff } from './images';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

describe('a picture’s kind', () => {
  it('is read from its bytes: png, jpeg, webp, gif, and nothing else', () => {
    expect(sniff(PNG)).toBe('image/png');
    expect(sniff(JPEG)).toBe('image/jpeg');
    expect(sniff(new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 '))).toBe('image/webp');
    expect(sniff(new TextEncoder().encode('GIF89a\0\0'))).toBe('image/gif');
    expect(sniff(SVG)).toBeNull();
    expect(sniff(new Uint8Array([]))).toBeNull();
  });
});

describe('inlining pictures', () => {
  it('turns each address into a data URL of the kind its bytes are, once', async () => {
    const asked: string[] = [];
    const out = await inlineImages(['/a', '/a', '/b'], async (u) => {
      asked.push(u);
      return u === '/a' ? PNG : JPEG;
    });
    expect(asked).toEqual(['/a', '/b']);
    expect(out.get('/a')).toMatch(/^data:image\/png;base64,iVBORw0KGgo/);
    expect(out.get('/b')).toMatch(/^data:image\/jpeg;base64,/);
  });

  it('leaves out what is not a picture, whatever the server called it, and what could not be fetched', async () => {
    const out = await inlineImages(['/svg', '/gone'], async (u) => (u === '/svg' ? SVG : null));
    expect(out.get('/svg')).toBeNull();
    expect(out.get('/gone')).toBeNull();
  });

  it('keeps an inline picture as it is, and refuses a data URL of any other kind', async () => {
    const ok = 'data:image/png;base64,iVBORw0KGgo=';
    const out = await inlineImages([ok, 'data:image/svg+xml;base64,PHN2Zz4=', 'data:text/html;base64,PGI+'], async () => {
      throw new Error('not fetched');
    });
    expect(out.get(ok)).toBe(ok);
    expect(out.get('data:image/svg+xml;base64,PHN2Zz4=')).toBeNull();
    expect(out.get('data:text/html;base64,PGI+')).toBeNull();
  });

  it('stops at a budget, so a file of hundreds of megabytes is not made', async () => {
    const big = new Uint8Array(30 * 1024 * 1024);
    big.set(PNG);
    const out = await inlineImages(['/1', '/2'], async () => big);
    expect(out.get('/1')).not.toBeNull();
    expect(out.get('/2')).toBeNull();
  });
});
