// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { groupsFor, itemStates, searchCommands } from '../../core/shell/registry';
import type { RibbonItem } from '../../core/shell/types';
import { closeTool, openNow } from '../panes/tools';
import { closeFind, findNow } from '../panes/findStore';
import { collect, problems } from './collect';
import { dataModule } from './data';
import { findModule } from './find';
import { formatModule } from './format';
import { formulasModule } from './formulas';
import { SHEETS_MODULES } from './index';
import { keyFor } from '../keys';
import { rect, setup, table } from './testkit';
import type { SheetsContext } from './types';

const all = collect(SHEETS_MODULES);

/** What the page would hand the ribbon, built over a real workbook. */
async function page(rows: string[][] = [['Name', 'Qty'], ['Rent', '950'], ['Food', '400']]) {
  const t = await setup(table(...rows));
  const ctx = {
    ...t.ctx,
    can: { edit: true, share: true, history: true, copy: true, trash: true, star: true, rename: true, create: true, download: true },
    source: { kind: 'cloud' },
    meta: {},
    model: t.model,
    session: t.session,
    actions: { focusGrid: () => undefined, focusPalette: () => undefined },
    panes: { isOpen: () => false, open: (id: string) => opened.push(id), close: () => undefined, toggle: () => undefined },
    zoom: 100,
    view: { gridlines: true }
  } as unknown as SheetsContext;
  const opened: string[] = [];
  return { t, ctx, opened };
}

const state = (ctx: SheetsContext, tab: string, id: string) => {
  const items = groupsFor(all.ribbon, tab, ctx).flatMap((g) => g.items);
  return itemStates(items, ctx).get(id);
};

afterEach(() => {
  closeTool();
  closeFind();
});

describe('where the tools sit', () => {
  it('share no id with each other or with core and charts', () => {
    expect(problems(SHEETS_MODULES)).toEqual([]);
  });

  it('keeps the slots the other modules were told about, and fills the ones that were left', () => {
    const slots = (tab: string) => Object.fromEntries(collect([formatModule, dataModule, formulasModule, findModule]).ribbon.filter((g) => g.tab === tab).map((g) => [g.id, g.order]));
    expect(slots('home')).toEqual({ 'home.font': 200, 'home.alignment': 300, 'home.number': 400, 'home.styles': 500, 'home.sort-filter': 750, 'home.find': 800 });
    expect(slots('data')).toEqual({ 'data.sort': 100, 'data.tools': 200 });
    expect(slots('formulas')).toEqual({ 'formulas.library': 100, 'formulas.names': 200, 'formulas.calc': 300 });
    expect(slots('view')).toEqual({ 'view.formulas': 160 });
  });

  it('lays the Home tab out in the board’s order', async () => {
    const { ctx } = await page();
    expect(groupsFor(all.ribbon, 'home', ctx).map((g) => g.id)).toEqual(
      expect.arrayContaining(['home.history', 'home.clipboard', 'home.font', 'home.alignment', 'home.number', 'home.styles', 'home.cells', 'home.editing', 'home.sort-filter', 'home.find'])
    );
    const order = groupsFor(all.ribbon, 'home', ctx).map((g) => g.id);
    const at = (id: string) => order.indexOf(id);
    expect(at('home.clipboard')).toBeLessThan(at('home.font'));
    expect(at('home.font')).toBeLessThan(at('home.alignment'));
    expect(at('home.number')).toBeLessThan(at('home.styles'));
    expect(at('home.styles')).toBeLessThan(at('home.cells'));
    expect(at('home.editing')).toBeLessThan(at('home.sort-filter'));
    expect(at('home.sort-filter')).toBeLessThan(at('home.find'));
  });

  it('has every control the brief names', async () => {
    const { ctx } = await page();
    const ids = (tab: string) => groupsFor(all.ribbon, tab, ctx).flatMap((g) => g.items.map((i) => i.id));
    expect(ids('home')).toEqual(
      expect.arrayContaining([
        'home.painter', 'home.font-family', 'home.size', 'home.bold', 'home.italic', 'home.underline', 'home.strike', 'home.borders', 'home.fill', 'home.text-color',
        'home.align', 'home.wrap', 'home.merge',
        'home.number-format', 'home.currency', 'home.percent', 'home.thousands', 'home.more-decimals', 'home.fewer-decimals',
        'home.conditional', 'home.cell-styles', 'home.sort-filter', 'home.find'
      ])
    );
    expect(ids('data')).toEqual(expect.arrayContaining(['data.sort-az', 'data.sort-za', 'data.sort', 'data.filter', 'data.clear-filter', 'data.validation', 'data.duplicates', 'data.split']));
    expect(ids('formulas')).toEqual(expect.arrayContaining(['formulas.insert', 'formulas.name-manager', 'formulas.define-name', 'formulas.show']));
  });
});

