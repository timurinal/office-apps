import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { fromBase64 } from '../crypto/primitives';
import { yToDeck } from '../slides/model/ydoc';
import { deckAssetIds } from './browser/slidesExport';
import { importSlides, isSlideImageToken, isSlidesFileName, slidesTitleOf } from './importSlides';
import { readPptx } from './pptx';
import { makePptx } from './pptx/testing';
import { PNG_1PX } from './testing';

const CORPUS = join(dirname(fileURLToPath(import.meta.url)), '../../../tests/corpus/pptx');
const corpus = (name: string): Uint8Array => new Uint8Array(readFileSync(join(CORPUS, name)));

const deckOf = (b64: string) => {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, fromBase64(b64));
  return yToDeck(doc);
};

const pic = (n: number) =>
  `<p:pic><p:nvPicPr><p:cNvPr id="${n + 1}" name="P"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rId${n + 4}"/></p:blipFill><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1000" cy="1000"/></a:xfrm></p:spPr></p:pic>`;

describe('importSlides', () => {
  it('makes the deck every slide of the file, with each picture named by a placeholder and its bytes beside it', () => {
    for (const name of ['05-google-table-pictures.pptx', '16-images-crop.pptx', '21-backgrounds.pptx', '30-master-decorations.pptx']) {
      const bytes = corpus(name);
      const read = readPptx(bytes);
      const out = importSlides(name, bytes);
      const deck = deckOf(out.stateBase64);
      expect(deck.slides.length, name).toBe(read.deck.slides.length);
      expect(out.slides, name).toBe(read.deck.slides.length);
      const ids = deckAssetIds(deck);
      expect(ids.every(isSlideImageToken), name).toBe(true);
      expect(new Set(ids), name).toEqual(new Set(out.images.map((i) => i.token)));
      // No picture's bytes travel in the state: they go up as assets.
      expect(out.stateBase64.length, name).toBeLessThan(bytes.length * 2 + 200_000);
      expect(JSON.stringify(deck), name).not.toContain('"data"');
      for (const img of out.images) expect(['image/png', 'image/jpeg', 'image/gif', 'image/webp'], name).toContain(img.mime);
    }
  });

  it('uploads a picture once however many slides show it', () => {
    const rel = (i: number) => ({ id: `rId${i + 4}`, type: 'image', target: '../media/one.png' });
    const out = importSlides(
      'Same.pptx',
      makePptx({ slides: [pic(1) + pic(2), pic(1)], slideRels: { 1: [rel(1), rel(2)], 2: [rel(1)] }, files: { 'ppt/media/one.png': PNG_1PX } })
    );
    expect(out.images).toHaveLength(1);
    expect(out.images[0]!.bytes).toEqual(PNG_1PX);
    const deck = deckOf(out.stateBase64);
    expect(deck.slides.flatMap((s) => s.elements.map((e) => (e as { asset: { id: string } }).asset.id))).toEqual(['import-0', 'import-0', 'import-0']);
  });

  it('refuses what is not a presentation, in plain words, before reading it', () => {
    const refusal = (name: string, bytes: Uint8Array) => {
      try {
        importSlides(name, bytes);
      } catch (err) {
        return (err as Error).message;
      }
      return null;
    };
    expect(refusal('old.ppt', corpus('01-powerpoint-basic.pptx'))).toBe('That kind of file cannot be opened here.');
    expect(refusal('deck.pptx', new Uint8Array(0))).toBe('That file is empty.');
    expect(refusal('deck.pptx', new TextEncoder().encode('plain text pretending to be a presentation, long enough to pass'))).toBe('That is not a presentation.');
  });

  it('takes a show and a template as a deck, and names it after the file', () => {
    expect(isSlidesFileName('a.PPSX') && isSlidesFileName('b.potx') && isSlidesFileName('c.pptx')).toBe(true);
    expect(isSlidesFileName('d.pptm') || isSlidesFileName('e.ppt') || isSlidesFileName('pptx')).toBe(false);
    expect(slidesTitleOf('C:\\decks\\Q4 kick-off.pptx')).toBe('Q4 kick-off');
    expect(slidesTitleOf('.pptx', 'From the file')).toBe('From the file');
    expect(slidesTitleOf('.pptx')).toBe('Untitled presentation');
  });
});
