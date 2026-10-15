// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { searchCommands } from '../../core/shell/registry';
import type { MenuEntry } from '../../core/shell/types';
import { matches } from '../../sheets/keys';
import { SelectionStore } from '../editor/selection';
import type { ElementJSON } from '../model/deck';
import { box, modelOf, testDeck } from '../model/testing';
import { ARRANGE_ROWS, arrangeModule } from './arrange';
import type { SlidesContext } from './types';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const el = (id: string, x: number, y: number, w = 100, h = 100): ElementJSON => ({ ...box(x, y, w, h), id }) as ElementJSON;

function setup(elements: ElementJSON[], chosen: string[], over: { edit?: boolean; focus?: 'canvas' | 'rail' } = {}) {
  const model = modelOf(testDeck([{ id: 's', layout: 'blank', elements }]));
  const selection = new SelectionStore();
  selection.set({ slide: 's', slides: ['s'], els: chosen, focus: over.focus ?? 'canvas' });
  const actions = { focusCanvas: vi.fn(), focusRail: vi.fn() };
  const ctx = {
    model,
    selection,
    slideId: 's',
    can: { edit: over.edit ?? true },
    select: { elements: (ids: string[]) => selection.set({ els: ids, editing: null, focus: 'canvas' }) },
    actions
  } as unknown as SlidesContext;
  return { model, selection, ctx, actions };
}

const menu = arrangeModule.ribbon[0]!.items[0]!;
const entries = (): MenuEntry<SlidesContext>[] => {
  if (menu.type !== 'menu') throw new Error('a menu');
  return menu.entries;
};
const entry = (label: string): MenuEntry<SlidesContext> => entries().find((e) => e.label === label)!;
const off = (c: SlidesContext, label: string): boolean => entry(label).disabled?.(c) ?? false;

describe('the Arrange menu', () => {
  it('is in a group of its own on Home, with every row in order and a rule between sections', () => {
    expect(arrangeModule.ribbon[0]).toMatchObject({ id: 'home.arrange', tab: 'home', order: 520 });
    expect(entries().map((e) => e.label)).toEqual([
      'Bring to front',
      'Bring forward',
      'Send backward',
      'Send to back',
      'Group',
      'Ungroup',
      'Align left',
      'Align centre',
      'Align right',
      'Align top',
      'Align middle',
      'Align bottom',
      'Distribute horizontally',
      'Distribute vertically',
      'Rotate right 90°',
      'Rotate left 90°',
      'Flip horizontal',
      'Flip vertical'
    ]);
    expect(entries().filter((e) => e.separated).map((e) => e.label)).toEqual(['Group', 'Align left', 'Distribute horizontally', 'Rotate right 90°']);
    expect(entry('Group').shortcut).toMatch(/G$/);
  });

  it('is off with nothing chosen, and for a reader', () => {
    const none = setup([el('a', 0, 0), el('b', 0, 0)], []);
    for (const e of entries()) expect(e.disabled?.(none.ctx), e.label).toBe(true);
    const reader = setup([el('a', 0, 0), el('b', 0, 0)], ['a', 'b'], { edit: false });
    for (const e of entries()) expect(e.disabled?.(reader.ctx), e.label).toBe(true);
    if (menu.type === 'menu') expect(menu.disabled?.(reader.ctx)).toBe(true);
  });

  it('is on for one object where it means something, off where it needs more', () => {
    const t = setup([el('a', 0, 0), el('b', 300, 0), el('c', 600, 0)], ['b']);
    expect(off(t.ctx, 'Bring to front')).toBe(false);
    expect(off(t.ctx, 'Align left')).toBe(false);
    expect(off(t.ctx, 'Rotate right 90°')).toBe(false);
    expect(off(t.ctx, 'Group')).toBe(true);
    expect(off(t.ctx, 'Ungroup')).toBe(true);
    expect(off(t.ctx, 'Distribute horizontally')).toBe(true);
  });

  it('turns Bring to front off for what is already in front, and Group and Distribute on for three', () => {
    const t = setup([el('a', 0, 0), el('b', 300, 0), el('c', 600, 0)], ['c']);
    expect(off(t.ctx, 'Bring to front')).toBe(true);
    expect(off(t.ctx, 'Send to back')).toBe(false);
    t.selection.set({ els: ['a', 'b', 'c'] });
    expect(off(t.ctx, 'Group')).toBe(false);
    expect(off(t.ctx, 'Distribute vertically')).toBe(false);
    expect(off(t.ctx, 'Ungroup')).toBe(true);
  });

  it('runs a row on what is chosen and gives the keyboard back to the slide', () => {
    const t = setup([el('a', 0, 0), el('b', 300, 0)], ['a']);
    entry('Bring to front').run(t.ctx);
    expect(t.model.slide('s')!.elements.map((e) => e.id)).toEqual(['b', 'a']);
    expect(t.actions.focusCanvas).toHaveBeenCalled();
    // From the slide list, it goes back there.
    const rail = setup([el('a', 0, 0), el('b', 300, 0)], ['a'], { focus: 'rail' });
    entry('Align left').run(rail.ctx);
    expect(rail.actions.focusRail).toHaveBeenCalled();
  });
});

