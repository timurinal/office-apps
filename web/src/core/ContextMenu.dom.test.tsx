// @vitest-environment happy-dom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ContextMenu, duplicateGroupIds, joinGroups, tidy, type ContextEntry, type Point } from './ContextMenu';
import { copyIcon } from './icons';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
let api: { set: (p: Point | null) => void };
let closed: number;

function Host({ items, label = 'Cells', returnFocus, from, parentDown }: { items: readonly ContextEntry[]; label?: string; returnFocus?: () => void; from?: Element | null; parentDown?: () => void }) {
  const [at, setAt] = useState<Point | null>(null);
  api = { set: setAt };
  return (
    <div onPointerDown={parentDown} onKeyDown={parentDown}>
      <ContextMenu
        at={at}
        items={items}
        label={label}
        from={from ?? null}
        {...(returnFocus ? { returnFocus } : {})}
        onClose={() => {
          closed++;
          setAt(null);
        }}
      />
    </div>
  );
}

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  closed = 0;
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.querySelectorAll('.oa-ctx-root').forEach((n) => n.remove());
  vi.restoreAllMocks();
  delete (HTMLElement.prototype as { scrollHeight?: unknown }).scrollHeight;
  delete (HTMLElement.prototype as { offsetWidth?: unknown }).offsetWidth;
});

const wait = (ms: number) => act(async () => void (await new Promise((r) => setTimeout(r, ms))));
const open = (items: readonly ContextEntry[], props: Partial<Parameters<typeof Host>[0]> = {}, at: Point = { x: 20, y: 30 }) => {
  act(() => root.render(<Host items={items} {...props} />));
  act(() => api.set(at));
};
const menus = (): HTMLElement[] => [...document.body.querySelectorAll<HTMLElement>('[role="menu"]')];
const rows = (m: HTMLElement = menus()[0]!): HTMLButtonElement[] => [...m.children].filter((c): c is HTMLButtonElement => c.tagName === 'BUTTON');
const labels = (m?: HTMLElement): string[] => rows(m).map((r) => r.querySelector('.oa-menu-label')!.textContent!);
const row = (label: string, m?: HTMLElement): HTMLButtonElement => rows(m).find((r) => r.querySelector('.oa-menu-label')!.textContent === label)!;
const key = (k: string, init: KeyboardEventInit = {}, el: Element = document.activeElement!) => {
  const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init });
  act(() => void el.dispatchEvent(e));
  return e;
};
const click = (el: Element) => act(() => (el as HTMLElement).click());
const hover = (el: Element) => act(() => void el.dispatchEvent(new MouseEvent('pointerover', { bubbles: true })));

const ITEMS = (log: string[] = []): ContextEntry[] => [
  { label: 'Cut', icon: copyIcon, shortcut: 'Ctrl+X', onSelect: () => log.push('cut') },
  { label: 'Copy', shortcut: 'Ctrl+C', onSelect: () => log.push('copy') },
  { label: 'Paste', disabled: true, onSelect: () => log.push('paste') },
  { label: 'Delete', danger: true, separated: true, onSelect: () => log.push('delete') }
];

describe('the entries', () => {
  it('turns separated into a rule, and never leaves one first, last or doubled', () => {
    const out = tidy([{ separator: true }, { label: 'A', separated: true }, { separator: true }, { label: 'B', separated: true }, { separator: true }]);
    expect(out.map((e) => ('separator' in e ? '-' : 'label' in e ? e.label : '?'))).toEqual(['A', '-', 'B']);
  });

  it('leaves out a row whose submenu is empty', () => {
    expect(tidy([{ label: 'Sort', submenu: [] }, { label: 'Copy' }])).toEqual([{ label: 'Copy' }]);
    expect(tidy([{ label: 'Sort', submenu: [{ separator: true }] }])).toEqual([]);
  });

  it('joins groups by order with a rule between them, skipping an empty group', () => {
    const out = joinGroups([
      { id: 'b', order: 200, items: [{ label: 'B1' }, { label: 'B2' }] },
      { id: 'empty', order: 150, items: [] },
      { id: 'a', order: 100, items: [{ label: 'A' }] },
      { id: 'c', order: 200, items: [{ label: 'C' }] }
    ]);
    expect(out.map((e) => ('separator' in e ? '-' : 'label' in e ? e.label : '?'))).toEqual(['A', '-', 'B1', 'B2', '-', 'C']);
  });

  it('names a group id used twice', () => {
    expect(duplicateGroupIds([{ id: 'a', order: 1, items: [] }, { id: 'b', order: 2, items: [] }, { id: 'a', order: 3, items: [] }])).toEqual(['a']);
  });
});

