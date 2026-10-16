import { describe, expect, it } from 'vitest';
import { fileSections, groupsFor, searchCommands, statusFor, visibleTabs } from '../../core/shell/registry';
import { collect, problems } from './collect';
import { coreModule } from './core';
import { SLIDES_MODULES } from './index';
import { SLIDES_TABS, type SlidesCan, type SlidesContext } from './types';

/** The parts of a context the registry's predicates read. The rest is not touched. */
const ctx = (over: Partial<SlidesCan> = {}, source: 'cloud' | 'local' = 'cloud', view = 'normal'): SlidesContext =>
  ({
    source: { kind: source },
    meta: { id: 'd0', templateScope: null },
    slideId: 's1',
    slideIndex: 0,
    zoom: 100,
    fit: true,
    view,
    views: [{ id: 'normal', label: 'Normal' }],
    notes: { shown: true, setShown: () => undefined },
    design: { layouts: [{ id: 'title' }, { id: 'titleContent' }, { id: 'blank' }] },
    model: { canUndo: () => true, canRedo: () => true, order: () => ['s1'] },
    text: { available: () => true },
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
      present: false,
      template: true,
      ...over
    }
  }) as unknown as SlidesContext;

const all = collect(SLIDES_MODULES);
const core = collect([coreModule]);

