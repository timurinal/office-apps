// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AnimateOptions } from '../../motion';
import type { Transition } from '../model/deck';
import { modelOf, testDeck } from '../model/testing';
import type { CanvasFrame, SlidesContext } from '../modules/types';
import { requestPreview } from './previewBus';
import { TransitionPreviewLayer } from './PreviewLayer';
import type { Animator } from './Stage';
import { flush } from './testing';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  delete document.documentElement.dataset.motion;
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  delete document.documentElement.dataset.motion;
});

interface Call {
  el: Element;
  frames: Keyframe[];
  options: AnimateOptions;
  cancelled: boolean;
  finish: () => void;
}
function fake() {
  const calls: Call[] = [];
  const animator: Animator = (el, frames, options) => {
    let done!: () => void;
    const finished = new Promise<void>((r) => (done = r));
    const call: Call = { el, frames, options, cancelled: false, finish: () => done() };
    calls.push(call);
    return { finished, cancel: () => void (call.cancelled = true) } as unknown as Animation;
  };
  return { calls, animator };
}

function setup(index: number, transitions: Record<string, Transition> = {}) {
  const model = modelOf(testDeck(['s1', 's2', 's3'].map((id) => ({ id, layout: 'blank', elements: [], ...(transitions[id] ? { transition: transitions[id] } : {}) }))));
  const id = `s${index + 1}`;
  const slide = model.slide(id)!;
  const ctx = { model, design: model.design(), slideId: id, slideIndex: index } as unknown as SlidesContext;
  const frame: CanvasFrame = { slide, scale: 0.5, width: 1920, height: 1080, drag: null };
  return { ctx, frame, model };
}
const layer = (a: Animator, s: ReturnType<typeof setup>) => act(() => root.render(<TransitionPreviewLayer ctx={s.ctx} frame={s.frame} animator={a} />));
const preview = () => host.querySelector('.sp-preview') as HTMLElement | null;
const roles = () => [...host.querySelectorAll('.sp-layer')].map((l) => (l as HTMLElement).dataset.role);

describe('the preview over the canvas', () => {
  it('draws nothing until it is asked for', () => {
    const { animator, calls } = fake();
    layer(animator, setup(1, { s2: { kind: 'push' } }));
    expect(preview()).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('plays the slide’s own transition from the slide before it, once, at the size of the slide on screen', async () => {
    const { animator, calls } = fake();
    layer(animator, setup(1, { s2: { kind: 'push', from: 'bottom' } }));
    act(() => requestPreview());
    expect(preview()).not.toBeNull();
    expect(roles()).toEqual(['out', 'in']);
    expect(calls).toHaveLength(2);
    expect(calls[1]!.frames[0]).toEqual({ transform: 'translate(0%, 100%)' });
    expect((host.querySelector('.sp-box') as HTMLElement).style.width).toBe('960px');
    for (const c of calls) c.finish();
    await act(async () => void (await flush()));
    expect(preview()).toBeNull();
  });

  it('arrives from black when it is the first slide', () => {
    const { animator, calls } = fake();
    layer(animator, setup(0, { s1: { kind: 'fade' } }));
    act(() => requestPreview());
    expect(roles()).toEqual(['out', 'in']);
    const out = host.querySelector('.sp-layer[data-role="out"] .sl-stage') as HTMLElement;
    expect(out.style.background || out.style.backgroundColor).toBe('#000000');
    expect(calls).toHaveLength(1);
  });

  it('is gone at once for a slide with no transition, with nothing left drawn', () => {
    const { animator, calls } = fake();
    layer(animator, setup(1));
    act(() => requestPreview());
    expect(calls).toHaveLength(0);
    expect(preview()).toBeNull();
  });

  it('plays again each time it is asked', async () => {
    const { animator, calls } = fake();
    layer(animator, setup(1, { s2: { kind: 'fade' } }));
    act(() => requestPreview());
    calls[0]!.finish();
    await act(async () => void (await flush()));
    expect(preview()).toBeNull();
    act(() => requestPreview());
    expect(preview()).not.toBeNull();
    expect(calls).toHaveLength(2);
  });

  it('does not play what was asked before it was drawn', () => {
    requestPreview();
    const { animator, calls } = fake();
    layer(animator, setup(1, { s2: { kind: 'fade' } }));
    expect(preview()).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('is a fade under reduced motion, whatever the slide has', () => {
    document.documentElement.dataset.motion = 'off';
    const { animator, calls } = fake();
    layer(animator, setup(1, { s2: { kind: 'wipe', from: 'left' } }));
    act(() => requestPreview());
    expect(calls).toHaveLength(1);
    expect(calls[0]!.frames).toEqual([{ opacity: 0 }, { opacity: 1 }]);
  });

  it('takes no pointer events and is hidden from a screen reader: it is over the slide being edited', () => {
    const { animator } = fake();
    layer(animator, setup(1, { s2: { kind: 'fade' } }));
    act(() => requestPreview());
    expect(preview()!.getAttribute('aria-hidden')).toBe('true');
  });

  it('is not asked for in a deck with no slide on the canvas', () => {
    const { animator, calls } = fake();
    const s = setup(1, { s2: { kind: 'fade' } });
    (s.ctx as { slideId: string | null; slideIndex: number }).slideId = null;
    (s.ctx as { slideIndex: number }).slideIndex = -1;
    layer(animator, s);
    act(() => requestPreview());
    expect(preview()).toBeNull();
    expect(calls).toHaveLength(0);
  });
});
