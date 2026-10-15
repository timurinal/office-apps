/**
 * Files that are a stranger's worst. Each is either refused, in words a person can be shown, or
 * neutralised: read, with what was dangerous in it gone and the rest of the deck intact.
 *
 *   refused       zip bomb, billion laughs, external entity, more slides than a deck holds, XML nested
 *                 far past anything a slide has, and what is not a presentation at all
 *   neutralised   links to scripts and files, relationships that point outside the file, a picture
 *                 that lies about its type, dimensions that are not dimensions, groups nested past
 *                 the limit, a slide with a thousand shapes
 *
 * `generate/make_pptx.mjs` makes them. `formats/security.test.ts` builds the same attacks in memory
 * and times the ones that are about speed.
 */

import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DECK_LIMITS, type DeckJSON, type ElementJSON, type GroupElement, type ImageElement, type ShapeElement, type TableElement } from '../../../web/src/slides/model/deck';
import { isFormatError, type FormatError } from '../../../web/src/formats/errors';
import { readPptx } from '../../../web/src/formats/pptx/read';
import { HOSTILE, allElements, bytesOf, listHostile, plain } from './helpers';

afterEach(() => vi.restoreAllMocks());

const open = (name: string) => readPptx(bytesOf(join(HOSTILE, `${name}.pptx`)));

function refusal(name: string): FormatError {
  try {
    open(name);
  } catch (e) {
    if (isFormatError(e)) return e;
    throw e;
  }
  throw new Error(`${name} was not refused`);
}

/** The sentences a person may be shown. */
const PLAIN = new Set(['That file is too large to open.', 'That file could not be opened.', 'That file could not be read.', 'That presentation is too large.', 'That is not a presentation.', 'That file is too large.']);

const everything = (deck: DeckJSON): string => JSON.stringify(deck);

function hrefs(deck: DeckJSON): string[] {
  const out: string[] = [];
  const walk = (n: { marks?: { type: string; attrs?: Record<string, unknown> }[]; content?: unknown[] }): void => {
    for (const m of n.marks ?? []) if (m.type === 'link') out.push(String(m.attrs!.href));
    for (const c of (n.content ?? []) as (typeof n)[]) walk(c);
  };
  for (const e of allElements(deck)) if (e.type === 'shape' && e.text) walk(e.text as never);
  return out;
}

describe('the hostile corpus', () => {
  it('has the files the README lists', () => {
    expect(listHostile()).toEqual([
      'deep-groups.pptx',
      'deep-xml.pptx',
      'doctype-external.pptx',
      'entity-expansion.pptx',
      'external-rels.pptx',
      'huge-shapes.pptx',
      'huge-slide-size.pptx',
      'javascript-links.pptx',
      'lying-picture.pptx',
      'not-a-presentation.pptx',
      'too-many-shapes.pptx',
      'too-many-slides.pptx',
      'truncated.pptx',
      'zip-bomb.pptx',
      'zip-of-something-else.pptx'
    ]);
  });
});

describe('refused, in plain words', () => {
  const cases: [string, string][] = [
    ['zip-bomb', 'zip_limit'],
    ['entity-expansion', 'xml_unsafe'],
    ['doctype-external', 'xml_unsafe'],
    ['too-many-slides', 'deck_too_large'],
    ['deep-xml', 'zip_limit'],
    ['not-a-presentation', 'not_pptx'],
    ['truncated', 'not_pptx'],
    ['zip-of-something-else', 'not_pptx']
  ];
  for (const [name, code] of cases) {
    it(`${name}: ${code}`, () => {
      const e = refusal(name);
      expect(e.code).toBe(code);
      expect(PLAIN.has(e.message), e.message).toBe(true);
      // Nothing about the parser reaches the person.
      expect(e.message).not.toMatch(/xml|entity|doctype|zip|saxes|offset|line \d/i);
    });
  }

  it('says what each is, once', () => {
    expect(refusal('zip-bomb').message).toBe('That file is too large to open.');
    expect(refusal('entity-expansion').message).toBe('That file could not be opened.');
    expect(refusal('too-many-slides').message).toBe('That presentation is too large.');
    expect(refusal('not-a-presentation').message).toBe('That is not a presentation.');
  });
});

