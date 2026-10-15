/**
 * Mutations of the corpus, seeded, so a failure names the seed that makes it.
 *
 * The reader is given decks with a part cut off, an attribute swapped for something it should not be,
 * an element deleted or doubled, a number made enormous. The one thing it may do is refuse the file
 * with a `FormatError`; it must not throw anything else, and when it reads, what it returns must be a
 * deck: finite numbers, no slide lost, nothing that was not in the file. The writer is given decks whose
 * values have been swapped for other types, and must write a package every part of which parses.
 */

import { join } from 'node:path';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import type { AssetRef, DeckJSON } from '../../../web/src/slides/model/deck';
import { isFormatError } from '../../../web/src/formats/errors';
import { parsePart } from '../../../web/src/formats/pptx/part';
import { readPptx } from '../../../web/src/formats/pptx/read';
import { writePptx } from '../../../web/src/formats/pptx/write';
import { DIR, bytesOf, listDecks, sldIdCount } from './helpers';

function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const JUNK = ['', ' ', 'NaN', '-1', '0', '1', '99999999999999999999', '1e308', '-2147483648', '2147483647', 'abc', '<>', '&amp;', 'constructor', '__proto__', 'toString', '#', 'null', 'true', '0.5', '-0'];

type Rnd = () => number;
const pick = <T>(r: Rnd, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;

/** One mutation of an XML text. */
function mutateXml(xml: string, r: Rnd): string {
  switch (Math.floor(r() * 7)) {
    case 0:
      return xml.slice(0, Math.floor(r() * xml.length));
    case 1: {
      // An attribute value swapped for junk.
      const attrs = [...xml.matchAll(/ ([A-Za-z:]+)="([^"]*)"/g)];
      if (attrs.length === 0) return xml;
      const m = pick(r, attrs);
      return xml.slice(0, m.index) + ` ${m[1]}="${pick(r, JUNK)}"` + xml.slice(m.index! + m[0].length);
    }
    case 2: {
      // Text swapped for junk.
      const texts = [...xml.matchAll(/>([^<>]+)</g)];
      if (texts.length === 0) return xml;
      const m = pick(r, texts);
      return xml.slice(0, m.index! + 1) + pick(r, JUNK) + xml.slice(m.index! + m[0].length - 1);
    }
    case 3: {
      // An element and everything in it deleted.
      const tags = [...xml.matchAll(/<([A-Za-z0-9]+:[A-Za-z0-9]+)(?: [^>]*)?>[\s\S]*?<\/\1>/g)];
      if (tags.length === 0) return xml;
      const m = pick(r, tags);
      return xml.slice(0, m.index) + xml.slice(m.index! + m[0].length);
    }
    case 4: {
      // An element doubled.
      const tags = [...xml.matchAll(/<([A-Za-z0-9]+:[A-Za-z0-9]+)(?: [^>]*)?>[\s\S]*?<\/\1>/g)];
      if (tags.length === 0) return xml;
      const m = pick(r, tags);
      return xml.slice(0, m.index! + m[0].length) + m[0] + xml.slice(m.index! + m[0].length);
    }
    case 5: {
      // An element's name changed to another that is in the file.
      const names = [...xml.matchAll(/<([A-Za-z0-9]+:[A-Za-z0-9]+)/g)].map((m) => m[1]!);
      if (names.length < 2) return xml;
      const from = pick(r, names);
      const to = pick(r, names);
      const i = xml.indexOf(`<${from}`);
      const j = xml.indexOf(`</${from}>`, i);
      if (i < 0 || j < 0) return xml;
      return xml.slice(0, i) + `<${to}` + xml.slice(i + 1 + from.length, j) + `</${to}>` + xml.slice(j + 3 + from.length);
    }
    default: {
      // A number made enormous.
      const nums = [...xml.matchAll(/="(-?\d{3,})"/g)];
      if (nums.length === 0) return xml;
      const m = pick(r, nums);
      return xml.slice(0, m.index) + `="${m[1]}${'9'.repeat(1 + Math.floor(r() * 20))}"` + xml.slice(m.index! + m[0].length);
    }
  }
}

function mutatePackage(bytes: Uint8Array, r: Rnd): Uint8Array {
  const files = unzipSync(bytes);
  const xmls = Object.keys(files).filter((n) => /\.(?:xml|rels)$/.test(n) && !n.startsWith('[') );
  const times = 1 + Math.floor(r() * 3);
  for (let i = 0; i < times; i++) {
    const name = pick(r, xmls);
    files[name] = strToU8(mutateXml(strFromU8(files[name]!), r));
  }
  return zipSync(files);
}

const finite = (v: unknown, path: string): void => {
  if (typeof v === 'number') expect(Number.isFinite(v), `${path} is ${v}`).toBe(true);
  else if (Array.isArray(v)) v.forEach((x, i) => finite(x, `${path}[${i}]`));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) finite(x, `${path}.${k}`);
};

