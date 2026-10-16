import { describe, expect, it } from 'vitest';
import { FILL_COLORS as SHEET_FILLS, TEXT_COLORS as SHEET_TEXT } from '../sheets/modules/palettes';
import { HIGHLIGHT_COLORS, SHADING_COLORS, TEXT_COLORS } from '../docs/core/colors';
import { contrast, luminance } from './color';
import {
  DARK_GROUND,
  FILL_LUMINANCE_MAX,
  INK_CONTRAST_MIN,
  darkFill,
  darkInk,
  hslOf,
  parseColour
} from './darkColors';

/** Hue in degrees of a `#rrggbb`, and how far apart two hues are. */
const hueOf = (hex: string): number => hslOf(parseColour(hex)!).h;
const apart = (a: number, b: number): number => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));
const chroma = (hex: string): number => {
  const { r, g, b } = parseColour(hex)!;
  return Math.max(r, g, b) - Math.min(r, g, b);
};

// A fixed pseudo-random sweep, so a failure names its colour and the next run finds it too.
function sweep(n: number): string[] {
  let x = 0x9e3779b9;
  const next = () => ((x = Math.imul(x ^ (x >>> 15), 0x2c1b3c6d) >>> 0), x);
  return Array.from({ length: n }, () => '#' + (next() & 0xffffff).toString(16).padStart(6, '0'));
}
const SAMPLE = sweep(3000);
const PALETTE_TEXT = [...TEXT_COLORS, ...SHEET_TEXT].map((s) => s.value);
const PALETTE_FILLS = [...HIGHLIGHT_COLORS, ...SHADING_COLORS, ...SHEET_FILLS].map((s) => s.value);

describe('parseColour', () => {
  it('reads what the format can hold', () => {
    expect(parseColour('#3d6cd0')).toEqual({ r: 61, g: 108, b: 208, a: 1 });
    expect(parseColour('#FFF')).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseColour('rgb(1, 2, 3)')).toEqual({ r: 1, g: 2, b: 3, a: 1 });
    expect(parseColour('rgba(1, 2, 3, 0.5)')).toEqual({ r: 1, g: 2, b: 3, a: 0.5 });
    expect(parseColour('#11223344')?.a).toBeCloseTo(0.267, 2);
  });
  it('refuses the rest', () => {
    for (const bad of ['', 'red', 'transparent', 'var(--x)', '#12', '#ggg', 'rgb(1,2)', 'rgb(300, 0, 0)', 'url(x)']) expect(parseColour(bad), bad).toBeNull();
  });
});

describe('darkInk, the colour of text on a dark page', () => {
  it('flips black to white', () => {
    expect(darkInk('#000000')).toBe('#ffffff');
  });

  // White inverts to black, which is the page; it is raised to the least that reads, not past it.
  it('raises white, which inverts to the page, only as far as it must', () => {
    const white = darkInk('#ffffff');
    expect(contrast(white, DARK_GROUND)).toBeGreaterThanOrEqual(INK_CONTRAST_MIN - 0.05);
    expect(contrast(white, DARK_GROUND)).toBeLessThan(INK_CONTRAST_MIN + 0.3);
  });

  it('reads on the dark page at 4.5:1 or better, for every colour the palettes offer', () => {
    for (const c of PALETTE_TEXT) expect(contrast(darkInk(c), DARK_GROUND), c).toBeGreaterThanOrEqual(4.5);
  });

  it('reads on the dark page for any colour at all', () => {
    for (const c of SAMPLE) expect(contrast(darkInk(c), DARK_GROUND), c).toBeGreaterThanOrEqual(INK_CONTRAST_MIN - 0.05);
  });

  it('keeps the hue of a colour that has one', () => {
    for (const c of [...PALETTE_TEXT, ...SAMPLE]) {
      if (chroma(c) < 40 || chroma(darkInk(c)) < 40) continue;
      expect(apart(hueOf(darkInk(c)), hueOf(c)), `${c} -> ${darkInk(c)}`).toBeLessThanOrEqual(6);
    }
  });

  it('turns a dark colour light, and a light one down to the least that reads', () => {
    expect(luminance(darkInk('#2f55a6'))).toBeGreaterThan(luminance('#2f55a6'));
    expect(luminance(darkInk('#8e1f1f'))).toBeGreaterThan(luminance('#8e1f1f'));
    expect(luminance(darkInk('#bdd5e1'))).toBeLessThan(luminance('#bdd5e1'));
  });

  it('inverts lightness where that already reads', () => {
    // hsl(0, 0%, 26%) -> 74%
    const out = parseColour(darkInk('#434343'))!;
    expect(hslOf(out).l).toBeGreaterThan(0.72);
    expect(hslOf(out).l).toBeLessThan(0.77);
  });

  it('keeps alpha, and hands back what it cannot read', () => {
    expect(darkInk('rgba(0, 0, 0, 0.5)')).toBe('rgba(255, 255, 255, 0.5)');
    expect(darkInk('banana')).toBe('banana');
    expect(darkInk('var(--ink)')).toBe('var(--ink)');
  });

  it('reads against the ground it is given', () => {
    expect(contrast(darkInk('#444444', '#000000'), '#000000')).toBeGreaterThanOrEqual(INK_CONTRAST_MIN - 0.05);
  });
});

describe('darkFill, the colour of a highlight or a cell on a dark page', () => {
  it('turns pale fills dark', () => {
    for (const c of ['#fff2a8', '#ffffff', '#f1f3f9', '#ffd9a8']) expect(luminance(darkFill(c)), c).toBeLessThan(0.03);
  });

  it('is never lighter than the cap, so any text that reads on the page reads on it', () => {
    for (const c of [...PALETTE_FILLS, ...SAMPLE]) expect(luminance(darkFill(c)), c).toBeLessThanOrEqual(FILL_LUMINANCE_MAX + 0.002);
  });

  it('keeps the hue of a colour that has one', () => {
    for (const c of [...PALETTE_FILLS, ...SAMPLE]) {
      if (chroma(c) < 60 || chroma(darkFill(c)) < 25) continue;
      expect(apart(hueOf(darkFill(c)), hueOf(c)), `${c} -> ${darkFill(c)}`).toBeLessThanOrEqual(8);
    }
  });

  it('keeps a dark fill dark', () => {
    for (const c of ['#292b31', '#12142e', '#2f55a6']) expect(luminance(darkFill(c)), c).toBeLessThanOrEqual(FILL_LUMINANCE_MAX + 0.002);
  });

  it('keeps alpha, and hands back what it cannot read', () => {
    expect(darkFill('rgba(255, 255, 255, 0.4)')).toMatch(/^rgba\(\d+, \d+, \d+, 0\.4\)$/);
    expect(darkFill('nope')).toBe('nope');
  });
});

describe('text on a fill, both mapped', () => {
  it('reads at 4.5:1 for every colour the palettes put on every fill they offer', () => {
    for (const ink of PALETTE_TEXT) {
      for (const fill of PALETTE_FILLS) {
        expect(contrast(darkInk(ink), darkFill(fill)), `${ink} on ${fill}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('reads for any pair at all', () => {
    for (let i = 0; i < 1500; i++) {
      const ink = SAMPLE[i]!;
      const fill = SAMPLE[(i * 7 + 1) % SAMPLE.length]!;
      expect(contrast(darkInk(ink), darkFill(fill)), `${ink} on ${fill}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("reads the page's own light text on a mapped fill too", () => {
    for (const fill of [...PALETTE_FILLS, ...SAMPLE]) expect(contrast('#e9e9ed', darkFill(fill)), fill).toBeGreaterThanOrEqual(4.5);
  });
});
