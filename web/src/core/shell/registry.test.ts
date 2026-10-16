import { describe, expect, it } from 'vitest';
import {
  duplicateIds,
  fileSections,
  groupsFor,
  itemStates,
  scoreText,
  searchCommands,
  statesEqual,
  statusFor,
  visibleItems,
  visibleTabs
} from './registry';
import type { Command, FileChoice, FileItem, RibbonGroup, RibbonItem, StatusItem, TabDef } from './types';

interface Ctx {
  bold: boolean;
  local: boolean;
}
const ctx: Ctx = { bold: true, local: false };
const press = (id: string, extra: Partial<RibbonItem<Ctx> & { type: 'button' }> = {}): RibbonItem<Ctx> => ({
  type: 'button',
  id,
  label: id,
  run: () => undefined,
  ...extra
});
const sep = (id: string): RibbonItem<Ctx> => ({ type: 'separator', id });

const TABS: TabDef[] = [
  { id: 'file', label: 'File' },
  { id: 'home', label: 'Home' },
  { id: 'layout', label: 'Layout' }
];

describe('the ribbon', () => {
  const groups: RibbonGroup<Ctx>[] = [
    { id: 'home.font', tab: 'home', order: 200, label: 'Font', items: [press('home.bold', { active: (c) => c.bold })] },
    { id: 'home.undo', tab: 'home', order: 100, label: 'Undo', items: [press('home.undo')] },
    { id: 'home.mine', tab: 'home', order: 150, label: 'Mine', items: [press('home.mine')] }
  ];

  it('lays a tab out by order, whatever order the modules were listed in', () => {
    expect(groupsFor(groups, 'home', ctx).map((g) => g.id)).toEqual(['home.undo', 'home.mine', 'home.font']);
  });

  it('draws a tab only if it has something on it, and always draws File', () => {
    expect(visibleTabs(TABS, groups, ctx).map((t) => t.id)).toEqual(['file', 'home']);
  });

  it('a module that fills Layout makes the tab appear', () => {
    const more: RibbonGroup<Ctx>[] = [
      ...groups,
      { id: 'layout.margins', tab: 'layout', order: 100, label: 'Margins', items: [press('layout.margins')] }
    ];
    expect(visibleTabs(TABS, more, ctx).map((t) => t.id)).toEqual(['file', 'home', 'layout']);
  });

  it('drops an item that says it is not visible, and a group left empty by that', () => {
    const local: RibbonGroup<Ctx>[] = [
      { id: 'a', tab: 'home', order: 1, label: 'A', items: [press('a.share', { visible: (c) => !c.local })] }
    ];
    expect(groupsFor(local, 'home', { ...ctx, local: true })).toEqual([]);
    expect(groupsFor(local, 'home', ctx)).toHaveLength(1);
  });

  it('never leaves a separator first, last or doubled', () => {
    const items = [sep('s0'), press('a'), sep('s1'), press('b', { visible: () => false }), sep('s2'), press('c'), sep('s3')];
    expect(visibleItems(items, ctx).map((i) => i.id)).toEqual(['a', 's1', 'c']);
  });

  it('finds an id used twice', () => {
    const dup: RibbonGroup<Ctx>[] = [
      { id: 'g', tab: 'home', order: 1, label: 'G', items: [press('x'), press('x')] },
      { id: 'g', tab: 'home', order: 2, label: 'G', items: [] }
    ];
    expect(duplicateIds(dup).sort()).toEqual(['g', 'x']);
    expect(duplicateIds(groups)).toEqual([]);
  });

  it('reads each item’s state from the context, and sees when nothing changed', () => {
    const items = [press('b', { active: (c) => c.bold, disabled: (c) => c.local })];
    const a = itemStates(items, ctx);
    expect(a.get('b')).toEqual({ active: true, disabled: false, value: null });
    expect(statesEqual(a, itemStates(items, { ...ctx }))).toBe(true);
    expect(statesEqual(a, itemStates(items, { bold: false, local: false }))).toBe(false);
  });
});

