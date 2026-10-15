// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { reorderTo, SheetTabs, type SheetTab, type SheetTabsProps } from './SheetTabs';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SHEETS: SheetTab[] = [
  { id: 'a', name: 'Summary' },
  { id: 'b', name: 'Costs', color: '#d64545' },
  { id: 'c', name: 'Headcount' },
  { id: 'h', name: 'Archive', hidden: true }
];

let host: HTMLDivElement;
let root: Root;
const calls: string[] = [];

function props(over: Partial<SheetTabsProps> = {}): SheetTabsProps {
  const log = (name: string) => (...a: unknown[]) => calls.push(`${name}:${a.join(',')}`);
  return {
    sheets: SHEETS,
    active: 'a',
    onSelect: log('select'),
    onAdd: log('add'),
    onRename: log('rename'),
    onDelete: log('delete'),
    onDuplicate: log('duplicate'),
    onColor: log('color'),
    onHide: log('hide'),
    onUnhide: log('unhide'),
    onReorder: log('reorder'),
    ...over
  };
}

function mount(over: Partial<SheetTabsProps> = {}) {
  act(() => root.render(<SheetTabs {...props(over)} />));
}

const tab = (name: string) => [...host.querySelectorAll<HTMLElement>('[role="tab"]')].find((t) => t.textContent === name)!;
const button = (label: string) => host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
const key = (el: Element, k: string, init: KeyboardEventInit = {}) => act(() => void el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init })));
const click = (el: Element) => act(() => void el.dispatchEvent(new MouseEvent('click', { bubbles: true })));

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  calls.length = 0;
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('the tabs', () => {
  it('draws the visible sheets, the active one selected and the only one in the tab order', () => {
    mount();
    expect([...host.querySelectorAll('[role="tab"]')].map((t) => t.textContent)).toEqual(['Summary', 'Costs', 'Headcount']);
    expect(tab('Summary').getAttribute('aria-selected')).toBe('true');
    expect(tab('Costs').getAttribute('aria-selected')).toBe('false');
    expect(tab('Summary').tabIndex).toBe(0);
    expect(tab('Costs').tabIndex).toBe(-1);
    expect(host.querySelector('[role="tablist"]')!.getAttribute('aria-label')).toBe('Sheets');
  });

  it('names a tab\'s colour for the underline', () => {
    mount();
    expect(tab('Costs').getAttribute('data-colored')).toBe('true');
    expect(tab('Costs').style.getPropertyValue('--tab-color')).toBe('#d64545');
    expect(tab('Headcount').getAttribute('data-colored')).toBeNull();
  });

  it('chooses a sheet on a press, once, and not the one that is showing', () => {
    mount();
    click(tab('Costs'));
    click(tab('Summary'));
    expect(calls).toEqual(['select:b']);
  });

  it('adds a sheet with the plus', () => {
    mount();
    click(button('New sheet'));
    expect(calls).toEqual(['add:']);
  });

  it('steps with the arrows, and disables them at the ends', () => {
    mount({ active: 'a' });
    expect(button('Previous sheet').disabled).toBe(true);
    click(button('Next sheet'));
    expect(calls).toEqual(['select:b']);
    mount({ active: 'c' });
    expect(button('Next sheet').disabled).toBe(true);
    click(button('Previous sheet'));
    expect(calls).toContain('select:b');
  });

  it('skips a hidden sheet when stepping', () => {
    mount({ active: 'c' });
    expect(button('Next sheet').disabled).toBe(true);
  });
});

