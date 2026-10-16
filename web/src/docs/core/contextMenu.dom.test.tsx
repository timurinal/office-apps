// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NodeSelection } from '@tiptap/pm/state';
import { yUndoPluginKey } from '@tiptap/y-tiptap';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastHost } from '../../core/ui';
import { contextItems } from '../modules/menus';
import type { DocsContext } from '../modules/types';
import { altTextNow, closeAltText, menuTargetAt, openAltText, setAltText, useDocsContextMenu } from './contextMenu';
import { linkAt } from './links';
import { docOf, makeEditor, p, type TestEditor } from './testing';
import { uiOf } from './ui';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// A raster data URL is the one kind of picture a document takes without an upload.
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

const cell = (text: string) => ({ type: 'tableCell', content: [p(text)] });
const SAMPLE = docOf(
  p('Plain words here.'),
  { type: 'paragraph', content: [{ type: 'text', text: 'Read ' }, { type: 'text', text: 'the docs', marks: [{ type: 'link', attrs: { href: 'https://example.com/docs' } }] }, { type: 'text', text: ' now.' }] },
  { type: 'table', content: [{ type: 'tableRow', content: [cell('A1'), cell('B1')] }, { type: 'tableRow', content: [cell('A2'), cell('B2')] }] },
  { type: 'image', attrs: { src: PNG, alt: 'First' } },
  p('The end.')
);

let host: HTMLDivElement;
let root: Root;
let t: TestEditor;
let notify: ReturnType<typeof vi.fn>;
const focusEditor = vi.fn();

beforeEach(() => {
  host = document.body.appendChild(document.createElement('div'));
  root = createRoot(host);
  notify = vi.fn();
  focusEditor.mockClear();
  t = makeEditor(SAMPLE);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  t.destroy();
  closeAltText();
  document.body.querySelectorAll('.oa-ctx-root, .oa-scrim').forEach((n) => n.remove());
  vi.restoreAllMocks();
});

function Harness({ ctx }: { ctx: DocsContext }) {
  return <ToastHost>{useDocsContextMenu(ctx, [contextItems])}</ToastHost>;
}

function mount(over: { edit?: boolean; restricted?: boolean } = {}) {
  const edit = over.edit ?? true;
  t.editor.setEditable(edit);
  const ctx = { editor: t.editor, can: { edit }, caps: { restricted: over.restricted ?? false }, notify, actions: { focusEditor } } as unknown as DocsContext;
  act(() => root.render(<Harness ctx={ctx} />));
  return ctx;
}

const dom = (): HTMLElement => t.editor.view.dom;
/** The undo history merges what is done within half a second; the document being set up is a step of its own. */
const nextStep = () => yUndoPluginKey.getState(t.editor.state)!.undoManager.stopCapturing();
const menus = (): HTMLElement[] => [...document.body.querySelectorAll<HTMLElement>('[role="menu"]')];
const rows = (): string[] => [...(menus()[0]?.children ?? [])].filter((c) => c.tagName === 'BUTTON').map((r) => r.querySelector('.oa-menu-label')!.textContent!);
const row = (label: string): HTMLButtonElement => [...menus()[0]!.children].find((c): c is HTMLButtonElement => c.tagName === 'BUTTON' && c.querySelector('.oa-menu-label')!.textContent === label)!;
const press = (label: string) => act(() => row(label).click());
const rightClick = (el: Element, init: MouseEventInit = {}) => {
  const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 40, button: 2, ...init });
  act(() => void el.dispatchEvent(e));
  return e;
};
const wait = (ms = 0) => act(async () => void (await new Promise((r) => setTimeout(r, ms))));
const find = <T extends Element>(sel: string): T => dom().querySelector<T>(sel)!;
const texts = (): string[] => [...dom().querySelectorAll('td, th')].map((c) => c.textContent ?? '');

