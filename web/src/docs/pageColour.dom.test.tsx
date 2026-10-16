// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { groupsFor } from '../core/shell/registry';
import { setAppearance } from '../core/appearance';
import { collect } from './modules/collect';
import { DOCS_MODULES } from './modules';
import { PageColourSwitch } from './modules/appearance';
import type { DocsContext } from './modules/types';
import { Page } from './PageEditor';
import { pageColourPref } from './pageColour';
import type { MenuItem } from '../core/shell/types';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.body.appendChild(document.createElement('div'));
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  pageColourPref.set('auto');
  setAppearance('system');
  localStorage.clear();
});

const page = () => host.querySelector<HTMLElement>('article.oa-paper')!;

describe('the page', () => {
  it('is white on Auto in the light theme and dark on Auto in the dark one', () => {
    setAppearance('light');
    act(() => root.render(<Page>x</Page>));
    expect(page().getAttribute('data-page')).toBe('white');
    act(() => setAppearance('dark'));
    expect(page().getAttribute('data-page')).toBe('dark');
  });

  it('takes the reader’s choice over the theme, and follows it as it changes', () => {
    setAppearance('dark');
    act(() => root.render(<Page>x</Page>));
    act(() => pageColourPref.set('white'));
    expect(page().getAttribute('data-page')).toBe('white');
    act(() => pageColourPref.set('sepia'));
    expect(page().getAttribute('data-page')).toBe('sepia');
    setAppearance('light');
    act(() => pageColourPref.set('dark'));
    expect(page().getAttribute('data-page')).toBe('dark');
  });
});

describe('the footer switch', () => {
  it('is four dots, the chosen one pressed', () => {
    act(() => root.render(<PageColourSwitch />));
    const dots = [...host.querySelectorAll<HTMLButtonElement>('button')];
    expect(dots.map((b) => b.getAttribute('aria-label'))).toEqual(['Page colour: Auto', 'Page colour: White', 'Page colour: Sepia', 'Page colour: Dark']);
    expect(dots.map((b) => b.getAttribute('aria-pressed'))).toEqual(['true', 'false', 'false', 'false']);
  });

  it('chooses a page colour', () => {
    act(() => root.render(<PageColourSwitch />));
    act(() => host.querySelector<HTMLButtonElement>('button[aria-label="Page colour: Sepia"]')!.click());
    expect(pageColourPref.get()).toBe('sepia');
    expect(host.querySelector('button[aria-label="Page colour: Sepia"]')!.getAttribute('aria-pressed')).toBe('true');
  });

  it('is on the footer, to the right of the layout switch and before the zoom', () => {
    const items = collect(DOCS_MODULES).statusItems.filter((i) => i.side === 'right');
    const order = items.map((i) => [i.id, i.order] as const).sort((a, b) => a[1] - b[1]);
    const ids = order.map(([id]) => id);
    expect(ids.indexOf('layout.views')).toBeLessThan(ids.indexOf('appearance.page-colour'));
  });
});

describe('the View tab', () => {
  const ctx = { editor: null, source: { kind: 'cloud' }, can: { edit: true } } as unknown as DocsContext;
  const view = () => groupsFor(collect(DOCS_MODULES).ribbon, 'view', ctx);

  it('has Page colour and Theme', () => {
    const ids = view().map((g) => g.id);
    expect(ids).toEqual(expect.arrayContaining(['view.page-colour', 'view.appearance']));
    const colour = view().find((g) => g.id === 'view.page-colour')!.items[0] as MenuItem<DocsContext>;
    expect(colour.entries.map((e) => e.label)).toEqual(['Auto', 'White', 'Sepia', 'Dark']);
  });

  it('ticks the page colour that is chosen and chooses another', () => {
    const colour = () => view().find((g) => g.id === 'view.page-colour')!.items[0] as MenuItem<DocsContext>;
    expect(colour().entries.filter((e) => e.active?.(ctx)).map((e) => e.label)).toEqual(['Auto']);
    colour().entries[3]!.run(ctx);
    expect(pageColourPref.get()).toBe('dark');
    expect(colour().entries.filter((e) => e.active?.(ctx)).map((e) => e.label)).toEqual(['Dark']);
  });
});
