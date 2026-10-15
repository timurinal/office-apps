import { describe, expect, it } from 'vitest';
import { OFFICE_THEME, resolveColor, themeSlots, tinted } from './colors';

const near = (a: string, b: string, tol = 2) => {
  const x = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const y = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  return x.every((v, i) => Math.abs(v - y[i]!) <= tol);
};

describe('a colour as a workbook states it', () => {
  it('reads an RGB value, with or without its alpha', () => {
    expect(resolveColor({ argb: 'FF00FF00' }, OFFICE_THEME)).toBe('#00ff00');
    expect(resolveColor({ argb: '80112233' }, OFFICE_THEME)).toBe('#112233');
    expect(resolveColor({ argb: 'ABCDEF' }, OFFICE_THEME)).toBe('#abcdef');
  });

  it('numbers a theme lt1, dk1, lt2, dk2, then the accents', () => {
    expect(resolveColor({ theme: 0 }, OFFICE_THEME)).toBe('#ffffff');
    expect(resolveColor({ theme: 1 }, OFFICE_THEME)).toBe('#000000');
    expect(resolveColor({ theme: 4 }, OFFICE_THEME)).toBe('#4472c4');
    const custom = themeSlots({ accent1: '18A303', dk1: '111111' });
    expect(resolveColor({ theme: 4 }, custom)).toBe('#18a303');
    expect(resolveColor({ theme: 1 }, custom)).toBe('#111111');
    // A slot the theme leaves out is Office's.
    expect(resolveColor({ theme: 5 }, custom)).toBe('#ed7d31');
  });

  it('lightens and darkens a theme colour the way the Excel palette shows it', () => {
    // "Blue, Accent 1, Lighter 40%" and "Darker 25%".
    expect(near(resolveColor({ theme: 4, tint: 0.3999755851924192 }, OFFICE_THEME)!, '#8faadc')).toBe(true);
    expect(near(resolveColor({ theme: 4, tint: -0.249977111117893 }, OFFICE_THEME)!, '#2f5597')).toBe(true);
    expect(tinted('FFFFFF', -0.5)).toBe('#808080');
    expect(tinted('000000', 0.5)).toBe('#808080');
  });

  it('reads the indexed palette and leaves "automatic" to the reader', () => {
    expect(resolveColor({ indexed: 2 }, OFFICE_THEME)).toBe('#ff0000');
    expect(resolveColor({ indexed: 64 }, OFFICE_THEME)).toBeNull();
    expect(resolveColor({ auto: true }, OFFICE_THEME)).toBeNull();
    expect(resolveColor(undefined, OFFICE_THEME)).toBeNull();
    expect(resolveColor({ argb: 'not a colour' }, OFFICE_THEME)).toBeNull();
  });
});
