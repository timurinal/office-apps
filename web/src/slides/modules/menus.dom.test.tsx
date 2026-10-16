// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useContextMenu } from '../../core/contextHost';
import { joinGroups } from '../../core/ContextMenu';
import { ToastHost } from '../../core/ui';
import { SelectionStore } from '../editor/selection';
import type { ElementJSON, TableElement } from '../model/deck';
import { box, modelOf, testDeck, txt } from '../model/testing';
import { tablesFor, clearCells } from './insert/tables';
import { closeSlideDialog, openSlideDialogNow } from './menuDialogs';
import { CanvasMenuLayer, contextItems } from './menus';
import type { CanvasFrame, SlidesContext, SlidesMenuTarget } from './types';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
let model: ReturnType<typeof modelOf>;
beforeEach(() => {
  host = document.createElement('div');
  host.className = 'sl-desk';
  const canvas = document.createElement('div');
  canvas.className = 'sl-canvas';
  host.appendChild(canvas);
  document.body.appendChild(host);
  root = createRoot(canvas);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.querySelectorAll('.oa-ctx-root, .oa-scrim').forEach((n) => n.remove());
  closeSlideDialog();
  if (model) clearCells(model);
});

interface Opts {
  can?: boolean;
  download?: boolean;
  slides?: number;
}

/** What the editor does: a menu host over the modules' rows, and a canvas layer that asks it. */
function Harness({ ctx, frame }: { ctx: SlidesContext; frame: CanvasFrame }) {
  const open = { current: null as ((t: SlidesMenuTarget, at: { x: number; y: number }, from?: Element | null) => boolean) | null };
  const live = { ...ctx, contextMenu: (t: SlidesMenuTarget, at: { x: number; y: number }, from?: Element | null) => open.current?.(t, at, from) ?? false } as SlidesContext;
  const menu = useContextMenu<SlidesMenuTarget, SlidesContext>({ ctx: live, hooks: [contextItems], label: (t) => (t.kind === 'shape' ? 'Shape' : 'Slide'), returnFocus: () => ctx.actions.focusCanvas() });
  open.current = menu.open;
  return (
    <>
      <CanvasMenuLayer c={live} frame={frame} />
      {menu.element}
    </>
  );
}

function setup(elements: ElementJSON[], opts: Opts = {}) {
  const can = opts.can ?? true;
  const slides = Array.from({ length: opts.slides ?? 1 }, (_, i) => ({ id: `s${i + 1}`, layout: 'blank', elements: i === 0 ? elements : [] }));
  model = modelOf(testDeck(slides));
  const selection = new SelectionStore();
  selection.set({ slide: 's1', slides: ['s1'] });
  const panes = { open: vi.fn(), isOpen: () => false, close: vi.fn(), toggle: vi.fn() };
  const editText = vi.fn();
  const focusCanvas = vi.fn();
  const notify = vi.fn();
  const ctx = {
    model,
    selection,
    can: { edit: can, download: opts.download ?? true },
    slideId: 's1',
    design: model.design(),
    source: { kind: 'cloud' },
    meta: { id: 'doc' },
    panes,
    select: { elements: (ids: string[]) => selection.set({ els: ids, editing: null }), editText },
    actions: { focusCanvas },
    notify
  } as unknown as SlidesContext;
  const frame = (): CanvasFrame => ({ slide: model.slide('s1')!, scale: 1, width: 1920, height: 1080, drag: null });
  const draw = () => act(() => root.render(<ToastHost><Harness ctx={ctx} frame={frame()} /></ToastHost>));
  draw();
  // The editor draws the canvas again when the slide changes; a test says when.
  return { model, selection, ctx, panes, editText, focusCanvas, draw };
}

/** A right click at slide px (x, y): the canvas is at the origin and a scale of 1 in a page with no layout. */
function rightClick(x: number, y: number, init: MouseEventInit = {}): MouseEvent {
  const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 2, ...init });
  act(() => {
    host.querySelector('.sl-canvas')!.dispatchEvent(e);
  });
  return e;
}

