// @vitest-environment happy-dom
import { act, Profiler } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RouterProvider } from '../../router';
import type { DocsContext } from '../modules/types';
import { resetTitles } from './docTitles';
import { ctxOf } from './env';
import { openFind, closeFind } from './find';
import { CoreHost } from './Host';
import { uiOf } from './ui';
import { docOf, jsonOf, makeEditor, p, select, type TestEditor } from './testing';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
let t: TestEditor;

beforeEach(() => {
  host = document.body.appendChild(document.createElement('div'));
  root = createRoot(host);
  resetTitles(async (id) => (id === 'gone' ? null : { title: 'Budget', kind: 'sheets' }));
  window.history.replaceState({}, '', '/docs/d1');
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  t?.destroy();
  vi.restoreAllMocks();
});

function ctxFor(over: { edit?: boolean } = {}): DocsContext {
  return {
    editor: t.editor,
    source: { kind: 'local' },
    meta: { id: 'd1', ownerId: '', ownerName: '' },
    can: { edit: over.edit ?? true },
    notify: vi.fn()
  } as unknown as DocsContext;
}

const mount = (ctx: DocsContext) => act(() => root.render(<RouterProvider><CoreHost ctx={ctx} /></RouterProvider>));
const flush = () => act(async () => void (await new Promise((r) => setTimeout(r, 30))));
/** Time passing, in slices: an `act` scope only applies what React queued when it ends, so
 *  an exit animation (a render, then a timer, then another render) needs several. */
const settle = async (ms: number) => {
  for (let spent = 0; spent < ms; spent += 40) await flush();
};

const SAMPLE = docOf({
  type: 'paragraph',
  content: [
    { type: 'text', text: 'See ' },
    { type: 'docLink', attrs: { docId: 'd2', kind: 'docs', title: 'Budget draft' } },
    { type: 'text', text: ' and ' },
    { type: 'docLink', attrs: { docId: 'gone', kind: 'docs', title: 'Secret' } },
    { type: 'text', text: ' due ' },
    { type: 'dateChip', attrs: { date: '2026-10-14' } },
    { type: 'text', text: ' with Library link' }
  ]
});

describe('the host', () => {
  it('gives the editor the current context, for the paste and drop handlers to read', () => {
    t = makeEditor(SAMPLE);
    const ctx = ctxFor();
    mount(ctx);
    expect(ctxOf(t.editor)).toBe(ctx);
    const next = ctxFor();
    mount(next);
    expect(ctxOf(t.editor)).toBe(next);
  });

  it('opens the document a chip points at, in the app it is in now, not the one it was linked in', async () => {
    t = makeEditor(SAMPLE);
    mount(ctxFor());
    await flush();
    const chip = t.editor.view.dom.querySelector<HTMLElement>('[data-doc-id="d2"]')!;
    expect(chip.textContent).toBe('Budget');
    act(() => void chip.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })));
    expect(window.location.pathname).toBe('/sheets/d2');
  });

  it('opens it in a new tab for Ctrl and ⌘', async () => {
    t = makeEditor(SAMPLE);
    mount(ctxFor());
    await flush();
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const chip = t.editor.view.dom.querySelector<HTMLElement>('[data-doc-id="d2"]')!;
    act(() => void chip.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true })));
    expect(open).toHaveBeenCalledWith('/sheets/d2', '_blank', 'noopener,noreferrer');
    expect(window.location.pathname).toBe('/docs/d1');
  });

  it('does not follow a link the reader cannot open', async () => {
    t = makeEditor(SAMPLE);
    mount(ctxFor());
    await flush();
    const chip = t.editor.view.dom.querySelector<HTMLElement>('[data-doc-id="gone"]')!;
    expect(chip.dataset.state).toBe('unavailable');
    act(() => void chip.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })));
    expect(window.location.pathname).toBe('/docs/d1');
  });

  it('opens a selected document link with Enter', async () => {
    t = makeEditor(SAMPLE);
    mount(ctxFor());
    await flush();
    let at = -1;
    t.editor.state.doc.descendants((n, pos) => {
      if (n.type.name === 'docLink' && n.attrs.docId === 'd2') at = pos;
    });
    t.editor.commands.setNodeSelection(at);
    act(() => void t.editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })));
    expect(window.location.pathname).toBe('/sheets/d2');
  });

  it('edits a date chip when it is clicked, by a person who can edit', async () => {
    t = makeEditor(SAMPLE);
    mount(ctxFor());
    await flush();
    const chip = t.editor.view.dom.querySelector<HTMLElement>('[data-chip="date"]')!;
    act(() => void chip.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })));
    expect(uiOf(t.editor).get().dateAt).not.toBeNull();
    await flush();
    const field = document.querySelector<HTMLInputElement>('.oa-datepop input[type="date"]');
    expect(field?.value).toBe('2026-10-14');
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    act(() => {
      set.call(field!, '2026-12-25');
      field!.dispatchEvent(new Event('input', { bubbles: true }));
      field!.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(JSON.stringify(jsonOf(t.editor))).toContain('2026-12-25');
  });

  it('leaves a date chip alone for a reader', async () => {
    t = makeEditor(SAMPLE);
    t.editor.setEditable(false);
    mount(ctxFor({ edit: false }));
    await flush();
    const chip = t.editor.view.dom.querySelector<HTMLElement>('[data-chip="date"]')!;
    act(() => void chip.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })));
    expect(uiOf(t.editor).get().dateAt).toBeNull();
  });
});

