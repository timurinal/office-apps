// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastHost } from '../../core/ui';
import { SelectionStore } from '../editor/selection';
import type { ElementJSON, TextDoc } from '../model/deck';
import { box, modelOf, testDeck, txt } from '../model/testing';
import { closeSlideDialog, openSlideDialog, openSlideDialogNow, SlideDialogs } from './menuDialogs';
import type { SlidesContext } from './types';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  closeSlideDialog();
  document.body.innerHTML = '';
});

const wait = (ms = 0) => act(async () => void (await new Promise((r) => setTimeout(r, ms))));

function setup(elements: ElementJSON[], chosen: string[], can = true) {
  const model = modelOf(testDeck([{ id: 's1', layout: 'blank', elements }, { id: 's2', layout: 'blank', elements: [] }]));
  const selection = new SelectionStore();
  selection.set({ slide: 's1', slides: ['s1'], els: chosen });
  const focusCanvas = vi.fn();
  const ctx = { model, selection, can: { edit: can }, slideId: 's1', design: model.design(), source: { kind: 'local' }, meta: { id: 'd' }, actions: { focusCanvas }, notify: vi.fn() } as unknown as SlidesContext;
  act(() => root.render(<ToastHost><SlideDialogs ctx={ctx} /></ToastHost>));
  return { model, selection, ctx, focusCanvas };
}

const q = <T extends Element>(sel: string): T => document.body.querySelector<T>(sel)!;
const button = (label: string): HTMLButtonElement => [...document.body.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === label)!;
const type = (el: HTMLInputElement | HTMLTextAreaElement, text: string) =>
  act(() => {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
const runs = (doc: TextDoc) => doc.content.flatMap((p) => p.content ?? []);

describe('the store', () => {
  it('says which one is open, and closes only the one it is asked to', () => {
    openSlideDialog('alt');
    const alt = openSlideDialogNow()!;
    openSlideDialog('link');
    closeSlideDialog(alt.seq);
    expect(openSlideDialogNow()?.kind).toBe('link');
    closeSlideDialog();
    expect(openSlideDialogNow()).toBeNull();
  });

  it('opens nothing for a reader', () => {
    setup([{ ...box(0, 0), id: 'a', text: txt('Hi') }], ['a'], false);
    openSlideDialog('link');
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
  });
});

describe('Link', () => {
  it('links the whole text of the chosen shapes in one step, and Undo takes it back', async () => {
    const s = setup([{ ...box(0, 0), id: 'a', text: txt('Read this', 'and this') }, { ...box(200, 0), id: 'b', text: txt('Also') }], ['a', 'b']);
    act(() => openSlideDialog('link'));
    expect(q('h2').textContent).toBe('Link');
    type(q<HTMLInputElement>('input'), 'example.com/docs');
    act(() => button('Apply').click());
    await wait(200);
    for (const id of ['a', 'b']) {
      const marks = runs((s.model.element('s1', id) as { text: TextDoc }).text).map((r) => r.marks?.find((m) => m.type === 'link')?.attrs?.href);
      expect(marks.every((h) => h === 'https://example.com/docs'), id).toBe(true);
    }
    s.model.undo();
    expect(runs((s.model.element('s1', 'a') as { text: TextDoc }).text).some((r) => r.marks?.some((m) => m.type === 'link'))).toBe(false);
    expect(openSlideDialogNow()).toBeNull();
  });

  it('refuses what is not a web or email address, and says so where it was typed', () => {
    const s = setup([{ ...box(0, 0), id: 'a', text: txt('Hi') }], ['a']);
    act(() => openSlideDialog('link'));
    type(q<HTMLInputElement>('input'), 'javascript:alert(1)');
    act(() => button('Apply').click());
    expect(q('.oa-field-note').textContent).toBe('Enter a web or email address.');
    expect(runs((s.model.element('s1', 'a') as { text: TextDoc }).text).some((r) => r.marks?.some((m) => m.type === 'link'))).toBe(false);
    expect(q('[role="dialog"]')).not.toBeNull();
  });

  it('starts from the address the text already has, and Remove link takes it off', async () => {
    const linked: TextDoc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Docs', marks: [{ type: 'link', attrs: { href: 'https://example.com/' } }] }] }] };
    const s = setup([{ ...box(0, 0), id: 'a', text: linked }], ['a']);
    act(() => openSlideDialog('link'));
    expect(q<HTMLInputElement>('input').value).toBe('https://example.com/');
    act(() => button('Remove link').click());
    await wait(200);
    expect(runs((s.model.element('s1', 'a') as { text: TextDoc }).text).some((r) => r.marks?.some((m) => m.type === 'link'))).toBe(false);
  });

  it('has no Remove link where there is no link', () => {
    setup([{ ...box(0, 0), id: 'a', text: txt('Hi') }], ['a']);
    act(() => openSlideDialog('link'));
    expect(button('Remove link')).toBeUndefined();
  });
});

describe('Alt text', () => {
  it('describes the chosen shape, and an emptied description takes it away', async () => {
    const s = setup([{ type: 'image', id: 'i', x: 0, y: 0, w: 100, h: 100, asset: { id: 'x' } }], ['i']);
    act(() => openSlideDialog('alt'));
    expect(q('h2').textContent).toBe('Alt text');
    type(q<HTMLTextAreaElement>('textarea'), 'A bar chart of sales');
    act(() => button('Save').click());
    await wait(200);
    expect((s.model.element('s1', 'i') as { alt?: string }).alt).toBe('A bar chart of sales');
    s.model.undo();
    expect((s.model.element('s1', 'i') as { alt?: string }).alt).toBeUndefined();
    s.model.redo();
    act(() => openSlideDialog('alt'));
    expect(q<HTMLTextAreaElement>('textarea').value).toBe('A bar chart of sales');
    type(q<HTMLTextAreaElement>('textarea'), '');
    act(() => button('Save').click());
    await wait(200);
    expect((s.model.element('s1', 'i') as { alt?: string }).alt).toBeUndefined();
  });

  it('gives the keyboard back to the slide when it closes', async () => {
    const s = setup([{ ...box(0, 0), id: 'a' }], ['a']);
    act(() => openSlideDialog('alt'));
    act(() => button('Cancel').click());
    await wait(200);
    expect(s.focusCanvas).toHaveBeenCalled();
  });
});

describe('Format background', () => {
  it('sets a gradient on the slide at once, in one step, and on every slide when asked', async () => {
    const s = setup([], []);
    act(() => openSlideDialog('background'));
    expect(q('h2').textContent).toBe('Format background');
    act(() => q<HTMLButtonElement>('button[aria-label="Dawn"]').click());
    expect(s.model.slide('s1')!.bg).toMatchObject({ kind: 'gradient' });
    expect(s.model.slide('s2')!.bg).toBeUndefined();
    s.model.undo();
    expect(s.model.slide('s1')!.bg).toBeUndefined();
    act(() => void [...document.body.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find((i) => i.closest('label')?.textContent === 'Apply to all slides')!.click());
    act(() => q<HTMLButtonElement>('button[aria-label="Sky"]').click());
    expect(s.model.slide('s2')!.bg).toMatchObject({ kind: 'gradient' });
    act(() => button('Reset background').click());
    expect(s.model.slide('s1')!.bg).toBeUndefined();
    expect(s.model.slide('s2')!.bg).toBeUndefined();
    act(() => button('Done').click());
    await wait(200);
    expect(openSlideDialogNow()).toBeNull();
  });

  it('offers a picture only on a cloud source', () => {
    setup([], []);
    act(() => openSlideDialog('background'));
    expect(button('Picture…')).toBeUndefined();
  });
});