describe('neutralised', () => {
  it('external-rels: nothing outside the file is followed, named or kept, and the rest of the slide is', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { deck, warnings } = open('external-rels');
    expect(fetchSpy).not.toHaveBeenCalled();
    const s = everything(deck);
    expect(s).not.toMatch(/169\.254|etc\/passwd|etc\/shadow|file:|http:/i);
    // The three pictures point at nothing the deck may take; the text box is still there.
    expect(deck.slides[0]!.elements.map((e) => e.type)).toEqual(['shape']);
    expect(plain((deck.slides[0]!.elements[0] as ShapeElement).text)).toBe('Still here');
    expect(warnings.join(' ')).toMatch(/linked from outside the file/);
    expect(warnings.join(' ')).toMatch(/could not be found/);
  });

  it('javascript-links: only web and mail addresses stay', () => {
    const { deck, warnings } = open('javascript-links');
    expect(hrefs(deck)).toEqual(['https://example.com/ok', 'mailto:a@example.com']);
    expect(everything(deck)).not.toMatch(/javascript|vbscript|data:text|file:|ftp:/i);
    expect(warnings.join(' ')).toMatch(/7 links to places other than web and mail addresses were left out/);
    // The text of every link is kept.
    expect(deck.slides[0]!.elements.length).toBe(9);
  });

  it('huge-slide-size: not a size a slide can be, so the slide is 16:9', () => {
    const { deck, warnings } = open('huge-slide-size');
    expect(deck.size).toBe('16:9');
    expect(warnings.join(' ')).toMatch(/slide size was not a size a slide can be/);
    expect(deck.slides.length).toBe(1);
    expect(plain((deck.slides[0]!.elements[0] as ShapeElement).text)).toBe('On an absurd slide');
  });

  it('huge-shapes: every number is a number a slide can hold', () => {
    const { deck } = open('huge-shapes');
    const bounded = (n: number | undefined, lo: number, hi: number): boolean => n === undefined || (Number.isFinite(n) && n >= lo && n <= hi);
    for (const e of allElements(deck)) {
      expect(bounded(e.x, -20000, 20000), `x ${e.x}`).toBe(true);
      expect(bounded(e.y, -20000, 20000), `y ${e.y}`).toBe(true);
      expect(bounded(e.w, 0, 20000), `w ${e.w}`).toBe(true);
      expect(bounded(e.h, 0, 20000), `h ${e.h}`).toBe(true);
      expect(bounded(e.rot, 0, 360), `rot ${e.rot}`).toBe(true);
    }
    const huge = deck.slides[0]!.elements[0] as ShapeElement;
    expect(huge.line!.width).toBeLessThanOrEqual(400);
    const mark = huge.text!.content[0]!.content![0]!.marks!.find((m) => m.type === 'textStyle')!;
    expect(mark.attrs!.fontSize).toBeLessThanOrEqual(400);
    const table = deck.slides[0]!.elements.find((e) => e.type === 'table') as TableElement;
    expect(table.cols.every((c) => c >= 0 && c <= 20000)).toBe(true);
    expect(table.rows.every((r) => r.h >= 0 && r.h <= 20000)).toBe(true);
    expect(Math.max(...table.rows.flatMap((r) => r.cells.map((c) => c.colSpan ?? 1)))).toBeLessThanOrEqual(table.cols.length);
    // And the text box after them is read.
    expect(deck.slides[0]!.elements.some((e) => e.type === 'shape' && plain(e.text) === 'After the huge ones')).toBe(true);
  });

  it('lying-picture: a picture is its bytes, whatever its name says', () => {
    const { deck, warnings } = open('lying-picture');
    const images = deck.slides[0]!.elements.filter((e): e is ImageElement => e.type === 'image');
    // An SVG with a script, a web page and an executable are gone; a PNG and a JPEG with the wrong name are what they are.
    expect(images.map((i) => i.asset.mime)).toEqual(['image/png', 'image/jpeg']);
    expect(everything(deck)).not.toMatch(/script|alert|<svg|<html/i);
    expect(warnings.join(' ')).toMatch(/EMF, WMF, SVG or TIFF/);
    expect(warnings.join(' ')).toMatch(/2 pictures that are not picture files were left out/);
  });

  it('too-many-shapes: a slide holds what a slide holds, and says what it left out', () => {
    const { deck, warnings } = open('too-many-shapes');
    expect(deck.slides[0]!.elements.length).toBe(DECK_LIMITS.elementsPerSlide);
    expect(plain((deck.slides[0]!.elements.at(-1) as ShapeElement).text)).toBe(`Shape ${DECK_LIMITS.elementsPerSlide - 1}`);
    expect(warnings.join(' ')).toMatch(/200 shapes past the 400 a slide can hold were left out/);
  });

  it('deep-groups: groups nested past the limit are flattened, and what was inside is kept', () => {
    const { deck, warnings } = open('deep-groups');
    const depth = (e: ElementJSON): number => (e.type === 'group' ? 1 + Math.max(0, ...e.children.map(depth)) : 0);
    const deepest = Math.max(...deck.slides[0]!.elements.map(depth));
    expect(deepest).toBeLessThanOrEqual(DECK_LIMITS.groupDepth);
    expect(allElements(deck).some((e) => e.type === 'shape' && plain(e.text) === 'Deep inside')).toBe(true);
    expect(warnings.join(' ')).toMatch(/nested more than 8 deep/);
    void (undefined as unknown as GroupElement);
  });
});
