// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  APPEARANCE_KEY,
  appearanceState,
  applyTheme,
  editorTheme,
  initAppearance,
  parseAppearance,
  readAppearance,
  resolveTheme,
  setAppearance,
  subscribeAppearance,
  writeAppearance,
  type Appearance
} from './appearance';

const memory = (initial: Record<string, string> = {}) => {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    data
  };
};

const refusing = {
  getItem: (): string | null => {
    throw new DOMException('denied', 'SecurityError');
  },
  setItem: (): void => {
    throw new DOMException('full', 'QuotaExceededError');
  }
};

describe('parseAppearance', () => {
  it('knows the three choices and calls everything else System', () => {
    expect(parseAppearance('light')).toBe('light');
    expect(parseAppearance('dark')).toBe('dark');
    expect(parseAppearance('system')).toBe('system');
    for (const bad of [null, undefined, '', 'Dark', 'sepia', 3, {}, ['dark']]) expect(parseAppearance(bad)).toBe('system');
  });
});

describe('the remembered choice', () => {
  it('is read back, and System when nothing was kept', () => {
    expect(readAppearance(memory())).toBe('system');
    expect(readAppearance(memory({ [APPEARANCE_KEY]: 'dark' }))).toBe('dark');
    expect(readAppearance(memory({ [APPEARANCE_KEY]: 'banana' }))).toBe('system');
  });

  it('is written under the key the first-paint script reads', () => {
    const s = memory();
    expect(writeAppearance('light', s)).toBe(true);
    expect(s.data.get(APPEARANCE_KEY)).toBe('light');
  });

  it('works without storage: a read says System, a write says it was not kept', () => {
    expect(readAppearance(refusing)).toBe('system');
    expect(readAppearance(null)).toBe('system');
    expect(writeAppearance('dark', refusing)).toBe(false);
    expect(writeAppearance('dark', null)).toBe(false);
  });
});

describe('resolveTheme', () => {
  it('follows the system only on System', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });
});

describe('editorTheme', () => {
  // Slides follows the page like the others; it says so on its own element
  // because its stylesheet's unmarked roles are the dark ones.
  it('gives Slides the resolved theme, so System follows the system', () => {
    expect(editorTheme('slides', resolveTheme('system', false))).toBe('light');
    expect(editorTheme('slides', resolveTheme('system', true))).toBe('dark');
    expect(editorTheme('slides', resolveTheme('dark', false))).toBe('dark');
    expect(editorTheme('slides', resolveTheme('light', true))).toBe('light');
  });

  it('leaves every other editor to the page', () => {
    for (const t of ['light', 'dark'] as const) {
      expect(editorTheme('docs', t)).toBeUndefined();
      expect(editorTheme('sheets', t)).toBeUndefined();
      expect(editorTheme(null, t)).toBeUndefined();
    }
  });
});

describe('applyTheme', () => {
  it('writes the resolved theme and the choice on the root', () => {
    const el = document.createElement('html');
    applyTheme(el, 'system', true);
    expect(el.getAttribute('data-theme')).toBe('dark');
    expect(el.getAttribute('data-appearance')).toBe('system');
    applyTheme(el, 'light', true);
    expect(el.getAttribute('data-theme')).toBe('light');
    expect(el.getAttribute('data-appearance')).toBe('light');
  });
});

// ── the store ───────────────────────────────────────────────────────────────

type MqListener = (e: { matches: boolean }) => void;
let systemDark = false;
let mqListeners: MqListener[] = [];

beforeEach(() => {
  systemDark = false;
  mqListeners = [];
  window.matchMedia = ((query: string) => ({
    media: query,
    get matches() {
      return systemDark;
    },
    addEventListener: (_: string, l: MqListener) => void mqListeners.push(l),
    removeEventListener: (_: string, l: MqListener) => void (mqListeners = mqListeners.filter((x) => x !== l)),
    addListener: () => undefined,
    removeListener: () => undefined,
    onchange: null,
    dispatchEvent: () => false
  })) as unknown as typeof window.matchMedia;
  localStorage.clear();
  document.documentElement.setAttribute('data-theme', 'light');
  document.documentElement.removeAttribute('data-appearance');
});
afterEach(() => {
  setAppearance('system');
  localStorage.clear();
});

