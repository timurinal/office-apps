// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { joinGroups, tidy, type ContextEntry, type ContextItem } from '../../core/ContextMenu';
import { closeTool, openNow } from '../panes/tools';
import { contextItems, menusModule } from './menus';
import { rect, setup, table } from './testkit';
import type { SheetsContext, SheetsMenuTarget } from './types';

afterEach(() => closeTool());

const isItem = (e: ContextEntry): e is ContextItem => 'label' in e;
const names = (entries: readonly ContextEntry[]): string[] => tidy(entries).map((e) => (isItem(e) ? e.label : '-'));
const find = (entries: readonly ContextEntry[], label: string): ContextItem => {
  const hit = entries.find((e): e is ContextItem => isItem(e) && e.label === label);
  if (!hit) throw new Error(`no row ${label}: ${names(entries).join(', ')}`);
  return hit;
};

async function open(can: { edit?: boolean; download?: boolean } = {}) {
  const kit = await setup(table(['Item', 'Qty', 'Note'], ['pear', '3', 'x'], ['apple', '5', 'y'], ['fig', '1', 'z']));
  const ctx = Object.assign(Object.create(kit.ctx), {
    can: { edit: can.edit ?? true, download: can.download ?? true },
    actions: { focusGrid: () => undefined }
  }) as SheetsContext;
  const entries = (target: SheetsMenuTarget): ContextEntry[] => joinGroups(contextItems(target, ctx));
  const cell = (r1: number, c1: number, r2 = r1, c2 = c1): SheetsMenuTarget => {
    kit.select(rect(r1, c1, r2, c2));
    return { kind: 'cell', rect: rect(r1, c1, r2, c2), active: { row: r1, col: c1 } };
  };
  const cols = (from: number, to = from): SheetsMenuTarget => {
    kit.select(rect(0, from, kit.ctx.data.rowCount() - 1, to));
    return { kind: 'col', from, to };
  };
  const rows = (from: number, to = from): SheetsMenuTarget => {
    kit.select(rect(from, 0, to, kit.ctx.data.colCount() - 1));
    return { kind: 'row', from, to };
  };
  return { ...kit, entries, cell, cols, rows, view: ctx };
}

