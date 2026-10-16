import { describe, expect, it } from 'vitest';
import { FONTS } from '../../docs/core/fonts';
import type { ThemeJSON } from '../model/deck';
import { contrast, isHex, resolveColor, THEME_SLOTS } from './color';
import { BODY_SIZES, DEFAULT_THEME_ID, masterFor, previewOf, THEME_PREVIEWS, THEMES, themeById } from './index';

const ACCENTS = ['accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6'] as const;
const known = new Set([...FONTS.map((f) => f.name), 'Trebuchet MS']);

/** A theme this file has never heard of, as an imported deck would bring. */
const custom = (id: string, accent1: string): ThemeJSON => ({
  ...THEMES[0]!,
  id,
  name: id,
  colors: { ...THEMES[0]!.colors, accent1 }
});

describe('the themes', () => {
  it('are eight, and the first is Violet: violet, Trebuchet MS for headings and Inter for body', () => {
    expect(THEMES).toHaveLength(8);
    expect(DEFAULT_THEME_ID).toBe(THEMES[0]!.id);
    expect(THEMES[0]).toMatchObject({ id: 'violet', name: 'Violet', fonts: { major: 'Trebuchet MS', minor: 'Inter' } });
    expect(THEMES[0]!.colors.accent1).toBe('#796cbf');
    expect(THEMES[0]!.colors.lt1.toLowerCase()).toBe('#fbfaff');
  });

  it('range from light to dark, serif to sans, and one hue to none', () => {
    expect(THEMES.map((t) => t.id)).toEqual(['violet', 'midnight', 'paper', 'fern', 'harbour', 'ember', 'graphite', 'billboard']);
    expect(THEME_PREVIEWS.filter((p) => p.dark).map((p) => p.id)).toEqual(['midnight']);
    expect(themeById('paper')!.fonts.major).toBe('Georgia');
    // The monochrome one has no hue worth the name: every colour is a grey, a cool one like the brand's slate.
    const grey = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
      return Math.max(r, g, b) - Math.min(r, g, b) <= 16;
    };
    expect(Object.values(themeById('graphite')!.colors).every(grey)).toBe(true);
  });

  it('have an id and a name each, and no two alike', () => {
    expect(new Set(THEMES.map((t) => t.id)).size).toBe(THEMES.length);
    expect(new Set(THEMES.map((t) => t.name)).size).toBe(THEMES.length);
    for (const t of THEMES) {
      expect(t.id).toMatch(/^[a-z]+$/);
      expect(t.name.length).toBeGreaterThan(0);
      expect(t.name.length).toBeLessThanOrEqual(16);
    }
  });

  it('are found by id', () => {
    for (const t of THEMES) expect(themeById(t.id)).toBe(t);
    expect(themeById('nope')).toBeUndefined();
  });

  for (const theme of THEMES) {
    describe(theme.name, () => {
      it('fills every slot with a lowercase #rrggbb', () => {
        for (const slot of THEME_SLOTS) expect(theme.colors[slot], slot).toMatch(/^#[0-9a-f]{6}$/);
        if (theme.colors.folHlink !== undefined) expect(isHex(theme.colors.folHlink)).toBe(true);
        expect(Object.keys(theme.colors).filter((k) => k !== 'folHlink').sort()).toEqual([...THEME_SLOTS].sort());
      });

      it('has six accents that differ, so a chart’s series do', () => {
        expect(new Set(ACCENTS.map((a) => theme.colors[a])).size).toBe(6);
      });

      it('names fonts the app hosts or every machine has', () => {
        expect(known.has(theme.fonts.major), theme.fonts.major).toBe(true);
        expect(known.has(theme.fonts.minor), theme.fonts.minor).toBe(true);
      });

      it('reads a link on its ground', () => {
        const p = previewOf(theme);
        expect(contrast(theme.colors.hlink, p.ground)).toBeGreaterThanOrEqual(4.5);
      });

      it('is described for the gallery in resolved colours', () => {
        const p = previewOf(theme);
        expect(p).toMatchObject({ id: theme.id, name: theme.name, major: theme.fonts.major, minor: theme.fonts.minor });
        for (const c of [p.ground, p.ink, p.hero, p.heroInk, ...p.accents]) expect(c).toMatch(/^#[0-9a-f]{6}$/);
        expect(p.accents).toHaveLength(6);
        expect(contrast(p.ink, p.ground)).toBeGreaterThanOrEqual(7);
        expect(contrast(p.heroInk, p.hero)).toBeGreaterThanOrEqual(4.5);
        expect(THEME_PREVIEWS.find((x) => x.id === theme.id)).toEqual(p);
      });
    });
  }
});

/** What a master's text sits on, resolved. */
const groundOf = (theme: ThemeJSON, master: ReturnType<typeof masterFor>): string => {
  expect(master.bg?.kind).toBe('solid');
  return master.bg?.kind === 'solid' ? resolveColor(master.bg.color, theme) : '#ffffff';
};

describe('masterFor', () => {
  for (const theme of [...THEMES, custom('plain', '#796cbf'), custom('yellow', '#ffe14d')]) {
    describe(theme.name, () => {
      const master = masterFor(theme);
      const ground = groundOf(theme, master);
      const on = (color: Parameters<typeof resolveColor>[0] | undefined) => contrast(resolveColor(color ?? '#000000', theme), ground);

      it('draws on a solid ground, and decorates nothing', () => {
        expect(ground).toMatch(/^#[0-9a-f]{6}$/);
        expect(master.elements).toEqual([]);
      });

      it('sets a title in the heading font, 3 to 1 against the ground at the least', () => {
        const { title } = master.styles;
        expect(title.fontFamily).toBe(theme.fonts.major);
        expect(title.fontSize).toBeGreaterThanOrEqual(36);
        expect(title.fontSize).toBeLessThanOrEqual(60);
        expect(title.bullet).toEqual({ kind: 'none' });
        expect(on(title.color)).toBeGreaterThanOrEqual(3);
      });

      it('sets body at five levels, each smaller than the last, in the body font, 4.5 to 1', () => {
        const { body } = master.styles;
        expect(body).toHaveLength(5);
        expect(body.map((s) => s.fontSize)).toEqual([...BODY_SIZES]);
        for (let i = 1; i < body.length; i++) expect(body[i]!.fontSize!).toBeLessThan(body[i - 1]!.fontSize!);
        body.forEach((s, level) => {
          expect(s.fontFamily, `level ${level}`).toBe(theme.fonts.minor);
          expect(on(s.color), `level ${level} text`).toBeGreaterThanOrEqual(4.5);
        });
      });

      it('gives each body level a bullet that shows, and steps it in', () => {
        const { body } = master.styles;
        body.forEach((s, level) => {
          expect(s.bullet?.kind, `level ${level}`).toBe('char');
          if (s.bullet?.kind === 'char') {
            expect(s.bullet.char.length).toBeGreaterThan(0);
            expect(on(s.bullet.color), `level ${level} bullet`).toBeGreaterThanOrEqual(3);
          }
          // The text sits to the right of its bullet.
          expect(s.indent!).toBeGreaterThan(s.bulletIndent!);
          if (level > 0) {
            expect(s.bulletIndent!).toBeGreaterThan(body[level - 1]!.bulletIndent!);
            expect(s.indent!).toBeGreaterThan(body[level - 1]!.indent!);
          }
        });
        expect(body[0]!.bulletIndent).toBe(0);
      });

      it('sets everything else in the body font at 4.5 to 1, with no bullet', () => {
        const { other } = master.styles;
        expect(other.fontFamily).toBe(theme.fonts.minor);
        expect(other.bullet).toEqual({ kind: 'none' });
        expect(on(other.color)).toBeGreaterThanOrEqual(4.5);
      });

      it('is the same twice', () => {
        expect(JSON.stringify(masterFor(theme))).toBe(JSON.stringify(master));
      });
    });
  }

  it('draws a dark theme on its dark and a light one on its light, in the other for ink', () => {
    const dark = masterFor(themeById('midnight')!);
    expect(dark.bg).toEqual({ kind: 'solid', color: { theme: 'dk1' } });
    expect(dark.styles.title.color).toEqual({ theme: 'lt1' });
    const light = masterFor(themeById('violet')!);
    expect(light.bg).toEqual({ kind: 'solid', color: { theme: 'lt1' } });
    expect(light.styles.title.color).toEqual({ theme: 'dk1' });
  });

  it('writes colours as theme slots, so another theme’s colours reach it', () => {
    const json = JSON.stringify(masterFor(themeById('violet')!));
    expect(json).not.toMatch(/#[0-9a-f]{6}/);
  });
});