describe('the Slides modules', () => {
  it('share no id: not a module, a ribbon group or item, a command, a key, a footer item, a mode or a view', () => {
    expect(problems(SLIDES_MODULES)).toEqual([]);
  });

  it('puts every group on a tab that exists', () => {
    const tabIds = new Set(SLIDES_TABS.map((t) => t.id));
    for (const g of all.ribbon) expect(tabIds.has(g.tab), `${g.id} is on ${g.tab}`).toBe(true);
  });

  it('keeps the slots types.ts tells the other modules about', () => {
    const slots = (tab: string) => Object.fromEntries(core.ribbon.filter((g) => g.tab === tab).map((g) => [g.id, g.order]));
    expect(slots('home')).toEqual({ 'home.history': 100, 'home.clipboard': 150, 'home.slides': 200, 'home.font': 300, 'home.paragraph': 400 });
    expect(slots('insert')).toEqual({ 'insert.slides': 100, 'insert.text': 500 });
    expect(slots('slideshow')).toEqual({ 'slideshow.start': 100, 'slideshow.setup': 200 });
    expect(slots('view')).toEqual({ 'view.views': 100, 'view.show': 200, 'view.zoom': 300 });
    const footer = (side: 'left' | 'right') => core.statusItems.filter((s) => s.side === side).map((s) => [s.id, s.order]);
    expect(footer('left')).toEqual([['status.slide', 10], ['status.connection', 20]]);
    expect(footer('right')).toEqual([['status.notes', 10], ['status.views', 20], ['status.fit', 30]]);
  });

  it('has the Home buttons the brief names', () => {
    const items = groupsFor(core.ribbon, 'home', ctx()).flatMap((g) => g.items.map((i) => i.id));
    expect(items).toEqual(
      expect.arrayContaining([
        'home.undo',
        'home.redo',
        'home.paste',
        'home.cut',
        'home.copy',
        'home.new-slide',
        'home.layout',
        'home.reset',
        'home.font-family',
        'home.font-size',
        'home.bold',
        'home.italic',
        'home.underline',
        'home.strike',
        'home.color',
        'home.bullets',
        'home.numbering',
        'home.align-left',
        'home.align-center',
        'home.align-right',
        'home.align-justify',
        'home.line-spacing'
      ])
    );
  });

  it('draws the Slide show tab only when a module can present', () => {
    const tabs = (c: SlidesContext) => visibleTabs(SLIDES_TABS, core.ribbon, c).map((t) => t.id);
    // Without a presenter the Start group is empty, but Hide slide still puts the tab there.
    expect(groupsFor(core.ribbon, 'slideshow', ctx()).map((g) => g.id)).toEqual(['slideshow.setup']);
    expect(groupsFor(core.ribbon, 'slideshow', ctx({ present: true })).map((g) => g.id)).toEqual(['slideshow.start', 'slideshow.setup']);
    expect(tabs(ctx())).toEqual(['file', 'home', 'insert', 'slideshow', 'view']);
    // F5 goes to the browser when there is nothing to present.
    const f5 = core.keys.find((k) => k.keys === 'F5')!;
    expect(f5.when?.(ctx())).toBe(false);
    expect(f5.when?.(ctx({ present: true }))).toBe(true);
  });

  it('takes the keys the brief names, and no group keys (the drawing module has those)', () => {
    expect(core.keys.map((k) => k.keys).sort()).toEqual(['F5', 'Mod+/', 'Mod+A', 'Mod+B', 'Mod+D', 'Mod+I', 'Mod+M', 'Mod+Shift+Z', 'Mod+U', 'Mod+Y', 'Mod+Z', 'Shift+F5']);
  });

  it('keeps a reader from every command and key that changes the deck', () => {
    const reader = ctx({ edit: false, copy: false, trash: false, share: false });
    const titles = searchCommands(all.commands, '', reader, 200).map((c) => c.title);
    for (const t of ['Undo', 'Redo', 'Cut', 'Paste', 'Duplicate', 'New slide', 'Duplicate slide', 'Delete slide', 'Reset slide', 'Text box', 'Bold']) {
      expect(titles, t).not.toContain(t);
    }
    expect(titles).toEqual(expect.arrayContaining(['Copy', 'Select all', 'Zoom in', 'Show or hide notes']));
    const disabled = groupsFor(core.ribbon, 'home', reader)
      .flatMap((g) => g.items)
      .filter((i) => i.type !== 'separator' && i.type !== 'custom' && i.disabled?.(reader));
    expect(disabled.map((i) => i.id)).toEqual(
      expect.arrayContaining(['home.undo', 'home.redo', 'home.paste', 'home.cut', 'home.reset', 'home.font-family', 'home.bold', 'home.bullets', 'home.line-spacing'])
    );
    for (const k of core.keys.filter((k) => ['Mod+Z', 'Mod+Y', 'Mod+M', 'Mod+D', 'Mod+B'].includes(k.keys))) {
      expect(k.when?.(reader), k.keys).toBe(false);
    }
  });

  it('takes Copy and Cut away from a reader whose link has downloads off', () => {
    const restricted = ctx({ edit: false, download: false });
    const items = groupsFor(core.ribbon, 'home', restricted).flatMap((g) => g.items.map((i) => i.id));
    expect(items).not.toContain('home.copy');
    expect(items).not.toContain('home.cut');
    expect(searchCommands(all.commands, 'copy', restricted, 20).map((c) => c.title)).not.toContain('Copy');
  });

  it('hides what a local file cannot do, and has the File menu sections types.ts names', () => {
    expect(fileSections(core.fileItems, ctx()).map((s) => [s.section, s.items.map((i) => i.label)])).toEqual([
      ['Document', ['New', 'Open', 'Make a copy', 'Rename']],
      ['Share', ['Version history', 'Share']],
      ['Danger', ['Move to trash']]
    ]);
    const local = ctx({ share: false, history: false, copy: false, trash: false, star: false, create: false }, 'local');
    const titles = searchCommands(all.commands, '', local, 200).map((c) => c.title);
    for (const t of ['Share', 'Version history', 'New presentation', 'Make a copy', 'Move to trash', 'Open another document']) {
      expect(titles, t).not.toContain(t);
    }
    expect(fileSections(core.fileItems, local).flatMap((s) => s.items.map((i) => i.label))).toEqual(['Rename']);
  });

  it('with every module, offers the deck as a template and as a PowerPoint file, and neither where it cannot', () => {
    const c = { ...ctx(), meta: { id: 'd1', templateScope: null } } as unknown as SlidesContext;
    expect(fileSections(all.fileItems, c).map((s) => [s.section, s.items.map((i) => i.label)])).toEqual([
      ['Document', ['New', 'Open', 'Make a copy', 'Rename', 'Save as template']],
      ['Share', ['Version history', 'Share']],
      ['Export', ['Export as PowerPoint (.pptx)']],
      ['Danger', ['Move to trash']]
    ]);
    expect(searchCommands(all.commands, 'powerpoint', c, 20).map((x) => x.title)).toContain('Export as PowerPoint');
    const reader = { ...ctx({ download: false, template: false, edit: false }), meta: { id: 'd1', templateScope: null } } as unknown as SlidesContext;
    const labels = fileSections(all.fileItems, reader).flatMap((s) => s.items.map((i) => i.label));
    expect(labels).not.toContain('Export as PowerPoint (.pptx)');
    expect(labels).not.toContain('Save as template');
    const saved = { ...ctx(), meta: { id: 'd2', templateScope: 'user' } } as unknown as SlidesContext;
    expect(fileSections(all.fileItems, saved).flatMap((s) => s.items.map((i) => i.label))).toContain('Remove from templates');
  });

  it('shows the Notes switch in the footer only in Normal view', () => {
    expect(statusFor(core.statusItems, 'right', ctx()).map((s) => s.id)).toEqual(['status.notes', 'status.views', 'status.fit']);
    expect(statusFor(core.statusItems, 'right', ctx({}, 'cloud', 'sorter')).map((s) => s.id)).toEqual(['status.views', 'status.fit']);
  });
});
