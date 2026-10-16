import { describe, expect, it } from 'vitest';
import { fileSections, groupsFor, searchCommands, statusFor, visibleTabs } from '../../core/shell/registry';
import { collect, problems } from './collect';
import { coreModule } from './core';
import { SHEETS_MODULES } from './index';
import { SHEETS_TABS, type SheetsContext } from './types';

/** The parts of a context the registry's predicates read. The rest is not touched. */
const ctx = (over: Partial<SheetsContext['can']> = {}, source: 'cloud' | 'local' = 'cloud'): SheetsContext =>
  ({
    source: { kind: source },
    sheets: [{ id: 's', name: 'Sheet1', color: null, hidden: false }],
    zoom: 100,
    view: { gridlines: true },
    model: { canUndo: () => true, canRedo: () => true },
    data: { frozen: () => ({ rows: 0, cols: 0 }) },
    can: {
      edit: true,
      share: true,
      history: true,
      copy: true,
      trash: true,
      star: true,
      rename: true,
      create: source === 'cloud',
      download: true,
      ...over
    }
  }) as unknown as SheetsContext;

const all = collect(SHEETS_MODULES);

describe('the Sheets modules', () => {
  it('share no id: not a module, a ribbon group or item, a command, a key, a footer item or a mode', () => {
    expect(problems(SHEETS_MODULES)).toEqual([]);
  });

  it('puts every group on a tab that exists, and draws only the tabs that have something on them', () => {
    const tabIds = new Set(SHEETS_TABS.map((t) => t.id));
    for (const g of all.ribbon) expect(tabIds.has(g.tab), `${g.id} is on ${g.tab}`).toBe(true);
    const shown = visibleTabs(SHEETS_TABS, all.ribbon, ctx()).map((t) => t.id);
    // Core fills Home and View, charts fills Insert, and the formatting and data tools fill Formulas and Data;
    // the rest appear when a module puts a group on them.
    expect(shown).toEqual(['file', 'home', 'insert', 'formulas', 'data', 'view']);
  });

  it('keeps the Home slots the other modules are told about', () => {
    // Core's own slots; the other modules' groups sit between them (format.test.ts holds those).
    const core = collect([coreModule]);
    const slots = Object.fromEntries(core.ribbon.filter((g) => g.tab === 'home').map((g) => [g.id, g.order]));
    expect(slots).toEqual({ 'home.history': 100, 'home.clipboard': 150, 'home.cells': 600, 'home.editing': 700 });
    const view = Object.fromEntries(core.ribbon.filter((g) => g.tab === 'view').map((g) => [g.id, g.order]));
    expect(view).toEqual({ 'view.freeze': 100, 'view.show': 150, 'view.zoom': 200 });
    const home = groupsFor(all.ribbon, 'home', ctx()).map((g) => g.id);
    expect(home.filter((id) => id in slots)).toEqual(['home.history', 'home.clipboard', 'home.cells', 'home.editing']);
  });

  it('has the buttons the brief names', () => {
    const items = groupsFor(all.ribbon, 'home', ctx()).flatMap((g) => g.items.map((i) => i.id));
    expect(items).toEqual(
      expect.arrayContaining(['home.undo', 'home.redo', 'home.paste', 'home.cut', 'home.copy', 'home.insert', 'home.delete', 'home.autosum', 'home.clear'])
    );
    const view = groupsFor(all.ribbon, 'view', ctx()).flatMap((g) => g.items.map((i) => i.id));
    expect(view).toEqual(expect.arrayContaining(['view.freeze', 'view.gridlines', 'view.zoom-in', 'view.zoom-out']));
    const autosum = all.ribbon.flatMap((g) => g.items).find((i) => i.type === 'split' && i.id === 'home.autosum');
    expect(autosum?.type === 'split' && autosum.menu.map((m) => m.label)).toEqual(['Sum', 'Average', 'Count', 'Max', 'Min']);
  });

  it('puts the downloads in the File menu\'s Export section, between Share and Danger', () => {
    const sections = fileSections(all.fileItems, ctx());
    expect(sections.map((s) => s.section)).toEqual(['Document', 'Share', 'Export', 'Danger']);
    expect(sections[0]!.items.map((i) => i.label)).toEqual(['New', 'Open', 'Make a copy', 'Rename']);
    expect(sections[1]!.items.map((i) => i.label)).toEqual(['Version history', 'Share']);
    expect(sections[2]!.items.map((i) => i.label)).toEqual(['Download a copy']);
    expect(sections[2]!.items[0]!.submenu!.map((c) => c.label)).toEqual(['Workbook (.xlsx)', 'Comma-separated values (.csv)', 'Tab-separated values (.tsv)']);
    // A reader on a link whose owner turned downloads off gets neither the rows nor the commands.
    const noDownload = ctx({ download: false });
    expect(fileSections(all.fileItems, noDownload).map((s) => s.section)).not.toContain('Export');
    expect(searchCommands(all.commands, 'download', noDownload, 20)).toEqual([]);
    expect(searchCommands(all.commands, 'download', ctx(), 20).map((c) => c.id).sort()).toEqual(['file.download-csv', 'file.download-tsv', 'file.download-xlsx']);
    expect(searchCommands(all.commands, 'download', ctx(), 20).map((c) => c.title).sort()).toEqual(['Download a copy as .csv', 'Download a copy as .tsv', 'Download a copy as .xlsx']);
    // The old names of the formats still find them, though they are not shown.
    expect(searchCommands(all.commands, 'excel', ctx(), 20).map((c) => c.title)).toContain('Download a copy as .xlsx');
    // Lock is not built for Sheets, and there is nothing in it for it to hide.
    expect(all.fileItems.map((f) => f.id)).not.toContain('file.lock');
  });

  it('takes the keys the brief names', () => {
    expect(collect([coreModule]).keys.map((k) => k.keys).sort()).toEqual(['Mod++', 'Mod+-', 'Mod+/', 'Mod+Shift+Z', 'Mod+Y', 'Mod+Z']);
  });

  it('hides what a local file cannot do: sharing, history, making another document, the trash', () => {
    const local = ctx({ share: false, history: false, copy: false, trash: false, star: false, create: false }, 'local');
    const titles = searchCommands(all.commands, '', local, 100).map((c) => c.title);
    for (const t of ['Share', 'Version history', 'New spreadsheet', 'Make a copy', 'Move to trash', 'Open another document']) {
      expect(titles, t).not.toContain(t);
    }
    expect(titles).toContain('Undo');
    expect(titles).toContain('AutoSum');
    const rows = fileSections(all.fileItems, local).flatMap((s) => s.items.map((i) => i.label));
    // Save as, on the local page, is what leaves a file there (local/LocalDocument.tsx).
    expect(rows).toEqual(['Rename']);
    expect(searchCommands(all.commands, 'download', local, 20)).toEqual([]);
  });

  it('offers the whole set on a cloud spreadsheet', () => {
    const titles = searchCommands(all.commands, '', ctx(), 100).map((c) => c.title);
    for (const t of ['Share', 'Version history', 'New spreadsheet', 'Make a copy', 'Move to trash', 'Undo', 'Insert rows above', 'Delete rows', 'AutoSum', 'Clear contents']) {
      expect(titles, t).toContain(t);
    }
  });

  it('keeps a reader from every command that changes the workbook', () => {
    const reader = ctx({ edit: false, copy: false, trash: false, share: false });
    const titles = searchCommands(all.commands, '', reader, 100).map((c) => c.title);
    for (const t of ['Undo', 'Redo', 'Cut', 'Paste', 'Clear contents', 'Insert rows above', 'Delete rows', 'Insert sheet', 'AutoSum', 'Freeze top row']) {
      expect(titles, t).not.toContain(t);
    }
    // What does not change anything stays.
    expect(titles).toEqual(expect.arrayContaining(['Copy', 'Zoom in', 'Show or hide gridlines']));
    // A reader's buttons are disabled where they are drawn.
    const disabled = groupsFor(all.ribbon, 'home', reader)
      .flatMap((g) => g.items)
      .filter((i) => i.type !== 'separator' && i.type !== 'custom' && i.disabled?.(reader));
    expect(disabled.map((i) => i.id)).toEqual(expect.arrayContaining(['home.undo', 'home.redo', 'home.paste', 'home.cut', 'home.insert', 'home.delete', 'home.autosum', 'home.clear']));
  });

  it('keeps a reader on a link without downloads from copying and cutting', () => {
    const restricted = ctx({ download: false, copy: false });
    const ids = groupsFor(all.ribbon, 'home', restricted).flatMap((g) => g.items.map((i) => i.id));
    expect(ids).not.toContain('home.copy');
    expect(ids).not.toContain('home.cut');
    expect(searchCommands(all.commands, '', restricted, 100).map((c) => c.title)).not.toContain('Copy');
  });

  it('puts the sheet tabs at the left of the footer, and the sum and the connection at the right', () => {
    expect(statusFor(all.statusItems, 'left', ctx()).map((s) => s.id)).toEqual(['status.sheet-tabs']);
    expect(statusFor(all.statusItems, 'right', ctx()).map((s) => s.id)).toEqual(['status.selection', 'status.connection']);
    // Before the structure has come there is no sheet to name or to sum.
    const none = { ...ctx(), sheets: [] } as unknown as SheetsContext;
    expect(statusFor(all.statusItems, 'left', none)).toEqual([]);
  });

  it('ticks the freeze that is in force', () => {
    const freeze = all.ribbon.flatMap((g) => g.items).find((i) => i.type === 'menu' && i.id === 'view.freeze');
    const frozen = { ...ctx(), data: { frozen: () => ({ rows: 1, cols: 0 }) } } as unknown as SheetsContext;
    const ticked = freeze?.type === 'menu' ? freeze.entries.filter((e) => e.active?.(frozen)).map((e) => e.label) : [];
    expect(ticked).toEqual(['Freeze top row']);
  });
});
