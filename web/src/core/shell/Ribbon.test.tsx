// @vitest-environment happy-dom
import { act } from 'react';
import type React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditingModeMenu, Ribbon, useRibbonFit } from './Ribbon';
import type { RibbonGroup, TabDef } from './types';

/**
 * The ribbon framework, with every kind of control on one strip. Nothing in Docs uses a
 * split button, a menu, a select or a colour picker yet; the next modules will, and the
 * first thing they should find is that the framework already runs them.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface Ctx {
  bold: boolean;
  font: string;
  color: string | null;
  style: string;
  canUndo: boolean;
}

const TABS: TabDef[] = [
  { id: 'file', label: 'File' },
  { id: 'home', label: 'Home' },
  { id: 'insert', label: 'Insert' },
  { id: 'layout', label: 'Layout' }
];

/** Any shape will do: the ribbon draws whatever markup it is handed. */
const boldIcon = '<path d="M0 0h256v256H0z"/>';

let host: HTMLDivElement;
let root: Root;
const calls: string[] = [];

const GROUPS: RibbonGroup<Ctx>[] = [
  {
    id: 'home.a',
    tab: 'home',
    order: 100,
    label: 'Basics',
    items: [
      { type: 'button', id: 'undo', label: 'Undo', icon: boldIcon, run: () => calls.push('undo'), disabled: (c) => !c.canUndo },
      { type: 'button', id: 'bold', label: 'Bold', icon: boldIcon, active: (c) => c.bold, run: () => calls.push('bold') },
      { type: 'separator', id: 's1' },
      {
        type: 'gallery',
        id: 'style',
        label: 'Paragraph style',
        entries: [
          { value: 'p', label: 'Normal' },
          { value: 'h1', label: 'Heading 1' }
        ],
        value: (c) => c.style,
        run: (_c, v) => calls.push(`style:${v}`)
      }
    ]
  },
  {
    id: 'home.b',
    tab: 'home',
    order: 200,
    label: 'Font',
    items: [
      {
        type: 'select',
        id: 'font',
        label: 'Font',
        width: 120,
        options: [
          { value: 'Inter', label: 'Inter' },
          { value: 'Serif', label: 'Serif' }
        ],
        value: (c) => c.font,
        run: (_c, v) => calls.push(`font:${v}`)
      },
      {
        type: 'color',
        id: 'color',
        label: 'Text colour',
        palette: [
          { value: '#3d6cd0', label: 'Blue' },
          { value: '#b93c59', label: 'Red' }
        ],
        value: (c) => c.color,
        run: (_c, v) => calls.push(`color:${v}`)
      },
      {
        type: 'split',
        id: 'paste',
        label: 'Paste',
        icon: boldIcon,
        run: () => calls.push('paste'),
        menu: [
          { label: 'Paste as text', run: () => calls.push('paste-text') },
          { label: 'Paste special', run: () => calls.push('paste-special'), visible: () => false }
        ]
      },
      {
        type: 'menu',
        id: 'find',
        label: 'Find',
        showLabel: true,
        entries: [{ label: 'Replace', run: () => calls.push('replace'), active: () => true }]
      }
    ]
  },
  {
    id: 'insert.a',
    tab: 'insert',
    order: 100,
    label: 'Links',
    items: [{ type: 'button', id: 'link', label: 'Link', showLabel: true, run: () => calls.push('link') }]
  }
];

const base: Ctx = { bold: true, font: 'Inter', color: '#b93c59', style: 'p', canUndo: false };

function mount(props: Partial<React.ComponentProps<typeof Ribbon<Ctx>>> = {}, ctx: Ctx = base) {
  act(() => {
    root.render(
      <Ribbon<Ctx>
        tabs={TABS}
        groups={GROUPS}
        ctx={ctx}
        active="home"
        onActive={() => undefined}
        collapsed={false}
        onCollapsed={() => undefined}
        fileMenu={<button role="menuitem">New</button>}
        subscribe={() => () => undefined}
        {...props}
      />
    );
  });
}

