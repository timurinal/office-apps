import { describe, expect, it, vi } from 'vitest';
import { groupsFor, searchCommands, visibleTabs } from '../../core/shell/registry';
import { SelectionStore } from '../editor/selection';
import type { ElementJSON } from '../model/deck';
import { SHAPE_KINDS } from '../render/geometry';
import { box, modelOf, testDeck, txt } from '../model/testing';
import { collect, problems } from './collect';
import { coreModule } from './core';
import { designModule } from './design';
import { formatModule, FORMAT_PANE } from './format';
import { SLIDES_MODULES } from './index';
import { insertModule } from './insert';
import { SHAPE_NAMES } from './insert/ShapeGallery';
import { SLIDES_TABS, type SlidesContext } from './types';

const modules = [coreModule, insertModule, designModule, formatModule];
const all = collect(modules);

/** What the registry's predicates read, over a real model and selection. */
function ctx(over: { edit?: boolean; source?: 'cloud' | 'local'; elements?: ElementJSON[]; chosen?: string[]; open?: boolean } = {}): SlidesContext & { toggled: ReturnType<typeof vi.fn> } {
  const model = modelOf(testDeck([{ id: 's1', layout: 'blank', elements: over.elements ?? [] }]));
  const selection = new SelectionStore();
  selection.set({ slide: 's1', slides: ['s1'], els: over.chosen ?? [] });
  const toggled = vi.fn();
  return {
    model,
    selection,
    selected: selection.get(),
    source: { kind: over.source ?? 'cloud' },
    slideId: 's1',
    slideIndex: 0,
    design: model.design(),
    text: { available: () => true },
    panes: { isOpen: () => over.open ?? false, toggle: toggled, open: vi.fn(), close: vi.fn() },
    can: { edit: over.edit ?? true, download: true, create: true, present: false, share: true, history: true, copy: true, trash: true, star: true, rename: true },
    toggled
  } as unknown as SlidesContext & { toggled: ReturnType<typeof vi.fn> };
}

const ids = (c: SlidesContext, tab: string): string[] => groupsFor(all.ribbon, tab, c).flatMap((g) => g.items.map((i) => i.id));

describe('the Insert, Design and Format modules', () => {
  it('share no id with each other or the core', () => {
    expect(problems(modules)).toEqual([]);
  });

  it('keep to the slots types.ts reserves for them', () => {
    const slots = (tab: string) => Object.fromEntries(collect([insertModule, designModule, formatModule]).ribbon.filter((g) => g.tab === tab).map((g) => [g.id, g.order]));
    expect(slots('insert')).toEqual({ 'insert.tables': 200, 'insert.images': 300, 'insert.illustrations': 400 });
    expect(slots('design')).toEqual({ 'design.themes': 100, 'design.customise': 300 });
    expect(slots('home')).toEqual({ 'home.drawing': 500, 'home.format': 550 });
  });

  it('draw the Design tab, which core leaves empty', () => {
    expect(visibleTabs(SLIDES_TABS, collect([coreModule]).ribbon, ctx()).map((t) => t.id)).not.toContain('design');
    expect(visibleTabs(SLIDES_TABS, all.ribbon, ctx()).map((t) => t.id)).toContain('design');
  });
});

describe('the command box', () => {
  it('lists nothing twice: no title of these modules is another module\'s, in its section', () => {
    const mine = collect([insertModule, designModule, formatModule]).commands;
    const others = [...collect(SLIDES_MODULES.filter((m) => !['insert', 'design', 'format'].includes(m.id))).commands];
    for (const c of mine) expect(others.filter((o) => o.title === c.title && o.section === c.section).map((o) => o.id), c.title).toEqual([]);
    expect(new Set(mine.map((c) => `${c.section}|${c.title}`)).size).toBe(mine.length);
  });
});

