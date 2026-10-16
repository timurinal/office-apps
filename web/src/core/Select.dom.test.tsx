// @vitest-environment happy-dom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Select, type SelectOption } from './controls';
import { Popover } from './ui';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const OPTIONS: SelectOption[] = [
  { value: 'apple', label: 'Apple' },
  { value: 'banana', label: 'Banana' },
  { value: 'cherry', label: 'Cherry', disabled: true },
  { value: 'cranberry', label: 'Cranberry' },
  { value: 'date', label: 'Date' }
];

let host: HTMLDivElement;
let root: Root;
let changes: string[];
const realMatchMedia = window.matchMedia;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  changes = [];
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.querySelectorAll('.oa-ctx-root').forEach((n) => n.remove());
  window.matchMedia = realMatchMedia;
  vi.restoreAllMocks();
});

function Harness({ initial = 'banana', options = OPTIONS, ...rest }: { initial?: string; options?: SelectOption[]; label?: string; disabled?: boolean; 'aria-label'?: string }) {
  const [value, setValue] = useState(initial);
  return (
    <Select
      label="Fruit"
      value={value}
      options={options}
      onChange={(v) => {
        changes.push(v);
        setValue(v);
      }}
      {...rest}
    />
  );
}

const mount = (props: Parameters<typeof Harness>[0] = {}) => act(() => root.render(<Harness {...props} />));
const trigger = (): HTMLButtonElement => host.querySelector<HTMLButtonElement>('button[role="combobox"]')!;
const listbox = (): HTMLElement | null => document.body.querySelector('[role="listbox"]');
const options = (): HTMLElement[] => [...(listbox()?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])];
const key = (k: string, init: KeyboardEventInit = {}, el: Element = trigger()) => {
  const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init });
  act(() => void el.dispatchEvent(e));
  return e;
};
const click = (el: Element) => act(() => (el as HTMLElement).click());
const activeLabel = (): string | undefined => {
  const id = trigger().getAttribute('aria-activedescendant');
  return id ? document.getElementById(id)?.textContent ?? undefined : undefined;
};
const wait = (ms: number) => act(async () => void (await new Promise((r) => setTimeout(r, ms))));

describe('the closed dropdown', () => {
  it('is a button that shows the value, not a native select', () => {
    mount();
    expect(host.querySelector('select')).toBeNull();
    expect(trigger().textContent).toBe('Banana');
    expect(trigger().getAttribute('aria-haspopup')).toBe('listbox');
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    expect(trigger().getAttribute('data-value')).toBe('banana');
    expect(listbox()).toBeNull();
  });

  it('is named by its label', () => {
    mount();
    const label = host.querySelector('label')!;
    expect(label.getAttribute('for')).toBe(trigger().id);
    expect(label.textContent).toBe('Fruit');
  });

  it('names its list as the button is named: by aria-label over the visible label, as the Share dialog does', () => {
    mount({ label: 'Can', 'aria-label': 'What they can do' });
    expect(trigger().getAttribute('aria-label')).toBe('What they can do');
    click(trigger());
    expect(listbox()!.getAttribute('aria-label')).toBe('What they can do');
  });

  it('names its list by the label when there is no aria-label', () => {
    mount();
    click(trigger());
    expect(listbox()!.getAttribute('aria-label')).toBe('Fruit');
  });

  it('shows nothing for a value that is not an option', () => {
    mount({ initial: 'nope' });
    expect(trigger().textContent).toBe('');
  });
});

describe('opening', () => {
  it('opens on a click, with the chosen option checked and pointed at', () => {
    mount();
    click(trigger());
    expect(trigger().getAttribute('aria-expanded')).toBe('true');
    expect(options().map((o) => o.textContent)).toEqual(['Apple', 'Banana', 'Cherry', 'Cranberry', 'Date']);
    expect(options().map((o) => o.getAttribute('aria-selected'))).toEqual(['false', 'true', 'false', 'false', 'false']);
    expect(trigger().getAttribute('aria-controls')).toBe(listbox()!.id);
    expect(activeLabel()).toBe('Banana');
  });

  it('draws in a portal on the body, so a dialog\'s overflow cannot clip it', () => {
    mount();
    click(trigger());
    expect(host.contains(listbox())).toBe(false);
    expect(listbox()!.closest('.oa-ctx-root')!.parentElement).toBe(document.body);
  });

  it('opens from the keyboard with Enter, Space and the arrows, and not when disabled', () => {
    mount();
    for (const k of ['Enter', ' ', 'ArrowDown', 'ArrowUp']) {
      key(k);
      expect(trigger().getAttribute('aria-expanded'), k).toBe('true');
      key('Escape');
    }
    mount({ disabled: true });
    key('ArrowDown');
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    expect(trigger().disabled).toBe(true);
  });

  it('scrolls the chosen option into view as it opens, and the pointed one as the keys move', () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    mount();
    click(trigger());
    expect(scroll).toHaveBeenCalledWith({ block: 'nearest' });
    expect(scroll.mock.contexts.at(-1)).toBe(options()[1]);
    key('ArrowDown');
    expect(scroll.mock.contexts.at(-1)).toBe(options()[3]);
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  });

  it('wears the app and theme of the place it came from', () => {
    const shell = document.createElement('div');
    shell.setAttribute('data-app', 'slides');
    shell.setAttribute('data-theme', 'dark');
    document.body.appendChild(shell);
    const inner = document.createElement('div');
    shell.appendChild(inner);
    const r = createRoot(inner);
    act(() => r.render(<Harness />));
    click(inner.querySelector('button[role="combobox"]')!);
    const wrap = document.body.querySelector('.oa-ctx-root')!;
    expect(wrap.getAttribute('data-app')).toBe('slides');
    expect(wrap.getAttribute('data-theme')).toBe('dark');
    act(() => r.unmount());
    shell.remove();
  });
});

