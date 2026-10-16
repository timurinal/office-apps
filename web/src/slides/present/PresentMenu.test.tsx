// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SlidesContext } from '../modules/types';
import { clearLaunch, peekLaunch } from './launch';
import { PresentMenu } from './PresentMenu';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  clearLaunch();
  vi.restoreAllMocks();
});

const ctxOf = (slideIndex = 3) => ({ present: vi.fn(), slideIndex, notify: vi.fn(), model: { order: () => ['a', 'b', 'c', 'd', 'e'] } }) as unknown as SlidesContext & { present: ReturnType<typeof vi.fn> };
const click = (el: Element | null | undefined) => act(() => void el!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
const byLabel = (l: string) => host.querySelector(`[aria-label="${l}"]`) as HTMLButtonElement | null;
const item = (label: string) => [...document.body.querySelectorAll('[role="menuitem"]')].find((n) => n.textContent?.includes(label));

describe('the header’s Present button', () => {
  it('starts the show from the current slide', () => {
    const ctx = ctxOf(3);
    act(() => root.render(<PresentMenu ctx={ctx} />));
    click([...host.querySelectorAll('button')].find((b) => b.textContent === 'Present'));
    expect(ctx.present).toHaveBeenCalledWith(3);
  });

  it('starts at the first slide when none is chosen', () => {
    const ctx = ctxOf(-1);
    act(() => root.render(<PresentMenu ctx={ctx} />));
    click([...host.querySelectorAll('button')].find((b) => b.textContent === 'Present'));
    expect(ctx.present).toHaveBeenCalledWith(0);
  });

  it('has a chevron that opens the other ways, with the keys that do them', () => {
    const ctx = ctxOf(3);
    act(() => root.render(<PresentMenu ctx={ctx} />));
    expect(item('From beginning')).toBeUndefined();
    click(byLabel('Ways to present'));
    expect(byLabel('Ways to present')!.getAttribute('aria-expanded')).toBe('true');
    expect(item('From beginning')!.textContent).toContain('F5');
    expect(item('From current slide')!.textContent).toContain('Shift+F5');
    expect(item('Presenter view')).toBeDefined();
  });

  it('From beginning and From current slide start there', () => {
    const ctx = ctxOf(3);
    act(() => root.render(<PresentMenu ctx={ctx} />));
    click(byLabel('Ways to present'));
    click(item('From beginning'));
    expect(ctx.present).toHaveBeenLastCalledWith(0);
    click(byLabel('Ways to present'));
    click(item('From current slide'));
    expect(ctx.present).toHaveBeenLastCalledWith(3);
  });

  it('Presenter view opens the audience’s window and starts the show as a presenter’s', () => {
    const ctx = ctxOf(2);
    const win = {} as Window;
    const open = vi.spyOn(window, 'open').mockReturnValue(win);
    act(() => root.render(<PresentMenu ctx={ctx} />));
    click(byLabel('Ways to present'));
    click(item('Presenter view'));
    expect(open).toHaveBeenCalledTimes(1);
    expect(ctx.present).toHaveBeenCalledWith(2);
    expect(peekLaunch()).toMatchObject({ mode: 'presenter', audience: win });
  });

  it('is off while there is nothing to show', () => {
    act(() => root.render(<PresentMenu ctx={ctxOf()} disabled />));
    for (const b of host.querySelectorAll('button')) expect(b.disabled).toBe(true);
    act(() => root.render(<PresentMenu ctx={null} />));
    for (const b of host.querySelectorAll('button')) expect(b.disabled).toBe(true);
  });
});
