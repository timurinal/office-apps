import { describe, expect, it } from 'vitest';
import { groupsFor, searchCommands, visibleTabs } from '../../core/shell/registry';
import { collect, problems } from './collect';
import { DOCS_MODULES } from './index';
import { DOCS_TABS, type DocsContext } from './types';

/** The parts of a context the registry's predicates read. The rest is not touched. */
const ctx = (over: Partial<DocsContext['can']> = {}, source: 'cloud' | 'local' = 'cloud'): DocsContext =>
  ({
    editor: null,
    source: { kind: source },
    can: {
      edit: true,
      comment: true,
      comments: true,
      share: true,
      history: true,
      lock: true,
      unlock: false,
      copy: true,
      trash: true,
      star: true,
      rename: true,
      create: source === 'cloud',
      print: true,
      ...over
    }
  }) as unknown as DocsContext;

describe('the Docs modules', () => {
  it('share no id: not a module, a ribbon group or item, a command, a footer item or a mode', () => {
    expect(problems(DOCS_MODULES)).toEqual([]);
  });

  it('puts the toolbar on Home, and draws a tab only when a module has put something on it', () => {
    const all = collect(DOCS_MODULES).ribbon;
    const home = groupsFor(all, 'home', ctx()).flatMap((g) => g.items.map((i) => i.id));
    expect(home).toEqual(
      expect.arrayContaining([
        'home.undo', 'home.redo', 'home.style', 'home.bold', 'home.italic', 'home.underline', 'home.strike', 'home.bullets', 'home.numbering',
        'home.font.family', 'home.font.size', 'home.color', 'home.highlight', 'home.align', 'home.spacing', 'home.painter', 'home.clear'
      ])
    );
    const tabs = visibleTabs(DOCS_TABS, all, ctx()).map((t) => t.id);
    expect(tabs).toEqual(expect.arrayContaining(['file', 'home', 'insert', 'view', 'review']));
    // A tab nobody has filled is not drawn; whichever are, they come in the order of DOCS_TABS.
    expect(tabs).toEqual(DOCS_TABS.map((t) => t.id).filter((id) => tabs.includes(id)));
  });

  it('lays Home out in the order the board draws it: history, tools, font, text, paragraph, alignment, styles, find', () => {
    const groups = groupsFor(collect(DOCS_MODULES).ribbon, 'home', ctx()).map((g) => g.id);
    const mine = ['home.history', 'home.painter', 'home.font', 'home.marks', 'home.paragraph', 'home.align', 'home.styles', 'home.find'];
    expect(groups.filter((g) => mine.includes(g))).toEqual(mine);
  });

  it('hides what a local file cannot do: comments, history, lock and making another document', () => {
    const local = ctx({ comment: false, comments: false, share: false, history: false, lock: false, copy: false, trash: false, star: false, create: false }, 'local');
    const all = collect(DOCS_MODULES);
    const review = groupsFor(all.ribbon, 'review', local);
    expect(review).toEqual([]);
    expect(visibleTabs(DOCS_TABS, all.ribbon, local).map((t) => t.id)).not.toContain('review');
    const titles = searchCommands(all.commands, '', local, 100).map((c) => c.title);
    for (const t of ['Share', 'Lock with a password', 'Version history', 'New comment', 'Move to trash', 'New document', 'Make a copy']) {
      expect(titles, t).not.toContain(t);
    }
    expect(titles).toContain('Bold');
    expect(titles).toContain('Print');
  });

  it('offers the whole set on a cloud document', () => {
    const titles = searchCommands(collect(DOCS_MODULES).commands, '', ctx(), 100).map((c) => c.title);
    for (const t of ['Share', 'Lock with a password', 'Version history', 'New comment', 'Move to trash', 'New document', 'Make a copy', 'Bold']) {
      expect(titles, t).toContain(t);
    }
  });

  it('keeps a reader from every command that types', () => {
    const reader = ctx({ edit: false, comment: false, copy: false, trash: false, lock: false, share: false });
    const titles = searchCommands(collect(DOCS_MODULES).commands, '', reader, 100).map((c) => c.title);
    expect(titles).not.toContain('Bold');
    expect(titles).not.toContain('Normal text');
    expect(titles).toContain('Show comments');
  });

  it('finds Bold from "strong" and Heading 1 from "h1"', () => {
    const cmds = collect(DOCS_MODULES).commands;
    expect(searchCommands(cmds, 'strong', ctx())[0]?.title).toBe('Bold');
    expect(searchCommands(cmds, 'heading 1', ctx())[0]?.title).toBe('Heading 1');
  });
});