const menus = (): HTMLElement[] => [...document.body.querySelectorAll<HTMLElement>('[role="menu"]')];
const menu = (label = 'Shape'): HTMLElement | null => menus().find((m) => m.getAttribute('aria-label') === label) ?? null;
const rows = (m: HTMLElement | null = menus()[0] ?? null): string[] => [...(m?.children ?? [])].filter((c) => c.tagName === 'BUTTON').map((r) => r.querySelector('.oa-menu-label')!.textContent!);
const row = (label: string, m: HTMLElement | null = menus()[0] ?? null): HTMLButtonElement => [...(m?.children ?? [])].find((c): c is HTMLButtonElement => c.tagName === 'BUTTON' && c.querySelector('.oa-menu-label')!.textContent === label)!;
const press = (label: string, m?: HTMLElement | null) => act(() => row(label, m).click());
const hover = (label: string) => act(() => void row(label).dispatchEvent(new MouseEvent('pointerover', { bubbles: true })));

describe('a right click on a shape', () => {
  it('chooses it and opens the shape menu, the clipboard first and Format shape after the arrangement', () => {
    const s = setup([{ ...box(100, 100, 400, 300), id: 'a', text: txt('Hello') }, { ...box(900, 100, 200, 200), id: 'b' }]);
    const e = rightClick(200, 200);
    expect(e.defaultPrevented).toBe(true);
    expect(s.selection.get().els).toEqual(['a']);
    expect(menus()[0]!.getAttribute('aria-label')).toBe('Shape');
    expect(rows()).toEqual(['Cut', 'Copy', 'Paste', 'Save as picture', 'Edit text', 'Link…', 'Alt text…', 'Arrange', 'Format shape…', 'Duplicate', 'Delete']);
  });

  it('has Save as picture, which lists a PNG and an SVG by what they are, for whoever may copy it out', () => {
    setup([{ ...box(100, 100, 400, 300), id: 'a' }]);
    rightClick(200, 200);
    expect(row('Save as picture').getAttribute('aria-haspopup')).toBe('menu');
    hover('Save as picture');
    expect(menus()).toHaveLength(2);
    expect(menus()[1]!.getAttribute('aria-label')).toBe('Save as picture');
    expect(rows(menus()[1])).toEqual(['PNG (.png)', 'SVG (.svg)']);
  });

  it('saves what is chosen, in the format that was, from the exporter loaded then', async () => {
    const saved = vi.fn(async () => undefined);
    vi.doMock('../export', () => ({ savePicture: saved }));
    const s = setup([{ ...box(100, 100, 400, 300), id: 'a' }, { ...box(900, 100, 200, 200), id: 'b' }]);
    s.selection.set({ els: ['a', 'b'] });
    s.ctx.meta = { id: 'doc', title: 'Deck' } as never;
    rightClick(200, 200);
    hover('Save as picture');
    press('SVG (.svg)', menus()[1]);
    await vi.waitFor(() => expect(saved).toHaveBeenCalledTimes(1));
    const [host, slide, ids, format] = saved.mock.calls[0] as unknown as [{ title: string; model: unknown }, string, string[], string];
    expect(host.title).toBe('Deck');
    expect(host.model).toBe(s.model);
    expect(slide).toBe('s1');
    // A click on one of several chosen keeps them all.
    expect(ids).toEqual(['a', 'b']);
    expect(format).toBe('svg');
    vi.doUnmock('../export');
  });

  it('has Arrange as a submenu with the order, align, distribute and turn rows', () => {
    setup([{ ...box(100, 100, 400, 300), id: 'a' }, { ...box(900, 100, 200, 200), id: 'b' }]);
    rightClick(200, 200);
    hover('Arrange');
    expect(menus()).toHaveLength(2);
    expect(rows(menus()[1])).toEqual(expect.arrayContaining(['Bring to front', 'Send to back', 'Align left', 'Rotate right 90°', 'Flip horizontal']));
    expect(rows(menus()[1])).not.toContain('Group');
  });

  it('runs an Arrange row on what was clicked, in one step', () => {
    const s = setup([{ ...box(100, 100, 400, 300), id: 'a' }, { ...box(900, 100, 200, 200), id: 'b' }]);
    rightClick(200, 200);
    hover('Arrange');
    press('Bring to front', menus()[1]);
    expect(s.model.slide('s1')!.elements.map((e) => e.id)).toEqual(['b', 'a']);
    s.model.undo();
    expect(s.model.slide('s1')!.elements.map((e) => e.id)).toEqual(['a', 'b']);
  });

  it('offers Group for several chosen, and Ungroup for a group', () => {
    const s = setup([{ ...box(100, 100, 400, 300), id: 'a' }, { ...box(900, 100, 200, 200), id: 'b' }]);
    s.selection.set({ els: ['a', 'b'] });
    rightClick(200, 200);
    expect(rows()).toContain('Group');
    expect(rows()).not.toContain('Ungroup');
    expect(rows()).not.toContain('Edit text');
    press('Group');
    expect(s.model.slide('s1')!.elements).toHaveLength(1);
    s.draw();
    rightClick(200, 200);
    expect(rows()).toContain('Ungroup');
    expect(rows()).not.toContain('Group');
  });

  it('keeps the choice when the click is on one of several chosen', () => {
    const s = setup([{ ...box(100, 100, 400, 300), id: 'a' }, { ...box(900, 100, 200, 200), id: 'b' }]);
    s.selection.set({ els: ['a', 'b'] });
    rightClick(200, 200);
    expect(s.selection.get().els).toEqual(['a', 'b']);
  });

  it('opens the Format pane, edits the text, and links and describes the shape through its dialogs', () => {
    const s = setup([{ ...box(100, 100, 400, 300), id: 'a', text: txt('Hello') }]);
    rightClick(200, 200);
    press('Format shape…');
    expect(s.panes.open).toHaveBeenCalledWith('format');
    expect(s.focusCanvas).toHaveBeenCalled();
    rightClick(200, 200);
    press('Edit text');
    expect(s.editText).toHaveBeenCalledWith('a', 'end');
    rightClick(200, 200);
    press('Link…');
    expect(openSlideDialogNow()?.kind).toBe('link');
    rightClick(200, 200);
    press('Alt text…');
    expect(openSlideDialogNow()?.kind).toBe('alt');
  });

  it('has no Link for a shape with no text, and Alt text for a picture', () => {
    setup([{ ...box(100, 100, 400, 300), id: 'a' }, { type: 'image', id: 'i', x: 900, y: 100, w: 200, h: 200, asset: { id: 'x' } }]);
    rightClick(200, 200);
    expect(rows()).toContain('Edit text');
    expect(rows()).not.toContain('Link…');
    rightClick(1000, 200);
    expect(rows()).not.toContain('Edit text');
    expect(rows()).toContain('Alt text…');
  });

  it('copies, duplicates and deletes in one step each', () => {
    const s = setup([{ ...box(100, 100, 400, 300), id: 'a' }]);
    rightClick(200, 200);
    press('Duplicate');
    expect(s.model.slide('s1')!.elements).toHaveLength(2);
    s.model.undo();
    expect(s.model.slide('s1')!.elements).toHaveLength(1);
    rightClick(200, 200);
    press('Delete');
    expect(s.model.slide('s1')!.elements).toHaveLength(0);
    s.model.undo();
    expect(s.model.slide('s1')!.elements).toHaveLength(1);
  });

  it('has no Cut or Copy where downloads are off', () => {
    const s = setup([{ ...box(100, 100, 400, 300), id: 'a' }], { download: false });
    rightClick(200, 200);
    expect(rows().slice(0, 1)).toEqual(['Paste']);
    expect(rows()).not.toContain('Save as picture');
    expect(joinGroups(contextItems({ kind: 'shape', ids: s.selection.get().els }, s.ctx)).length).toBeGreaterThan(0);
  });

  it('over a table also has its rows, columns, merge and split, acting on the cell that was clicked', () => {
    const table: TableElement = {
      type: 'table',
      id: 't',
      x: 100,
      y: 100,
      w: 300,
      h: 100,
      cols: [100, 100, 100],
      rows: [0, 1].map((r) => ({ h: 50, cells: [0, 1, 2].map((c) => ({ text: txt(`${r}.${c}`) })) }))
    };
    const s = setup([table]);
    rightClick(250, 160);
    // Row 2, column 2.
    expect(tablesFor(s.model).chosen).toMatchObject({ a: { r: 1, c: 1 } });
    expect(rows()).toEqual(expect.arrayContaining(['Insert row above', 'Insert row below', 'Insert column left', 'Insert column right', 'Delete rows', 'Delete columns', 'Merge cells', 'Split cell']));
    press('Insert row above');
    expect((s.model.element('s1', 't') as TableElement).rows).toHaveLength(3);
  });

  it('is only Copy for a reader who may copy, and the browser\'s where downloads are off too', () => {
    setup([{ ...box(100, 100, 400, 300), id: 'a' }], { can: false });
    const e = rightClick(200, 200);
    expect(rows()).toEqual(['Copy', 'Save as picture']);
    expect(e.defaultPrevented).toBe(true);
    act(() => row('Copy').click());
    const none = rightClick(1500, 900);
    expect(none.defaultPrevented).toBe(false);
  });

  it('is the browser\'s for a reader with downloads off', () => {
    setup([{ ...box(100, 100, 400, 300), id: 'a' }], { can: false, download: false });
    const e = rightClick(200, 200);
    expect(e.defaultPrevented).toBe(false);
    expect(menus()).toHaveLength(0);
  });
});

