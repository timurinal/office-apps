// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DeckJSON, SlideJSON } from '../model/deck';
import { testDeck } from '../model/testing';
import { IDLE_MS, Surface, type SurfaceProps } from './Surface';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
const sizes = { w: 960, h: 600 };

beforeEach(() => {
  // happy-dom lays nothing out: a surface is as big as this says.
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: function (this: HTMLElement) { return this.classList.contains('sp-surface') ? sizes.w : this.classList.contains('sp-slide') ? 960 : 0; } });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: function (this: HTMLElement) { return this.classList.contains('sp-surface') ? sizes.h : this.classList.contains('sp-slide') ? 540 : 0; } });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientWidth;
  delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientHeight;
  vi.useRealTimers();
});

const design = (d: DeckJSON = testDeck()) => ({ theme: d.theme, master: d.master, layouts: d.layouts, size: d.size });
const slide: SlideJSON = { id: 's1', layout: 'blank', elements: [] };

function draw(over: Partial<SurfaceProps> = {}) {
  act(() =>
    root.render(<Surface design={design()} shown={{ id: 's1', index: 0, slide }} screen="none" laser={false} remote={null} animated={false} {...over} />)
  );
  const surface = host.querySelector('.sp-surface') as HTMLElement;
  const box = host.querySelector('.sp-slide') as HTMLElement | null;
  if (box) box.getBoundingClientRect = () => ({ left: 0, top: 0, width: 960, height: 540, right: 960, bottom: 540, x: 0, y: 0, toJSON: () => ({}) });
  return { surface, box };
}

const pointer = (el: Element, type: string, x: number, y: number, button = 0) =>
  act(() => void el.dispatchEvent(Object.assign(new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button }), { pointerType: 'mouse' })));
const click = (el: Element, x = 100, y = 100) => {
  pointer(el, 'pointerdown', x, y);
  pointer(el, 'pointerup', x, y);
};
const frame = () => act(async () => void (await new Promise((r) => setTimeout(r, 40))));

describe('the slide on black', () => {
  it('is as wide as fits: the window’s height decides when the window is wide', () => {
    const { box } = draw();
    // 960 x 600: a 16:9 slide is 960 wide and 540 high.
    expect(box!.style.width).toBe('960px');
    expect(box!.style.height).toBe('540px');
  });

  it('is as wide as the height allows in a window that is wider than a slide', () => {
    sizes.w = 1600;
    const { box } = draw();
    // 600 high: 600 * 16 / 9.
    expect(box!.style.width).toBe('1066px');
    expect(box!.style.height).toBe('599.625px');
    sizes.w = 960;
  });

  it('draws nothing but black before it has a size or a slide', () => {
    sizes.w = 0;
    const { box } = draw();
    expect(box).toBeNull();
    sizes.w = 960;
    const { box: none } = draw({ shown: null });
    expect(none).toBeNull();
  });

  it('says the slide to a screen reader, and only there', () => {
    draw({ announce: 'Slide 2 of 6. What we ship.' });
    const live = host.querySelector('.sp-sr')!;
    expect(live.textContent).toBe('Slide 2 of 6. What we ship.');
    expect(live.getAttribute('aria-live')).toBe('polite');
  });
});

describe('black, white and the end', () => {
  it('draws a screen over the slide and takes it away', () => {
    draw({ screen: 'black' });
    expect(host.querySelector('.sp-screen')!.getAttribute('data-screen')).toBe('black');
    draw({ screen: 'white' });
    expect(host.querySelector('.sp-screen')!.getAttribute('data-screen')).toBe('white');
    draw({ screen: 'none' });
    expect(host.querySelector('.sp-screen')!.getAttribute('data-screen')).toBe('none');
  });

  it('says what the end of the show is', () => {
    draw({ screen: 'end' });
    expect(host.querySelector('.sp-screen')!.textContent).toBe('End of slide show. Click to exit.');
  });

  it('is not drawn at all in the presenter’s own copy, which keeps the slide on view', () => {
    draw({ screen: 'black', overlay: false });
    expect(host.querySelector('.sp-screen')).toBeNull();
    expect(host.querySelector('.sp-slide .sl-view')).not.toBeNull();
  });

  it('keeps the slide underneath, so it is there when the screen goes', () => {
    draw({ screen: 'black' });
    expect(host.querySelector('.sp-slide .sl-view')).not.toBeNull();
  });
});

