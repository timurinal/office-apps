// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPref } from './pref';

type Tone = 'a' | 'b' | 'c';
const parse = (raw: string | null): Tone => (raw === 'b' || raw === 'c' ? raw : 'a');
const make = () => createPref<Tone>({ key: 'test.pref', parse, serialize: (v) => v });

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('a per-reader preference', () => {
  it('starts as the parse of what was kept, and as the default when nothing was', () => {
    expect(make().get()).toBe('a');
    localStorage.setItem('test.pref', 'c');
    expect(make().get()).toBe('c');
    localStorage.setItem('test.pref', 'junk');
    expect(make().get()).toBe('a');
  });

  it('keeps a choice, announces it once, and does not announce the same one twice', () => {
    const p = make();
    const seen = vi.fn();
    const off = p.subscribe(seen);
    p.set('b');
    expect(localStorage.getItem('test.pref')).toBe('b');
    expect(p.get()).toBe('b');
    p.set('b');
    expect(seen).toHaveBeenCalledTimes(1);
    off();
    p.set('c');
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it('works when storage refuses to read, and when it refuses to write', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    const p = make();
    expect(p.get()).toBe('a');
    expect(() => p.set('b')).not.toThrow();
    expect(p.get()).toBe('b');
  });

  it('follows the same preference changed in another tab', () => {
    const p = make();
    const seen = vi.fn();
    const off = p.subscribe(seen);
    window.dispatchEvent(new StorageEvent('storage', { key: 'test.pref', newValue: 'c' }));
    expect(p.get()).toBe('c');
    expect(seen).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new StorageEvent('storage', { key: 'other', newValue: 'b' }));
    expect(p.get()).toBe('c');
    off();
    window.dispatchEvent(new StorageEvent('storage', { key: 'test.pref', newValue: 'b' }));
    expect(p.get()).toBe('c');
  });
});
