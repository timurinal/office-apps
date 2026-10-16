import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { SLIDE_HEIGHT, SLIDE_WIDTH, type Fill, type ThemeJSON } from '../model/deck';
import { contrast, resolveColor } from './color';
import { blankDeck, DEFAULT_THEME_ID, FOOTER_TYPES, layoutsFor, masterFor, previewOf, THEME_PREVIEWS, THEMES, themeById } from './index';

/**
 * Plain is PowerPoint's Office Theme: a white slide, a title and a subtitle, and nothing drawn
 * that is not text. It is the default, so it is what a new presentation starts on; every other
 * theme is a choice, and keeps the look it had before Plain existed.
 */

const H = SLIDE_HEIGHT['16:9'];
const plain = themeById('plain')!;

/** The colour of a solid fill, resolved against `theme`; anything else is not a ground. */
const solid = (fill: Fill | undefined, theme: ThemeJSON): string => (fill?.kind === 'solid' ? resolveColor(fill.color, theme) : `not solid: ${fill?.kind}`);

describe('the Plain theme', () => {
  it('is the default, comes first in the gallery, and is what a new presentation starts on', () => {
    expect(DEFAULT_THEME_ID).toBe('plain');
    expect(THEMES[0]).toBe(plain);
    expect(THEME_PREVIEWS[0]!.id).toBe('plain');
    expect(blankDeck().theme).toBe(plain);
    expect(blankDeck('nope').theme).toBe(plain);
  });

  it('is white with near-black ink, a dark grey for the quiet text, and one neutral sans for everything', () => {
    expect(plain.name).toBe('Plain');
    expect(plain.colors.lt1).toBe('#ffffff');
    expect(contrast(plain.colors.dk1, plain.colors.lt1)).toBeGreaterThanOrEqual(15);
    expect(contrast(plain.colors.dk2, plain.colors.lt1)).toBeGreaterThanOrEqual(7);
    expect(plain.fonts).toEqual({ major: 'Inter', minor: 'Inter' });
  });

  it('has six accents that differ, led by a blue and an orange, and a link that reads on white', () => {
    const accents = (['accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6'] as const).map((a) => plain.colors[a]);
    expect(new Set(accents).size).toBe(6);
    const hue = (hex: string): number => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
      const max = Math.max(r, g, b);
      const d = max - Math.min(r, g, b);
      if (d === 0) return -1;
      const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
      return Math.round(((h * 60 + 360) % 360));
    };
    expect(hue(accents[0]!)).toBeGreaterThanOrEqual(200);
    expect(hue(accents[0]!)).toBeLessThanOrEqual(240);
    expect(hue(accents[1]!)).toBeGreaterThanOrEqual(10);
    expect(hue(accents[1]!)).toBeLessThanOrEqual(35);
    expect(hue(accents[2]!)).toBe(-1);
    expect(contrast(plain.colors.hlink, plain.colors.lt1)).toBeGreaterThanOrEqual(4.5);
  });

  it('is described for the gallery as a white slide', () => {
    const p = previewOf(plain);
    expect(p).toMatchObject({ id: 'plain', dark: false, ground: '#ffffff', hero: '#ffffff' });
    expect(contrast(p.heroInk, p.hero)).toBeGreaterThanOrEqual(7);
  });

  it('sets its master on a white ground, with the title in ink, not bold, and the bullets in ink', () => {
    const master = masterFor(plain);
    expect(master.bg).toEqual({ kind: 'solid', color: { theme: 'lt1' } });
    expect(solid(master.bg, plain)).toBe('#ffffff');
    expect(master.styles.title).toMatchObject({ bold: false, color: { theme: 'dk1' }, align: 'left' });
    const first = master.styles.body[0]!.bullet;
    expect(first).toMatchObject({ kind: 'char', color: { theme: 'dk1' } });
  });

  describe('layouts', () => {
    const layouts = layoutsFor(plain);

    it('draw nothing but placeholders: no rule, band, bar or card on any of the ten', () => {
      expect(layouts).toHaveLength(10);
      for (const l of layouts) {
        const drawn = l.elements.filter((e) => !e.ph).map((e) => e.name);
        expect(drawn, l.id).toEqual([]);
      }
    });

    it('have no ground of their own, so the title and section slides are as white as the rest', () => {
      for (const l of layouts) expect(l.bg, l.id).toBeUndefined();
    });

    it('put the title slide’s title centred at about 35% of the height, and the subtitle centred below it', () => {
      const title = layouts.find((l) => l.id === 'title')!;
      const ph = (type: string) => title.elements.find((e) => e.ph?.type === type)!;
      const [t, s] = [ph('ctrTitle'), ph('subTitle')];
      expect(title.elements.filter((e) => !FOOTER_TYPES.includes(e.ph!.type)).map((e) => e.ph!.type)).toEqual(['ctrTitle', 'subTitle']);
      expect((t.y + t.h / 2) / H).toBeGreaterThan(0.33);
      expect((t.y + t.h / 2) / H).toBeLessThan(0.37);
      // Both are centred on the slide, and the subtitle starts where the title stops.
      expect(t.x + t.w / 2).toBe(SLIDE_WIDTH / 2);
      expect(s.x + s.w / 2).toBe(SLIDE_WIDTH / 2);
      expect(s.y).toBeGreaterThanOrEqual(t.y + t.h);
      expect(title.styles!.ctrTitle![0]).toMatchObject({ align: 'center' });
      expect(title.styles!.subTitle![0]).toMatchObject({ align: 'center', bullet: { kind: 'none' } });
      expect(title.styles!.subTitle).toHaveLength(5);
    });

    it('set the title slide’s title at 60 pt and every other layout’s at the master’s 44', () => {
      expect(layouts.find((l) => l.id === 'title')!.styles!.ctrTitle![0]!.fontSize).toBe(60);
      expect(masterFor(plain).styles.title.fontSize).toBe(44);
    });
  });

  describe('a new presentation', () => {
    const deck = blankDeck();

    it('is white, with a title slide of exactly a title and a subtitle and nothing drawn on it', () => {
      expect(solid(deck.master.bg, deck.theme)).toBe('#ffffff');
      const [slide] = deck.slides;
      expect(deck.slides).toHaveLength(1);
      expect(slide!.layout).toBe('title');
      expect(slide!.bg).toBeUndefined();
      expect(slide!.elements.map((e) => e.ph?.type)).toEqual(['ctrTitle', 'subTitle']);
      expect(deck.layouts.find((l) => l.id === 'title')!.bg).toBeUndefined();
    });

    it('carries the Plain master and layouts', () => {
      expect(deck.master).toEqual(masterFor(plain));
      expect(deck.layouts).toEqual(layoutsFor(plain));
    });
  });
});

