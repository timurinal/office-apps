// @vitest-environment happy-dom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Popover } from '../ui';
import { FileMenu } from './FileMenu';
import type { FileItem } from './types';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * The File menu as the ribbon draws it: a tab, and a popover that closes on any click inside it.
 * The menu's rows are real, and so is the popover, so what is asked here is how the two work together.
 */

let host: HTMLDivElement;
let root: Root;
const log: string[] = [];

type Ctx = { off?: boolean };

const items = (): FileItem<Ctx>[] => [
  { id: 'rename', label: 'Rename', section: 'Document', order: 100, shortcut: 'F2', run: () => void log.push('rename') },
  {
    id: 'copy',
    label: 'Download a copy',
    section: 'Export',
    order: 610,
    run: () => void log.push('WRONG: the row itself ran'),
    submenu: [
      { id: 'docx', label: 'Document (.docx)', run: () => void log.push('docx') },
      { id: 'md', label: 'Markdown (.md)', run: () => void log.push('md') },
      { id: 'html', label: 'Web page (.html)', run: () => void log.push('html'), disabled: (c) => !!c.off }
    ]
  },
  { id: 'trash', label: 'Move to trash', section: 'Danger', order: 900, danger: true, run: () => void log.push('trash') }
];

function Ribbon({ rows, ctx = {}, wrap }: { rows: FileItem<Ctx>[]; ctx?: Ctx; wrap?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div onPointerDown={wrap} data-app="slides" data-theme="dark" className="oa-shell">
      <span className="oa-pop-wrap">
        <button type="button" id="file-tab" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          File
        </button>
        <Popover open={open} onClose={() => setOpen(false)} role="menu" label="File" className="oa-file-menu">
          <div onClick={() => setOpen(false)}>
            <FileMenu items={rows} ctx={ctx} />
          </div>
        </Popover>
      </span>
    </div>
  );
}

beforeEach(() => {
  host = document.body.appendChild(document.createElement('div'));
  root = createRoot(host);
  log.length = 0;
  // As a browser has it: a row in a panel that is still hidden for its first frame takes no keyboard.
  const focus = HTMLElement.prototype.focus;
  vi.spyOn(HTMLElement.prototype, 'focus').mockImplementation(function (this: HTMLElement, options?: FocusOptions) {
    if (this.closest<HTMLElement>('[role="menu"]')?.style.visibility === 'hidden') return;
    focus.call(this, options);
  });
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
const tab = () => document.getElementById('file-tab') as HTMLButtonElement;
const popover = () => document.body.querySelector<HTMLElement>('.oa-popover');
/** The popover is gone once its exit is over. */
const gone = async () => {
  await wait(200);
  return popover() === null;
};
const menus = (): HTMLElement[] => [...document.body.querySelectorAll<HTMLElement>('[role="menu"]')].filter((m) => m.getAttribute('aria-label') !== 'File');
const rowOf = (label: string): HTMLButtonElement => [...host.querySelectorAll<HTMLButtonElement>('button[data-file-row]')].find((b) => b.textContent!.includes(label))!;
const choice = (label: string): HTMLButtonElement => [...menus()[0]!.querySelectorAll<HTMLButtonElement>('button[data-row]')].find((b) => b.textContent!.includes(label))!;
const key = (k: string, init: KeyboardEventInit = {}, el: Element = document.activeElement!) => {
  const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init });
  act(() => void el.dispatchEvent(e));
  return e;
};
/** What a browser does with Enter or Space on a button that has the keyboard. */
const activate = () => act(() => (document.activeElement as HTMLElement).click());
const click = (el: Element) => act(() => (el as HTMLElement).click());
const hover = (el: Element) => act(() => void el.dispatchEvent(new MouseEvent('pointerover', { bubbles: true })));

/** Opened as a keyboard opens it: the tab has the keyboard when the menu appears. */
function openWithKeyboard(rows = items(), ctx: Ctx = {}, wrap?: () => void) {
  act(() => root.render(<Ribbon rows={rows} ctx={ctx} wrap={wrap} />));
  act(() => tab().focus());
  click(tab());
}

describe('the rows', () => {
  it('draws its sections, and a ▸ and an expanded state on the row that has a submenu', () => {
    openWithKeyboard();
    expect([...host.querySelectorAll('button[data-file-row] .oa-menu-label')].map((l) => l.textContent)).toEqual(['Rename', 'Download a copy', 'Move to trash']);
    expect(rowOf('Rename').querySelector('kbd')!.textContent).toBe('F2');
    const r = rowOf('Download a copy');
    expect(r.getAttribute('aria-haspopup')).toBe('menu');
    expect(r.getAttribute('aria-expanded')).toBe('false');
    expect(r.querySelector('.oa-menu-sub')).not.toBeNull();
    expect(rowOf('Rename').getAttribute('aria-haspopup')).toBeNull();
    expect(menus()).toHaveLength(0);
  });

  it('runs a row that has none, and closes', async () => {
    openWithKeyboard();
    click(rowOf('Rename'));
    expect(log).toEqual(['rename']);
    expect(await gone()).toBe(true);
  });
});

