/**
 * Every template and every blank deck through the model that will make a document of it: the slide
 * text schema, and the Yjs layout. If a node is in the wrong place, an attribute is one the editor
 * does not have, or a deck breaks a rule `deckToY` holds, this is where it fails, and not on a
 * person's Home page.
 */

import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { LIMITS } from '@shared/api';
import type { DeckJSON, ElementJSON, TextDoc } from '../model/deck';
import { deckToY, yToDeck } from '../model/ydoc';
import { plainText, textNode } from '../model/schema';
import { blankDeck, THEMES } from '../themes';
import { SLIDES_TEMPLATES } from './index';

const texts = (els: ElementJSON[]): TextDoc[] =>
  els.flatMap((e): TextDoc[] => {
    if (e.type === 'group') return texts(e.children);
    if (e.type === 'table') return e.rows.flatMap((r) => r.cells.map((c) => c.text));
    return e.type === 'shape' && e.text ? [e.text] : [];
  });

const allText = (deck: DeckJSON): TextDoc[] => [
  ...texts(deck.master.elements),
  ...deck.layouts.flatMap((l) => texts(l.elements)),
  ...deck.slides.flatMap((s) => [...texts(s.elements), ...(s.notes ? [s.notes] : [])])
];

const decks: [string, () => DeckJSON][] = [
  ...SLIDES_TEMPLATES.map((t): [string, () => DeckJSON] => [t.title, () => t.deck()]),
  ...THEMES.map((t): [string, () => DeckJSON] => [`a blank deck in ${t.name}`, () => blankDeck(t.id)])
];

describe.each(decks)('%s', (_name, make) => {
  const deck = make();

  it('has text the slide schema accepts, in its slides, its layouts and its notes', () => {
    const docs = allText(deck);
    expect(docs.length).toBeGreaterThan(10);
    for (const doc of docs) expect(() => textNode(doc), JSON.stringify(doc)).not.toThrow();
  });

  it('becomes a Yjs state a room takes, and well under the cap', () => {
    const state = deckToY(deck);
    expect(state.byteLength).toBeGreaterThan(0);
    expect(state.byteLength).toBeLessThan(LIMITS.docStateMaxBytes / 8);
  });

  it('reads back as the deck it was: the same theme, master, layouts, and slides in order', () => {
    const doc = new Y.Doc();
    Y.applyUpdate(doc, deckToY(deck));
    const back = yToDeck(doc);
    expect(back.size).toBe(deck.size);
    expect(back.theme).toEqual(deck.theme);
    expect(back.master).toEqual(deck.master);
    expect(back.layouts).toEqual(deck.layouts);
    expect(back.slides.map((s) => s.id)).toEqual(deck.slides.map((s) => s.id));
    back.slides.forEach((s, i) => {
      const was = deck.slides[i]!;
      expect(s.layout).toBe(was.layout);
      expect(s.elements.map((e) => e.id)).toEqual(was.elements.map((e) => e.id));
      expect(s.elements.map((e) => e.type)).toEqual(was.elements.map((e) => e.type));
      expect(s.elements.map((e) => e.ph)).toEqual(was.elements.map((e) => e.ph));
      expect(plainText(s.notes)).toBe(plainText(was.notes));
      expect(texts(s.elements).map((d) => plainText(d))).toEqual(texts(was.elements).map((d) => plainText(d)));
    });
    doc.destroy();
  });
});
