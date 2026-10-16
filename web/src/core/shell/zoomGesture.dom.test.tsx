// @vitest-environment happy-dom
import { act, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { keyZoomsHere, stepZoom, useHoldStill, useZoomGesture, wheelZoom, zoomKey, type Pt } from './zoomGesture';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('the arithmetic', () => {
  it('steps a notched wheel by ten, to the next ten, and no further than the range', () => {
    expect(wheelZoom(100, { deltaY: -100, deltaMode: 0 }, 50, 200)).toBe(110);
    expect(wheelZoom(100, { deltaY: 100, deltaMode: 0 }, 50, 200)).toBe(90);
    // Firefox counts a notch in lines.
    expect(wheelZoom(100, { deltaY: -3, deltaMode: 1 }, 50, 200)).toBe(110);
    expect(stepZoom(87, 1, 50, 200)).toBe(90);
    expect(stepZoom(87, -1, 50, 200)).toBe(80);
    expect(stepZoom(195, 1, 50, 200)).toBe(200);
    expect(stepZoom(200, 1, 50, 200)).toBe(200);
    expect(stepZoom(50, -1, 50, 200)).toBe(50);
  });

  it('scales smoothly for a pinch, by a factor, so that out and back in returns', () => {
    const a = wheelZoom(100, { deltaY: -2.5, deltaMode: 0 }, 50, 200);
    expect(a).toBeGreaterThan(100);
    expect(a).toBeLessThan(105);
    expect(wheelZoom(a, { deltaY: 2.5, deltaMode: 0 }, 50, 200)).toBeCloseTo(100, 9);
    // The same pinch is the same ratio at any zoom.
    expect(wheelZoom(150, { deltaY: -2.5, deltaMode: 0 }, 50, 200) / 150).toBeCloseTo(a / 100, 9);
    expect(wheelZoom(199, { deltaY: -20, deltaMode: 0 }, 50, 200)).toBe(200);
  });

  it('never zooms the wrong way from outside the range: Fit can be smaller than the smallest step', () => {
    expect(stepZoom(40, -1, 50, 200)).toBe(40);
    expect(stepZoom(40, 1, 50, 200)).toBe(50);
    expect(wheelZoom(40, { deltaY: 1.5, deltaMode: 0 }, 50, 200)).toBe(40);
  });

  it('reads Ctrl with = or +, with or without Shift, and the keypad, and - and 0', () => {
    const k = (key: string, more: Partial<KeyboardEvent> = {}) => zoomKey({ key, code: '', ctrlKey: true, metaKey: false, altKey: false, ...more });
    expect(k('=')).toBe('in');
    expect(k('+', { shiftKey: true })).toBe('in');
    expect(k('+', { code: 'NumpadAdd' })).toBe('in');
    expect(k('-')).toBe('out');
    expect(k('_', { shiftKey: true })).toBe('out');
    expect(k('-', { code: 'NumpadSubtract' })).toBe('out');
    expect(k('0')).toBe('reset');
    expect(k('0', { code: 'Numpad0' })).toBe('reset');
    expect(k('=', { ctrlKey: false, metaKey: true })).toBe('in');
    expect(k('=', { ctrlKey: false })).toBeNull();
    // AltGr is Ctrl and Alt together on Windows: a character, not a shortcut.
    expect(k('=', { altKey: true })).toBeNull();
    expect(k('a')).toBeNull();
  });
});

describe('where it runs', () => {
  let box: HTMLDivElement;
  beforeEach(() => {
    box = document.createElement('div');
    box.innerHTML = `
      <div class="chrome"><input type="range" id="slider"><input id="find"><button id="btn">B</button></div>
      <div data-zoom-content><textarea id="cell"></textarea></div>
      <div contenteditable="true" id="page"><p id="para">Text</p></div>
      <div role="dialog"><button id="in-dialog">OK</button><input id="dialog-field"></div>`;
    document.body.appendChild(box);
  });
  afterEach(() => box.remove());
  const at = (id: string) => box.querySelector(`#${id}`);

  it('keys: not in a dialog, nor a field outside the content; in a page, a text box or a cell, yes', () => {
    expect(keyZoomsHere(document.body)).toBe(true);
    expect(keyZoomsHere(at('btn'))).toBe(true);
    expect(keyZoomsHere(at('para'))).toBe(true);
    expect(keyZoomsHere(at('cell'))).toBe(true);
    expect(keyZoomsHere(at('slider'))).toBe(false);
    expect(keyZoomsHere(at('find'))).toBe(false);
    expect(keyZoomsHere(at('in-dialog'))).toBe(false);
    expect(keyZoomsHere(at('dialog-field'))).toBe(false);
  });
});

describe('the listeners', () => {
  let host: HTMLDivElement;
  let root: Root;
  let calls: { percent: number; at: Pt | null }[];
  let resets: number;

  function Editor({ start = 100, enabled }: { start?: number; enabled?: boolean }) {
    const [zoom, setZoom] = useState(start);
    useZoomGesture({
      ...(enabled === undefined ? {} : { enabled }),
      value: zoom,
      min: 50,
      max: 200,
      set: (percent, at) => {
        calls.push({ percent, at });
        setZoom(percent);
      },
      reset: () => {
        resets++;
        setZoom(100);
      }
    });
    return (
      <div>
        <output id="pct">{zoom}</output>
        <input id="find" />
        <div role="dialog">
          <button id="in-dialog">OK</button>
        </div>
      </div>
    );
  }

  beforeEach(() => {
    calls = [];
    resets = 0;
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  const pct = () => Number(host.querySelector('#pct')!.textContent);
  const wheel = (target: EventTarget, init: WheelEventInit) => {
    const e = new WheelEvent('wheel', { bubbles: true, cancelable: true, ...init });
    // happy-dom's WheelEvent drops the modifier keys and the pointer's position.
    Object.defineProperties(e, {
      ctrlKey: { value: init.ctrlKey ?? false },
      clientX: { value: init.clientX ?? 0 },
      clientY: { value: init.clientY ?? 0 }
    });
    act(() => void target.dispatchEvent(e));
    return e.defaultPrevented;
  };
  const key = (target: EventTarget, key: string, init: KeyboardEventInit = {}) => {
    const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ctrlKey: true, ...init });
    act(() => void target.dispatchEvent(e));
    return e.defaultPrevented;
  };

  it('takes Ctrl and the wheel from the browser, and holds the pointer still', () => {
    act(() => root.render(<Editor />));
    expect(wheel(document.body, { ctrlKey: true, deltaY: -100, clientX: 30, clientY: 40 })).toBe(true);
    expect(pct()).toBe(110);
    expect(calls.at(-1)).toEqual({ percent: 110, at: { x: 30, y: 40 } });
    expect(wheel(document.body, { ctrlKey: true, deltaY: 100 })).toBe(true);
    expect(pct()).toBe(100);
    // Without Ctrl the wheel scrolls.
    expect(wheel(document.body, { deltaY: 100 })).toBe(false);
    expect(pct()).toBe(100);
  });

  it('is registered as a listener that may prevent the default: not passive', () => {
    const spy = vi.spyOn(window, 'addEventListener');
    try {
      act(() => root.render(<Editor />));
      expect(spy.mock.calls.filter((c) => (c[0] as string) === 'wheel').map((c) => c[2])).toEqual([{ passive: false }]);
    } finally {
      spy.mockRestore();
    }
  });

  it('adds up a pinch’s small steps rather than rounding each away', () => {
    act(() => root.render(<Editor />));
    for (let i = 0; i < 10; i++) wheel(document.body, { ctrlKey: true, deltaY: -0.4 });
    // Each step alone is 0.4%, which rounds to nothing; ten of them are 4%.
    expect(pct()).toBe(104);
  });

  it('steps by ten from the keys, holding the centre, and Ctrl+0 resets', () => {
    act(() => root.render(<Editor start={87} />));
    expect(key(document.body, '=')).toBe(true);
    expect(pct()).toBe(90);
    expect(calls.at(-1)).toEqual({ percent: 90, at: null });
    expect(key(document.body, '+', { shiftKey: true })).toBe(true);
    expect(pct()).toBe(100);
    expect(key(document.body, '-')).toBe(true);
    expect(pct()).toBe(90);
    expect(key(document.body, '0')).toBe(true);
    expect(resets).toBe(1);
    expect(pct()).toBe(100);
  });

  it('leaves the keys alone in a field outside the content, in a dialog, and when something took them first', () => {
    act(() => root.render(<Editor />));
    expect(key(host.querySelector('#find')!, '=')).toBe(false);
    expect(key(host.querySelector('#in-dialog')!, '=')).toBe(false);
    const first = (e: Event) => e.preventDefault();
    document.addEventListener('keydown', first);
    try {
      key(document.body, '-');
    } finally {
      document.removeEventListener('keydown', first);
    }
    expect(pct()).toBe(100);
    expect(calls).toEqual([]);
  });

  it('takes the wheel over a field and over a dialog too: the browser would zoom the whole site, and remember it', () => {
    act(() => root.render(<Editor />));
    expect(wheel(host.querySelector('#find')!, { ctrlKey: true, deltaY: -100 })).toBe(true);
    expect(wheel(host.querySelector('#in-dialog')!, { ctrlKey: true, deltaY: -100 })).toBe(true);
    expect(pct()).toBe(120);
  });

  it('leaves everything to the browser while it is off: Slides’ show', () => {
    act(() => root.render(<Editor enabled={false} />));
    expect(wheel(document.body, { ctrlKey: true, deltaY: -100 })).toBe(false);
    expect(key(document.body, '=')).toBe(false);
    act(() => root.render(<Editor enabled />));
    expect(wheel(document.body, { ctrlKey: true, deltaY: -100 })).toBe(true);
    expect(pct()).toBe(110);
  });

  it('stops listening when the editor goes', () => {
    act(() => root.render(<Editor />));
    act(() => root.render(<div />));
    expect(wheel(document.body, { ctrlKey: true, deltaY: -100 })).toBe(false);
    expect(key(document.body, '=')).toBe(false);
  });
});

describe('holding a point still', () => {
  let host: HTMLDivElement;
  let root: Root;
  let hold: (at: Pt | null) => void = () => undefined;
  let setScale: (s: number) => void = () => undefined;

  /**
   * happy-dom has no layout, so the content's box is computed: it starts 100 px from the scroller's
   * left and 50 px from its top, at `scale` times 1000 by 800, less what is scrolled.
   */
  function Desk() {
    const [scale, set] = useState(1);
    setScale = set;
    const scroller = useRef<HTMLDivElement>(null);
    const content = useRef<HTMLDivElement>(null);
    hold = useHoldStill(() => scroller.current, () => content.current, scale);
    return (
      <div ref={scroller} id="scroller">
        <div ref={content} id="content" data-scale={scale} />
      </div>
    );
  }

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root.render(<Desk />));
    const scroller = host.querySelector<HTMLElement>('#scroller')!;
    const content = host.querySelector<HTMLElement>('#content')!;
    Object.defineProperty(scroller, 'clientWidth', { configurable: true, value: 600 });
    Object.defineProperty(scroller, 'clientHeight', { configurable: true, value: 400 });
    scroller.getBoundingClientRect = () => new DOMRect(0, 0, 600, 400);
    content.getBoundingClientRect = () => {
      const s = Number(content.dataset.scale);
      return new DOMRect(100 - scroller.scrollLeft, 50 - scroller.scrollTop, 1000 * s, 800 * s);
    };
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  /** The content's own point under a client point. */
  const under = (p: Pt) => {
    const c = host.querySelector<HTMLElement>('#content')!;
    const r = c.getBoundingClientRect();
    const s = Number(c.dataset.scale);
    return { x: (p.x - r.left) / s, y: (p.y - r.top) / s };
  };

  it('scrolls so that the point under the pointer is under it again', () => {
    const p = { x: 300, y: 250 };
    const before = under(p);
    act(() => {
      hold(p);
      setScale(2);
    });
    const after = under(p);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });

  it('holds the centre of the view when there is no pointer', () => {
    const centre = { x: 300, y: 200 };
    const before = under(centre);
    act(() => {
      hold(null);
      setScale(1.5);
    });
    const after = under(centre);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });

  it('does nothing to a zoom it was not asked to hold', () => {
    const scroller = host.querySelector<HTMLElement>('#scroller')!;
    act(() => setScale(2));
    expect(scroller.scrollLeft).toBe(0);
    expect(scroller.scrollTop).toBe(0);
  });
});
