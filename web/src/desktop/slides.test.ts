import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { yToDeck } from '../slides/model/ydoc';
import { themeById } from '../slides/themes';
import { readContainer, writeContainer } from './container';
import { parseMirror } from './deckMirror';
import type { Host, OpenRequest } from './host';
import { NEW_DECK_THEME, openSlides } from './LocalSlidesPage';
import { pictureIdsIn, PictureStore } from './pictures';

const corpus = (name: string) => new Uint8Array(readFileSync(new URL(`../../../tests/corpus/pptx/${name}`, import.meta.url)));

function hostWith(bytes: Uint8Array): Host {
  return { readOpened: async () => bytes } as unknown as Host;
}

describe('a Slides window', () => {
  it('starts a blank deck in a theme that exists', async () => {
    expect(themeById(NEW_DECK_THEME)).toBeDefined();
    const opened = await openSlides(hostWith(new Uint8Array()), { kind: 'slides', source: 'new' });
    const doc = new Y.Doc();
    Y.applyUpdate(doc, opened.state);
    expect(yToDeck(doc).theme.id).toBe(NEW_DECK_THEME);
    expect(opened.title).toBe('Untitled presentation');
  });

  it('imports a PowerPoint file with its pictures, each named by an id of its own, and saves them all', async () => {
    const open: OpenRequest = { kind: 'slides', source: 'import', path: '/x/16-images-crop.pptx', name: '16-images-crop.pptx' };
    const opened = await openSlides(hostWith(corpus('16-images-crop.pptx')), open);
    expect(opened.title).toBe('16-images-crop');
    expect(opened.pictures.length).toBeGreaterThan(0);

    const doc = new Y.Doc();
    Y.applyUpdate(doc, opened.state);
    const named = pictureIdsIn(yToDeck(doc));
    expect([...named].some((id) => id.startsWith('import-'))).toBe(false);
    expect([...named].every((id) => opened.pictures.some((p) => p.id === id))).toBe(true);

    const store = new PictureStore(opened.pictures);
    const file = writeContainer({ kind: 'slides', id: opened.id, title: opened.title, app: 'Office', state: Y.encodeStateAsUpdate(doc), pictures: store.list(named) });
    const back = readContainer(file, 'slides');
    expect(back.pictures.map((p) => p.id).sort()).toEqual([...named].sort());
  });

  it('finds the pictures a deck names, in slides, fills and the design', () => {
    const deck = {
      slides: [{ elements: [{ type: 'image', asset: { id: 'a1' } }, { type: 'shape', fill: { kind: 'image', asset: { id: 'b2' } } }], bg: { kind: 'image', asset: { id: 'c3' } } }],
      master: { elements: [{ type: 'image', asset: { id: 'd4' } }] },
      odd: { asset: { id: '../nope' } }
    };
    expect([...pictureIdsIn(deck)].sort()).toEqual(['a1', 'b2', 'c3', 'd4']);
  });

  it('takes only well-formed messages from the presenter’s channel', () => {
    expect(parseMirror({ t: 'want' })).toEqual({ t: 'want' });
    expect(parseMirror({ t: 'update', update: new Uint8Array([1]) })).not.toBeNull();
    expect(parseMirror({ t: 'update', update: 'nope' })).toBeNull();
    expect(parseMirror({ t: 'deck', id: 'd', title: 't', update: new Uint8Array(), pictures: [{ id: 'p', mime: 'text/html', name: '', bytes: new Uint8Array() }] })).toMatchObject({ pictures: [] });
    expect(parseMirror(null)).toBeNull();
    expect(parseMirror({ t: 'other' })).toBeNull();
  });
});