describe('the command box', () => {
  it('has each row under Format, for someone who can edit', () => {
    const t = setup([el('a', 0, 0)], ['a']);
    const found = searchCommands(arrangeModule.commands, 'align', t.ctx, 20).map((c) => c.title);
    expect(found).toEqual(expect.arrayContaining(['Align left', 'Align centre', 'Align right', 'Align top', 'Align middle', 'Align bottom']));
    expect(arrangeModule.commands.every((c) => c.section === 'Format')).toBe(true);
    expect(arrangeModule.commands).toHaveLength(ARRANGE_ROWS.length);
    const reader = setup([el('a', 0, 0)], ['a'], { edit: false });
    expect(searchCommands(arrangeModule.commands, '', reader.ctx, 50)).toEqual([]);
  });

  it('runs a command', () => {
    const t = setup([el('a', 0, 0), el('b', 300, 0)], ['b']);
    arrangeModule.commands.find((c) => c.id === 'arrange.back')!.run(t.ctx);
    expect(t.model.slide('s')!.elements.map((e) => e.id)).toEqual(['b', 'a']);
  });
});

describe('the keys', () => {
  const key = (keys: string) => arrangeModule.keys!.find((k) => k.keys === keys)!;
  const press = (init: Partial<KeyboardEventInit> & { key: string }) => new KeyboardEvent('keydown', init);

  it('are the ones PowerPoint has', () => {
    expect(arrangeModule.keys!.map((k) => k.keys).sort()).toEqual(['Mod+G', 'Mod+Shift+G', 'Mod+[', 'Mod+]', 'Mod+Shift+{', 'Mod+Shift+}'].sort());
    expect(matches('Mod+G', press({ key: 'g', ctrlKey: true }))).toBe(true);
    expect(matches('Mod+Shift+G', press({ key: 'G', ctrlKey: true, shiftKey: true }))).toBe(true);
    expect(matches('Mod+]', press({ key: ']', ctrlKey: true }))).toBe(true);
    expect(matches('Mod+[', press({ key: '[', metaKey: true }))).toBe(true);
    // With Shift a keyboard with brackets on those keys sends the braces.
    expect(matches('Mod+Shift+}', press({ key: '}', ctrlKey: true, shiftKey: true }))).toBe(true);
    expect(matches('Mod+Shift+{', press({ key: '{', ctrlKey: true, shiftKey: true }))).toBe(true);
    expect(matches('Mod+]', press({ key: '}', ctrlKey: true, shiftKey: true }))).toBe(false);
  });

  it('do something only when the slide has the keyboard and there is something to do', () => {
    const t = setup([el('a', 0, 0), el('b', 300, 0)], ['a', 'b']);
    expect(key('Mod+G').when!(t.ctx)).toBe(true);
    t.selection.set({ focus: 'rail' });
    expect(key('Mod+G').when!(t.ctx)).toBe(false);
    t.selection.set({ focus: 'canvas', els: ['a'] });
    expect(key('Mod+G').when!(t.ctx)).toBe(false);
    expect(key('Mod+Shift+G').when!(t.ctx)).toBe(false);
    expect(key('Mod+]').when!(t.ctx)).toBe(true);
    const reader = setup([el('a', 0, 0), el('b', 300, 0)], ['a', 'b'], { edit: false });
    for (const k of arrangeModule.keys!) expect(k.when!(reader.ctx), k.keys).toBe(false);
  });

  it('group, and ungroup, each as one undo entry', () => {
    const t = setup([el('a', 0, 0), el('b', 300, 0)], ['a', 'b']);
    key('Mod+G').run(t.ctx);
    const g = t.model.slide('s')!.elements[0]!;
    expect(g.type).toBe('group');
    expect(t.selection.get().els).toEqual([g.id]);
    expect(key('Mod+Shift+G').when!(t.ctx)).toBe(true);
    key('Mod+Shift+G').run(t.ctx);
    expect(t.model.slide('s')!.elements.map((e) => e.id)).toEqual(['a', 'b']);
    t.model.undo();
    expect(t.model.slide('s')!.elements[0]!.type).toBe('group');
    t.model.undo();
    expect(t.model.slide('s')!.elements.map((e) => e.id)).toEqual(['a', 'b']);
  });

  it('send backward and bring forward move one place', () => {
    const t = setup([el('a', 0, 0), el('b', 300, 0), el('c', 600, 0)], ['c']);
    key('Mod+[').run(t.ctx);
    expect(t.model.slide('s')!.elements.map((e) => e.id)).toEqual(['a', 'c', 'b']);
    key('Mod+]').run(t.ctx);
    expect(t.model.slide('s')!.elements.map((e) => e.id)).toEqual(['a', 'b', 'c']);
    key('Mod+Shift+{').run(t.ctx);
    expect(t.model.slide('s')!.elements.map((e) => e.id)).toEqual(['c', 'a', 'b']);
    key('Mod+Shift+}').run(t.ctx);
    expect(t.model.slide('s')!.elements.map((e) => e.id)).toEqual(['a', 'b', 'c']);
  });
});