describe('a click, a tap and a swipe', () => {
  it('a click is next', () => {
    const onAct = vi.fn();
    const { surface } = draw({ onAct });
    click(surface);
    expect(onAct).toHaveBeenCalledWith({ type: 'next' });
  });

  it('a click that wandered a few pixels is still a click, and one that wandered far is not', () => {
    const onAct = vi.fn();
    const { surface } = draw({ onAct });
    pointer(surface, 'pointerdown', 100, 100);
    pointer(surface, 'pointerup', 104, 96);
    expect(onAct).toHaveBeenCalledTimes(1);
    onAct.mockClear();
    pointer(surface, 'pointerdown', 100, 100);
    pointer(surface, 'pointerup', 130, 100);
    expect(onAct).not.toHaveBeenCalled();
  });

  it('a swipe left is next and a swipe right is previous, and a mostly vertical one is neither', () => {
    const onAct = vi.fn();
    const { surface } = draw({ onAct });
    pointer(surface, 'pointerdown', 400, 200);
    pointer(surface, 'pointerup', 300, 205);
    expect(onAct).toHaveBeenLastCalledWith({ type: 'next' });
    pointer(surface, 'pointerdown', 300, 200);
    pointer(surface, 'pointerup', 420, 190);
    expect(onAct).toHaveBeenLastCalledWith({ type: 'prev' });
    onAct.mockClear();
    pointer(surface, 'pointerdown', 300, 100);
    pointer(surface, 'pointerup', 380, 300);
    expect(onAct).not.toHaveBeenCalled();
  });

  it('is only the main button’s', () => {
    const onAct = vi.fn();
    const { surface } = draw({ onAct });
    pointer(surface, 'pointerdown', 100, 100, 2);
    pointer(surface, 'pointerup', 100, 100, 2);
    expect(onAct).not.toHaveBeenCalled();
  });

  it('leaves a link on the slide to be followed, and is not next', () => {
    const onAct = vi.fn();
    const { box } = draw({ onAct });
    const link = document.createElement('a');
    link.href = 'https://example.com';
    box!.appendChild(link);
    click(link);
    expect(onAct).not.toHaveBeenCalled();
  });

  it('does nothing in the presenter’s own copy, which has no action to take', () => {
    const { surface } = draw({ onAct: undefined });
    expect(() => click(surface)).not.toThrow();
  });
});

describe('the browser’s menu', () => {
  it('does not open over the slide', () => {
    const { surface } = draw();
    const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    act(() => void surface.dispatchEvent(e));
    expect(e.defaultPrevented).toBe(true);
  });
});

describe('the cursor', () => {
  it('goes after two seconds without moving, and comes back when it moves', () => {
    vi.useFakeTimers();
    const { surface } = draw();
    pointer(surface, 'pointermove', 10, 10);
    expect(surface.hasAttribute('data-idle')).toBe(false);
    act(() => void vi.advanceTimersByTime(IDLE_MS - 100));
    expect(surface.hasAttribute('data-idle')).toBe(false);
    act(() => void vi.advanceTimersByTime(200));
    expect(surface.hasAttribute('data-idle')).toBe(true);
    pointer(surface, 'pointermove', 12, 12);
    expect(surface.hasAttribute('data-idle')).toBe(false);
  });

  it('goes after two seconds even when the pointer never moved, as when a show opens under a still hand', () => {
    vi.useFakeTimers();
    const { surface } = draw();
    expect(surface.hasAttribute('data-idle')).toBe(false);
    act(() => void vi.advanceTimersByTime(IDLE_MS + 50));
    expect(surface.hasAttribute('data-idle')).toBe(true);
  });

  it('is hidden for as long as the laser is on', () => {
    const { surface } = draw({ laser: true });
    expect(surface.hasAttribute('data-laser')).toBe(true);
    const { surface: off } = draw({ laser: false });
    expect(off.hasAttribute('data-laser')).toBe(false);
  });
});

