// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { groupsFor, searchCommands, visibleTabs } from '../../core/shell/registry';
import { collect, problems } from './collect';
import { coreModule } from './core';
import { findModule } from './find';
import { guidesModule } from './guides';
import { guidesOn, setGuides } from './guidesState';
import { SLIDES_MODULES } from './index';
import { sorterModule } from './sorter';
import { SLIDES_TABS, type SlidesCan, type SlidesContext } from './types';
import { viewModule } from './view';
import { arrangeModule } from './arrange';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ctx = (over: Partial<SlidesCan> = {}): SlidesContext =>
  ({
    source: { kind: 'cloud' },
    slideId: 's1',
    slideIndex: 0,
    zoom: 100,
    fit: true,
    view: 'normal',
    views: [{ id: 'normal', label: 'Normal' }, { id: 'sorter', label: 'Slide sorter' }],
    design: { layouts: [{ id: 'title' }, { id: 'titleContent' }, { id: 'blank' }] },
    notes: { shown: true, setShown: () => undefined },
    selection: { get: () => ({ slide: 's1', slides: ['s1'], els: [], editing: null, focus: 'canvas' }) },
    model: { canUndo: () => true, canRedo: () => true, order: () => ['s1'], element: () => null },
    text: { available: () => true },
    can: { edit: true, share: true, history: true, copy: true, trash: true, star: true, rename: true, create: true, download: true, present: false, ...over }
  }) as unknown as SlidesContext;

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
  setGuides(true);
});

/** Core and these five: the others' predicates read parts of the context this test does not build. */
const MINE = [coreModule, arrangeModule, guidesModule, sorterModule, findModule, viewModule];

describe('the modules together', () => {
  it('are listed, and share no id with core or each other', () => {
    expect(SLIDES_MODULES.map((m) => m.id)).toEqual(expect.arrayContaining(['core', 'arrange', 'guides', 'sorter', 'find', 'view']));
    expect(problems(SLIDES_MODULES)).toEqual([]);
    expect(problems(MINE)).toEqual([]);
  });

  it('put every group on a tab that exists, in the slots types.ts names', () => {
    const mine = collect([arrangeModule, guidesModule, sorterModule, findModule, viewModule]);
    const tabs = new Set(SLIDES_TABS.map((t) => t.id));
    for (const g of mine.ribbon) expect(tabs.has(g.tab), g.id).toBe(true);
    const slot = (id: string) => mine.ribbon.find((g) => g.id === id)!;
    // Home: after the drawing group (500), before Editing's find (600) which is this module's own.
    expect([slot('home.arrange').tab, slot('home.arrange').order]).toEqual(['home', 520]);
    expect([slot('home.find').tab, slot('home.find').order]).toEqual(['home', 600]);
    // View: between Show (200) and Zoom (300).
    expect([slot('view.guides').tab, slot('view.guides').order]).toEqual(['view', 250]);
  });

  it('adds the slide sorter as a view after Normal, with its command', () => {
    const all = collect(MINE);
    expect(all.views.map((v) => [v.id, v.label])).toContainEqual(['sorter', 'Slide sorter']);
    expect(all.views.find((v) => v.id === 'sorter')!.order).toBeGreaterThan(0);
    const run: string[] = [];
    const c = ctx();
    c.setView = (id) => void run.push(id);
    searchCommands(all.commands, 'sorter', c, 5)[0]!.run(c);
    expect(run).toEqual(['sorter']);
  });

  it('gives the View tab the guides switch beside core’s Views, Show and Zoom', () => {
    const all = collect(MINE);
    expect(groupsFor(all.ribbon, 'view', ctx()).map((g) => g.id)).toEqual(['view.views', 'view.show', 'view.guides', 'view.zoom']);
    expect(visibleTabs(SLIDES_TABS, all.ribbon, ctx()).map((t) => t.id)).toContain('view');
  });

  it('gives the Home tab Arrange and Find, and a reader keeps them off', () => {
    const all = collect(MINE);
    const ids = groupsFor(all.ribbon, 'home', ctx()).map((g) => g.id);
    expect(ids).toEqual(expect.arrayContaining(['home.arrange', 'home.find']));
    const titles = searchCommands(all.commands, '', ctx({ edit: false }), 400).map((c) => c.title);
    for (const t of ['Bring to front', 'Group', 'Align left', 'Distribute horizontally', 'Rotate right 90°', 'Find and replace']) expect(titles, t).not.toContain(t);
    // A reader may still look for something, and see the slides in the sorter.
    expect(titles).toEqual(expect.arrayContaining(['Find', 'Slide sorter view', 'Show or hide smart guides']));
  });
});

describe('the smart guides switch', () => {
  it('shows whether guides are on, and follows the store, not the page', () => {
    const item = viewModule.ribbon[0]!.items[0]!;
    if (item.type !== 'custom') throw new Error('a custom item');
    act(() => root.render(<>{item.render(ctx())}</>));
    const button = () => host.querySelector<HTMLButtonElement>('[data-id="view.guides"]')!;
    expect(button().getAttribute('aria-pressed')).toBe('true');
    expect(button().textContent).toBe('Smart guides');
    act(() => button().click());
    expect(guidesOn()).toBe(false);
    expect(button().getAttribute('aria-pressed')).toBe('false');
    // Turned back on from somewhere else (the command box): the button follows.
    act(() => guidesModule.commands[0]!.run(ctx()));
    expect(button().getAttribute('aria-pressed')).toBe('true');
  });
});
