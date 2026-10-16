// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { appearanceState, setAppearance } from '../../core/appearance';
import { groupsFor } from '../../core/shell/registry';
import type { MenuItem } from '../../core/shell/types';
import { collect, problems } from './collect';
import { SLIDES_MODULES } from './index';
import type { SlidesContext } from './types';

afterEach(() => {
  setAppearance('system');
  localStorage.clear();
});

const ctx = { source: { kind: 'cloud' }, views: [{ id: 'normal', label: 'Normal' }], can: { edit: true } } as unknown as SlidesContext;

describe('the Slides appearance module', () => {
  it('shares no id with another module', () => {
    expect(problems(SLIDES_MODULES)).toEqual([]);
  });

  it('puts Theme on the View tab, after Zoom', () => {
    const groups = groupsFor(collect(SLIDES_MODULES).ribbon, 'view', ctx);
    const ids = groups.map((g) => g.id);
    expect(ids.indexOf('view.appearance')).toBeGreaterThan(ids.indexOf('view.zoom'));
    const menu = groups.find((g) => g.id === 'view.appearance')!.items[0] as MenuItem<SlidesContext>;
    expect(menu.entries.map((e) => e.label)).toEqual(['System', 'Light', 'Dark']);
    menu.entries[1]!.run(ctx);
    expect(appearanceState()).toEqual({ appearance: 'light', theme: 'light' });
  });

  it('has the commands', () => {
    expect(collect(SLIDES_MODULES).commands.map((c) => c.id)).toEqual(expect.arrayContaining(['view.theme-system', 'view.theme-light', 'view.theme-dark']));
  });
});