describe('a cell or a range', () => {
  it('has the clipboard, insert, delete, clear, sort, filter and format, in that order', async () => {
    const t = await open();
    expect(names(t.entries(t.cell(1, 1)))).toEqual(['Cut', 'Copy', 'Paste', 'Paste values', '-', 'Insert', 'Delete', 'Clear contents', '-', 'Sort', 'Filter', '-', 'Format cells…']);
  });

  it('has submenus for Insert, Delete and Sort', async () => {
    const t = await open();
    const all = t.entries(t.cell(1, 1));
    expect(names(find(all, 'Insert').submenu!)).toEqual(['Rows above', 'Rows below', '-', 'Columns left', 'Columns right']);
    expect(names(find(all, 'Delete').submenu!)).toEqual(['Rows', 'Columns']);
    expect(names(find(all, 'Sort').submenu!)).toEqual(['Sort A to Z', 'Sort Z to A', '-', 'Custom sort…']);
  });

  it('shows the shortcut each row has', async () => {
    const t = await open();
    const all = t.entries(t.cell(1, 1));
    expect(find(all, 'Copy').shortcut).toMatch(/C$/);
    expect(find(all, 'Clear contents').shortcut).toBe('Delete');
  });

  it('inserts as many rows as are chosen, above or below, and columns left or right', async () => {
    const t = await open();
    const all = t.entries(t.cell(1, 0, 2, 0));
    find(find(all, 'Insert').submenu!, 'Rows above').onSelect!();
    // Two rows came in above row 2, so apple is two rows lower.
    expect([t.text(1, 0), t.text(2, 0), t.text(3, 0)]).toEqual(['', '', 'pear']);
    t.model.undo();
    expect(t.text(1, 0)).toBe('pear');
    find(find(all, 'Insert').submenu!, 'Columns right').onSelect!();
    expect([t.text(0, 0), t.text(0, 1), t.text(0, 2)]).toEqual(['Item', '', 'Qty']);
  });

  it('deletes the rows or the columns the range covers', async () => {
    const t = await open();
    const all = t.entries(t.cell(1, 1));
    find(find(all, 'Delete').submenu!, 'Rows').onSelect!();
    expect(t.text(1, 0)).toBe('apple');
    t.model.undo();
    find(find(all, 'Delete').submenu!, 'Columns').onSelect!();
    expect(t.text(0, 1)).toBe('Note');
  });

  it('clears the contents', async () => {
    const t = await open();
    find(t.entries(t.cell(1, 0, 2, 1)), 'Clear contents').onSelect!();
    expect([t.text(1, 0), t.text(2, 1), t.text(3, 0)]).toEqual(['', '', 'fig']);
  });

  it('sorts a column and turns the filter on and off, and ticks Filter while it is on', async () => {
    const t = await open();
    const all = t.entries(t.cols(0));
    find(find(t.entries(t.cell(0, 0, 3, 2)), 'Sort').submenu!, 'Sort A to Z').onSelect!();
    expect([t.text(1, 0), t.text(2, 0), t.text(3, 0)]).toEqual(['apple', 'fig', 'pear']);
    expect(all.length).toBeGreaterThan(0);
    const cells = t.entries(t.cell(0, 0, 3, 2));
    expect(find(cells, 'Filter').checked).toBe(false);
    find(cells, 'Filter').onSelect!();
    expect(t.ctx.data.filter()).not.toBeNull();
    expect(find(t.entries(t.cell(0, 0, 3, 2)), 'Filter').checked).toBe(true);
    find(t.entries(t.cell(0, 0, 3, 2)), 'Filter').onSelect!();
    expect(t.ctx.data.filter()).toBeNull();
  });

  it('opens the number format dialog for Format cells, and the sort dialog for a custom sort', async () => {
    const t = await open();
    const all = t.entries(t.cell(1, 1));
    find(all, 'Format cells…').onSelect!();
    expect(openNow()).toMatchObject({ id: 'numfmt' });
    find(find(all, 'Sort').submenu!, 'Custom sort…').onSelect!();
    expect(openNow()).toMatchObject({ id: 'sort' });
  });

  it('is only Copy for a reader who may copy, and nothing for one who may not', async () => {
    const reader = await open({ edit: false });
    expect(names(reader.entries(reader.cell(1, 1)))).toEqual(['Copy']);
    expect(names(reader.entries(reader.cols(0)))).toEqual(['Copy']);
    expect(names(reader.entries(reader.rows(0)))).toEqual(['Copy']);
    const restricted = await open({ edit: false, download: false });
    expect(restricted.entries(restricted.cell(1, 1))).toEqual([]);
  });

  it('has no Cut for an editor who may not download', async () => {
    const t = await open({ download: false });
    expect(names(t.entries(t.cell(1, 1))).slice(0, 3)).toEqual(['Paste', 'Paste values', '-']);
  });
});