const q = <T extends Element = HTMLElement>(sel: string): T => host.querySelector<T>(sel)!;
const click = (el: Element) => act(() => void (el as HTMLElement).click());
const key = (el: Element, k: string) =>
  act(() => void el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })));

beforeEach(() => {
  calls.length = 0;
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  // happy-dom has no layout, and the indicator only measures it. Frames are timers here, so a
  // test can run them.
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} });
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0) as unknown as number);
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe('the tabs', () => {
  it('draw the tabs that have something on them, and always File', () => {
    mount();
    expect([...host.querySelectorAll('[role="tab"]')].map((t) => t.textContent)).toEqual(['Home', 'Insert']);
    expect(host.textContent).toContain('File');
    expect(host.textContent).not.toContain('Layout');
  });

  it('mark the active tab, and ask for another when one is pressed', () => {
    const onActive = vi.fn();
    mount({ onActive });
    expect(q('[role="tab"][aria-selected="true"]').textContent).toBe('Home');
    click(host.querySelectorAll('[role="tab"]')[1]!);
    expect(onActive).toHaveBeenCalledWith('insert');
  });

  it('move between themselves with the arrow keys, and wrap', () => {
    const onActive = vi.fn();
    mount({ onActive });
    key(q('[role="tab"][aria-selected="true"]'), 'ArrowRight');
    expect(onActive).toHaveBeenLastCalledWith('insert');
    key(q('[role="tab"][aria-selected="true"]'), 'ArrowLeft');
    expect(onActive).toHaveBeenLastCalledWith('insert');
    key(q('[role="tab"][aria-selected="true"]'), 'End');
    expect(onActive).toHaveBeenLastCalledWith('insert');
    key(q('[role="tab"][aria-selected="true"]'), 'Home');
    expect(onActive).toHaveBeenLastCalledWith('home');
  });

  it('give the strip the tab’s name', () => {
    mount();
    expect(q('[role="toolbar"]').getAttribute('aria-label')).toBe('Home');
  });

  it('open the File menu', () => {
    mount();
    const file = [...host.querySelectorAll('button')].find((b) => b.textContent === 'File')!;
    click(file);
    expect(file.getAttribute('aria-expanded')).toBe('true');
    expect(host.querySelector('[role="menu"] [role="menuitem"]')?.textContent).toBe('New');
  });
});

