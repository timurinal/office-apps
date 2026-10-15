// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { clearCache, listKey, readCache, readList, writeCache, writeList } from './cache';

beforeEach(() => {
  clearCache();
  sessionStorage.clear();
});

describe('the list cache', () => {
  it('gives back what was written', () => {
    const page = { documents: [], nextCursor: null };
    writeList('recent', '', page);
    expect(readList('recent', '')).toEqual(page);
  });

  it('keeps a view and a kind apart', () => {
    writeCache(listKey('recent', ''), 'all');
    writeCache(listKey('recent', 'docs'), 'docs');
    writeCache(listKey('starred', ''), 'starred');
    expect(readCache(listKey('recent', ''))).toBe('all');
    expect(readCache(listKey('recent', 'docs'))).toBe('docs');
    expect(readCache(listKey('starred', ''))).toBe('starred');
  });

  it('is empty before anything is written', () => {
    expect(readList('trash', '')).toBeNull();
  });

  it('survives a reload of the tab, through sessionStorage', () => {
    writeCache('k', { n: 1 });
    // A fresh page has an empty memory and the same sessionStorage.
    const raw = sessionStorage.getItem('office.home.k');
    clearCache();
    sessionStorage.setItem('office.home.k', raw!);
    expect(readCache('k')).toEqual({ n: 1 });
  });

  it('forgets what is too old to paint', () => {
    writeCache('old', 'x', 1_000);
    expect(readCache('old', 1_000 + 9 * 60_000)).toBe('x');
    expect(readCache('old', 1_000 + 11 * 60_000)).toBeNull();
  });

  it('works when storage refuses', () => {
    const real = Object.getOwnPropertyDescriptor(window, 'sessionStorage');
    Object.defineProperty(window, 'sessionStorage', {
      get() {
        throw new Error('blocked');
      },
      configurable: true
    });
    expect(() => writeCache('k', 1)).not.toThrow();
    expect(readCache('k')).toBe(1); // memory still answers
    if (real) Object.defineProperty(window, 'sessionStorage', real);
  });

  it('ignores garbage left in storage', () => {
    sessionStorage.setItem('office.home.bad', '{not json');
    expect(readCache('bad')).toBeNull();
    sessionStorage.setItem('office.home.odd', JSON.stringify({ value: 1 }));
    expect(readCache('odd')).toBeNull();
  });
});
