// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { groupsFor } from '../../core/shell/registry';
import { collect, problems } from './collect';
import { SHEETS_MODULES } from './index';
import { DarkCellsSwitch } from './appearance';
import { darkCellsPref, DARK_CELLS_KEY } from '../darkCells';
import type { MenuItem } from '../../core/shell/types';
import type { SheetsContext } from './types';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.body.appendChild(document.createElement('div'));
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  darkCellsPref.set(false);
  localStorage.clear();
});

describe('the Sheets appearance module', () => {
  it('shares no id with another module', () => {
    expect(problems(SHEETS_MODULES)).toEqual([]);
  });

  it('puts Theme and Dark cells on the View tab, after Zoom', () => {
    const ctx = { can: { edit: true }, source: { kind: 'cloud' } } as unknown as SheetsContext;
    const groups = groupsFor(collect(SHEETS_MODULES).ribbon, 'view', ctx);
    const ids = groups.map((g) => g.id);
    expect(ids.indexOf('view.appearance')).toBeGreaterThan(ids.indexOf('view.zoom'));
    const items = groups.find((g) => g.id === 'view.appearance')!.items;
    expect(items.map((i) => i.id)).toEqual(['view.theme', 'view.dark-cells']);
    expect((items[0] as MenuItem<SheetsContext>).entries.map((e) => e.label)).toEqual(['System', 'Light', 'Dark']);
  });

  it('has the command for it', () => {
    expect(collect(SHEETS_MODULES).commands.map((c) => c.id)).toEqual(expect.arrayContaining(['view.dark-cells', 'view.theme-dark']));
  });
});

describe('Dark cells', () => {
  it('is off until it is asked for, and is a button that says so', () => {
    act(() => root.render(<DarkCellsSwitch />));
    const b = host.querySelector('button')!;
    expect(b.getAttribute('aria-pressed')).toBe('false');
    expect(b.textContent).toBe('Dark cells');
  });

  it('turns on and off from the button, and is kept for this reader', () => {
    act(() => root.render(<DarkCellsSwitch />));
    const b = () => host.querySelector('button')!;
    act(() => b().click());
    expect(b().getAttribute('aria-pressed')).toBe('true');
    expect(localStorage.getItem(DARK_CELLS_KEY)).toBe('on');
    act(() => b().click());
    expect(b().getAttribute('aria-pressed')).toBe('false');
    expect(localStorage.getItem(DARK_CELLS_KEY)).toBe('off');
  });

  it('follows the command, which changes the same choice', () => {
    act(() => root.render(<DarkCellsSwitch />));
    const cmd = collect(SHEETS_MODULES).commands.find((c) => c.id === 'view.dark-cells')!;
    act(() => cmd.run(null as unknown as SheetsContext));
    expect(host.querySelector('button')!.getAttribute('aria-pressed')).toBe('true');
  });
});
