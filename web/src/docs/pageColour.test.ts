// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { PAGE_COLOUR_KEY, PAGE_COLOURS, pageColourPref, parsePageColour, resolvePageColour } from './pageColour';

afterEach(() => {
  pageColourPref.set('auto');
  localStorage.clear();
});

describe('page colour', () => {
  it('has the four choices, Auto first', () => {
    expect(PAGE_COLOURS.map((c) => c.label)).toEqual(['Auto', 'White', 'Sepia', 'Dark']);
  });

  it('is Auto for anything that is not a choice', () => {
    expect(parsePageColour('sepia')).toBe('sepia');
    for (const bad of [null, undefined, '', 'Dark', 'black', 7]) expect(parsePageColour(bad)).toBe('auto');
  });

  it('follows the theme only on Auto', () => {
    expect(resolvePageColour('auto', 'dark')).toBe('dark');
    expect(resolvePageColour('auto', 'light')).toBe('white');
    expect(resolvePageColour('white', 'dark')).toBe('white');
    expect(resolvePageColour('sepia', 'dark')).toBe('sepia');
    expect(resolvePageColour('dark', 'light')).toBe('dark');
  });

  it('is kept in this browser, under its own key, and nowhere else', () => {
    pageColourPref.set('sepia');
    expect(localStorage.getItem(PAGE_COLOUR_KEY)).toBe('sepia');
    expect(pageColourPref.get()).toBe('sepia');
  });
});