describe('what the buttons show', () => {
  it('presses Bold, Italic, Underline and Strikethrough by the active cell, and a cell that is bold because its column is shows it', async () => {
    const { t, ctx } = await page();
    t.select(rect(1, 0));
    expect(state(ctx, 'home', 'home.bold')?.active).toBe(false);
    for (const key of ['bold', 'italic', 'underline', 'strike'] as const) {
      const id = `home.${key}`;
      const button = groupsFor(all.ribbon, 'home', ctx).flatMap((g) => g.items).find((i) => i.id === id) as Extract<RibbonItem<SheetsContext>, { type: 'button' }>;
      button.run(ctx);
      expect(state(ctx, 'home', id)?.active, id).toBe(true);
    }
    t.select(rect(0, 1, 999, 1));
    const bold = groupsFor(all.ribbon, 'home', ctx).flatMap((g) => g.items).find((i) => i.id === 'home.bold') as Extract<RibbonItem<SheetsContext>, { type: 'button' }>;
    bold.run(ctx);
    t.select(rect(40, 1));
    expect(state(ctx, 'home', 'home.bold')?.active).toBe(true);
  });

  it('shows the font, the colours and the number format of the active cell', async () => {
    const { t, ctx } = await page();
    t.select(rect(1, 1));
    expect(state(ctx, 'home', 'home.font-family')?.value).toBe('Inter');
    expect(state(ctx, 'home', 'home.number-format')?.value).toBe('general');
    t.model.setStyle(t.ctx.sheetId, rect(1, 1), { font: 'Georgia', color: '#c0392b', fill: '#ffeb9c', numFmt: '"£"#,##0.00', wrap: true, h: 'center' });
    expect(state(ctx, 'home', 'home.font-family')?.value).toBe('Georgia');
    expect(state(ctx, 'home', 'home.text-color')?.value).toBe('#c0392b');
    expect(state(ctx, 'home', 'home.fill')?.value).toBe('#ffeb9c');
    expect(state(ctx, 'home', 'home.number-format')?.value).toBe('currency');
    expect(state(ctx, 'home', 'home.wrap')?.active).toBe(true);
    t.model.setStyle(t.ctx.sheetId, rect(1, 1), { numFmt: '0%' });
    expect(state(ctx, 'home', 'home.percent')?.active).toBe(true);
    t.model.setStyle(t.ctx.sheetId, rect(1, 1), { numFmt: '#,##0.00' });
    expect(state(ctx, 'home', 'home.thousands')?.active).toBe(true);
    expect(state(ctx, 'home', 'home.percent')?.active).toBe(false);
  });

  it('ticks the alignment and the merge', async () => {
    const { t, ctx } = await page();
    const align = groupsFor(all.ribbon, 'home', ctx).flatMap((g) => g.items).find((i) => i.id === 'home.align');
    const ticked = () => (align?.type === 'menu' ? align.entries.filter((e) => e.active?.(ctx)).map((e) => e.label) : []);
    t.select(rect(1, 0));
    expect(ticked()).toEqual(['Align middle']);
    t.model.setStyle(t.ctx.sheetId, rect(1, 0), { h: 'right', v: 'top' });
    expect(ticked()).toEqual(['Align right', 'Align top']);
  });

  it('turns Show formulas on and off, and ticks Filter by whether there is one', async () => {
    const { t, ctx } = await page();
    expect(state(ctx, 'formulas', 'formulas.show')?.active).toBe(false);
    const show = groupsFor(all.ribbon, 'formulas', ctx).flatMap((g) => g.items).find((i) => i.id === 'formulas.show') as Extract<RibbonItem<SheetsContext>, { type: 'button' }>;
    show.run(ctx);
    expect(t.model.showFormulas).toBe(true);
    expect(state(ctx, 'formulas', 'formulas.show')?.active).toBe(true);
    show.run(ctx);
    expect(t.model.showFormulas).toBe(false);

    expect(state(ctx, 'data', 'data.filter')?.active).toBe(false);
    t.select(rect(1, 0));
    const filter = groupsFor(all.ribbon, 'data', ctx).flatMap((g) => g.items).find((i) => i.id === 'data.filter') as Extract<RibbonItem<SheetsContext>, { type: 'button' }>;
    filter.run(ctx);
    expect(state(ctx, 'data', 'data.filter')?.active).toBe(true);
    expect(state(ctx, 'data', 'data.clear-filter')?.disabled).toBe(true);
  });
});