describe('the keyboard in the open list', () => {
  it('moves with the arrows, Home and End, and skips a disabled option', () => {
    mount({ initial: 'apple' });
    key('ArrowDown');
    expect(activeLabel()).toBe('Apple');
    key('ArrowDown');
    expect(activeLabel()).toBe('Banana');
    key('ArrowDown');
    expect(activeLabel()).toBe('Cranberry');
    key('End');
    expect(activeLabel()).toBe('Date');
    key('ArrowDown');
    expect(activeLabel()).toBe('Date');
    key('Home');
    expect(activeLabel()).toBe('Apple');
    key('ArrowUp');
    expect(activeLabel()).toBe('Apple');
    expect(options()[0]!.getAttribute('aria-selected')).toBe('true');
  });

  it('chooses with Enter and with Space, closes, and keeps the focus on the button', () => {
    mount({ initial: 'apple' });
    trigger().focus();
    key('ArrowDown');
    key('ArrowDown');
    key('Enter');
    expect(changes).toEqual(['banana']);
    expect(trigger().textContent).toBe('Banana');
    expect(listbox()!.getAttribute('data-state')).toBe('closed');
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(trigger());
    key(' ');
    key('End');
    key(' ');
    expect(changes).toEqual(['banana', 'date']);
  });

  it('says nothing when the choice is the value it already had', () => {
    mount();
    key('Enter');
    key('Enter');
    expect(changes).toEqual([]);
  });

  it('types ahead: a letter finds the next option that starts with it, and a word narrows', () => {
    mount({ initial: 'apple' });
    key('ArrowDown');
    key('c');
    // Cherry is disabled.
    expect(activeLabel()).toBe('Cranberry');
    key('r');
    expect(activeLabel()).toBe('Cranberry');
    key('z');
    expect(activeLabel()).toBe('Cranberry');
  });

  it('opens on a letter when closed, at the first match', () => {
    mount({ initial: 'apple' });
    key('d');
    expect(trigger().getAttribute('aria-expanded')).toBe('true');
    expect(activeLabel()).toBe('Date');
  });

  it('closes on Escape, takes the key from a dialog around it, and leaves the focus on the button', () => {
    mount();
    trigger().focus();
    const outside = vi.fn();
    key('ArrowDown');
    document.addEventListener('keydown', outside);
    const esc = key('Escape');
    document.removeEventListener('keydown', outside);
    expect(esc.defaultPrevented).toBe(true);
    expect(outside).not.toHaveBeenCalled();
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(trigger());
    expect(changes).toEqual([]);
  });

  it('lets Escape through when it is closed, for whatever is around it', () => {
    mount();
    const e = key('Escape');
    expect(e.defaultPrevented).toBe(false);
  });

  it('Tab chooses what is pointed at and does not take the key', () => {
    mount({ initial: 'apple' });
    key('ArrowDown');
    key('ArrowDown');
    const tab = key('Tab');
    expect(tab.defaultPrevented).toBe(false);
    expect(changes).toEqual(['banana']);
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
  });
});