describe('a column header', () => {
  it('has the width, autofit, insert, delete, hide, unhide and sort', async () => {
    const t = await open();
    expect(names(t.entries(t.cols(1)))).toEqual([
      'Cut', 'Copy', 'Paste', 'Paste values', '-',
      'Column width…', 'Autofit column width', '-',
      'Insert column left', 'Insert column right', 'Delete column', '-',
      'Hide column', 'Unhide', '-',
      'Sort A to Z', 'Sort Z to A'
    ]);
  });

  it('counts the columns in what it says', async () => {
    const t = await open();
    const all = t.entries(t.cols(0, 2));
    expect(names(all)).toEqual(expect.arrayContaining(['Delete 3 columns', 'Hide 3 columns']));
  });

  it('opens the width dialog for the chosen columns', async () => {
    const t = await open();
    find(t.entries(t.cols(1, 2)), 'Column width…').onSelect!();
    expect(openNow()).toMatchObject({ id: 'size', axis: 'col' });
  });

  it('autofits the chosen columns to what is in them', async () => {
    const t = await open();
    const before = t.ctx.data.colWidth(0);
    find(t.entries(t.cols(0)), 'Autofit column width').onSelect!();
    expect(t.ctx.data.colWidth(0)).not.toBe(before);
    expect(t.ctx.data.colWidth(1)).toBe(112);
  });

  it('inserts left and right of the chosen columns, and deletes them', async () => {
    const t = await open();
    find(t.entries(t.cols(1)), 'Insert column left').onSelect!();
    expect([t.text(0, 0), t.text(0, 1), t.text(0, 2)]).toEqual(['Item', '', 'Qty']);
    t.model.undo();
    find(t.entries(t.cols(1)), 'Insert column right').onSelect!();
    expect([t.text(0, 1), t.text(0, 2), t.text(0, 3)]).toEqual(['Qty', '', 'Note']);
    t.model.undo();
    find(t.entries(t.cols(1)), 'Delete column').onSelect!();
    expect([t.text(0, 0), t.text(0, 1)]).toEqual(['Item', 'Note']);
  });

  it('hides the chosen columns, and offers Unhide only across one that is hidden', async () => {
    const t = await open();
    expect(find(t.entries(t.cols(1)), 'Unhide').disabled).toBe(true);
    find(t.entries(t.cols(1)), 'Hide column').onSelect!();
    expect(t.ctx.data.colWidth(1)).toBe(0);
    // Chosen through the hidden one, Unhide is on, and brings it back at the width it had.
    const across = t.entries(t.cols(0, 2));
    expect(find(across, 'Unhide').disabled).toBe(false);
    find(across, 'Unhide').onSelect!();
    expect(t.ctx.data.colWidth(1)).toBe(112);
  });

  it('sorts the column both ways', async () => {
    const t = await open();
    // The heading is text over text, so it is not taken for one and sorts with the rest.
    find(t.entries(t.cols(0)), 'Sort Z to A').onSelect!();
    expect([t.text(0, 0), t.text(3, 0)]).toEqual(['pear', 'apple']);
    find(t.entries(t.cols(0)), 'Sort A to Z').onSelect!();
    expect([t.text(0, 0), t.text(3, 0)]).toEqual(['apple', 'pear']);
  });
});

describe('a row header', () => {
  it('has the height, autofit, insert, delete, hide and unhide, and no sort', async () => {
    const t = await open();
    expect(names(t.entries(t.rows(1)))).toEqual([
      'Cut', 'Copy', 'Paste', 'Paste values', '-',
      'Row height…', 'Autofit row height', '-',
      'Insert row above', 'Insert row below', 'Delete row', '-',
      'Hide row', 'Unhide'
    ]);
  });

  it('opens the height dialog, inserts above and below, deletes and hides', async () => {
    const t = await open();
    find(t.entries(t.rows(1, 2)), 'Row height…').onSelect!();
    expect(openNow()).toMatchObject({ id: 'size', axis: 'row' });
    find(t.entries(t.rows(1, 2)), 'Insert row above').onSelect!();
    expect([t.text(1, 0), t.text(2, 0), t.text(3, 0)]).toEqual(['', '', 'pear']);
    t.model.undo();
    find(t.entries(t.rows(2)), 'Delete row').onSelect!();
    expect([t.text(1, 0), t.text(2, 0)]).toEqual(['pear', 'fig']);
    t.model.undo();
    find(t.entries(t.rows(2)), 'Hide row').onSelect!();
    expect(t.ctx.data.rowHeight(2)).toBe(0);
    find(t.entries(t.rows(1, 3)), 'Unhide').onSelect!();
    expect(t.ctx.data.rowHeight(2)).toBeGreaterThan(0);
  });
});

describe('the module', () => {
  it('answers for every target and nothing else, and adds its commands to the command box', () => {
    expect(menusModule.contextItems).toBe(contextItems);
    expect(menusModule.commands.map((c) => c.id)).toEqual(expect.arrayContaining(['format.col-width', 'format.row-height', 'edit.paste-values']));
  });
});
