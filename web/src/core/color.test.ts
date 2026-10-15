import { describe, expect, it } from 'vitest';
import { colorFor, contrast, hashString, initialsOf, PRESENCE_COLORS } from './color';

describe('colorFor', () => {
  it('gives the same colour for the same id, always', () => {
    expect(colorFor('u_office_a')).toBe(colorFor('u_office_a'));
    expect(hashString('u_office_a')).toBe(hashString('u_office_a'));
  });

  it('only ever answers a palette colour, in the six-digit form the caret accepts', () => {
    for (let i = 0; i < 500; i++) {
      const c = colorFor(`user-${i}`);
      expect(PRESENCE_COLORS).toContain(c);
      expect(c).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('spreads people across the palette instead of piling onto a few colours', () => {
    const counts = new Map<string, number>();
    for (let i = 0; i < 1000; i++) {
      const c = colorFor(`usr_${i.toString(36)}`);
      counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    expect(counts.size).toBe(PRESENCE_COLORS.length);
    // 1000 over 10 is 100 each. Nothing should be starved or hog the rest.
    for (const n of counts.values()) {
      expect(n).toBeGreaterThan(50);
      expect(n).toBeLessThan(160);
    }
  });

  it('tells ids that differ in one character apart', () => {
    const colours = new Set(['a', 'b', 'c', 'd', 'e', 'f'].map((s) => colorFor(`u_${s}`)));
    expect(colours.size).toBeGreaterThan(2);
  });
});

describe('the palette', () => {
  it('has no duplicate colour', () => {
    expect(new Set(PRESENCE_COLORS).size).toBe(PRESENCE_COLORS.length);
  });

  it('carries white label text at 4.5:1 or better', () => {
    for (const c of PRESENCE_COLORS) expect(contrast(c, '#ffffff')).toBeGreaterThanOrEqual(4.5);
  });

  it('measures contrast the way WCAG does', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrast('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
  });
});

describe('initialsOf', () => {
  it('uses the first and last word', () => {
    expect(initialsOf('Ada Rowe')).toBe('AR');
    expect(initialsOf('Ada Maria Rowe')).toBe('AR');
  });
  it('falls back sensibly', () => {
    expect(initialsOf('ada')).toBe('A');
    expect(initialsOf('   ')).toBe('?');
    expect(initialsOf('')).toBe('?');
  });
});
