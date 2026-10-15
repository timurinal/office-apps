import { afterEach, describe, expect, it, vi } from 'vitest';
import { groupsFor, searchCommands, visibleTabs } from '../../core/shell/registry';
import type { MenuEntry, RibbonItem } from '../../core/shell/types';
import { SelectionStore } from '../editor/selection';
import type { Transition } from '../model/deck';
import { modelOf, testDeck } from '../model/testing';
import { previewRequests } from '../present/previewBus';
import { collect, problems } from './collect';
import { coreModule } from './core';
import { SLIDES_MODULES } from './index';
import { transitionsModule } from './transitions';
import { SLIDES_TABS, type SlidesCan, type SlidesContext } from './types';

afterEach(() => vi.restoreAllMocks());

function ctxOf(o: { can?: Partial<SlidesCan>; transitions?: Record<string, Transition> } = {}) {
  const model = modelOf(
    testDeck(['s1', 's2', 's3'].map((id) => ({ id, layout: 'blank', elements: [], ...(o.transitions?.[id] ? { transition: o.transitions[id] } : {}) })))
  );
  const selection = new SelectionStore();
  selection.set({ slide: 's1', slides: ['s1'] });
  const ctx = {
    model,
    selection,
    slideId: 's1',
    slideIndex: 0,
    source: { kind: 'cloud' },
    design: model.design(),
    can: { edit: true, share: true, history: true, copy: true, trash: true, star: true, rename: true, create: true, download: true, present: true, ...o.can }
  } as unknown as SlidesContext;
  return { ctx, model, selection };
}

const all = collect([coreModule, transitionsModule]);
const tab = (c: SlidesContext) => groupsFor(all.ribbon, 'transitions', c);
const item = (c: SlidesContext, id: string): RibbonItem<SlidesContext> => tab(c).flatMap((g) => g.items).find((i) => i.id === id)!;
const slideTransition = (m: ReturnType<typeof ctxOf>['model'], id: string) => m.slide(id)?.transition;

describe('the Transitions module', () => {
  it('is listed with the others, and clashes with none', () => {
    expect(SLIDES_MODULES).toContain(transitionsModule);
    expect(problems(SLIDES_MODULES)).toEqual([]);
  });

  it('makes the Transitions tab appear, with Preview, Transition and Timing in the slots types.ts names', () => {
    const { ctx } = ctxOf();
    expect(visibleTabs(SLIDES_TABS, all.ribbon, ctx).map((t) => t.id)).toContain('transitions');
    expect(visibleTabs(SLIDES_TABS, collect([coreModule]).ribbon, ctx).map((t) => t.id)).not.toContain('transitions');
    expect(tab(ctx).map((g) => [g.id, g.order])).toEqual([
      ['transitions.preview', 100],
      ['transitions.transition', 200],
      ['transitions.timing', 300]
    ]);
  });

  it('has the gallery, the effect options, the duration and apply to all', () => {
    const { ctx } = ctxOf();
    expect(tab(ctx).flatMap((g) => g.items.map((i) => i.id))).toEqual([
      'transitions.preview-button',
      'transitions.gallery',
      'transitions.options',
      'transitions.duration',
      'transitions.apply-all'
    ]);
  });

  it('draws the preview on the canvas, as a layer', () => {
    expect(transitionsModule.canvas?.map((l) => l.id)).toEqual(['transition-preview']);
  });
});

describe('Preview', () => {
  it('is off while the slide has no transition and on when it has one', () => {
    const none = ctxOf();
    const preview = item(none.ctx, 'transitions.preview-button');
    expect(preview.type === 'button' && preview.disabled?.(none.ctx)).toBe(true);
    const some = ctxOf({ transitions: { s1: { kind: 'fade' } } });
    const p2 = item(some.ctx, 'transitions.preview-button');
    expect(p2.type === 'button' && p2.disabled?.(some.ctx)).toBe(false);
  });

  it('asks the canvas to play it', () => {
    const { ctx } = ctxOf({ transitions: { s1: { kind: 'zoom' } } });
    const before = previewRequests();
    const preview = item(ctx, 'transitions.preview-button');
    if (preview.type !== 'button') throw new Error('not a button');
    preview.run(ctx);
    expect(previewRequests()).toBe(before + 1);
  });

  it('can be used by a reader: it changes nothing', () => {
    const { ctx } = ctxOf({ can: { edit: false }, transitions: { s1: { kind: 'fade' } } });
    const preview = item(ctx, 'transitions.preview-button');
    expect(preview.type === 'button' && preview.disabled?.(ctx)).toBe(false);
  });
});