/** `FUZZ_SEEDS=500 npx vitest run tests/corpus/pptx/fuzz.test.ts` looks harder. */
const SEEDS = Number(process.env.FUZZ_SEEDS ?? 24);

describe('the reader, given decks that have been damaged', () => {
  for (const name of listDecks()) {
    it(`${name}: refuses with a FormatError or reads a deck, never throws anything else`, () => {
      const original = bytesOf(join(DIR, name));
      const count = name.startsWith('22') ? 4 : SEEDS;
      for (let seed = 1; seed <= count; seed++) {
        const r = prng(seed * 7919 + name.length);
        const bytes = mutatePackage(original, r);
        try {
          const { deck, warnings } = readPptx(bytes);
          // No slide is lost, unless the mutation cut the list itself.
          let listed = -1;
          try {
            listed = sldIdCount(bytes);
          } catch {
            listed = -1;
          }
          if (listed >= 0) expect(deck.slides.length, `${name} seed ${seed}`).toBe(listed);
          finite(deck, `${name} seed ${seed}: deck`);
          expect(JSON.stringify(deck), `${name} seed ${seed}`).not.toMatch(/\[object|native code|undefined/);
          for (const w of warnings) expect(typeof w).toBe('string');
        } catch (e) {
          if (!isFormatError(e)) throw new Error(`${name} seed ${seed}: ${(e as Error).stack}`);
        }
      }
    });
  }
});

const decode = (b64: string): Uint8Array => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
const getAsset = async (ref: AssetRef) => (ref.data ? { bytes: decode(ref.data), mime: ref.mime ?? 'image/png' } : null);

/** Every object or array in a value, with the key it is under. */
function nodes(v: unknown, out: { parent: Record<string, unknown> | unknown[]; key: string | number }[] = []): typeof out {
  if (Array.isArray(v)) {
    v.forEach((x, i) => {
      out.push({ parent: v, key: i });
      nodes(x, out);
    });
  } else if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) {
      out.push({ parent: v as Record<string, unknown>, key: k });
      nodes(x, out);
    }
  }
  return out;
}

const REPLACEMENTS: unknown[] = [null, NaN, Infinity, -1, 1e308, '', 'x', [], {}, true, '__proto__', 'constructor', 7, [null], [1, 2], { type: 'shape' }, { type: 'group', children: 5 }, { kind: 'solid' }, 'javascript:alert(1)'];

describe('the writer, given decks whose values are not what they should be', () => {
  for (const name of listDecks().filter((n) => !n.startsWith('22'))) {
    it(`${name}: writes a package every part of which parses, whatever it is given`, async () => {
      const first = readPptx(bytesOf(join(DIR, name))).deck;
      for (let seed = 1; seed <= Math.ceil(SEEDS / 2); seed++) {
        const r = prng(seed * 104729 + name.length);
        const deck = structuredClone(first) as DeckJSON;
        const all = nodes(deck).filter(({ key }) => key !== 'asset' && key !== 'data' && key !== 'mime');
        for (let i = 0; i < 1 + Math.floor(r() * 4); i++) {
          const target = pick(r, all);
          (target.parent as Record<string | number, unknown>)[target.key] = pick(r, REPLACEMENTS);
        }
        let bytes: Uint8Array;
        try {
          bytes = await writePptx(deck, getAsset);
        } catch (e) {
          throw new Error(`${name} seed ${seed}: ${(e as Error).stack}`);
        }
        for (const [part, data] of Object.entries(unzipSync(bytes))) {
          if (/\.(?:xml|rels)$/.test(part)) expect(() => parsePart(data), `${name} seed ${seed}: ${part}`).not.toThrow();
        }
        expect(() => readPptx(bytes), `${name} seed ${seed}`).not.toThrow();
      }
    });
  }
});
