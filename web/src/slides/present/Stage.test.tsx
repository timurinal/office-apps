// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AnimateOptions } from '../../motion';
import type { DeckJSON, SlideJSON, Transition } from '../model/deck';
import { testDeck } from '../model/testing';
import { Stage, type Animator, type Shown } from './Stage';
import { animatedProperties, plan, resolve } from './transitions';
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

const design = (d: DeckJSON = testDeck()) => ({ theme: d.theme, master: d.master, layouts: d.layouts, size: d.size });
const slide = (id: string, transition?: Transition): SlideJSON => ({ id, layout: 'blank', elements: [], ...(transition ? { transition } : {}) });
const shown = (id: string, index: number, transition?: Transition): Shown => ({ id, index, slide: slide(id, transition) });

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
    const finishedPromise = new Promise<void>((r) => (done = r));
    const call: Call = { el, frames, options, cancelled: false, finish: () => done() };
    calls.push(call);
    return { finished: finishedPromise, cancel: () => void (call.cancelled = true) } as unknown as Animation;
  };
  return { calls, animator };
}

const layers = () => [...host.querySelectorAll('.sp-layer')] as HTMLElement[];
const roles = () => layers().map((l) => l.dataset.role);
const draw = (el: Shown, o: { animator: Animator; animated?: boolean; onSettled?: () => void }) =>
  act(() => root.render(<Stage design={design()} shown={el} width={480} animator={o.animator} animated={o.animated} onSettled={o.onSettled} />));
const settle = () => act(async () => void (await flush()));

describe('the slide on screen', () => {
  it('is one layer, drawn at the width it is given', () => {
    const { animator } = fake();
    draw(shown('a', 0), { animator });
    expect(roles()).toEqual(['rest']);
    expect((host.querySelector('.sp-box') as HTMLElement).style.width).toBe('480px');
    expect((host.querySelector('.sp-box') as HTMLElement).style.height).toBe('270px');
    expect(host.querySelectorAll('.sl-view')).toHaveLength(1);
  });

  it('follows the deck: the same slide, changed, replaces the drawing and starts nothing', () => {
    const { animator, calls } = fake();
    draw(shown('a', 0), { animator });
    draw({ id: 'a', index: 0, slide: { ...slide('a'), bg: { kind: 'solid', color: '#ff0000' } } }, { animator });
    expect(roles()).toEqual(['rest']);
    expect(calls).toHaveLength(0);
  });
});