describe('a right click on the slide itself', () => {
  it('opens the slide menu: Paste, Layout and Format background', () => {
    setup([{ ...box(100, 100, 400, 300), id: 'a' }]);
    const e = rightClick(1500, 900);
    expect(e.defaultPrevented).toBe(true);
    expect(menu('Slide')).not.toBeNull();
    expect(rows()).toEqual(['Paste', 'Layout', 'Format background…']);
  });

  it('lists the deck\'s layouts under Layout, ticks the current one and sets another in one step', () => {
    const s = setup([]);
    rightClick(1500, 900);
    hover('Layout');
    const names = rows(menus()[1]);
    expect(names).toEqual(model.design().layouts.map((l) => l.name));
    const current = model.design().layouts.find((l) => l.id === model.slide('s1')!.layout)!;
    expect(row(current.name, menus()[1]).getAttribute('aria-checked')).toBe('true');
    const other = model.design().layouts.find((l) => l.id !== current.id)!;
    press(other.name, menus()[1]);
    expect(s.model.slide('s1')!.layout).toBe(other.id);
    s.model.undo();
    expect(s.model.slide('s1')!.layout).toBe(current.id);
  });

  it('opens the background dialog', () => {
    setup([]);
    rightClick(1500, 900);
    press('Format background…');
    expect(openSlideDialogNow()?.kind).toBe('background');
  });

  it('is the browser\'s over the grey round the slide, with Shift, and for a reader', () => {
    setup([{ ...box(100, 100, 400, 300), id: 'a' }]);
    expect(rightClick(-50, 200).defaultPrevented).toBe(false);
    expect(rightClick(2500, 200).defaultPrevented).toBe(false);
    expect(rightClick(1500, 900, { shiftKey: true }).defaultPrevented).toBe(false);
    expect(menus()).toHaveLength(0);
    setup([], { can: false });
    expect(rightClick(1500, 900).defaultPrevented).toBe(false);
  });
});

