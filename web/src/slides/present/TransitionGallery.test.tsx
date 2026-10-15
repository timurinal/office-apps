// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SelectionStore } from '../editor/selection';
import type { Transition } from '../model/deck';
import { modelOf, testDeck } from '../model/testing';
import type { SlidesContext } from '../modules/types';
import { previewRequests } from './previewBus';
import { DurationField, TransitionGallery } from './TransitionGallery';

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
});

function setup(o: { edit?: boolean; transitions?: Record<string, Transition> } = {}) {
  const model = modelOf(testDeck(['s1', 's2', 's3'].map((id) => ({ id, layout: 'blank', elements: [], ...(o.transitions?.[id] ? { transition: o.transitions[id] } : {}) }))));
  const selection = new SelectionStore();
  selection.set({ slide: 's1', slides: ['s1'] });
  const ctx = { model, selection, slideId: 's1', can: { edit: o.edit ?? true } } as unknown as SlidesContext;
  return { ctx, model, selection };
}
const radios = () => [...host.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
const checked = () => radios().find((r) => r.getAttribute('aria-checked') === 'true')?.textContent ?? null;
const click = (el: Element | undefined) => act(() => void el!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
const radio = (label: string) => radios().find((r) => r.textContent === label);
const input = () => host.querySelector('input') as HTMLInputElement;

describe('the gallery', () => {
  it('has the five kinds, each with a tile of its own for the preview', () => {
    const { ctx } = setup();
    act(() => root.render(<TransitionGallery ctx={ctx} />));
    expect(radios().map((r) => r.textContent)).toEqual(['None', 'Fade', 'Push', 'Wipe', 'Zoom']);
    expect([...host.querySelectorAll('.sp-tile')].map((t) => t.getAttribute('data-kind'))).toEqual(['none', 'fade', 'push', 'wipe', 'zoom']);
    expect(host.querySelector('[role="radiogroup"]')!.getAttribute('aria-label')).toBe('Transition to this slide');
  });

  it('marks the kind of the slide on the canvas, and none for a slide without one', () => {
    const { ctx } = setup({ transitions: { s1: { kind: 'wipe' } } });
    act(() => root.render(<TransitionGallery ctx={ctx} />));
    expect(checked()).toBe('Wipe');
    const none = setup();
    act(() => root.render(<TransitionGallery ctx={none.ctx} />));
    expect(checked()).toBe('None');
  });

  it('sets the kind when one is chosen, marks it, and plays it', () => {
    const { ctx, model } = setup();
    act(() => root.render(<TransitionGallery ctx={ctx} />));
    const before = previewRequests();
    click(radio('Push'));
    expect(model.slide('s1')?.transition).toEqual({ kind: 'push' });
    expect(checked()).toBe('Push');
    expect(previewRequests()).toBe(before + 1);
  });

  it('plays nothing for None, which is a cut', () => {
    const { ctx, model } = setup({ transitions: { s1: { kind: 'fade' } } });
    act(() => root.render(<TransitionGallery ctx={ctx} />));
    const before = previewRequests();
    click(radio('None'));
    expect(model.slide('s1')?.transition).toBeUndefined();
    expect(checked()).toBe('None');
    expect(previewRequests()).toBe(before);
  });

  it('follows an undo, and somebody else’s change', () => {
    const { ctx, model } = setup();
    act(() => root.render(<TransitionGallery ctx={ctx} />));
    click(radio('Zoom'));
    expect(checked()).toBe('Zoom');
    act(() => void model.undo());
    expect(checked()).toBe('None');
    act(() => void model.setSlides(['s1'], { transition: { kind: 'fade' } }));
    expect(checked()).toBe('Fade');
  });

  it('follows the slide on the canvas', () => {
    const { ctx, selection } = setup({ transitions: { s2: { kind: 'push' } } });
    act(() => root.render(<TransitionGallery ctx={ctx} />));
    expect(checked()).toBe('None');
    act(() => selection.set({ slide: 's2', slides: ['s2'] }));
    expect(checked()).toBe('Push');
  });

  it('is off for a reader, and for a deck with no slide on the canvas', () => {
    const reader = setup({ edit: false });
    act(() => root.render(<TransitionGallery ctx={reader.ctx} />));
    expect(radios().every((r) => r.disabled)).toBe(true);
    click(radio('Fade'));
    expect(reader.model.slide('s1')?.transition).toBeUndefined();
    const none = setup();
    (none.ctx as { slideId: string | null }).slideId = null;
    act(() => root.render(<TransitionGallery ctx={none.ctx} />));
    expect(radios().every((r) => r.disabled)).toBe(true);
  });

  it('is part of the ribbon’s own keyboard: each kind is a stop for the arrow keys', () => {
    const { ctx } = setup();
    act(() => root.render(<TransitionGallery ctx={ctx} />));
    expect(radios().every((r) => r.hasAttribute('data-rb-item'))).toBe(true);
    expect(new Set(radios().map((r) => r.dataset.id)).size).toBe(5);
  });
});

describe('the duration', () => {
  const change = (el: HTMLInputElement, value: string) =>
    act(() => {
      el.focus();
      el.value = value;
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
  const type = (el: HTMLInputElement, value: string) =>
    act(() => {
      el.focus();
      el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });

  it('shows the seconds of the slide on the canvas, 0.7 for one that does not say', () => {
    const { ctx } = setup({ transitions: { s1: { kind: 'fade', duration: 1250 } } });
    act(() => root.render(<DurationField ctx={ctx} />));
    expect(input().value).toBe('1.25');
    const plain = setup({ transitions: { s1: { kind: 'fade' } } });
    act(() => root.render(<DurationField ctx={plain.ctx} />));
    expect(input().value).toBe('0.7');
  });

  it('is empty and off for no transition, and for a reader', () => {
    const none = setup();
    act(() => root.render(<DurationField ctx={none.ctx} />));
    expect(input().value).toBe('');
    expect(input().disabled).toBe(true);
    const reader = setup({ edit: false, transitions: { s1: { kind: 'fade' } } });
    act(() => root.render(<DurationField ctx={reader.ctx} />));
    expect(input().disabled).toBe(true);
  });

  it('is written when the field is committed, in ms', () => {
    const { ctx, model } = setup({ transitions: { s1: { kind: 'fade' } } });
    act(() => root.render(<DurationField ctx={ctx} />));
    change(input(), '1.5');
    expect(model.slide('s1')?.transition).toEqual({ kind: 'fade', duration: 1500 });
  });

  it('is not written for every digit typed: one undo entry for one change', () => {
    const { ctx, model } = setup({ transitions: { s1: { kind: 'fade' } } });
    act(() => root.render(<DurationField ctx={ctx} />));
    type(input(), '1');
    type(input(), '1.');
    type(input(), '1.2');
    expect(model.slide('s1')?.transition).toEqual({ kind: 'fade' });
    change(input(), '1.2');
    expect(model.slide('s1')?.transition).toEqual({ kind: 'fade', duration: 1200 });
    act(() => void model.undo());
    expect(model.slide('s1')?.transition).toEqual({ kind: 'fade' });
  });

  it('comes back from a number past the range as the end of it, and shows that', () => {
    const { ctx, model } = setup({ transitions: { s1: { kind: 'fade' } } });
    act(() => root.render(<DurationField ctx={ctx} />));
    change(input(), '50');
    expect(model.slide('s1')?.transition?.duration).toBe(10_000);
    expect(input().value).toBe('10');
    change(input(), '0.01');
    expect(model.slide('s1')?.transition?.duration).toBe(100);
    expect(input().value).toBe('0.1');
  });

  it('puts back what the deck has when the text is not a number', () => {
    const { ctx, model } = setup({ transitions: { s1: { kind: 'fade', duration: 900 } } });
    act(() => root.render(<DurationField ctx={ctx} />));
    change(input(), 'soon');
    expect(model.slide('s1')?.transition?.duration).toBe(900);
    expect(input().value).toBe('0.9');
    change(input(), '');
    expect(input().value).toBe('0.9');
  });

  it('shows the deck’s number again after an undo, when the person is not in the field', () => {
    const { ctx, model } = setup({ transitions: { s1: { kind: 'fade' } } });
    act(() => root.render(<DurationField ctx={ctx} />));
    change(input(), '2');
    act(() => input().blur());
    act(() => void model.undo());
    expect(input().value).toBe('0.7');
  });
});