describe('by keyboard', () => {
  it('takes the keyboard on its first row when it was opened with the keyboard, and walks the rows with the arrows', () => {
    openWithKeyboard();
    expect(document.activeElement).toBe(rowOf('Rename'));
    key('ArrowDown');
    expect(document.activeElement).toBe(rowOf('Download a copy'));
    key('ArrowDown');
    expect(document.activeElement).toBe(rowOf('Move to trash'));
    key('ArrowDown');
    expect(document.activeElement).toBe(rowOf('Rename'));
    key('ArrowUp');
    expect(document.activeElement).toBe(rowOf('Move to trash'));
    key('Home');
    expect(document.activeElement).toBe(rowOf('Rename'));
    key('End');
    expect(document.activeElement).toBe(rowOf('Move to trash'));
  });

  it('opens a submenu on Right with the keyboard on its first choice, and Left closes it and goes back to the row', () => {
    openWithKeyboard();
    key('ArrowDown');
    key('ArrowRight');
    expect(menus()).toHaveLength(1);
    expect(menus()[0]!.getAttribute('aria-label')).toBe('Download a copy');
    expect([...menus()[0]!.querySelectorAll('.oa-menu-label')].map((l) => l.textContent)).toEqual(['Document (.docx)', 'Markdown (.md)', 'Web page (.html)']);
    expect(document.activeElement).toBe(choice('Document'));
    expect(rowOf('Download a copy').getAttribute('aria-expanded')).toBe('true');
    key('ArrowDown');
    expect(document.activeElement).toBe(choice('Markdown'));
    key('ArrowLeft');
    expect(menus()).toHaveLength(0);
    expect(document.activeElement).toBe(rowOf('Download a copy'));
    expect(popover()).not.toBeNull();
  });

  it('opens a submenu on Enter too, and a letter key does nothing to a row without one', () => {
    openWithKeyboard();
    key('Enter');
    expect(menus()).toHaveLength(0);
    expect(log).toEqual([]);
    key('ArrowDown');
    const e = key('Enter');
    expect(e.defaultPrevented).toBe(true);
    expect(menus()).toHaveLength(1);
    expect(document.activeElement).toBe(choice('Document'));
  });

  it('closes a submenu on Escape and leaves the menu open; the next Escape closes the menu and the keyboard goes back to the tab', async () => {
    openWithKeyboard();
    key('ArrowDown');
    key('ArrowRight');
    key('Escape');
    expect(menus()).toHaveLength(0);
    expect(document.activeElement).toBe(rowOf('Download a copy'));
    expect(popover()!.getAttribute('data-state')).toBe('open');
    key('Escape');
    expect(document.activeElement).toBe(tab());
    expect(await gone()).toBe(true);
  });

  it('chooses with Enter: the choice runs, the whole menu closes, and the keyboard is on the tab before it runs', async () => {
    let at: Element | null = null;
    const rows = items();
    rows[1]!.submenu = [{ id: 'md', label: 'Markdown (.md)', run: () => void (at = document.activeElement) }];
    openWithKeyboard(rows);
    key('ArrowDown');
    key('ArrowRight');
    activate();
    expect(at).toBe(tab());
    expect(menus()).toHaveLength(0);
    expect(await gone()).toBe(true);
    expect(document.activeElement).toBe(tab());
  });

  it('does not take the keyboard when the menu was opened by the pointer on a tab that has no focus', () => {
    act(() => root.render(<Ribbon rows={items()} />));
    click(tab());
    expect(document.activeElement).not.toBe(rowOf('Rename'));
  });

  it('does not open from a disabled row', () => {
    const rows = items();
    rows[1]!.disabled = () => true;
    openWithKeyboard(rows);
    expect(rowOf('Download a copy').disabled).toBe(true);
    hover(rowOf('Download a copy'));
    click(rowOf('Download a copy'));
    expect(menus()).toHaveLength(0);
  });

  it('shows a choice that is disabled, and does not run it', () => {
    openWithKeyboard(items(), { off: true });
    key('ArrowDown');
    key('ArrowRight');
    expect(choice('Web page').disabled).toBe(true);
    click(choice('Web page'));
    expect(log).toEqual([]);
    expect(popover()!.getAttribute('data-state')).toBe('open');
  });
});

