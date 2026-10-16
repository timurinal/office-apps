// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { appearanceState, setAppearance } from './appearance';
import { appearanceCommands, appearanceGroup } from './appearanceRibbon';
import type { MenuItem } from './shell/types';

afterEach(() => {
  setAppearance('system');
  localStorage.clear();
});

const menu = () => appearanceGroup<null>(300).items[0] as MenuItem<null>;

describe('the Theme menu', () => {
  it('sits on the View tab at the slot it is given, and offers the three choices', () => {
    const g = appearanceGroup<null>(300);
    expect(g.tab).toBe('view');
    expect(g.order).toBe(300);
    expect(menu().entries.map((e) => e.label)).toEqual(['System', 'Light', 'Dark']);
  });

  it('ticks the choice that is made, read when the menu opens', () => {
    const on = () => menu().entries.filter((e) => e.active?.(null)).map((e) => e.label);
    expect(on()).toEqual(['System']);
    menu().entries[2]!.run(null);
    expect(on()).toEqual(['Dark']);
    expect(appearanceState().theme).toBe('dark');
  });

  it('is also three commands for the Ctrl+K box', () => {
    const cmds = appearanceCommands<null>();
    cmds.find((c) => c.id === 'view.theme-light')!.run(null);
    expect(appearanceState()).toEqual({ appearance: 'light', theme: 'light' });
    expect(cmds.map((c) => c.section)).toEqual(['View', 'View', 'View']);
  });
});