describe('the strip', () => {
  it('shows a toggle as pressed and a disabled control as disabled, from the context', () => {
    mount();
    expect(q('[data-id="bold"]').getAttribute('aria-pressed')).toBe('true');
    expect(q<HTMLButtonElement>('[data-id="undo"]').disabled).toBe(true);
  });

  it('runs a button with the context, and does not run a disabled one', () => {
    mount();
    click(q('[data-id="bold"]'));
    click(q('[data-id="undo"]'));
    expect(calls).toEqual(['bold']);
  });

  it('marks the gallery’s current style and applies another', () => {
    mount();
    expect(q('[data-id="style.p"]').getAttribute('aria-selected')).toBe('true');
    click(q('[data-id="style.h1"]'));
    expect(calls).toEqual(['style:h1']);
  });

  it('opens a select on its current value and chooses from its list', () => {
    mount();
    expect(q('[data-id="font"]').textContent).toContain('Inter');
    click(q('[data-id="font"]'));
    const options = [...host.querySelectorAll('[role="option"]')].filter((o) => o.textContent === 'Serif');
    expect(options).toHaveLength(1);
    click(options[0]!);
    expect(calls).toEqual(['font:Serif']);
  });

  it('opens a colour palette, shows the current colour, and clears it', () => {
    mount();
    expect(q('[data-id="color"] .oa-rb-bar').getAttribute('style')).toContain('#b93c59');
    click(q('[data-id="color"]'));
    click(q('[aria-label="Blue"]'));
    expect(calls).toEqual(['color:#3d6cd0']);
    click(q('[data-id="color"]'));
    click([...host.querySelectorAll('button')].find((b) => b.textContent === 'No colour')!);
    expect(calls).toEqual(['color:#3d6cd0', 'color:null']);
  });

  it('runs a split button’s main action and its menu, hiding the entries that say so', () => {
    mount();
    click(q('[data-id="paste"]'));
    expect(calls).toEqual(['paste']);
    click(q('[data-id="paste.more"]'));
    const rows = [...host.querySelectorAll('[role="menuitem"]')].map((r) => r.textContent);
    expect(rows).toEqual(['Paste as text']);
    click(host.querySelector('[role="menuitem"]')!);
    expect(calls).toEqual(['paste', 'paste-text']);
  });

  it('opens a menu button and marks the entry that is on', () => {
    mount();
    click(q('[data-id="find"]'));
    expect(host.querySelector('[role="menuitem"]')?.textContent).toBe('Replace');
  });

  it('re-reads the context when the editor says it changed, and only then', () => {
    vi.useFakeTimers();
    // The strip and the strip that is fading out each subscribe; an editor event reaches both.
    const listeners = new Set<() => void>();
    const notify = () => listeners.forEach((cb) => cb());
    const ctx = { ...base };
    mount({ ctx, subscribe: (cb) => (listeners.add(cb), () => void listeners.delete(cb)) });
    expect(q('[data-id="bold"]').getAttribute('aria-pressed')).toBe('true');
    ctx.bold = false; // the editor moved, and the ribbon has not been told
    expect(q('[data-id="bold"]').getAttribute('aria-pressed')).toBe('true');
    act(() => {
      notify();
      vi.runAllTimers();
    });
    vi.useRealTimers();
    expect(q('[data-id="bold"]').getAttribute('aria-pressed')).toBe('false');
  });

  it('has one tab stop, and the arrow keys move along the controls that can be used', () => {
    mount();
    const stops = [...host.querySelectorAll<HTMLElement>('[role="toolbar"] [data-rb-item]')].filter((n) => n.tabIndex === 0);
    expect(stops.map((n) => n.dataset.id)).toEqual(['bold']); // undo is disabled, so the first usable one
    const strip = q('[role="toolbar"]');
    const focused: string[] = [];
    const spy = vi.spyOn(HTMLElement.prototype, 'focus').mockImplementation(function (this: HTMLElement) {
      focused.push(this.dataset.id ?? '');
    });
    key(q('[data-id="bold"]'), 'ArrowRight');
    key(q('[data-id="bold"]'), 'End');
    key(q('[data-id="bold"]'), 'Home');
    spy.mockRestore();
    expect(strip).toBeTruthy();
    expect(focused[0]).toBe('style.p');
    expect(focused[1]).toBe('find');
    expect(focused[2]).toBe('bold');
  });
});