describe('the menu', () => {
  it('draws its rows with their icons, shortcuts and a rule, in a portal under its own name', () => {
    open(ITEMS());
    const m = menus()[0]!;
    expect(m.getAttribute('aria-label')).toBe('Cells');
    expect(host.contains(m)).toBe(false);
    expect(m.closest('.oa-ctx-root')!.parentElement).toBe(document.body);
    expect(labels()).toEqual(['Cut', 'Copy', 'Paste', 'Delete']);
    expect(row('Cut').querySelector('svg')).not.toBeNull();
    expect(row('Cut').querySelector('kbd')!.textContent).toBe('Ctrl+X');
    expect(m.querySelectorAll('[role="separator"]')).toHaveLength(1);
    expect(m.children[3]!.getAttribute('role')).toBe('separator');
    expect(row('Delete').getAttribute('data-tone')).toBe('danger');
    expect(row('Paste').disabled).toBe(true);
  });

  it('takes the keyboard on its first row', () => {
    open(ITEMS());
    expect(document.activeElement).toBe(row('Cut'));
  });

  it('is a checkbox row where it has a tick, and shows the tick', () => {
    open([{ label: 'Filter', checked: true }, { label: 'Gridlines', checked: false }, { label: 'Plain' }]);
    expect(row('Filter').getAttribute('role')).toBe('menuitemcheckbox');
    expect(row('Filter').getAttribute('aria-checked')).toBe('true');
    expect(row('Filter').querySelector('.oa-menu-check')).not.toBeNull();
    expect(row('Gridlines').getAttribute('aria-checked')).toBe('false');
    expect(row('Gridlines').querySelector('.oa-menu-check')).toBeNull();
    expect(row('Plain').getAttribute('role')).toBe('menuitem');
  });

  it('runs a row, closes, and does not run a disabled one', () => {
    const log: string[] = [];
    open(ITEMS(log));
    click(row('Paste'));
    expect(log).toEqual([]);
    expect(closed).toBe(0);
    click(row('Copy'));
    expect(log).toEqual(['copy']);
    expect(closed).toBe(1);
  });

  it('leaves for the length of its exit, and then is gone', async () => {
    open(ITEMS());
    click(row('Copy'));
    expect(menus()[0]!.getAttribute('data-state')).toBe('closed');
    await wait(180);
    expect(menus()).toHaveLength(0);
  });

  it('holds a custom row, which can close the menu', () => {
    const log: string[] = [];
    open([
      { label: 'Rename', onSelect: () => log.push('rename') },
      {
        id: 'swatches',
        custom: ({ close }) => (
          <button type="button" id="swatch" onClick={() => (log.push('swatch'), close())}>
            Red
          </button>
        )
      }
    ]);
    click(document.getElementById('swatch')!);
    expect(log).toEqual(['swatch']);
    expect(closed).toBe(1);
  });

  it('wears the app and the theme of the element it came from', () => {
    const shell = document.createElement('div');
    shell.setAttribute('data-app', 'sheets');
    shell.setAttribute('data-theme', 'dark');
    const inner = document.createElement('span');
    shell.appendChild(inner);
    document.body.appendChild(shell);
    open(ITEMS(), { from: inner });
    const wrap = menus()[0]!.closest('.oa-ctx-root')!;
    expect(wrap.getAttribute('data-app')).toBe('sheets');
    expect(wrap.getAttribute('data-theme')).toBe('dark');
    shell.remove();
  });

  it('has no browser menu of its own, and keeps its events from the page under it', () => {
    const parentDown = vi.fn();
    open(ITEMS(), { parentDown });
    const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    act(() => void row('Cut').dispatchEvent(e));
    expect(e.defaultPrevented).toBe(true);
    act(() => void row('Cut').dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })));
    key('ArrowDown');
    expect(parentDown).not.toHaveBeenCalled();
  });
});

