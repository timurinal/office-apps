import { describe, expect, it } from 'vitest';
import { resolveColor as modelResolve } from '../model/color';
import type { Color, ThemeJSON } from '../model/deck';
import { alphaOf, blend, contrast, isHex, luminance, resolveColor, withLum } from './color';
import { THEMES } from './themes';

const theme: ThemeJSON = {
  id: 't',
  name: 'T',
  colors: {
    dk1: '#000000', lt1: '#ffffff', dk2: '#222222', lt2: '#eeeeee',
    accent1: '#ff0000', accent2: '#00ff00', accent3: '#0000ff', accent4: '#ffff00', accent5: '#ff00ff', accent6: '#00ffff',
    hlink: '#0000ee'
  },
  fonts: { major: 'Inter', minor: 'Inter' }
};

describe('contrast', () => {
  it('is 21 for black on white and 1 for a colour on itself, whichever way round', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrast('#ffffff', '#000000')).toBeCloseTo(21, 5);
    expect(contrast('#796cbf', '#796cbf')).toBe(1);
  });

  it('matches values worked out by hand', () => {
    // WCAG's own example: #767676 on white is 4.54 to 1, the grey just over AA.
    expect(contrast('#767676', '#ffffff')).toBeCloseTo(4.54, 2);
    expect(luminance('#ffffff')).toBeCloseTo(1, 6);
    expect(luminance('#000000')).toBe(0);
  });
});

describe('resolveColor', () => {
  it('passes a hex through and looks a slot up in the theme', () => {
    expect(resolveColor('#123456', theme)).toBe('#123456');
    expect(resolveColor({ theme: 'accent2' }, theme)).toBe('#00ff00');
    expect(resolveColor({ theme: 'dk2' }, theme)).toBe('#222222');
  });

  it('mixes toward white for a positive lum and toward black for a negative one, in sRGB', () => {
    expect(resolveColor({ theme: 'dk1', lum: 0.5 }, theme)).toBe('#808080');
    expect(resolveColor({ theme: 'lt1', lum: -0.5 }, theme)).toBe('#808080');
    expect(resolveColor({ theme: 'accent1', lum: 1 }, theme)).toBe('#ffffff');
    expect(resolveColor({ theme: 'accent1', lum: -1 }, theme)).toBe('#000000');
    expect(withLum('#ff0000', 0.4)).toBe('#ff6666');
  });

  it('darkens a colour without changing what it is', () => {
    const darker = withLum('#796cbf', -0.1);
    expect(isHex(darker)).toBe(true);
    expect(luminance(darker)).toBeLessThan(luminance('#796cbf'));
    expect(withLum('#796cbf', 0)).toBe('#796cbf');
  });

  it('agrees with the model’s own resolver, which is what the editor draws, for every kind of colour', () => {
    const samples: Color[] = [
      '#796cbf',
      { theme: 'accent1' },
      { theme: 'accent1', lum: -0.03 },
      { theme: 'accent1', lum: 0.4 },
      { theme: 'dk2', lum: -1 },
      { theme: 'lt2', lum: 1 },
      { theme: 'hlink', lum: 0.15 }
    ];
    for (const c of samples) expect(resolveColor(c, theme), JSON.stringify(c)).toBe(modelResolve(c, theme));
    // And for the real themes, whose colours the editor draws.
    for (const t of THEMES) {
      for (const c of samples) if (typeof c !== 'string') expect(resolveColor(c, t)).toBe(modelResolve(c, t));
    }
  });

  it('reads alpha, and blends over a ground', () => {
    expect(alphaOf('#ffffff')).toBe(1);
    expect(alphaOf({ theme: 'dk1', alpha: 0.25 })).toBe(0.25);
    expect(blend('#000000', 0.5, '#ffffff')).toBe('#808080');
    expect(blend('#123456', 1, '#ffffff')).toBe('#123456');
  });
});