describe('the laser', () => {
  it('follows the pointer over the slide, as a transform, and tells the other window where', async () => {
    const onPointer = vi.fn();
    const { surface, box } = draw({ laser: true, onPointer });
    const dot = box!.querySelector('.sp-laser') as HTMLElement;
    expect(dot.dataset.on).toBe('false');
    pointer(surface, 'pointermove', 480, 270);
    expect(dot.dataset.on).toBe('true');
    expect(dot.style.transform).toBe('translate(480px, 270px)');
    await frame();
    expect(onPointer).toHaveBeenCalledWith({ x: 0.5, y: 0.5 });
  });

  it('hides when the pointer is off the slide or has left the window, and says so', async () => {
    const onPointer = vi.fn();
    const { surface, box } = draw({ laser: true, onPointer });
    const dot = box!.querySelector('.sp-laser') as HTMLElement;
    pointer(surface, 'pointermove', 480, 270);
    pointer(surface, 'pointermove', 2000, 270);
    expect(dot.dataset.on).toBe('false');
    await frame();
    expect(onPointer).toHaveBeenLastCalledWith(null);
    pointer(surface, 'pointermove', 100, 100);
    // React makes `onPointerLeave` from a pointerout that goes nowhere.
    pointer(surface, 'pointerout', 100, 100);
    expect(dot.dataset.on).toBe('false');
  });

  it('sends one message a frame however many moves there were', async () => {
    const onPointer = vi.fn();
    const { surface } = draw({ laser: true, onPointer });
    for (let x = 100; x < 200; x += 5) pointer(surface, 'pointermove', x, 100);
    await frame();
    expect(onPointer).toHaveBeenCalledTimes(1);
    expect(onPointer.mock.calls[0]![0].x).toBeCloseTo(195 / 960);
  });

  it('sends nothing, and draws nothing, while the laser is off', async () => {
    const onPointer = vi.fn();
    const { surface, box } = draw({ laser: false, onPointer });
    pointer(surface, 'pointermove', 480, 270);
    await frame();
    expect(onPointer).not.toHaveBeenCalled();
    expect((box!.querySelector('.sp-laser') as HTMLElement).dataset.on).toBe('false');
  });

  it('draws the other window’s laser where it says, and not when the laser is off', () => {
    const { box } = draw({ laser: true, remote: { x: 0.25, y: 0.5 } });
    const dot = box!.querySelector('.sp-laser') as HTMLElement;
    expect(dot.dataset.on).toBe('true');
    expect(dot.style.transform).toBe('translate(240px, 270px)');
    const { box: after } = draw({ laser: true, remote: null });
    expect((after!.querySelector('.sp-laser') as HTMLElement).dataset.on).toBe('false');
    const { box: off } = draw({ laser: false, remote: { x: 0.25, y: 0.5 } });
    expect((off!.querySelector('.sp-laser') as HTMLElement).dataset.on).toBe('false');
  });

  it('moves with a transform and never with left or top', () => {
    const { surface, box } = draw({ laser: true });
    pointer(surface, 'pointermove', 300, 200);
    const dot = box!.querySelector('.sp-laser') as HTMLElement;
    expect(dot.style.left).toBe('');
    expect(dot.style.top).toBe('');
    expect(dot.style.transform).not.toBe('');
  });
});

describe('what is said on top of the slide', () => {
  it('shows the digits typed towards a slide number, ahead of a hint', () => {
    draw({ digits: '12', hint: 'Press F for full screen.' });
    expect(host.querySelector('.sp-chip')!.textContent).toBe('Go to slide 12');
    draw({ digits: '', hint: 'Press F for full screen.' });
    expect(host.querySelector('.sp-chip')!.textContent).toBe('Press F for full screen.');
    draw({ digits: '', hint: null });
    expect(host.querySelector('.sp-chip')).toBeNull();
  });
});