describe('the keyboard', () => {
  it('moves with the arrows, wrapping, over the rows that can be chosen', () => {
    open(ITEMS());
    key('ArrowDown');
    expect(document.activeElement).toBe(row('Copy'));
    key('ArrowDown');
    // Paste is disabled.
    expect(document.activeElement).toBe(row('Delete'));
    key('ArrowDown');
    expect(document.activeElement).toBe(row('Cut'));
    key('ArrowUp');
    expect(document.activeElement).toBe(row('Delete'));
    key('Home');
    expect(document.activeElement).toBe(row('Cut'));
    key('End');
    expect(document.activeElement).toBe(row('Delete'));
  });

  it('keeps Tab inside: it moves on, and never takes the key', () => {
    open(ITEMS());
    const tab = key('Tab');
    expect(tab.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(row('Copy'));
    key('Tab', { shiftKey: true });
    expect(document.activeElement).toBe(row('Cut'));
    key('Tab', { shiftKey: true });
    expect(document.activeElement).toBe(row('Delete'));
  });

  it('types ahead to a row', () => {
    open([{ label: 'Insert' }, { label: 'Delete' }, { label: 'Sort' }, { label: 'Filter' }]);
    key('s');
    expect(document.activeElement).toBe(row('Sort'));
    // A pause is not needed to start a new word with a different first letter once it is time again.
    key('o');
    expect(document.activeElement).toBe(row('Sort'));
  });

  it('closes on Escape, and the keyboard goes back to where it was', () => {
    const before = document.createElement('button');
    document.body.appendChild(before);
    before.focus();
    open(ITEMS());
    expect(document.activeElement).toBe(row('Cut'));
    const e = key('Escape');
    expect(e.defaultPrevented).toBe(true);
    expect(closed).toBe(1);
    expect(document.activeElement).toBe(before);
    before.remove();
  });

  it('gives the keyboard to returnFocus instead when it is given one, after a choice', () => {
    const back = vi.fn();
    const before = document.createElement('button');
    document.body.appendChild(before);
    before.focus();
    open(ITEMS(), { returnFocus: back });
    click(row('Copy'));
    expect(back).toHaveBeenCalledTimes(1);
    expect(document.activeElement).not.toBe(before);
    before.remove();
  });

  it('closes on Escape even when the keyboard is somewhere else', () => {
    open(ITEMS());
    (document.activeElement as HTMLElement).blur();
    key('Escape', {}, document.body);
    expect(closed).toBe(1);
  });

  it('puts the keyboard back before a chosen row runs, so a row that moves it keeps what it did', () => {
    const before = document.createElement('button');
    document.body.appendChild(before);
    const target = document.createElement('input');
    document.body.appendChild(target);
    before.focus();
    open([{ label: 'Edit text', onSelect: () => target.focus() }]);
    click(row('Edit text'));
    expect(document.activeElement).toBe(target);
    before.remove();
    target.remove();
  });
});

describe('submenus', () => {
  const withSub = (log: string[] = []): ContextEntry[] => [
    { label: 'Copy', onSelect: () => log.push('copy') },
    { label: 'Insert', submenu: [{ label: 'Rows above', onSelect: () => log.push('above') }, { label: 'Rows below', onSelect: () => log.push('below') }, { label: 'Columns', submenu: [{ label: 'Left', onSelect: () => log.push('left') }] }] },
    { label: 'Clear' }
  ];

  it('marks the row with a ▸ and says so to a screen reader', () => {
    open(withSub());
    const r = row('Insert');
    expect(r.getAttribute('aria-haspopup')).toBe('menu');
    expect(r.getAttribute('aria-expanded')).toBe('false');
    expect(r.querySelector('.oa-menu-sub')).not.toBeNull();
    expect(menus()).toHaveLength(1);
  });

  it('opens on hover, beside the row, without taking the keyboard', () => {
    open(withSub());
    hover(row('Insert'));
    expect(menus()).toHaveLength(2);
    expect(menus()[1]!.getAttribute('aria-label')).toBe('Insert');
    expect(labels(menus()[1])).toEqual(['Rows above', 'Rows below', 'Columns']);
    expect(row('Insert').getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(row('Copy'));
  });

  it('opens on Right with the keyboard on its first row, and Left closes it and goes back to the row', () => {
    open(withSub());
    key('ArrowDown');
    expect(document.activeElement).toBe(row('Insert'));
    key('ArrowRight');
    expect(menus()).toHaveLength(2);
    expect(document.activeElement).toBe(row('Rows above', menus()[1]));
    key('ArrowLeft');
    expect(menus()).toHaveLength(1);
    expect(document.activeElement).toBe(row('Insert'));
    expect(closed).toBe(0);
  });

  it('closes a submenu on Escape and leaves the menu open; the next Escape closes the menu', () => {
    open(withSub());
    key('ArrowDown');
    key('ArrowRight');
    key('Escape');
    expect(menus()).toHaveLength(1);
    expect(closed).toBe(0);
    expect(document.activeElement).toBe(row('Insert'));
    key('Escape');
    expect(closed).toBe(1);
  });

  it('opens on a click, and a click does not close the menu', () => {
    open(withSub());
    click(row('Insert'));
    expect(menus()).toHaveLength(2);
    expect(closed).toBe(0);
    expect(document.activeElement).toBe(row('Rows above', menus()[1]));
  });

  it('runs a row of the submenu and closes the whole menu', () => {
    const log: string[] = [];
    open(withSub(log));
    hover(row('Insert'));
    click(row('Rows below', menus()[1]));
    expect(log).toEqual(['below']);
    expect(closed).toBe(1);
  });

  it('nests: a submenu has submenus', () => {
    open(withSub());
    key('ArrowDown');
    key('ArrowRight');
    key('ArrowDown');
    key('ArrowDown');
    key('ArrowRight');
    expect(menus()).toHaveLength(3);
    expect(labels(menus()[2])).toEqual(['Left']);
    key('ArrowLeft');
    expect(menus()).toHaveLength(2);
    expect(document.activeElement).toBe(row('Columns', menus()[1]));
  });

  it('closes when the pointer goes to a row with none, after a moment, unless it is on the submenu', async () => {
    open(withSub());
    hover(row('Insert'));
    hover(row('Clear'));
    expect(menus()).toHaveLength(2);
    await wait(200);
    expect(menus()).toHaveLength(1);
    hover(row('Insert'));
    hover(row('Clear'));
    hover(rows(menus()[1])[0]!);
    // The pointer reached the submenu in time.
    act(() => void menus()[1]!.dispatchEvent(new MouseEvent('pointerover', { bubbles: true })));
    await wait(200);
    expect(menus()).toHaveLength(2);
  });

  it('closes when the keyboard moves to another row', () => {
    open(withSub());
    hover(row('Insert'));
    key('ArrowDown');
    expect(menus()).toHaveLength(1);
  });

  it('does not open from a disabled row', () => {
    open([{ label: 'Sort', disabled: true, submenu: [{ label: 'A to Z' }] }, { label: 'Other' }]);
    hover(row('Sort'));
    expect(menus()).toHaveLength(1);
  });
});

describe('where it goes', () => {
  const size = (w: number, h: number, vw: number, vh: number) => {
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get: () => h });
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get: () => w });
    window.innerWidth = vw;
    window.innerHeight = vh;
  };

  it('opens at the pointer', () => {
    size(200, 150, 1000, 800);
    open(ITEMS(), {}, { x: 120, y: 90 });
    expect(menus()[0]!.style.left).toBe('120px');
    expect(menus()[0]!.style.top).toBe('90px');
  });

  it('flips up and to the left where there is no room', () => {
    size(200, 150, 1000, 800);
    open(ITEMS(), {}, { x: 900, y: 750 });
    expect(menus()[0]!.style.left).toBe('700px');
    expect(menus()[0]!.style.top).toBe('600px');
  });

  it('takes a height to scroll in when the window is shorter than the menu', () => {
    size(200, 900, 1000, 400);
    open(ITEMS(), {}, { x: 100, y: 100 });
    expect(menus()[0]!.style.top).toBe('8px');
    expect(menus()[0]!.style.maxHeight).toBe('384px');
  });

  it('puts a submenu to the right of its row, and to the left where the right is full', () => {
    size(180, 120, 1000, 800);
    const rect = (left: number) => ({ left, right: left + 180, top: 200, bottom: 232, width: 180, height: 32, x: left, y: 200, toJSON: () => ({}) }) as DOMRect;
    const spy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect');
    const items: ContextEntry[] = [{ label: 'Copy' }, { label: 'Insert', submenu: [{ label: 'Above' }] }];
    spy.mockImplementation(() => rect(100));
    open(items, {}, { x: 100, y: 100 });
    hover(row('Insert'));
    expect(menus()[1]!.style.left).toBe('276px');
    expect(menus()[1]!.style.top).toBe('194px');
    act(() => api.set(null));
    spy.mockImplementation(() => rect(780));
    open(items, {}, { x: 700, y: 100 });
    // A new menu: the old one is leaving.
    const fresh = menus().filter((m) => m.getAttribute('data-state') === 'open');
    hover(row('Insert', fresh[0]));
    const subs = menus().filter((m) => m.getAttribute('aria-label') === 'Insert' && m.getAttribute('data-state') === 'open');
    expect(subs.at(-1)!.style.left).toBe('604px');
  });
});

