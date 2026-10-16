/**
 * What the reader makes is what the editor accepts.
 *
 * Every text body in every deck of the corpus, read from the file and read from our own export of it, is
 * checked against the slide text schema (`slides/model/schema.ts`), the one the editor, the renderer and
 * the model share: a body it refuses is refused there, so it must not be made here. And every value the
 * model reads through `safe.ts` on the way out (a colour, a fill, a line, a bullet, a family, a size) is
 * checked to come through unchanged, so the deck the reader hands over is the deck the room keeps.
 */

import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AssetRef, DeckJSON, ElementJSON, TextDoc } from '../../../web/src/slides/model/deck';
import { readPptx } from '../../../web/src/formats/pptx/read';
import { writePptx } from '../../../web/src/formats/pptx/write';
import { safeBullet, safeColor, safeFamily, safeLine, safePt } from '../../../web/src/slides/model/safe';
import { textNode } from '../../../web/src/slides/model/schema';
import { DIR, bytesOf, listDecks } from './helpers';

const decode = (b64: string): Uint8Array => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
const getAsset = async (ref: AssetRef) => (ref.data ? { bytes: decode(ref.data), mime: ref.mime ?? 'image/png' } : null);

function texts(deck: DeckJSON): { at: string; doc: TextDoc }[] {
  const out: { at: string; doc: TextDoc }[] = [];
  const el = (e: ElementJSON, at: string): void => {
    if (e.type === 'shape' && e.text) out.push({ at, doc: e.text });
    if (e.type === 'table') e.rows.forEach((r, ri) => r.cells.forEach((c, ci) => out.push({ at: `${at} cell ${ri},${ci}`, doc: c.text })));
    if (e.type === 'group') e.children.forEach((c, i) => el(c, `${at}.${i + 1}`));
  };
  deck.master.elements.forEach((e, i) => el(e, `master ${i + 1}`));
  deck.layouts.forEach((l) => l.elements.forEach((e, i) => el(e, `layout ${l.name} ${i + 1}`)));
  deck.slides.forEach((s, si) => {
    s.elements.forEach((e, i) => el(e, `slide ${si + 1} element ${i + 1}`));
    if (s.notes) out.push({ at: `slide ${si + 1} notes`, doc: s.notes });
  });
  return out;
}

/** Every style the model would read through safe.ts, on a deck. */
function styles(deck: DeckJSON): unknown[] {
  const out: unknown[] = [deck.master.styles.title, deck.master.styles.other, ...deck.master.styles.body];
  for (const l of deck.layouts) for (const levels of Object.values(l.styles ?? {})) out.push(...levels);
  return out;
}

describe('every text body the reader makes is one the editor accepts', () => {
  for (const name of listDecks()) {
    it(`${name}: from the file, and from our export of it`, async () => {
      const first = readPptx(bytesOf(join(DIR, name))).deck;
      const second = readPptx(await writePptx(first, getAsset)).deck;
      for (const deck of [first, second]) for (const { at, doc } of texts(deck)) expect(() => textNode(doc), `${name}: ${at}`).not.toThrow();
    });

    it(`${name}: colours, lines, bullets, families and sizes pass through safe.ts unchanged`, () => {
      const deck = readPptx(bytesOf(join(DIR, name))).deck;
      for (const s of styles(deck) as Record<string, unknown>[]) {
        if (s.color !== undefined) expect(safeColor(s.color), `${name}: ${JSON.stringify(s.color)}`).toEqual(s.color);
        if (s.bullet !== undefined) expect(safeBullet(s.bullet), `${name}: ${JSON.stringify(s.bullet)}`).toEqual(s.bullet);
        if (s.fontFamily !== undefined) expect(safeFamily(s.fontFamily), `${name}: ${String(s.fontFamily)}`).toBe(s.fontFamily);
        if (s.fontSize !== undefined) expect(safePt(s.fontSize), `${name}: ${String(s.fontSize)}`).toBe(s.fontSize);
      }
      const walk = (e: ElementJSON): void => {
        if (e.type === 'shape' || e.type === 'line' || e.type === 'image') {
          const line = (e as { line?: unknown }).line;
          if (line) expect(safeLine(line), `${name}: ${JSON.stringify(line)}`).toEqual(line);
        }
        if (e.type === 'shape' && e.text) {
          for (const p of e.text.content) {
            if (p.attrs?.bullet) expect(safeBullet(p.attrs.bullet), name).toEqual(p.attrs.bullet);
            for (const n of p.content ?? [])
              for (const m of n.marks ?? []) {
                if (m.type !== 'textStyle') continue;
                if (m.attrs?.color !== undefined) expect(safeColor(m.attrs.color), name).toEqual(m.attrs.color);
                if (m.attrs?.fontFamily !== undefined) expect(safeFamily(m.attrs.fontFamily), name).toBe(m.attrs.fontFamily);
                if (m.attrs?.fontSize !== undefined) expect(safePt(m.attrs.fontSize), name).toBe(m.attrs.fontSize);
              }
          }
        }
        if (e.type === 'shape' && e.fill?.kind === 'solid') expect(safeColor(e.fill.color), name).toEqual(e.fill.color);
        if (e.type === 'group') e.children.forEach(walk);
      };
      for (const s of deck.slides) s.elements.forEach(walk);
    });
  }
});