describe('Effect options', () => {
  const entries = (c: SlidesContext): MenuEntry<SlidesContext>[] => {
    const it = item(c, 'transitions.options');
    if (it.type !== 'menu') throw new Error('not a menu');
    return it.entries;
  };

  it('has the four sides', () => {
    expect(entries(ctxOf().ctx).map((e) => e.label)).toEqual(['From left', 'From right', 'From top', 'From bottom']);
  });

  it('is off unless the transition has a side: push and wipe', () => {
    const off = (t?: Transition) => {
      const { ctx } = ctxOf({ transitions: t ? { s1: t } : {} });
      const it = item(ctx, 'transitions.options');
      return it.type === 'menu' && it.disabled?.(ctx);
    };
    expect(off()).toBe(true);
    expect(off({ kind: 'fade' })).toBe(true);
    expect(off({ kind: 'zoom' })).toBe(true);
    expect(off({ kind: 'push' })).toBe(false);
    expect(off({ kind: 'wipe' })).toBe(false);
  });

  it('marks the side in use, from right when the deck says nothing, and changes it', () => {
    const { ctx, model } = ctxOf({ transitions: { s1: { kind: 'push' } } });
    const e = entries(ctx);
    expect(e.find((x) => x.active?.(ctx))!.label).toBe('From right');
    e.find((x) => x.label === 'From top')!.run(ctx);
    expect(slideTransition(model, 's1')).toEqual({ kind: 'push', from: 'top' });
    expect(entries(ctx).find((x) => x.active?.(ctx))!.label).toBe('From top');
  });

  it('is off for a reader', () => {
    const { ctx } = ctxOf({ can: { edit: false }, transitions: { s1: { kind: 'push' } } });
    const it = item(ctx, 'transitions.options');
    expect(it.type === 'menu' && it.disabled?.(ctx)).toBe(true);
  });
});

describe('Timing', () => {
  it('Apply to all slides puts the transition on every slide, as one step', () => {
    const { ctx, model } = ctxOf({ transitions: { s1: { kind: 'wipe', duration: 900, from: 'top' } } });
    const apply = item(ctx, 'transitions.apply-all');
    if (apply.type !== 'button') throw new Error('not a button');
    expect(apply.label).toBe('Apply to all slides');
    apply.run(ctx);
    for (const id of ['s1', 's2', 's3']) expect(slideTransition(model, id), id).toEqual({ kind: 'wipe', duration: 900, from: 'top' });
    model.undo();
    expect(slideTransition(model, 's2')).toBeUndefined();
  });

  it('Apply to all slides is off for a reader', () => {
    const { ctx } = ctxOf({ can: { edit: false } });
    const apply = item(ctx, 'transitions.apply-all');
    expect(apply.type === 'button' && apply.disabled?.(ctx)).toBe(true);
  });
});

describe('the command box', () => {
  it('has a command for each kind, apply to all and preview', () => {
    const { ctx } = ctxOf();
    const titles = searchCommands(all.commands, 'transition', ctx, 20).map((c) => c.title);
    expect(titles).toEqual(
      expect.arrayContaining(['Transition: None', 'Transition: Fade', 'Transition: Push', 'Transition: Wipe', 'Transition: Zoom', 'Apply transition to all slides', 'Preview transition'])
    );
  });

  it('sets the kind and plays it', () => {
    const { ctx, model } = ctxOf();
    const before = previewRequests();
    all.commands.find((c) => c.id === 'transition.wipe')!.run(ctx);
    expect(slideTransition(model, 's1')).toEqual({ kind: 'wipe' });
    expect(previewRequests()).toBe(before + 1);
    // None is a cut: nothing to play.
    all.commands.find((c) => c.id === 'transition.none')!.run(ctx);
    expect(slideTransition(model, 's1')).toBeUndefined();
    expect(previewRequests()).toBe(before + 1);
  });

  it('keeps a reader from every command that changes the deck, and leaves the preview', () => {
    const { ctx } = ctxOf({ can: { edit: false } });
    const titles = searchCommands(all.commands, '', ctx, 200).map((c) => c.title);
    for (const t of ['Transition: Fade', 'Transition: None', 'Apply transition to all slides']) expect(titles, t).not.toContain(t);
    expect(titles).toContain('Preview transition');
  });
});