describe('for a reader', () => {
  it('disables everything that changes the workbook, and leaves Find, Show formulas and the Name manager', async () => {
    const { ctx } = await page();
    const reader = { ...ctx, can: { ...ctx.can, edit: false } } as SheetsContext;
    const mine = collect([formatModule, dataModule, formulasModule, findModule]);
    const alive: string[] = [];
    for (const g of mine.ribbon) {
      for (const item of g.items) {
        if (item.type === 'separator' || item.type === 'custom') continue;
        if (!item.disabled?.(reader)) alive.push(item.id);
        // A menu's own entries answer for themselves.
        if (item.type === 'menu') for (const e of item.entries) if (!e.disabled?.(reader)) alive.push(`${item.id}>${e.label}`);
      }
    }
    expect(alive.sort()).toEqual(['formulas.name-manager', 'formulas.show', 'home.find', 'home.find>Find', 'view.show-formulas']);
    const titles = searchCommands(mine.commands, '', reader, 200).map((c) => c.title);
    expect(titles).toEqual(expect.arrayContaining(['Find', 'Name manager', 'Show or hide formulas', 'Manage conditional formatting']));
    for (const t of ['Bold', 'Sort A to Z', 'Remove duplicates', 'Data validation', 'Insert function', 'New conditional formatting rule', 'Find and replace']) expect(titles, t).not.toContain(t);
  });
});