describe('moving to another slide', () => {
  it('keeps the old slide under the new for the length of a fade, then drops it', async () => {
    const { animator, calls } = fake();
    const settled = vi.fn();
    draw(shown('a', 0), { animator, onSettled: settled });
    draw(shown('b', 1, { kind: 'fade', duration: 400 }), { animator, onSettled: settled });
    expect(roles()).toEqual(['out', 'in']);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.el).toBe(layers()[1]);
    expect(calls[0]!.frames).toEqual([{ opacity: 0 }, { opacity: 1 }]);
    expect(calls[0]!.options.duration).toBe(400);
    expect(settled).not.toHaveBeenCalled();
    calls[0]!.finish();
    await settle();
    expect(roles()).toEqual(['rest']);
    expect(calls[0]!.cancelled).toBe(true);
    expect(settled).toHaveBeenCalledTimes(1);
  });

  it('runs both layers for a push, from the side the deck names', () => {
    const { animator, calls } = fake();
    draw(shown('a', 0), { animator });
    draw(shown('b', 1, { kind: 'push', from: 'bottom' }), { animator });
    const [out, inn] = layers();
    expect(calls.map((c) => c.el)).toEqual([out, inn]);
    expect(calls[1]!.frames[0]).toEqual({ transform: 'translate(0%, 100%)' });
    expect(calls[0]!.frames[1]).toEqual({ transform: 'translate(0%, -100%)' });
  });

  it('wipes with the new slide’s layer as the mask and the slide inside it moving against it', () => {
    const { animator, calls } = fake();
    draw(shown('a', 0), { animator });
    draw(shown('b', 1, { kind: 'wipe', from: 'left' }), { animator });
    const inn = layers()[1]!;
    const inner = inn.querySelector('.sp-inner');
    expect(calls).toHaveLength(2);
    expect(calls[0]!.el).toBe(inn);
    expect(calls[1]!.el).toBe(inner);
    expect(calls[0]!.frames[0]).toEqual({ transform: 'translate(-100%, 0%)' });
    expect(calls[1]!.frames[0]).toEqual({ transform: 'translate(100%, 0%)' });
  });

  it('asks for nothing but transform and opacity, whatever the kind', () => {
    for (const kind of ['fade', 'push', 'wipe', 'zoom'] as const) {
      const { animator, calls } = fake();
      draw(shown('a', 0), { animator });
      draw(shown('b', 1, { kind }), { animator });
      expect(calls.length, kind).toBeGreaterThan(0);
      for (const c of calls) {
        for (const f of c.frames) {
          for (const k of Object.keys(f)) expect(['transform', 'opacity'], `${kind}: ${k}`).toContain(k);
        }
      }
      act(() => root.render(null));
    }
  });

  it('is a cut for none or no transition: no animation and one layer at once', () => {
    const { animator, calls } = fake();
    const settled = vi.fn();
    draw(shown('a', 0), { animator, onSettled: settled });
    draw(shown('b', 1), { animator, onSettled: settled });
    expect(calls).toHaveLength(0);
    expect(roles()).toEqual(['rest']);
    draw(shown('c', 2, { kind: 'none' }), { animator });
    expect(roles()).toEqual(['rest']);
  });

  it('plays nothing when it is told not to animate, as in the presenter’s own copy', () => {
    const { animator, calls } = fake();
    draw(shown('a', 0), { animator, animated: false });
    draw(shown('b', 1, { kind: 'push' }), { animator, animated: false });
    expect(calls).toHaveLength(0);
    expect(roles()).toEqual(['rest']);
    expect(host.querySelector('.sl-view')).not.toBeNull();
  });

  it('drops the old slide even if an animation never finishes', async () => {
    vi.useFakeTimers();
    try {
      const { animator } = fake();
      draw(shown('a', 0), { animator });
      draw(shown('b', 1, { kind: 'fade', duration: 300 }), { animator });
      expect(roles()).toEqual(['out', 'in']);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1400);
      });
      expect(roles()).toEqual(['rest']);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('going back', () => {
  it('plays the transition of the slide being left, from the opposite side', () => {
    const { animator, calls } = fake();
    draw(shown('b', 1, { kind: 'push', from: 'right' }), { animator });
    draw(shown('a', 0), { animator });
    // Slide b is left, and it says push from the right: back, the earlier slide comes from the left.
    expect(calls[1]!.frames[0]).toEqual({ transform: 'translate(-100%, 0%)' });
  });

  it('is a cut when the slide being left has no transition, even if the earlier one has', () => {
    const { animator, calls } = fake();
    draw(shown('b', 1), { animator });
    draw(shown('a', 0, { kind: 'push' }), { animator });
    expect(calls).toHaveLength(0);
  });
});

describe('several presses in a row', () => {
  it('finishes the transition that is running and starts the next from the slide it had reached', async () => {
    const { animator, calls } = fake();
    draw(shown('a', 0), { animator });
    draw(shown('b', 1, { kind: 'fade' }), { animator });
    draw(shown('c', 2, { kind: 'fade' }), { animator });
    expect(calls[0]!.cancelled).toBe(true);
    expect(roles()).toEqual(['out', 'in']);
    // The slide leaving now is b, the one that was arriving.
    expect(layers()[0]!.querySelector('.sl-view')).not.toBeNull();
    expect(calls).toHaveLength(2);
    calls[1]!.finish();
    await settle();
    expect(roles()).toEqual(['rest']);
  });
});

describe('reduced motion', () => {
  it('makes every transition a fade, with no transform', () => {
    document.documentElement.dataset.motion = 'off';
    for (const kind of ['push', 'wipe', 'zoom'] as const) {
      const { animator, calls } = fake();
      draw(shown('a', 0), { animator });
      draw(shown('b', 1, { kind, from: 'left', duration: 900 }), { animator });
      expect(calls, kind).toHaveLength(1);
      expect(calls[0]!.frames, kind).toEqual([{ opacity: 0 }, { opacity: 1 }]);
      expect(calls[0]!.options.duration, kind).toBeLessThanOrEqual(500);
      act(() => root.render(null));
    }
  });

  it('matches what resolve and plan say for the same transition', () => {
    const p = plan(resolve({ kind: 'push' }, { reduced: true })!);
    expect([...animatedProperties(p)]).toEqual(['opacity']);
  });

  it('still cuts a cut', () => {
    document.documentElement.dataset.motion = 'off';
    const { animator, calls } = fake();
    draw(shown('a', 0), { animator });
    draw(shown('b', 1), { animator });
    expect(calls).toHaveLength(0);
  });
});
