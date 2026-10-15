// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { groupsFor, searchCommands, visibleTabs } from '../../core/shell/registry';
import { clearLaunch, peekLaunch } from '../present/launch';
import { collect, problems } from './collect';
import { coreModule } from './core';
import { SLIDES_MODULES } from './index';
import { slideshowModule } from './slideshow';
import { SLIDES_TABS, type SlidesCan, type SlidesContext } from './types';

afterEach(() => {
  clearLaunch();
  vi.restoreAllMocks();
});

const ctx = (can: Partial<SlidesCan> = {}, slideId: string | null = 's1') =>
  ({
    source: { kind: 'cloud' },
    slideId,
    slideIndex: slideId ? 1 : -1,
    present: vi.fn(),
    notify: vi.fn(),
    model: { order: () => ['s0', 's1', 's2'], canUndo: () => false, canRedo: () => false },
    selection: { get: () => ({ slides: slideId ? [slideId] : [] }) },
    text: { available: () => false },
    design: { layouts: [] },
    notes: { shown: true, setShown: () => undefined },
    views: [{ id: 'normal', label: 'Normal' }],
    view: 'normal',
    zoom: 100,
    fit: true,
    can: { edit: true, share: true, history: true, copy: true, trash: true, star: true, rename: true, create: true, download: true, present: true, ...can }
  }) as unknown as SlidesContext;

const both = collect([coreModule, slideshowModule]);

describe('the slide show module', () => {
  it('is listed with the others, and clashes with none', () => {
    expect(SLIDES_MODULES).toContain(slideshowModule);
    expect(problems(SLIDES_MODULES)).toEqual([]);
  });

  it('provides the presenter, which is what makes Present exist', () => {
    expect(collect([coreModule]).presenter).toBeNull();
    expect(both.presenter).toBe(slideshowModule.presenter);
    expect(both.presenter).not.toBeNull();
  });

  it('puts Presenter view on the Slide show tab between Start and Set up', () => {
    const groups = groupsFor(both.ribbon, 'slideshow', ctx());
    expect(groups.map((g) => g.id)).toEqual(['slideshow.start', 'slideshow.presenter', 'slideshow.setup']);
    expect(groups.flatMap((g) => g.items.map((i) => i.id))).toEqual(['slideshow.from-start', 'slideshow.from-current', 'slideshow.presenter-view', 'slideshow.hide']);
  });

  it('has the four buttons the brief names, by their labels', () => {
    const labels = groupsFor(both.ribbon, 'slideshow', ctx()).flatMap((g) => g.items.map((i) => (i.type === 'separator' || i.type === 'custom' ? '' : i.label)));
    expect(labels).toEqual(['From beginning', 'From current slide', 'Presenter view', 'Hide slide']);
  });

  it('is not on the tab where nothing can present', () => {
    const items = groupsFor(both.ribbon, 'slideshow', ctx({ present: false })).flatMap((g) => g.items.map((i) => i.id));
    expect(items).not.toContain('slideshow.presenter-view');
    expect(items).toContain('slideshow.hide');
    expect(visibleTabs(SLIDES_TABS, both.ribbon, ctx({ present: false })).map((t) => t.id)).toContain('slideshow');
  });

  it('can be run by a reader: presenting changes nothing', () => {
    const reader = ctx({ edit: false, share: false, trash: false, copy: false });
    const item = groupsFor(both.ribbon, 'slideshow', reader)
      .flatMap((g) => g.items)
      .find((i) => i.id === 'slideshow.presenter-view');
    expect(item).toBeDefined();
    expect(item?.type === 'button' && item.disabled?.(reader)).toBe(false);
  });

  it('is off with no slide to start from', () => {
    const none = ctx({}, null);
    const item = groupsFor(both.ribbon, 'slideshow', none)
      .flatMap((g) => g.items)
      .find((i) => i.id === 'slideshow.presenter-view');
    expect(item?.type === 'button' && item.disabled?.(none)).toBe(true);
  });

  it('starts the show in the presenter’s view from the button, at the current slide', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue({} as Window);
    const c = ctx();
    const item = groupsFor(both.ribbon, 'slideshow', c)
      .flatMap((g) => g.items)
      .find((i) => i.id === 'slideshow.presenter-view');
    if (item?.type !== 'button') throw new Error('not a button');
    item.run(c);
    expect(open).toHaveBeenCalledTimes(1);
    expect(c.present).toHaveBeenCalledWith(1);
    expect(peekLaunch().mode).toBe('presenter');
  });

  it('is in the command box for anyone who can present', () => {
    const titles = (c: SlidesContext) => searchCommands(both.commands, 'presenter', c, 20).map((t) => t.title);
    expect(titles(ctx())).toContain('Slide show in presenter view');
    expect(titles(ctx({ present: false }))).not.toContain('Slide show in presenter view');
    expect(titles(ctx({}, null))).not.toContain('Slide show in presenter view');
  });

  it('is found by what a person would type for it', () => {
    for (const q of ['notes', 'speaker', 'audience']) {
      expect(searchCommands(both.commands, q, ctx(), 20).map((c) => c.title), q).toContain('Slide show in presenter view');
    }
  });

  it('adds no key of its own: F5 and Shift+F5 are core’s, and the show takes the rest while it runs', () => {
    expect(slideshowModule.keys ?? []).toEqual([]);
    expect(collect([coreModule]).keys.map((k) => k.keys)).toEqual(expect.arrayContaining(['F5', 'Shift+F5']));
  });
});