describe('text being typed in', () => {
  it('has the browser\'s menu: spelling and paste', () => {
    setup([{ ...box(100, 100, 400, 300), id: 'a' }]);
    const editing = document.createElement('div');
    editing.setAttribute('contenteditable', 'true');
    host.querySelector('.sl-canvas')!.appendChild(editing);
    const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 200, clientY: 200, button: 2 });
    act(() => {
      editing.dispatchEvent(e);
    });
    expect(e.defaultPrevented).toBe(false);
    expect(menus()).toHaveLength(0);
  });

  it('and Shift asks for it over a shape', () => {
    setup([{ ...box(100, 100, 400, 300), id: 'a' }]);
    expect(rightClick(200, 200, { shiftKey: true }).defaultPrevented).toBe(false);
    expect(menus()).toHaveLength(0);
  });
});

describe('the menu', () => {
  it('gives the keyboard back to the slide when it closes', () => {
    const s = setup([{ ...box(100, 100, 400, 300), id: 'a' }]);
    rightClick(200, 200);
    act(() => void document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
    expect(s.focusCanvas).toHaveBeenCalled();
  });

  it('keeps open while it is scrolled itself, and goes when anything else is', () => {
    setup([{ ...box(100, 100, 400, 300), id: 'a' }]);
    rightClick(200, 200);
    act(() => void menus()[0]!.dispatchEvent(new WheelEvent('wheel', { bubbles: true })));
    expect(menus()[0]!.getAttribute('data-state')).toBe('open');
    act(() => void host.dispatchEvent(new WheelEvent('wheel', { bubbles: true })));
    expect(menus()[0]!.getAttribute('data-state')).toBe('closed');
  });
});

describe('a thumbnail', () => {
  const ctxFor = (over: Opts = {}) => setup([], { slides: 3, ...over }).ctx;
  const labels = (c: SlidesContext, ids: string[]) =>
    joinGroups(contextItems({ kind: 'slides', ids }, c)).map((e) => ('separator' in e ? '-' : 'label' in e ? e.label : '?'));

  it('has New slide, Duplicate, Delete, Hide and Layout, said for one or several', () => {
    const c = ctxFor();
    c.selection.set({ slide: 's1', slides: ['s1'] });
    expect(labels(c, ['s1'])).toEqual(['New slide', '-', 'Duplicate slide', 'Delete slide', '-', 'Hide slide', 'Layout']);
    c.selection.set({ slide: 's1', slides: ['s1', 's2'] });
    expect(labels(c, ['s1', 's2'])).toEqual(['New slide', '-', 'Duplicate slides', 'Delete slides', '-', 'Hide slides', 'Layout']);
  });

  it('says Show for slides that are hidden, and acts on the chosen slides', () => {
    const c = ctxFor();
    c.selection.set({ slide: 's2', slides: ['s2'] });
    const find = (l: string) => joinGroups(contextItems({ kind: 'slides', ids: ['s2'] }, c)).find((e) => 'label' in e && e.label === l) as { onSelect: () => void };
    find('Hide slide').onSelect();
    expect(c.model.slide('s2')!.hidden).toBe(true);
    expect(labels(c, ['s2'])).toContain('Show slide');
    find('Duplicate slide').onSelect();
    expect(c.model.order()).toHaveLength(4);
  });

  it('will not delete every slide', () => {
    const c = ctxFor();
    c.selection.set({ slide: 's1', slides: ['s1', 's2', 's3'] });
    const del = joinGroups(contextItems({ kind: 'slides', ids: ['s1', 's2', 's3'] }, c)).find((e) => 'label' in e && e.label === 'Delete slides') as { disabled?: boolean };
    expect(del.disabled).toBe(true);
  });

  it('is nothing for a reader', () => {
    const c = ctxFor({ can: false });
    expect(joinGroups(contextItems({ kind: 'slides', ids: ['s1'] }, c))).toEqual([]);
  });
});