describe('Insert', () => {
  it('has Table, Picture, Shapes, Line, Arrow and Chart, with core\'s New slide and Text box between them', () => {
    const c = ctx();
    expect(ids(c, 'insert')).toEqual(['insert.new-slide', 'insert.table', 'insert.picture', 'insert.shapes', 'insert.line', 'insert.arrow', 'insert.chart', 'insert.text-box']);
  });

  it('has the table\'s rows, columns, merge and split only while a table is the only thing chosen', () => {
    const table: ElementJSON = { type: 'table', id: 't', x: 0, y: 0, w: 100, h: 50, cols: [100], rows: [{ h: 50, cells: [{ text: txt('a') }] }] };
    expect(ids(ctx({ elements: [table], chosen: [] }), 'insert')).not.toContain('insert.table-rows');
    expect(ids(ctx({ elements: [table, { ...box(0, 0), id: 'b' }], chosen: ['t', 'b'] }), 'insert')).not.toContain('insert.table-rows');
    const items = ids(ctx({ elements: [table], chosen: ['t'] }), 'insert');
    expect(items).toEqual(expect.arrayContaining(['insert.table-rows', 'insert.table-merge', 'insert.table-split']));
  });

  it('hides Picture where there is no server to keep it', () => {
    expect(ids(ctx({ source: 'local' }), 'insert')).not.toContain('insert.picture');
  });

  it('turns every control off for a reader, and for a deck with no slide', () => {
    const reader = ctx({ edit: false });
    const group = groupsFor(all.ribbon, 'insert', reader).find((g) => g.id === 'insert.illustrations')!;
    const chart = group.items.find((i) => i.id === 'insert.chart')!;
    expect(chart.type === 'menu' && chart.disabled?.(reader)).toBe(true);
    const picture = groupsFor(all.ribbon, 'insert', reader).find((g) => g.id === 'insert.images')!.items[0]!;
    expect(picture.type === 'button' && picture.disabled?.(reader)).toBe(true);
    const none = { ...ctx(), slideId: null } as unknown as ReturnType<typeof ctx>;
    expect(chart.type === 'menu' && chart.disabled?.(none)).toBe(true);
  });

  it('can make each of them from the command box, with no pointer', () => {
    const c = ctx();
    const titles = searchCommands(all.commands, '', c, 300).map((x) => x.title);
    for (const kind of SHAPE_KINDS) expect(titles).toContain(`Shape: ${SHAPE_NAMES[kind]}`);
    for (const t of ['Line', 'Arrow', 'Table', 'Picture', 'Chart: Column', 'Chart: Bar', 'Chart: Line', 'Chart: Pie', 'Chart: Scatter']) expect(titles, t).toContain(t);
    const reader = ctx({ edit: false });
    expect(searchCommands(all.commands, 'shape', reader, 50).map((x) => x.title).filter((t) => t.startsWith('Shape:'))).toEqual([]);
  });

  it('runs a command as one step', () => {
    const c = ctx();
    const cmd = all.commands.find((x) => x.id === 'insert.shape.ellipse')!;
    cmd.run(c);
    expect(c.model.slide('s1')!.elements).toMatchObject([{ type: 'shape', shape: 'ellipse' }]);
    c.model.undo();
    expect(c.model.slide('s1')!.elements).toHaveLength(0);
  });

  it('puts the cell editor under the drawing tool', () => {
    expect(insertModule.canvas!.map((l) => l.id)).toEqual(['insert.table', 'insert.draw']);
  });
});

describe('Format', () => {
  it('has a button on Home, after the drawing tools, that shows whether the pane is open', () => {
    const c = ctx({ open: true });
    const group = groupsFor(all.ribbon, 'home', c).find((g) => g.id === 'home.format')!;
    const button = group.items[0]!;
    expect(button.type === 'button' && button.active?.(c)).toBe(true);
    expect(button.type === 'button' && button.active?.(ctx({ open: false }))).toBe(false);
    if (button.type === 'button') button.run(c);
    expect(c.toggled).toHaveBeenCalledWith(FORMAT_PANE);
  });

  it('is the right edge\'s pane, 272 wide, titled as the board has it', () => {
    expect(formatModule.panes).toMatchObject([{ id: 'format', side: 'right', title: 'Format shape', width: 272 }]);
  });

  it('is not offered to a reader', () => {
    const reader = ctx({ edit: false });
    expect(ids(reader, 'home')).not.toContain('home.format-pane');
    expect(formatModule.panes![0]!.visible!(reader)).toBe(false);
    expect(searchCommands(all.commands, 'format shape', reader, 20).map((x) => x.title)).not.toContain('Format shape');
    expect(searchCommands(all.commands, 'format shape', ctx(), 20).map((x) => x.title)).toContain('Format shape');
  });

  it('has a menu on the canvas', () => {
    expect(formatModule.canvas!.map((l) => l.id)).toEqual(['format.context']);
  });
});

describe('Design', () => {
  it('has a command for each theme, off for the one in use, and one to reset the background', () => {
    const c = ctx();
    const themes = all.commands.filter((x) => x.id.startsWith('design.theme.'));
    expect(themes).toHaveLength(8);
    expect(themes.find((x) => x.id === 'design.theme.midnight')!.disabled?.(c)).toBe(false);
    themes.find((x) => x.id === 'design.theme.midnight')!.run(c);
    expect(c.model.design().theme.id).toBe('midnight');
    expect(themes.find((x) => x.id === 'design.theme.midnight')!.disabled?.({ ...c, design: c.model.design() } as SlidesContext)).toBe(true);
    expect(all.commands.some((x) => x.id === 'design.background-reset')).toBe(true);
  });
});