describe('the keyboard', () => {
  it('Right and Left move between tabs and choose, Home and End go to the ends', () => {
    mount({ active: 'b' });
    key(tab('Costs'), 'ArrowRight');
    key(tab('Costs'), 'ArrowLeft');
    key(tab('Costs'), 'Home');
    key(tab('Costs'), 'End');
    expect(calls).toEqual(['select:c', 'select:a', 'select:a', 'select:c']);
  });

  it('F2 renames, Enter commits the new name, Escape leaves it', () => {
    mount();
    key(tab('Summary'), 'F2');
    const input = host.querySelector<HTMLInputElement>('input[aria-label="Sheet name"]')!;
    expect(input.value).toBe('Summary');
    act(() => {
      input.value = 'Totals';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    key(input, 'Enter');
    expect(calls).toEqual(['rename:a,Totals']);
    // Optimistic: the new name shows before the model has answered.
    expect(tab('Totals')).toBeTruthy();

    calls.length = 0;
    key(tab('Totals'), 'F2');
    const again = host.querySelector<HTMLInputElement>('input[aria-label="Sheet name"]')!;
    act(() => {
      again.value = 'Nope';
      again.dispatchEvent(new Event('input', { bubbles: true }));
    });
    key(again, 'Escape');
    expect(calls).toEqual([]);
    expect(host.querySelector('input')).toBeNull();
  });

  it('a double click renames, and an empty or unchanged name is not sent', () => {
    mount();
    act(() => void tab('Costs').dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
    const input = host.querySelector<HTMLInputElement>('input[aria-label="Sheet name"]')!;
    expect(input.value).toBe('Costs');
    key(input, 'Enter');
    expect(calls).toEqual([]);
    act(() => void tab('Costs').dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
    const second = host.querySelector<HTMLInputElement>('input[aria-label="Sheet name"]')!;
    act(() => {
      second.value = '   ';
      second.dispatchEvent(new Event('input', { bubbles: true }));
    });
    key(second, 'Enter');
    expect(calls).toEqual([]);
  });

  it('limits a name to what a workbook can hold', () => {
    mount();
    key(tab('Summary'), 'F2');
    expect(host.querySelector<HTMLInputElement>('input')!.maxLength).toBe(31);
  });
});

describe('the menu', () => {
  const open = (name: string) => key(tab(name), 'F10', { shiftKey: true });
  const item = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((b) => b.textContent?.includes(label))!;

  it('opens with Shift+F10 and the menu key, and lists what can be done to a sheet', () => {
    mount();
    open('Costs');
    expect(document.querySelector('[role="menu"]')).toBeTruthy();
    expect([...document.querySelectorAll('[role="menuitem"]')].map((b) => b.textContent!.replace(/F2$/, ''))).toEqual(['Rename', 'Duplicate', 'Hide', 'Delete', 'Show Archive']);
  });

  it('duplicates, hides, deletes and shows a hidden sheet', () => {
    mount();
    for (const [label, expected] of [
      ['Duplicate', 'duplicate:b'],
      ['Hide', 'hide:b'],
      ['Delete', 'delete:b'],
      ['Show Archive', 'unhide:h']
    ] as const) {
      open('Costs');
      click(item(label));
      expect(calls.at(-1)).toBe(expected);
    }
  });

  it('chooses a colour, or none', () => {
    mount();
    open('Headcount');
    click(document.querySelector('[role="radio"][aria-label="#43a873"]')!);
    expect(calls).toEqual(['color:c,#43a873']);
    open('Costs');
    click(document.querySelector('[role="radio"][aria-label="No colour"]')!);
    expect(calls.at(-1)).toBe('color:b,');
  });

  it('renames from the menu', () => {
    mount();
    open('Costs');
    click(item('Rename'));
    expect(host.querySelector('input[aria-label="Sheet name"]')).toBeTruthy();
  });

  it('will not hide or delete the last sheet', () => {
    mount({ sheets: [{ id: 'a', name: 'Only' }] });
    open('Only');
    expect(item('Hide').disabled).toBe(true);
    expect(item('Delete').disabled).toBe(true);
  });
});

describe('read only', () => {
  it('can choose a sheet and nothing else', () => {
    mount({ readOnly: true });
    expect(button('New sheet').disabled).toBe(true);
    key(tab('Summary'), 'F2');
    expect(host.querySelector('input')).toBeNull();
    key(tab('Summary'), 'F10', { shiftKey: true });
    expect(document.querySelector('[role="menu"]')).toBeNull();
    click(tab('Costs'));
    expect(calls).toEqual(['select:b']);
  });
});

describe('dragging a tab', () => {
  /** Three tabs, 100px wide, with the layout a browser would give them. */
  function layoutTabs() {
    ['Summary', 'Costs', 'Headcount'].forEach((name, i) => {
      const el = tab(name);
      Object.defineProperty(el, 'offsetLeft', { value: i * 100, configurable: true });
      Object.defineProperty(el, 'offsetWidth', { value: 100, configurable: true });
      el.getBoundingClientRect = () => ({ left: i * 100, top: 0, right: i * 100 + 100, bottom: 30, width: 100, height: 30, x: i * 100, y: 0, toJSON: () => ({}) });
    });
    const list = host.querySelector<HTMLElement>('[role="tablist"]')!;
    list.getBoundingClientRect = () => ({ left: 0, top: 0, right: 300, bottom: 30, width: 300, height: 30, x: 0, y: 0, toJSON: () => ({}) });
  }
  const pointer = (el: Element, type: string, x: number) => act(() => void el.dispatchEvent(new MouseEvent(type, { clientX: x, button: 0, bubbles: true })));

  it('asks for the sheet to move to the slot it was dropped in, counting the hidden ones', () => {
    mount();
    layoutTabs();
    const a = tab('Summary');
    pointer(a, 'pointerdown', 50);
    pointer(a, 'pointermove', 120);
    pointer(a, 'pointermove', 260);
    expect([...host.querySelectorAll('[role="tab"]')].map((t) => t.textContent)).toEqual(['Costs', 'Headcount', 'Summary']);
    pointer(a, 'pointerup', 260);
    // Summary was first; with Archive hidden at the end it lands before it: index 2 of [b, c, a, h].
    expect(calls).toEqual(['reorder:a,2']);
  });

  it('is not a drag, and not a choice, for a press that barely moved', () => {
    mount({ active: 'b' });
    layoutTabs();
    const a = tab('Summary');
    pointer(a, 'pointerdown', 50);
    pointer(a, 'pointermove', 52);
    pointer(a, 'pointerup', 52);
    expect(calls).toEqual([]);
  });

  it('puts the tab back where it was if it is dropped there', () => {
    mount();
    layoutTabs();
    const b = tab('Costs');
    pointer(b, 'pointerdown', 150);
    pointer(b, 'pointermove', 200);
    pointer(b, 'pointermove', 150);
    pointer(b, 'pointerup', 150);
    expect(calls).toEqual([]);
  });
});

describe('where a dragged sheet lands in the whole list', () => {
  const all = ['a', 'b', 'h', 'c', 'd'];

  it('is before the visible sheet that now follows it', () => {
    expect(reorderTo(all, 'a', ['b', 'a', 'c', 'd'])).toBe(2);
    expect(reorderTo(all, 'd', ['d', 'a', 'b', 'c'])).toBe(0);
  });

  it('is after the last visible one when it is dropped at the end', () => {
    expect(reorderTo(all, 'a', ['b', 'c', 'd', 'a'])).toBe(4);
  });

  it('leaves hidden sheets where they were', () => {
    // Moving c before b: the hidden sheet stays after b.
    expect(reorderTo(all, 'c', ['a', 'c', 'b', 'd'])).toBe(1);
    expect(vi.isMockFunction(reorderTo)).toBe(false);
  });
});
