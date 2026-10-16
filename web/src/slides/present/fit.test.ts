import { describe, expect, it } from 'vitest';
import { fitWidth } from './fit';

describe('the widest slide a window holds', () => {
  it('is the window’s width when the window is no wider than a slide', () => {
    expect(fitWidth(960, 600, 1920, 1080)).toBe(960);
  });

  it('is what the height allows when the window is wider', () => {
    expect(fitWidth(1920, 540, 1920, 1080)).toBe(960);
  });

  it('follows the deck’s own shape', () => {
    // 4:3, 1920 x 1440.
    expect(fitWidth(1600, 600, 1920, 1440)).toBe(800);
  });

  it('is nothing for a window or a slide with no size', () => {
    expect(fitWidth(0, 600, 1920, 1080)).toBe(0);
    expect(fitWidth(960, 0, 1920, 1080)).toBe(0);
    expect(fitWidth(960, 600, 1920, 0)).toBe(0);
    expect(fitWidth(Number.NaN, 600, 1920, 1080)).toBe(0);
  });
});