describe('the pointer', () => {
  it('chooses on a click on an option', () => {
    mount();
    click(trigger());
    click(options()[4]!);
    expect(changes).toEqual(['date']);
    expect(trigger().textContent).toBe('Date');
    expect(document.activeElement).toBe(trigger());
  });

  it('does not choose a disabled option', () => {
    mount();
    click(trigger());
    click(options()[2]!);
    expect(changes).toEqual([]);
    expect(options()[2]!.getAttribute('aria-disabled')).toBe('true');
    expect(trigger().getAttribute('aria-expanded')).toBe('true');
  });

  it('closes on a press outside, and on a click on the button again', () => {
    mount();
    click(trigger());
    act(() => void document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })));
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    click(trigger());
    expect(trigger().getAttribute('aria-expanded')).toBe('true');
    click(trigger());
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
  });

  it('stays open for a press inside the list', () => {
    mount();
    click(trigger());
    act(() => void options()[0]!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })));
    expect(trigger().getAttribute('aria-expanded')).toBe('true');
  });

  it('keeps the focus on the button when the list is pressed', () => {
    mount();
    click(trigger());
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    act(() => void options()[0]!.dispatchEvent(down));
    expect(down.defaultPrevented).toBe(true);
  });

  it('is gone from the page once it has left', async () => {
    mount();
    click(trigger());
    key('Escape');
    expect(listbox()!.getAttribute('data-state')).toBe('closed');
    await wait(180);
    expect(listbox()).toBeNull();
  });
});

describe('inside a popover that closes on a press outside it', () => {
  it('is not outside: a press on the list does not close the popover, and a press elsewhere does', () => {
    const closed = vi.fn();
    act(() =>
      root.render(
        <div className="oa-pop-wrap">
          <Popover open onClose={closed} role="dialog" label="Filter">
            <Harness />
          </Popover>
        </div>
      )
    );
    click(trigger());
    act(() => void options()[0]!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })));
    expect(closed).not.toHaveBeenCalled();
    act(() => void document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })));
    expect(closed).toHaveBeenCalledTimes(1);
  });
});

describe('where it goes', () => {
  const layout = (button: { top: number; bottom: number; left?: number; width?: number }, panel: { w: number; h: number }, viewport: { w: number; h: number }) => {
    const left = button.left ?? 40;
    const width = button.width ?? 160;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const isButton = this.getAttribute('role') === 'combobox';
      return isButton ? ({ left, right: left + width, top: button.top, bottom: button.bottom, width, height: button.bottom - button.top, x: left, y: button.top, toJSON: () => ({}) } as DOMRect) : ({ left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);
    });
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get: () => panel.h });
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get: () => panel.w });
    window.innerWidth = viewport.w;
    window.innerHeight = viewport.h;
  };
  afterEach(() => {
    delete (HTMLElement.prototype as { scrollHeight?: unknown }).scrollHeight;
    delete (HTMLElement.prototype as { offsetWidth?: unknown }).offsetWidth;
  });

  it('opens below the button when there is room', () => {
    layout({ top: 100, bottom: 132 }, { w: 160, h: 150 }, { w: 800, h: 600 });
    mount();
    click(trigger());
    const l = listbox()!;
    expect(l.style.top).toBe('136px');
    expect(l.style.left).toBe('40px');
    expect(l.style.minWidth).toBe('160px');
  });

  it('flips above the button when there is no room below', () => {
    layout({ top: 500, bottom: 532 }, { w: 160, h: 150 }, { w: 800, h: 600 });
    mount();
    click(trigger());
    expect(Number.parseFloat(listbox()!.style.top)).toBe(500 - 4 - 150);
  });

  it('stays inside the window, with a height to scroll in, when neither side has room', () => {
    layout({ top: 100, bottom: 132 }, { w: 160, h: 900 }, { w: 800, h: 300 });
    mount();
    click(trigger());
    const l = listbox()!;
    expect(Number.parseFloat(l.style.maxHeight)).toBeGreaterThan(0);
    expect(Number.parseFloat(l.style.top) + Number.parseFloat(l.style.maxHeight)).toBeLessThanOrEqual(300 - 8 + 1);
    expect(Number.parseFloat(l.style.top)).toBeGreaterThanOrEqual(8);
  });

  it('is pulled back from the right edge of the window', () => {
    layout({ top: 100, bottom: 132, left: 700, width: 90 }, { w: 200, h: 100 }, { w: 800, h: 600 });
    mount();
    click(trigger());
    expect(Number.parseFloat(listbox()!.style.left)).toBe(800 - 200 - 8);
  });
});

describe('on a phone', () => {
  it('keeps the platform\'s own select, where the main pointer is a finger', () => {
    window.matchMedia = ((q: string) => ({ matches: q.includes('coarse'), media: q, addEventListener: () => undefined, removeEventListener: () => undefined })) as unknown as typeof window.matchMedia;
    mount();
    const native = host.querySelector('select')!;
    expect(native).not.toBeNull();
    expect(host.querySelector('button[role="combobox"]')).toBeNull();
    expect(native.value).toBe('banana');
    expect([...native.options].map((o) => o.textContent)).toEqual(['Apple', 'Banana', 'Cherry', 'Cranberry', 'Date']);
    expect(native.options[2]!.disabled).toBe(true);
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(native, 'date');
      native.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(changes).toEqual(['date']);
  });
});
