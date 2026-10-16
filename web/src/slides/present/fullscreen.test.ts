import { describe, expect, it } from 'vitest';
import { windowIsFull } from './fullscreen';

const media = (matches: boolean) => (q: string) => ({ matches: matches && q === '(display-mode: fullscreen)' });

describe('whether a window is full screen', () => {
  it('is yes for a Fullscreen API element, which is what F and a click on the slide ask for', () => {
    expect(windowIsFull({ document: { fullscreenElement: {} as Element }, window: {} })).toBe(true);
  });

  it('is yes for the browser’s own full screen, which a script cannot ask for: Firefox’s fullScreen', () => {
    expect(windowIsFull({ document: { fullscreenElement: null }, window: { fullScreen: true } })).toBe(true);
  });

  it('is yes where the display mode says so, which is how a browser that has no fullScreen says F11', () => {
    expect(windowIsFull({ document: { fullscreenElement: null }, window: { matchMedia: media(true) } })).toBe(true);
  });

  it('is no for a window that is only large', () => {
    expect(windowIsFull({ document: { fullscreenElement: null }, window: { fullScreen: false, matchMedia: media(false) } })).toBe(false);
    expect(windowIsFull({ document: { fullscreenElement: null }, window: {} })).toBe(false);
  });

  it('is no, and does not throw, where asking for the display mode does', () => {
    const boom = () => {
      throw new Error('no media');
    };
    expect(windowIsFull({ document: { fullscreenElement: null }, window: { matchMedia: boom } })).toBe(false);
  });
});