describe('what was clicked', () => {
  it('knows a link, a table cell and a picture, and not plain text', () => {
    mount();
    expect(menuTargetAt(t.editor, find('p'))).toBeNull();
    expect(menuTargetAt(t.editor, find('a'))).toEqual({ link: { href: 'https://example.com/docs' } });
    expect(menuTargetAt(t.editor, find('td'))).toEqual({ table: true });
    expect(menuTargetAt(t.editor, find('img'))).toMatchObject({ image: { pos: expect.any(Number) } });
  });
});

describe('plain text', () => {
  it('has the browser\'s menu, for its spelling suggestions', () => {
    mount();
    const e = rightClick(find('p'));
    expect(e.defaultPrevented).toBe(false);
    expect(menus()).toHaveLength(0);
  });

  it('and Shift asks for it over a link, a table and a picture', () => {
    mount();
    for (const sel of ['a', 'td', 'img']) expect(rightClick(find(sel), { shiftKey: true }).defaultPrevented, sel).toBe(false);
    expect(menus()).toHaveLength(0);
  });
});

describe('a link', () => {
  it('opens a menu with Open, Copy, Edit and Remove, and puts the caret in the link', () => {
    mount();
    const e = rightClick(find('a'));
    expect(e.defaultPrevented).toBe(true);
    expect(menus()[0]!.getAttribute('aria-label')).toBe('Link');
    expect(rows()).toEqual(['Open link', 'Copy link', 'Edit link', 'Remove link']);
    expect(linkAt(t.editor)?.href).toBe('https://example.com/docs');
  });

  it('opens it in a new tab with no opener', () => {
    mount();
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    rightClick(find('a'));
    press('Open link');
    expect(open).toHaveBeenCalledWith('https://example.com/docs', '_blank', 'noopener,noreferrer');
  });

  it('copies the address and says so', async () => {
    mount();
    const write = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: write } });
    rightClick(find('a'));
    press('Copy link');
    await wait();
    expect(write).toHaveBeenCalledWith('https://example.com/docs');
    expect(notify).toHaveBeenCalledWith({ text: 'Copied the link.' });
  });

  it('edits the link in the link editor, and removes it in one step', () => {
    mount();
    rightClick(find('a'));
    press('Edit link');
    expect(uiOf(t.editor).get().link).toBe(true);
    uiOf(t.editor).set({ link: false });
    rightClick(find('a'));
    press('Remove link');
    expect(t.editor.getHTML()).not.toContain('example.com/docs');
    expect(t.editor.getText()).toContain('the docs');
  });

  it('is Open and Copy for a reader, and Open alone where copying is off', () => {
    mount({ edit: false });
    rightClick(find('a'));
    expect(rows()).toEqual(['Open link', 'Copy link']);
    act(() => void document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    mount({ edit: false, restricted: true });
    rightClick(find('a'));
    expect(rows()).toEqual(['Open link']);
  });

  it('gives the keyboard back to the page when it closes', () => {
    mount();
    rightClick(find('a'));
    press('Open link');
    expect(focusEditor).toHaveBeenCalled();
  });
});