describe('the panels it draws', () => {
  it('shows the link editor when asked, with the selected text left alone, and not for a reader', async () => {
    t = makeEditor(SAMPLE);
    select(t.editor, 'Library');
    mount(ctxFor());
    act(() => uiOf(t.editor).set({ link: true }));
    await flush();
    expect(document.querySelector('.oa-linked')).not.toBeNull();
    expect(document.querySelector('.oa-linked input[placeholder="Paste or type an address"]')).not.toBeNull();
    // The selection has text, so the text field is not asked for.
    expect(document.querySelector('.oa-linked input[placeholder="Text to show"]')).toBeNull();

    act(() => uiOf(t.editor).set({ link: false }));
    t.editor.setEditable(false);
    mount(ctxFor({ edit: false }));
    act(() => uiOf(t.editor).set({ link: true }));
    await flush();
    expect(document.querySelector('.oa-linked')).toBeNull();
  });

  it('asks for the text too when nothing is selected', async () => {
    t = makeEditor(SAMPLE);
    t.editor.commands.focus('end');
    mount(ctxFor());
    act(() => uiOf(t.editor).set({ link: true }));
    await flush();
    expect(document.querySelector('.oa-linked input[placeholder="Text to show"]')).not.toBeNull();
  });

  it('shows the find bar once opened, hides replace for a reader, and goes when closed', async () => {
    t = makeEditor(SAMPLE);
    mount(ctxFor());
    expect(document.querySelector('.oa-findbar')).toBeNull();
    act(() => openFind(t.editor, { replace: true }));
    await flush();
    expect(document.querySelector('.oa-findbar')).not.toBeNull();
    expect(document.querySelector('input[aria-label="Replace with"]')).not.toBeNull();
    act(() => closeFind(t.editor));
    await settle(400);
    expect(document.querySelector('.oa-findbar')).toBeNull();

    mount(ctxFor({ edit: false }));
    act(() => openFind(t.editor, { replace: true }));
    await flush();
    expect(document.querySelector('.oa-findbar')).not.toBeNull();
    expect(document.querySelector('input[aria-label="Replace with"]')).toBeNull();
  });

  it('does not re-render for a keystroke while nothing is open', async () => {
    t = makeEditor(docOf(p('x')));
    const ctx = ctxFor();
    let commits = 0;
    act(() => root.render(<RouterProvider><Profiler id="host" onRender={() => commits++}><CoreHost ctx={ctx} /></Profiler></RouterProvider>));
    await flush();
    const settled = commits;
    for (let i = 0; i < 20; i++) {
      t.editor.commands.insertContentAt(1, 'a');
      await act(async () => void (await new Promise((r) => setTimeout(r, 20))));
    }
    expect(commits).toBe(settled);
  });
});