describe('setAppearance', () => {
  it('remembers the choice, applies it at once and tells whoever is listening', () => {
    const seen = vi.fn();
    const off = subscribeAppearance(seen);
    setAppearance('dark');
    expect(localStorage.getItem(APPEARANCE_KEY)).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(document.documentElement.getAttribute('data-appearance')).toBe('dark');
    expect(appearanceState()).toEqual({ appearance: 'dark', theme: 'dark' });
    expect(seen).toHaveBeenCalledTimes(1);
    off();
    setAppearance('light');
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it('still changes the page when storage refuses', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    expect(() => setAppearance('dark')).not.toThrow();
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(appearanceState().appearance).toBe('dark');
    spy.mockRestore();
  });

  it('does not announce a choice that is already made', () => {
    setAppearance('dark');
    const seen = vi.fn();
    const off = subscribeAppearance(seen);
    setAppearance('dark');
    expect(seen).not.toHaveBeenCalled();
    off();
  });

  it('keeps the same state object until something changes, for useSyncExternalStore', () => {
    setAppearance('light');
    const a = appearanceState();
    expect(appearanceState()).toBe(a);
    setAppearance('dark');
    expect(appearanceState()).not.toBe(a);
  });
});

describe('initAppearance', () => {
  it('applies the kept choice', () => {
    localStorage.setItem(APPEARANCE_KEY, 'dark');
    const stop = initAppearance();
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    stop();
  });

  it('follows the system while the choice is System, and only then', () => {
    const stop = initAppearance();
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    systemDark = true;
    mqListeners.forEach((l) => l({ matches: true }));
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(appearanceState().theme).toBe('dark');

    setAppearance('light');
    systemDark = false;
    systemDark = true;
    mqListeners.forEach((l) => l({ matches: true }));
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    stop();
  });

  it('follows a choice made in another tab', () => {
    const stop = initAppearance();
    localStorage.setItem(APPEARANCE_KEY, 'dark');
    window.dispatchEvent(new StorageEvent('storage', { key: APPEARANCE_KEY, newValue: 'dark' }));
    expect(appearanceState().appearance).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    window.dispatchEvent(new StorageEvent('storage', { key: 'something-else', newValue: 'light' }));
    expect(appearanceState().appearance).toBe('dark');
    stop();
  });

  it('listens to nothing after it has stopped', () => {
    const stop = initAppearance();
    stop();
    expect(mqListeners).toHaveLength(0);
  });
});

// ── the first-paint script ──────────────────────────────────────────────────

/**
 * `web/public/theme-init.js` is the same decision as `resolveTheme` made before any of this file
 * has loaded, so there is no flash. It is a separate file because the policy is `script-src 'self'`
 * (an inline script would not run), and it is run here against every case the function decides.
 */
describe('theme-init.js', () => {
  const source = readFileSync(join(process.cwd(), 'web/public/theme-init.js'), 'utf8');

  const run = (stored: string | null | 'throws', dark: boolean) => {
    const root = document.documentElement;
    root.setAttribute('data-theme', 'light');
    root.removeAttribute('data-appearance');
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => {
        if (stored === 'throws') throw new DOMException('denied', 'SecurityError');
        return k === APPEARANCE_KEY ? stored : null;
      }
    });
    systemDark = dark;
    try {
      new Function(source)();
    } finally {
      vi.unstubAllGlobals();
    }
    return { theme: root.getAttribute('data-theme'), appearance: root.getAttribute('data-appearance') };
  };

  it('reads the key appearance.ts writes', () => {
    expect(source).toContain(`'${APPEARANCE_KEY}'`);
  });

  it('decides what resolveTheme decides, for every stored value and either system', () => {
    const stored: (string | null)[] = [null, 'system', 'light', 'dark', 'sepia', ''];
    for (const s of stored) {
      for (const dark of [false, true]) {
        const a: Appearance = parseAppearance(s);
        expect(run(s, dark), `${String(s)} / system dark ${dark}`).toEqual({ theme: resolveTheme(a, dark), appearance: a });
      }
    }
  });

  it('is System when storage throws', () => {
    expect(run('throws', true)).toEqual({ theme: 'dark', appearance: 'system' });
    expect(run('throws', false)).toEqual({ theme: 'light', appearance: 'system' });
  });

  it('is light when the browser cannot say what the system prefers', () => {
    const real = window.matchMedia;
    (window as unknown as { matchMedia: unknown }).matchMedia = undefined;
    try {
      expect(run(null, true)).toEqual({ theme: 'light', appearance: 'system' });
    } finally {
      window.matchMedia = real;
    }
  });

  it('is loaded, blocking, before the stylesheet by index.html', () => {
    const html = readFileSync(join(process.cwd(), 'web/index.html'), 'utf8');
    const tag = /<script src="\/theme-init\.js"><\/script>/.exec(html);
    expect(tag, 'a plain, blocking script tag').not.toBeNull();
    expect(html.indexOf(tag![0])).toBeLessThan(html.indexOf('</head>'));
    expect(html).not.toMatch(/<script(?![^>]*src=)[^>]*>/);
  });
});