describe('one row', () => {
  // the ribbon is the same height on every tab. A group that does not fit goes
  // under More at the end of the strip, never onto a second row. happy-dom has no layout, so the
  // strip's room and each group's width are given here.
  let room = 0;
  // Each group's width with its words, with its icons alone, and with an item that has a short form drawn short.
  let widths: Record<string, [number, number] | [number, number, number]> = {};
  const observers: { cb: () => void; on: Element[] }[] = [];
  const resize = () =>
    act(() => {
      for (const o of observers) if (o.on.some((e) => e.classList.contains('oa-rb-content'))) o.cb();
    });

  beforeEach(() => {
    observers.length = 0;
    widths = { 'home.a': [300, 300], 'home.b': [300, 300] };
    vi.stubGlobal(
      'ResizeObserver',
      class {
        o: { cb: () => void; on: Element[] };
        constructor(cb: () => void) {
          this.o = { cb, on: [] };
          observers.push(this.o);
        }
        observe(e: Element) {
          this.o.on.push(e);
        }
        unobserve() {}
        disconnect() {
          this.o.on = [];
        }
      }
    );
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get(this: HTMLElement) {
        return this.classList.contains('oa-rb-content') ? room : 0;
      }
    });
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      value(this: HTMLElement) {
        const [wide, tight, short] = (widths[this.dataset.group ?? ''] ?? [0, 0]) as [number, number, number | undefined];
        const width = this.closest('[data-collapsed]') ? (short ?? tight) : this.closest('[data-compact]') ? tight : wide;
        return { width, height: 30, x: 0, y: 0, top: 0, left: 0, right: width, bottom: 30, toJSON: () => ({}) };
      }
    });
  });
  afterEach(() => {
    delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth;
    delete (HTMLElement.prototype as { getBoundingClientRect?: unknown }).getBoundingClientRect;
  });

  const inStrip = (group: string) => host.querySelector(`.oa-rb-content > [data-group="${group}"]`);

  it('puts a group that does not fit under More, and runs its controls from there', () => {
    room = 400;
    mount();
    expect(inStrip('home.a')).not.toBeNull();
    expect(inStrip('home.b')).toBeNull();
    const more = q('[aria-label="More"]');
    click(more);
    expect(more.getAttribute('aria-expanded')).toBe('true');
    const paste = q('.oa-popover [data-group="home.b"] [data-id="paste"]');
    click(paste);
    expect(calls).toEqual(['paste']);
    expect(more.getAttribute('aria-expanded')).toBe('false');
  });

  it('takes a group back when the strip widens, and has no More when everything fits', () => {
    room = 400;
    mount();
    expect(inStrip('home.b')).toBeNull();
    room = 700;
    resize();
    expect(inStrip('home.b')).not.toBeNull();
    expect(host.querySelector('[aria-label="More"]')).toBeNull();
    room = 250;
    resize();
    expect(host.querySelector('.oa-rb-content > [data-group]')).toBeNull();
    expect(host.querySelector('[aria-label="More"]')).not.toBeNull();
  });

  it('drops the words from its buttons before it puts a group under More, and takes them back with room', () => {
    widths = { 'home.a': [300, 200], 'home.b': [300, 200] };
    room = 500;
    mount();
    expect(inStrip('home.b')).not.toBeNull();
    expect(host.querySelector('[aria-label="More"]')).toBeNull();
    expect(q('.oa-rb-content').hasAttribute('data-compact')).toBe(true);
    room = 700;
    resize();
    expect(q('.oa-rb-content').hasAttribute('data-compact')).toBe(false);
    room = 300;
    resize();
    expect(q('.oa-rb-content').hasAttribute('data-compact')).toBe(true);
    expect(inStrip('home.a')).not.toBeNull();
    expect(inStrip('home.b')).toBeNull();
  });

  describe('an item with a short form, such as Slides’ gallery of shapes', () => {
    // The gallery is on the strip while there is room, and gives way before any group goes under More, and after the
    // buttons have dropped their words: it is the thing the strip keeps longest.
    function Gallery() {
      const { collapsed } = useRibbonFit();
      return <span data-form={collapsed ? 'short' : 'inline'}>{collapsed ? 'Shapes' : 'tiles'}</span>;
    }
    const WITH_GALLERY: RibbonGroup<Ctx>[] = [
      GROUPS[0]!,
      { id: 'home.g', tab: 'home', order: 150, label: 'Drawing', items: [{ type: 'custom', id: 'gallery', render: () => <Gallery /> }] }
    ];
    const form = () => host.querySelector('.oa-rb-content > [data-group="home.g"] [data-form]')?.getAttribute('data-form') ?? null;
    const compact = () => q('.oa-rb-content').hasAttribute('data-compact');

    beforeEach(() => {
      // home.a: 300 with words, 200 without. home.g: 200 as a gallery, 60 as a button.
      widths = { 'home.a': [300, 200], 'home.g': [200, 200, 60] };
    });

    it('is drawn in full while everything fits', () => {
      room = 600;
      mount({ groups: WITH_GALLERY });
      expect(form()).toBe('inline');
      expect(compact()).toBe(false);
    });

    it('keeps its tiles when only the words have to go', () => {
      room = 450;
      mount({ groups: WITH_GALLERY });
      expect(compact()).toBe(true);
      expect(form()).toBe('inline');
      expect(host.querySelector('[aria-label="More"]')).toBeNull();
    });

    it('goes back to its button when the words are not enough, before any group goes under More', () => {
      room = 300;
      mount({ groups: WITH_GALLERY });
      expect(compact()).toBe(true);
      expect(form()).toBe('short');
      expect(inStrip('home.a')).not.toBeNull();
      expect(host.querySelector('[aria-label="More"]')).toBeNull();
    });

    it('puts a group under More only once the button is no longer enough, and draws the button there', () => {
      room = 240;
      mount({ groups: WITH_GALLERY });
      expect(inStrip('home.a')).not.toBeNull();
      expect(inStrip('home.g')).toBeNull();
      click(q('[aria-label="More"]'));
      expect(q('.oa-popover [data-group="home.g"] [data-form]').getAttribute('data-form')).toBe('short');
    });

    it('takes its tiles back as the strip widens, a step at a time', () => {
      room = 240;
      mount({ groups: WITH_GALLERY });
      room = 300;
      resize();
      expect(form()).toBe('short');
      expect(host.querySelector('[aria-label="More"]')).toBeNull();
      room = 450;
      resize();
      expect(form()).toBe('inline');
      expect(compact()).toBe(true);
      room = 600;
      resize();
      expect(form()).toBe('inline');
      expect(compact()).toBe(false);
    });

    it('costs a strip with nothing to collapse no extra step: its groups go under More as they always did', () => {
      widths = { 'home.a': [300, 300], 'home.b': [300, 300] };
      room = 400;
      mount();
      expect(inStrip('home.a')).not.toBeNull();
      expect(inStrip('home.b')).toBeNull();
      expect(q('.oa-rb-content').hasAttribute('data-compact')).toBe(true);
    });
  });

  it('keeps the keyboard on the strip: the arrows end at More', () => {
    room = 400;
    mount({ ctx: { ...base, canUndo: true } });
    const focused: string[] = [];
    const spy = vi.spyOn(HTMLElement.prototype, 'focus').mockImplementation(function (this: HTMLElement) {
      focused.push(this.dataset.id ?? '');
    });
    key(q('[data-id="undo"]'), 'End');
    spy.mockRestore();
    expect(focused).toEqual(['ribbon.more']);
  });
});

