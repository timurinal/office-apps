// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * App mounts the toast host above every page, so a toast is drawn outside the editor's own
 * AppKindProvider. It must still wear the editor's theme and colour: in Slides that is the page's
 * theme, named on the toast, because Slides' unmarked roles are the dark ones. Home sets neither.
 */

let path = '/slides/s1';
vi.mock('./router', async (actual) => ({
  ...(await actual<typeof import('./router')>()),
  useRouter: () => ({ navigate: vi.fn(), path, query: new URLSearchParams() })
}));
vi.mock('./state', () => ({
  AppProvider: ({ children }: { children: React.ReactNode }) => children,
  useApp: () => ({ status: 'ready', refresh: vi.fn() })
}));
vi.mock('./pages/Editor', async () => {
  const { useNotify } = await import('./core/ui');
  return {
    Editor: function Shout() {
      const notify = useNotify();
      return <button onClick={() => notify({ text: 'Adding a picture.' })}>go</button>;
    }
  };
});
vi.mock('./pages/Home', async () => {
  const { useNotify } = await import('./core/ui');
  return {
    Home: function Shout() {
      const notify = useNotify();
      return <button onClick={() => notify({ text: 'Moved to trash.' })}>go</button>;
    }
  };
});

const { App } = await import('./App');
const { setAppearance } = await import('./core/appearance');

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.body.appendChild(document.createElement('div'));
  root = createRoot(host);
  setAppearance('system');
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  localStorage.clear();
});

function toastOn(at: string): Element | null {
  path = at;
  act(() => root.render(<App />));
  act(() => host.querySelector('button')!.click());
  return document.body.querySelector('.oa-toast');
}

it('a toast raised in Slides names the light theme and its colour under System, on a light page', () => {
  expect(document.documentElement.dataset.theme ?? 'light').toBe('light');
  const toast = toastOn('/slides/s1');
  expect(toast?.getAttribute('data-theme')).toBe('light');
  expect(toast?.getAttribute('data-app')).toBe('slides');
});

it('a toast raised in Sheets takes the page’s theme and the Sheets colour', () => {
  const toast = toastOn('/sheets/s1');
  expect(toast?.hasAttribute('data-theme')).toBe(false);
  expect(toast?.getAttribute('data-app')).toBe('sheets');
});

it('a toast on Home says nothing of an app', () => {
  const toast = toastOn('/');
  expect(toast?.hasAttribute('data-theme')).toBe(false);
  expect(toast?.hasAttribute('data-app')).toBe(false);
});
