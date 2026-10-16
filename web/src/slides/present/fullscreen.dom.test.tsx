// @vitest-environment happy-dom
import { act, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useFullscreen } from './fullscreen';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * What a real browser does, as seen in headed Zen and headed Chromium (Phase 5c): in Fullscreen API full screen,
 * Escape and F11 are the browser's. Neither reaches the page as a key, and the page is told only that full screen
 * ended. So the page cannot tell which one the person pressed.
 */
let host: HTMLDivElement;
let root: Root;
let current: Element | null;
const request = vi.fn(async function (this: HTMLElement) {
  current = this;
  document.dispatchEvent(new Event('fullscreenchange'));
});
const leave = () => {
  current = null;
  document.dispatchEvent(new Event('fullscreenchange'));
};

beforeEach(() => {
  current = null;
  Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: true });
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => current });
  Object.defineProperty(document, 'exitFullscreen', { configurable: true, value: vi.fn(async () => leave()) });
  (HTMLElement.prototype as unknown as { requestFullscreen: unknown }).requestFullscreen = request;
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  request.mockClear();
  for (const k of ['fullscreenEnabled', 'fullscreenElement', 'exitFullscreen']) delete (document as unknown as Record<string, unknown>)[k];
  delete (HTMLElement.prototype as unknown as Record<string, unknown>).requestFullscreen;
});

function mount(start: boolean) {
  const onEscape = vi.fn();
  let toggle!: () => void;
  function Probe() {
    const el = useRef<HTMLDivElement>(null);
    toggle = useFullscreen(el, { start, onEscape }).toggle;
    return <div ref={el} />;
  }
  act(() => root.render(<Probe />));
  return { onEscape, toggle: () => act(() => toggle()) };
}

describe('a show that opened full screen', () => {
  it('ends when the browser leaves full screen, which is how Escape reaches it', async () => {
    const t = mount(true);
    await act(async () => void (await Promise.resolve()));
    expect(current).not.toBeNull();
    act(() => leave());
    expect(t.onEscape).toHaveBeenCalledTimes(1);
  });

  it('is not ended by its own F: it leaves and enters without ending', async () => {
    const t = mount(true);
    await act(async () => void (await Promise.resolve()));
    t.toggle();
    await act(async () => void (await Promise.resolve()));
    expect(current).toBeNull();
    t.toggle();
    await act(async () => void (await Promise.resolve()));
    expect(t.onEscape).not.toHaveBeenCalled();
  });
});

describe('a window the person put into full screen, with F or F11', () => {
  it('is not ended by the browser leaving it: Escape and F11 both do, and cannot be told apart', async () => {
    const t = mount(false);
    t.toggle();
    await act(async () => void (await Promise.resolve()));
    expect(current).not.toBeNull();
    act(() => leave());
    expect(t.onEscape).not.toHaveBeenCalled();
  });

  it('can go in and out as often as it is asked, and is never ended', async () => {
    const t = mount(false);
    for (let i = 0; i < 3; i++) {
      t.toggle();
      await act(async () => void (await Promise.resolve()));
      act(() => leave());
    }
    expect(t.onEscape).not.toHaveBeenCalled();
  });
});