describe('closing', () => {
  it('goes on a press outside, and takes no focus', () => {
    const before = document.createElement('button');
    document.body.appendChild(before);
    before.focus();
    open(ITEMS());
    const elsewhere = document.createElement('input');
    document.body.appendChild(elsewhere);
    elsewhere.focus();
    act(() => void elsewhere.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })));
    expect(closed).toBe(1);
    expect(document.activeElement).toBe(elsewhere);
    before.remove();
    elsewhere.remove();
  });

  it('stays for a press inside', () => {
    open(ITEMS());
    act(() => void row('Cut').dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })));
    expect(closed).toBe(0);
  });

  it('goes on a scroll outside it, but not on one in it, and on a resize and a blur', () => {
    open(ITEMS());
    act(() => void menus()[0]!.dispatchEvent(new WheelEvent('wheel', { bubbles: true })));
    expect(closed).toBe(0);
    act(() => void host.dispatchEvent(new WheelEvent('wheel', { bubbles: true })));
    expect(closed).toBe(1);
    open(ITEMS());
    act(() => void window.dispatchEvent(new Event('resize')));
    expect(closed).toBe(2);
    open(ITEMS());
    act(() => void window.dispatchEvent(new Event('blur')));
    expect(closed).toBe(3);
  });
});

describe('opening again', () => {
  it('is a new menu: it takes the keyboard on its first row, while the last is still leaving', () => {
    open(ITEMS());
    key('ArrowDown');
    expect(document.activeElement).toBe(row('Copy'));
    act(() => api.set(null));
    act(() => api.set({ x: 200, y: 200 }));
    const live = menus().filter((m) => m.getAttribute('data-state') === 'open');
    expect(live).toHaveLength(1);
    expect(document.activeElement).toBe(row('Cut', live[0]));
  });
});
