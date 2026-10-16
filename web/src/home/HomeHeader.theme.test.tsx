// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Appearance } from '../core/appearance';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../state', () => ({ useApp: () => ({ me: null }), useBranding: () => null }));
vi.mock('../router', () => ({ Link: ({ children }: { children: React.ReactNode }) => <a href="/">{children}</a>, useRouter: () => ({ navigate: vi.fn(), path: '/', query: new URLSearchParams() }) }));
vi.mock('../core/palette/CommandSearch', () => ({ CommandSearch: () => null }));

const { HomeHeader, HOME_COMMANDS } = await import('./HomeHeader');

let host: HTMLDivElement;
let root: Root;
const setAppearance = vi.fn<(a: Appearance) => void>();

beforeEach(() => {
  setAppearance.mockReset();
  host = document.body.appendChild(document.createElement('div'));
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const ctx = (appearance: Appearance) => ({ create: vi.fn(), pickFile: vi.fn(), layout: 'grid' as const, setLayout: vi.fn(), appearance, setAppearance });

const openView = () => {
  const view = [...host.querySelectorAll<HTMLButtonElement>('.oa-home-menu')].find((b) => b.textContent === 'View')!;
  act(() => view.click());
  return [...document.body.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
};

describe("Home's View menu", () => {
  it('offers the layout and, below a rule, System, Light and Dark', () => {
    act(() => root.render(<HomeHeader ctx={ctx('system')} />));
    expect(openView().map((i) => i.textContent)).toEqual(['Grid', 'List', 'System theme', 'Light theme', 'Dark theme']);
  });

  it('ticks the choice that is made', () => {
    act(() => root.render(<HomeHeader ctx={ctx('dark')} />));
    const items = openView();
    const ticked = items.filter((i) => i.querySelector('svg')).map((i) => i.textContent);
    expect(ticked).toEqual(['Grid', 'Dark theme']);
  });

  it('chooses one', () => {
    act(() => root.render(<HomeHeader ctx={ctx('system')} />));
    const items = openView();
    act(() => items.find((i) => i.textContent === 'Light theme')!.click());
    expect(setAppearance).toHaveBeenCalledWith('light');
  });
});

describe("Home's search box", () => {
  it('runs the three theme commands', () => {
    const c = ctx('system');
    for (const [id, a] of [['view.theme-system', 'system'], ['view.theme-light', 'light'], ['view.theme-dark', 'dark']] as const) {
      HOME_COMMANDS.find((x) => x.id === id)!.run(c);
      expect(setAppearance).toHaveBeenLastCalledWith(a);
    }
    expect(HOME_COMMANDS.filter((x) => x.id.startsWith('view.theme')).every((x) => x.section === 'View')).toBe(true);
  });
});