describe('the File menu and the footer', () => {
  const file: FileItem<Ctx>[] = [
    { id: 'trash', label: 'Move to trash', section: 'Danger', order: 900, run: () => undefined, danger: true },
    { id: 'new', label: 'New', section: 'Document', order: 100, run: () => undefined },
    { id: 'download', label: 'Download', section: 'Export', order: 500, run: () => undefined },
    { id: 'copy', label: 'Make a copy', section: 'Document', order: 200, run: () => undefined },
    { id: 'share', label: 'Share', section: 'Document', order: 300, run: () => undefined, visible: (c) => !c.local }
  ];

  it('groups rows into sections, each placed where its first row says', () => {
    const sections = fileSections(file, ctx);
    expect(sections.map((s) => s.section)).toEqual(['Document', 'Export', 'Danger']);
    expect(sections[0]!.items.map((i) => i.id)).toEqual(['new', 'copy', 'share']);
  });

  it('hides what a local file cannot do', () => {
    expect(fileSections(file, { ...ctx, local: true })[0]!.items.map((i) => i.id)).toEqual(['new', 'copy']);
  });

  it('lists the choices of a submenu row that are visible, and drops the row when none is', () => {
    const row = (choices: FileChoice<Ctx>[]): FileItem<Ctx> => ({
      id: 'copy-as',
      label: 'Download a copy',
      section: 'Export',
      order: 610,
      run: () => undefined,
      submenu: choices
    });
    const one = { id: 'a', label: 'Document (.docx)', run: () => undefined };
    const two = { id: 'b', label: 'Markdown (.md)', run: () => undefined, visible: (c: Ctx) => !c.local };
    expect(fileSections([row([one, two])], ctx)[0]!.items[0]!.submenu!.map((c) => c.id)).toEqual(['a', 'b']);
    expect(fileSections([row([one, two])], { ...ctx, local: true })[0]!.items[0]!.submenu!.map((c) => c.id)).toEqual(['a']);
    expect(fileSections([row([two])], { ...ctx, local: true })).toEqual([]);
    // The row itself can be hidden, as any other.
    expect(fileSections([{ ...row([one]), visible: (c: Ctx) => !c.local }], { ...ctx, local: true })).toEqual([]);
  });

  it('orders status items by side and order', () => {
    const status: StatusItem<Ctx>[] = [
      { id: 'b', side: 'left', order: 20, render: () => null },
      { id: 'a', side: 'left', order: 10, render: () => null },
      { id: 'z', side: 'right', order: 1, render: () => null }
    ];
    expect(statusFor(status, 'left', ctx).map((i) => i.id)).toEqual(['a', 'b']);
  });
});

describe('the command search', () => {
  const cmd = (id: string, title: string, keywords: string[] = [], extra: Partial<Command<Ctx>> = {}): Command<Ctx> => ({
    id,
    title,
    section: 'Test',
    keywords,
    run: () => undefined,
    ...extra
  });
  const all = [
    cmd('table', 'Insert table'),
    cmd('bold', 'Bold', ['strong']),
    cmd('bullets', 'Bulleted list', ['bullets']),
    cmd('share', 'Share', [], { visible: (c) => !c.local }),
    cmd('copy', 'Make a copy')
  ];

  it('puts a title that starts with the text before one that only contains it', () => {
    expect(searchCommands(all, 'b', ctx).map((c) => c.id)).toEqual(['bold', 'bullets', 'table']);
  });

  it('matches a keyword', () => {
    expect(searchCommands(all, 'strong', ctx).map((c) => c.id)).toEqual(['bold']);
  });

  it('matches letters in order', () => {
    expect(searchCommands(all, 'tbl', ctx).map((c) => c.id)).toEqual(['table']);
  });

  it('matches the start of a later word', () => {
    expect(scoreText('Insert table', [], 'tab')).toBeGreaterThan(scoreText('Make a stable thing', [], 'tab'));
  });

  it('lists everything it can run for an empty query, and nothing it cannot', () => {
    expect(searchCommands(all, '', ctx)).toHaveLength(5);
    expect(searchCommands(all, '', { ...ctx, local: true }).map((c) => c.id)).not.toContain('share');
  });

  it('finds nothing for nonsense', () => {
    expect(searchCommands(all, 'qzx', ctx)).toEqual([]);
  });
});