describe('by pointer', () => {
  it('opens on hover beside the row, without taking the keyboard', () => {
    openWithKeyboard();
    hover(rowOf('Download a copy'));
    expect(menus()).toHaveLength(1);
    expect(document.activeElement).toBe(rowOf('Rename'));
    expect(rowOf('Download a copy').getAttribute('aria-expanded')).toBe('true');
  });

  it('opens on a tap, and a tap does not close the menu or run the row', () => {
    openWithKeyboard();
    click(rowOf('Download a copy'));
    expect(menus()).toHaveLength(1);
    expect(popover()!.getAttribute('data-state')).toBe('open');
    expect(log).toEqual([]);
    expect(document.activeElement).toBe(choice('Document'));
  });

  it('does not open on a finger touching the row, only on its tap, so the tap’s own click is not taken by the submenu', () => {
    openWithKeyboard();
    act(() => void rowOf('Download a copy').dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType: 'touch' })));
    expect(menus()).toHaveLength(0);
    click(rowOf('Download a copy'));
    expect(menus()).toHaveLength(1);
    expect(log).toEqual([]);
  });

  it('runs a choice and closes the whole menu', async () => {
    openWithKeyboard();
    hover(rowOf('Download a copy'));
    click(choice('Markdown'));
    expect(log).toEqual(['md']);
    expect(menus()).toHaveLength(0);
    expect(await gone()).toBe(true);
  });

  it('stays open for a click on the submenu’s own edge, and goes for a click on a choice', async () => {
    openWithKeyboard();
    hover(rowOf('Download a copy'));
    click(menus()[0]!);
    expect(popover()!.getAttribute('data-state')).toBe('open');
    expect(menus()).toHaveLength(1);
    click(choice('Markdown'));
    expect(await gone()).toBe(true);
  });

  it('is not outside the menu when it is pressed in the submenu', () => {
    const pressed = vi.fn();
    openWithKeyboard(items(), {}, pressed);
    hover(rowOf('Download a copy'));
    act(() => void choice('Markdown').dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })));
    expect(popover()!.getAttribute('data-state')).toBe('open');
    expect(menus()).toHaveLength(1);
    // The popover's own sibling handlers do not hear it either.
    expect(pressed).not.toHaveBeenCalled();
  });

  it('goes on a press outside, and takes the submenu with it', async () => {
    openWithKeyboard();
    hover(rowOf('Download a copy'));
    act(() => void document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })));
    expect(await gone()).toBe(true);
    expect(menus()).toHaveLength(0);
  });

  it('closes when the pointer goes to a row with none, after a moment, unless it reached the submenu', async () => {
    openWithKeyboard();
    hover(rowOf('Download a copy'));
    hover(rowOf('Move to trash'));
    expect(menus()).toHaveLength(1);
    await wait(200);
    expect(menus()).toHaveLength(0);
    hover(rowOf('Download a copy'));
    hover(rowOf('Move to trash'));
    act(() => void menus()[0]!.dispatchEvent(new MouseEvent('pointerover', { bubbles: true })));
    await wait(200);
    expect(menus()).toHaveLength(1);
  });

  it('closes when the keyboard moves to another row', () => {
    openWithKeyboard();
    hover(rowOf('Download a copy'));
    key('ArrowDown', {}, rowOf('Download a copy'));
    expect(menus()).toHaveLength(0);
  });

  it('wears the app and the theme of the menu it hangs from, in a portal on the page', () => {
    openWithKeyboard();
    hover(rowOf('Download a copy'));
    const wrapper = menus()[0]!.closest('.oa-ctx-root')!;
    expect(wrapper.parentElement).toBe(document.body);
    expect(wrapper.getAttribute('data-app')).toBe('slides');
    expect(wrapper.getAttribute('data-theme')).toBe('dark');
  });
});

describe('where it goes', () => {
  const size = (w: number, h: number, vw: number, vh: number) => {
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get: () => h });
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get: () => w });
    window.innerWidth = vw;
    window.innerHeight = vh;
  };
  const rect = (left: number, top: number) => ({ left, right: left + 280, top, bottom: top + 36, width: 280, height: 36, x: left, y: top, toJSON: () => ({}) }) as DOMRect;

  it('is beside its row, to the right', () => {
    size(240, 120, 1200, 800);
    openWithKeyboard();
    vi.spyOn(rowOf('Download a copy'), 'getBoundingClientRect').mockReturnValue(rect(100, 200));
    hover(rowOf('Download a copy'));
    expect(menus()[0]!.style.left).toBe('376px');
    expect(menus()[0]!.style.top).toBe('194px');
  });

  it('flips to the left of its row where the right is full, and up where the bottom is', () => {
    size(240, 120, 600, 800);
    openWithKeyboard();
    vi.spyOn(rowOf('Download a copy'), 'getBoundingClientRect').mockReturnValue(rect(300, 760));
    hover(rowOf('Download a copy'));
    expect(menus()[0]!.style.left).toBe('64px');
    expect(Number.parseFloat(menus()[0]!.style.top)).toBeLessThanOrEqual(800 - 120 - 8);
  });
});