describe('the keys', () => {
  const press = (key: string, o: Partial<KeyboardEventInit> = {}) => new KeyboardEvent('keydown', { key, ctrlKey: true, ...o });

  it('toggle bold, italic and underline in the grid', async () => {
    const { t, ctx } = await page();
    t.select(rect(1, 0));
    for (const [key, field] of [['b', 'bold'], ['i', 'italic'], ['u', 'underline']] as const) {
      const k = keyFor(all.keys, press(key), ctx);
      expect(k, key).toBeDefined();
      k!.run(ctx);
      expect(t.style(1, 0)[field], field).toBe(true);
    }
    keyFor(all.keys, press('X', { shiftKey: true }), ctx)!.run(ctx);
    expect(t.style(1, 0).strike).toBe(true);
  });

  it('show a percent with Ctrl+Shift+%, which is the key that comes out whatever the layout', async () => {
    const { t, ctx } = await page([['0.5']]);
    t.select(rect(0, 0));
    const k = keyFor(all.keys, press('%', { shiftKey: true }), ctx);
    expect(k).toBeDefined();
    k!.run(ctx);
    expect(t.text(0, 0)).toBe('50%');
    k!.run(ctx);
    expect(t.text(0, 0)).toBe('0.5');
  });

  it('turn the filter on and off with Ctrl+Shift+L, and are refused to a reader', async () => {
    const { t, ctx } = await page();
    t.select(rect(1, 0));
    keyFor(all.keys, press('L', { shiftKey: true }), ctx)!.run(ctx);
    expect(ctx.data.filter()).not.toBeNull();
    const reader = { ...ctx, can: { ...ctx.can, edit: false } } as SheetsContext;
    expect(keyFor(all.keys, press('b'), reader)).toBeUndefined();
    expect(keyFor(all.keys, press('L', { shiftKey: true }), reader)).toBeUndefined();
  });

  it('open the find bar with Ctrl+F, and the replace row with Ctrl+H', async () => {
    const { ctx } = await page();
    keyFor(all.keys, press('f'), ctx)!.run(ctx);
    expect(findNow()).toMatchObject({ open: true, replace: false });
    keyFor(all.keys, press('h'), ctx)!.run(ctx);
    expect(findNow()).toMatchObject({ open: true, replace: true });
  });
});

describe('the filter button', () => {
  it('opens the filter menu for its column, and nothing else is taken', async () => {
    const { ctx } = await page();
    const [take] = collect([dataModule]).intents;
    expect(take!({ type: 'select', rect: rect(0, 0), active: { row: 0, col: 0 } }, ctx)).toBe(false);
    expect(openNow()).toBeNull();
    expect(take!({ type: 'filterMenu', col: 2 }, ctx)).toBe(true);
    expect(openNow()).toMatchObject({ id: 'filter', col: 2 });
  });
});

describe('the command box', () => {
  it('finds the tools by what a person would type', async () => {
    const { ctx } = await page();
    const find = (q: string) => searchCommands(all.commands, q, ctx, 6).map((c) => c.title);
    expect(find('bold')[0]).toBe('Bold');
    expect(find('sort')).toEqual(expect.arrayContaining(['Sort A to Z', 'Sort Z to A', 'Custom sort']));
    expect(find('dupl')).toEqual(expect.arrayContaining(['Remove duplicates']));
    expect(find('validation')[0]).toBe('Data validation');
    expect(find('wrap')[0]).toBe('Wrap text');
    expect(find('merge')).toEqual(expect.arrayContaining(['Merge cells', 'Merge and centre']));
    expect(find('replace')).toEqual(expect.arrayContaining(['Find and replace']));
    expect(find('names')).toEqual(expect.arrayContaining(['Name manager']));
    expect(find('highlight')).toEqual(expect.arrayContaining(['Highlight duplicate values']));
  });

  it('runs a format command on the selection, and opens a dialog for one that asks a question', async () => {
    const { t, ctx } = await page();
    t.select(rect(1, 1, 2, 1));
    const run = (title: string) => searchCommands(all.commands, title, ctx, 1)[0]!.run(ctx);
    run('Format as percentage');
    expect(t.text(1, 1)).toBe('95000.00%');
    run('Outside borders');
    expect(t.style(1, 1).borderTop?.line).toBe('thin');
    run('Clear formats');
    expect(t.style(1, 1)).toEqual({});
    run('Custom sort');
    expect(openNow()?.id).toBe('sort');
    run('Insert function');
    expect(openNow()?.id).toBe('function');
    run('New conditional formatting rule');
    expect(openNow()?.id).toBe('cf');
  });

  it('opens the rules pane', async () => {
    const { ctx, opened } = await page();
    searchCommands(all.commands, 'Manage conditional', ctx, 1)[0]!.run(ctx);
    expect(opened).toEqual(['cf-rules']);
  });
});