describe('a table', () => {
  it('opens a menu with the rows and columns, merge and split, and Delete table', () => {
    mount();
    const e = rightClick(find('td'));
    expect(e.defaultPrevented).toBe(true);
    expect(menus()[0]!.getAttribute('aria-label')).toBe('Table');
    expect(rows()).toEqual(['Insert row above', 'Insert row below', 'Insert column left', 'Insert column right', 'Delete row', 'Delete column', 'Merge cells', 'Split cell', 'Delete table']);
  });

  it('gives every row an icon, so the deletes line up with the rest', () => {
    mount();
    rightClick(find('td'));
    expect(rows().filter((label) => !row(label).querySelector('svg'))).toEqual([]);
  });

  it('puts the caret in the cell that was clicked, so the rows act on it', () => {
    mount();
    rightClick(dom().querySelectorAll('td')[3]!);
    expect(t.editor.state.selection.$from.parent.textContent).toBe('B2');
    press('Insert row above');
    expect(texts()).toEqual(['A1', 'B1', '', '', 'A2', 'B2']);
  });

  it('inserts below and to the right, deletes a row and a column, and the whole table, each in one step', () => {
    mount();
    rightClick(dom().querySelectorAll('td')[0]!);
    press('Insert column right');
    expect(dom().querySelectorAll('tr:first-child td')).toHaveLength(3);
    rightClick(dom().querySelectorAll('td')[0]!);
    press('Delete column');
    expect(dom().querySelectorAll('tr:first-child td')).toHaveLength(2);
    rightClick(dom().querySelectorAll('td')[0]!);
    press('Delete row');
    expect(dom().querySelectorAll('tr')).toHaveLength(1);
    rightClick(dom().querySelectorAll('td')[0]!);
    nextStep();
    press('Delete table');
    expect(dom().querySelector('table')).toBeNull();
    t.editor.commands.undo();
    expect(dom().querySelector('table')).not.toBeNull();
  });

  it('turns off the rows that cannot run: Merge and Split need cells to work on', () => {
    mount();
    rightClick(find('td'));
    expect(row('Merge cells').disabled).toBe(true);
    expect(row('Split cell').disabled).toBe(true);
  });

  it('is the browser\'s for a reader', () => {
    mount({ edit: false });
    const e = rightClick(find('td'));
    expect(e.defaultPrevented).toBe(false);
    expect(menus()).toHaveLength(0);
  });

  it('has both a link\'s rows and the table\'s for a link in a cell', () => {
    t.destroy();
    t = makeEditor(docOf({ type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'go', marks: [{ type: 'link', attrs: { href: 'https://example.com/' } }] }] }] }] }] }));
    mount();
    rightClick(find('a'));
    expect(rows()).toEqual(expect.arrayContaining(['Open link', 'Remove link', 'Insert row above', 'Delete table']));
  });
});

describe('a picture', () => {
  it('opens a menu with Alt text and Delete, and selects the picture', () => {
    mount();
    const e = rightClick(find('img'));
    expect(e.defaultPrevented).toBe(true);
    expect(menus()[0]!.getAttribute('aria-label')).toBe('Picture');
    expect(rows()).toEqual(['Alt text…', 'Delete picture']);
    expect(t.editor.state.selection).toBeInstanceOf(NodeSelection);
    expect((t.editor.state.selection as NodeSelection).node.type.name).toBe('image');
  });

  it('describes it through a dialog, from what it says now, in one step', async () => {
    mount();
    rightClick(find('img'));
    press('Alt text…');
    await wait(50);
    const field = document.body.querySelector<HTMLTextAreaElement>('[role="dialog"] textarea')!;
    expect(field.value).toBe('First');
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(field, 'A bar chart of sales');
      field.dispatchEvent(new Event('input', { bubbles: true }));
    });
    nextStep();
    act(() => [...document.body.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === 'Save')!.click());
    await wait(200);
    expect(find('img').getAttribute('alt')).toBe('A bar chart of sales');
    expect(altTextNow()).toBeNull();
    t.editor.commands.undo();
    expect(find('img').getAttribute('alt')).toBe('First');
  });

  it('takes the alt text away when it is emptied', () => {
    mount();
    rightClick(find('img'));
    const pos = (t.editor.state.selection as NodeSelection).from;
    expect(setAltText(t.editor, pos, '   ')).toBe(true);
    expect(find('img').hasAttribute('alt')).toBe(false);
  });

  it('refuses a position that is not a picture', () => {
    mount();
    expect(setAltText(t.editor, 1, 'x')).toBe(false);
    openAltText(1);
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
  });

  it('deletes it, and Undo brings it back', () => {
    mount();
    rightClick(find('img'));
    nextStep();
    press('Delete picture');
    expect(dom().querySelector('img')).toBeNull();
    t.editor.commands.undo();
    expect(dom().querySelector('img')).not.toBeNull();
  });

  it('is the browser\'s for a reader', () => {
    mount({ edit: false });
    const e = rightClick(find('img'));
    expect(e.defaultPrevented).toBe(false);
    expect(menus()).toHaveLength(0);
  });
});
