import { unzipSync } from 'fflate';
import { describe, expect, it, vi } from 'vitest';
import type { DeckJSON, ElementJSON } from '../../slides/model/deck';
import { blankDeck } from '../../slides/themes';
import { readPptx } from '../pptx';
import { PNG_1PX } from '../testing';
import { buildPptxFile, deckAssetIds } from './slidesExport';

const image = (id: string): ElementJSON => ({ type: 'image', x: 0, y: 0, w: 100, h: 100, asset: { id } });

function deckWith(...ids: string[]): DeckJSON {
  const deck = blankDeck();
  deck.slides = [
    { id: 's1', layout: 'blank', elements: ids.map(image) },
    { id: 's2', layout: 'blank', bg: { kind: 'image', asset: { id: ids[0]! }, fit: 'cover' }, elements: [] }
  ];
  return deck;
}

const ok = (bytes: Uint8Array, type = 'image/png') => new Response(bytes as BodyInit, { status: 200, headers: { 'content-type': type } });

describe('Export as PowerPoint', () => {
  it('fetches each picture the deck names once, from the document’s assets, and writes every slide', async () => {
    const get = vi.fn(async (url: string | URL | Request) => (String(url).endsWith('/a1') ? ok(PNG_1PX) : new Response(null, { status: 404 })));
    const out = await buildPptxFile({ deck: deckWith('a1', 'a1', 'gone'), title: 'Kick-off', assetUrl: (id) => `/api/office/documents/d/assets/${id}` }, get as unknown as typeof fetch);
    expect(get.mock.calls.map(([u]) => String(u)).sort()).toEqual(['/api/office/documents/d/assets/a1', '/api/office/documents/d/assets/gone']);
    const files = Object.keys(unzipSync(out.bytes));
    expect(files.filter((f) => f.startsWith('ppt/media/'))).toHaveLength(1);
    expect(readPptx(out.bytes).deck.slides).toHaveLength(2);
    // The one that did not come is said once.
    expect(out.warnings.map((w) => w.message).join(' ')).toMatch(/1 picture/);
  });

  it('asks for nothing it has no address for', async () => {
    const get = vi.fn();
    const out = await buildPptxFile({ deck: deckWith('a1'), title: 'Local', assetUrl: () => null }, get as unknown as typeof fetch);
    expect(get).not.toHaveBeenCalled();
    expect(readPptx(out.bytes).deck.slides).toHaveLength(2);
  });

  it('finds a picture wherever a deck has one', () => {
    const deck = deckWith('a1', 'a2');
    deck.master = { ...deck.master, bg: { kind: 'image', asset: { id: 'm1' }, fit: 'cover' } };
    deck.layouts[0] = { ...deck.layouts[0]!, elements: [...deck.layouts[0]!.elements, image('l1')] };
    expect(deckAssetIds(deck).sort()).toEqual(['a1', 'a2', 'l1', 'm1']);
  });
});
