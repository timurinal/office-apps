// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { groupsFor } from '../../core/shell/registry';
import { SelectionStore } from '../editor/selection';
import { modelOf, testDeck } from '../model/testing';
import { THEMES } from '../themes';
import { designModule } from './design';
import type { SlidesContext } from './types';

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
});

function open(can = true, source: 'cloud' | 'local' = 'cloud') {
  const model = modelOf(
    testDeck([
      { id: 's1', layout: 'blank', elements: [] },
      { id: 's2', layout: 'blank', elements: [] }
    ])
  );
  const selection = new SelectionStore();
  selection.set({ slide: 's1', slides: ['s1'] });
  const focusCanvas = vi.fn();
  const ctx = {
    model,
    selection,
    source: { kind: source },
    meta: { id: 'doc1' },
    can: { edit: can },
    design: model.design(),
    slideId: 's1',
    actions: { focusCanvas },
    notify: vi.fn()
  } as unknown as SlidesContext;
  const items = (group: string) => groupsFor(designModule.ribbon, 'design', ctx).find((g) => g.id === group)!.items;
  const render = (id: string) => {
    const item = [...items('design.themes'), ...items('design.customise')].find((i) => i.id === id)!;
    act(() => root.render(item.type === 'custom' ? <>{item.render(ctx)}</> : null));
  };
  const redraw = (id: string) => {
    ctx.design = model.design();
    render(id);
  };
  return { model, selection, ctx, render, redraw, focusCanvas };
}

const click = (el: Element): void => {
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
};

describe('the Design tab', () => {
  it('has the theme gallery and the customise group, and no slide size', () => {
    const { ctx } = open();
    const groups = groupsFor(designModule.ribbon, 'design', ctx);
    expect(groups.map((g) => [g.id, g.order])).toEqual([['design.themes', 100], ['design.customise', 300]]);
    expect(groups[1]!.items.map((i) => i.id)).toEqual(['design.layout', 'design.background']);
    expect(JSON.stringify(groups.map((g) => g.items.map((i) => i.id)))).not.toMatch(/size/i);
  });
});

describe('the theme gallery', () => {
  it('shows each theme as a card with its name, and marks the one in use', () => {
    const m = open();
    const d = m.model.design();
    m.model.setDesign({ theme: { ...THEMES[1]! }, master: d.master, layouts: [...d.layouts] });
    m.redraw('design.themes');
    const tiles = [...host.querySelectorAll<HTMLButtonElement>('button.sl-theme')];
    expect(tiles.map((t) => t.getAttribute('aria-label'))).toEqual(THEMES.slice(0, 4).map((t) => `${t.name} theme`));
    expect(tiles.map((t) => t.getAttribute('aria-pressed'))).toEqual(['false', 'true', 'false', 'false']);
    // Its look is its own: ground, and one swatch per accent.
    const card = tiles[0]!.querySelector<HTMLElement>('.sl-theme-card')!;
    expect(card.style.background).not.toBe('');
    expect(card.querySelectorAll('.sl-theme-dots span')).toHaveLength(6);
    expect(card.querySelector('.sl-theme-aa')!.getAttribute('style')).toContain('font-family');
  });

  it('choosing one applies it in one step and gives the keyboard back to the slide', () => {
    const m = open();
    m.render('design.themes');
    click(host.querySelector('button[aria-label="Fern theme"]') ?? host.querySelectorAll('button.sl-theme')[3]!);
    expect(m.model.design().theme.id).toBe(THEMES[3]!.id);
    expect(m.focusCanvas).toHaveBeenCalled();
    m.model.undo();
    expect(m.model.design().theme.id).toBe('test');
    expect(m.model.canUndo()).toBe(false);
  });

  it('lists every theme under its arrow, with its fonts', () => {
    const m = open();
    m.render('design.themes');
    click(host.querySelector('button[aria-label="All themes"]')!);
    const all = [...host.querySelectorAll<HTMLButtonElement>('.sl-theme-grid button.sl-theme')];
    expect(all).toHaveLength(THEMES.length);
    expect(host.querySelector('.sl-theme-grid')!.textContent).toContain('Trebuchet MS, Inter');
    click(all[all.length - 1]!);
    expect(m.model.design().theme.id).toBe(THEMES[THEMES.length - 1]!.id);
  });

  it('is off for a reader', () => {
    const m = open(false);
    m.render('design.themes');
    expect([...host.querySelectorAll<HTMLButtonElement>('button.sl-theme')].every((b) => b.disabled)).toBe(true);
  });
});

describe('the background menu', () => {
  const menu = () => host.querySelector('[role="dialog"][aria-label="Background"]')!;
  const openMenu = (m: ReturnType<typeof open>) => {
    m.render('design.background');
    click(host.querySelector('button[data-id="design.background"]')!);
  };

  it('a solid colour from the theme goes on the chosen slide in one step', () => {
    const m = open();
    openMenu(m);
    click(menu().querySelector('button[aria-label="Accent 2"]')!);
    expect(m.model.slide('s1')!.bg).toEqual({ kind: 'solid', color: { theme: 'accent2' } });
    expect(m.model.slide('s2')!.bg).toBeUndefined();
    m.model.undo();
    expect(m.model.slide('s1')!.bg).toBeUndefined();
  });

  it('a gradient, and Apply to all slides', () => {
    const m = open();
    openMenu(m);
    click(menu().querySelector('label input[type="checkbox"]')!);
    click(menu().querySelector('button[aria-label="Dusk"]')!);
    expect(m.model.slide('s1')!.bg).toMatchObject({ kind: 'gradient' });
    expect(m.model.slide('s2')!.bg).toMatchObject({ kind: 'gradient' });
    m.model.undo();
    expect(m.model.slide('s2')!.bg).toBeUndefined();
  });

  it('Reset takes the slide\'s own away, and is off when it has none', () => {
    const m = open();
    openMenu(m);
    const reset = () => [...menu().querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === 'Reset background')!;
    expect(reset().disabled).toBe(true);
    click(menu().querySelector('button[aria-label="Accent 2"]')!);
    expect(m.model.slide('s1')!.bg).toBeDefined();
    m.render('design.background');
    click(host.querySelector('button[data-id="design.background"]')!);
    click(reset());
    expect(m.model.slide('s1')!.bg).toBeUndefined();
  });

  it('offers a picture only where there is a server to keep it', () => {
    const cloud = open();
    openMenu(cloud);
    expect(menu().textContent).toContain('Picture…');
    act(() => root.unmount());
    root = createRoot(host);
    const local = open(true, 'local');
    openMenu(local);
    expect(menu().textContent).not.toContain('Picture…');
  });

  it('is off for a reader', () => {
    const m = open(false);
    m.render('design.background');
    expect(host.querySelector<HTMLButtonElement>('button[data-id="design.background"]')!.disabled).toBe(true);
  });
});