describe('collapsing', () => {
  it('hides the strip, and the chevron asks to expand', () => {
    const onCollapsed = vi.fn();
    mount({ collapsed: true, onCollapsed });
    expect(host.querySelector('[role="toolbar"]')).toBeNull();
    const chevron = q('[aria-label="Expand the ribbon"]');
    click(chevron);
    expect(onCollapsed).toHaveBeenCalledWith(false);
  });

  it('shows the strip while a tab is pressed, until something outside is', () => {
    mount({ collapsed: true });
    click(host.querySelector('[role="tab"]')!);
    expect(host.querySelector('[role="toolbar"]')).not.toBeNull();
    act(() => void document.body.dispatchEvent(new Event('pointerdown', { bubbles: true })));
    expect(host.querySelector('[role="toolbar"]')).toBeNull();
  });
});

describe('the editing mode menu', () => {
  const modes = [
    { id: 'editing', label: 'Editing', order: 100 },
    { id: 'viewing', label: 'Viewing', order: 900 }
  ];

  it('is a menu when there is a choice', () => {
    const onMode = vi.fn();
    act(() => root.render(<EditingModeMenu modes={modes} mode="editing" onMode={onMode} />));
    const trigger = q('button');
    expect(trigger.textContent).toContain('Editing');
    click(trigger);
    click([...host.querySelectorAll('[role="menuitem"]')].find((r) => r.textContent === 'Viewing')!);
    expect(onMode).toHaveBeenCalledWith('viewing');
  });

  it('is only a label for a reader who has none', () => {
    act(() => root.render(<EditingModeMenu modes={[{ id: 'viewing', label: 'Viewing', order: 1 }]} mode="viewing" onMode={() => undefined} />));
    expect(host.querySelector('button')).toBeNull();
    expect(host.textContent).toBe('Viewing');
  });
});