// ── the others do not move ──────────────────────────────────────────────────

/** A theme this file has never heard of, as an imported deck would bring: it gets the derived look. */
const custom = (id: string, accent1: string): ThemeJSON => ({ ...themeById('violet')!, id, name: id, colors: { ...themeById('violet')!.colors, accent1 } });

const digest = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);

/**
 * The first 16 hex digits of the SHA-256 of each theme's layouts, master and gallery entry as
 * JSON, taken before Plain existed. A theme brought in from a file (`imported`, `yellow`) is here
 * too: it gets `deriveLook`, which Plain must not have touched. If one of these fails, a flag
 * written for Plain has leaked into the look of a theme it was not written for.
 */
const BEFORE: Record<string, { layouts: string; master: string; preview: string }> = {
  violet: { layouts: 'b4604ac01351b090', master: '5f745b7d73b4a46e', preview: '4012467077dee3ba' },
  midnight: { layouts: '16e953741d0930ad', master: '65642124fc48fb75', preview: '6e805552f7708e4b' },
  paper: { layouts: 'b95c65f4256fee1e', master: 'd8ecf1a125f0d757', preview: '8954a4a239700369' },
  fern: { layouts: 'a7a416a3735bf439', master: '4005f025f4c51890', preview: 'a7f9793f036411b7' },
  harbour: { layouts: '237d9f8a0b1ad9e1', master: '70e1dd83e577e3ef', preview: '429f21dda923aa82' },
  ember: { layouts: 'a7a416a3735bf439', master: '5f745b7d73b4a46e', preview: '925d6e636013b3af' },
  graphite: { layouts: '8496a22d0fede127', master: '347a1d4f39917610', preview: '3c429e1f542d4eca' },
  billboard: { layouts: '04eb525c5f84cee0', master: '027642bfe965ae22', preview: '8102d5eec12c8183' },
  imported: { layouts: '402040a160b55f32', master: '4005f025f4c51890', preview: '2e7ababc7ad16c92' },
  yellow: { layouts: '402040a160b55f32', master: 'ccf7e1b1d846886f', preview: '539afc2b5bf12bf8' }
};

describe('every theme but Plain keeps its look', () => {
  const others = [...THEMES.filter((t) => t.id !== 'plain'), custom('imported', '#796cbf'), custom('yellow', '#ffe14d')];

  it('covers each of them', () => {
    expect(others.map((t) => t.id).sort()).toEqual(Object.keys(BEFORE).sort());
  });

  for (const theme of others) {
    it(`${theme.name}: layouts, master and gallery entry are byte for byte what they were`, () => {
      const want = BEFORE[theme.id]!;
      expect(digest(layoutsFor(theme)), 'layouts').toBe(want.layouts);
      expect(digest(masterFor(theme)), 'master').toBe(want.master);
      expect(digest(previewOf(theme)), 'preview').toBe(want.preview);
    });
  }

  it('still draw the title slide on a colour, with the accent bar, and the section header on a tint with its band', () => {
    for (const theme of others) {
      const layouts = layoutsFor(theme);
      const named = (id: string) => layouts.find((l) => l.id === id)!.elements.filter((e) => !e.ph).map((e) => e.name);
      expect(named('title'), theme.id).toEqual(['Accent']);
      expect(named('section'), theme.id).toEqual(['Band']);
      expect(layouts.find((l) => l.id === 'title')!.bg?.kind, theme.id).toBe('solid');
    }
  });
});
