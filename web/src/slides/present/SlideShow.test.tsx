// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DeckJSON } from '../model/deck';
import type { SlideModel } from '../model/model';
import { modelOf, testDeck } from '../model/testing';
import type { SlidesContext } from '../modules/types';
import { SlideShow } from './SlideShow';

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
  stubFullscreen(false);
});

const slides = (n: number, hidden: number[] = []): DeckJSON['slides'] =>
  Array.from({ length: n }, (_, i) => ({ id: `s${i + 1}`, layout: 'blank', elements: [], ...(hidden.includes(i) ? { hidden: true } : {}) }));

function setup(model: SlideModel, from = 0) {
  const select = vi.fn();
  const close = vi.fn();
  const ctx = { model, design: model.design(), select: { slide: select }, meta: { id: 'doc' }, notify: vi.fn() } as unknown as SlidesContext;
  act(() => root.render(<SlideShow ctx={ctx} from={from} close={close} />));
  return { select, close, ctx };
}

const show = () => document.body.querySelector('.sp-root') as HTMLElement | null;
const shownSlide = () => document.body.querySelector('.sp-sr')!.textContent;

/** A key as a browser sends it: to the window in capture, then the document, and a page's own handlers after. */
function keydown(k: string, over: KeyboardEventInit = {}, target: EventTarget = document.body) {
  const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...over });
  act(() => void target.dispatchEvent(e));
  return e;
}

/** A browser with full screen, answering as the real one does, in steps the test takes. */
function stubFullscreen(on: boolean) {
  const doc = document as unknown as Record<string, unknown>;
  const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
  if (!on) {
    delete doc.fullscreenEnabled;
    delete doc.fullscreenElement;
    delete doc.exitFullscreen;
    delete proto.requestFullscreen;
    return { request: vi.fn(), exit: vi.fn(), leaveByBrowser: () => undefined };
  }
  const request = vi.fn(async function (this: HTMLElement) {
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => this });
    document.dispatchEvent(new Event('fullscreenchange'));
  });
  const leave = () => {
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => null });
    document.dispatchEvent(new Event('fullscreenchange'));
  };
  const exit = vi.fn(async () => leave());
  Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: true });
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => null });
  Object.defineProperty(document, 'exitFullscreen', { configurable: true, value: exit });
  proto.requestFullscreen = request;
  return { request, exit, leaveByBrowser: leave };
}

describe('the show over the page', () => {
  it('is a dialog on the body in the dark, with the slide announced', () => {
    setup(modelOf(testDeck(slides(3))), 1);
    const el = show()!;
    expect(el.parentElement).toBe(document.body);
    expect(el.getAttribute('role')).toBe('dialog');
    expect(el.getAttribute('aria-label')).toBe('Slide show');
    expect(el.getAttribute('data-theme')).toBe('dark');
    expect(shownSlide()).toBe('Slide 2 of 3.');
  });

  it('takes the keyboard: focus moves to it', () => {
    setup(modelOf(testDeck(slides(3))));
    expect(document.activeElement).toBe(show());
  });

  it('takes it back when focus wandered out, and the key still counts', () => {
    setup(modelOf(testDeck(slides(3))));
    const input = document.createElement('input');
    host.appendChild(input);
    input.focus();
    expect(document.activeElement).toBe(input);
    keydown('ArrowRight', {}, input);
    expect(document.activeElement).toBe(show());
    expect(shownSlide()).toBe('Slide 2 of 3.');
  });
});

describe('the keys', () => {
  it('step through the slides', () => {
    setup(modelOf(testDeck(slides(4))));
    keydown('ArrowRight');
    expect(shownSlide()).toBe('Slide 2 of 4.');
    keydown(' ');
    keydown('PageDown');
    expect(shownSlide()).toBe('Slide 4 of 4.');
    keydown('ArrowLeft');
    keydown('Home');
    expect(shownSlide()).toBe('Slide 1 of 4.');
    keydown('End');
    expect(shownSlide()).toBe('Slide 4 of 4.');
  });

  it('skip hidden slides', () => {
    setup(modelOf(testDeck(slides(5, [1, 2]))));
    keydown('ArrowRight');
    expect(shownSlide()).toBe('Slide 4 of 5.');
    keydown('ArrowLeft');
    expect(shownSlide()).toBe('Slide 1 of 5.');
  });

  it('go to the slide that was typed, when Enter is pressed', () => {
    setup(modelOf(testDeck(slides(12))));
    keydown('1');
    keydown('0');
    expect(document.body.querySelector('.sp-chip')!.textContent).toBe('Go to slide 10');
    keydown('Enter');
    expect(shownSlide()).toBe('Slide 10 of 12.');
    expect(document.body.querySelector('.sp-chip')).toBeNull();
  });

  it('blank the screen and bring it back', () => {
    setup(modelOf(testDeck(slides(2))));
    keydown('b');
    expect(document.body.querySelector('.sp-screen')!.getAttribute('data-screen')).toBe('black');
    keydown('w');
    expect(document.body.querySelector('.sp-screen')!.getAttribute('data-screen')).toBe('white');
    keydown('w');
    expect(document.body.querySelector('.sp-screen')!.getAttribute('data-screen')).toBe('none');
  });

  it('switch the laser on with L and with Ctrl+P, and keep the browser from printing', () => {
    setup(modelOf(testDeck(slides(2))));
    const surface = () => document.body.querySelector('.sp-surface')!;
    keydown('l');
    expect(surface().hasAttribute('data-laser')).toBe(true);
    keydown('l');
    expect(surface().hasAttribute('data-laser')).toBe(false);
    const e = keydown('p', { ctrlKey: true });
    expect(surface().hasAttribute('data-laser')).toBe(true);
    expect(e.defaultPrevented).toBe(true);
  });

  it('never reach the editor under the show', () => {
    setup(modelOf(testDeck(slides(2))));
    const page = vi.fn();
    document.addEventListener('keydown', page);
    window.addEventListener('keydown', page);
    keydown('ArrowRight');
    keydown('Delete');
    keydown('z', { ctrlKey: true });
    expect(page).not.toHaveBeenCalled();
    document.removeEventListener('keydown', page);
    window.removeEventListener('keydown', page);
  });

  it('keep a letter out of the text box that still has focus under the show', () => {
    setup(modelOf(testDeck(slides(2))));
    const input = document.createElement('input');
    host.appendChild(input);
    const e = keydown('a', {}, input);
    expect(e.defaultPrevented).toBe(true);
    expect(keydown('Delete', {}, input).defaultPrevented).toBe(true);
    expect(keydown('F5').defaultPrevented).toBe(true);
  });

  it('leave the browser’s own: reload, close and the tools', () => {
    setup(modelOf(testDeck(slides(2))));
    expect(keydown('r', { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(keydown('w', { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(keydown('F12').defaultPrevented).toBe(false);
    expect(keydown('ArrowLeft', { altKey: true }).defaultPrevented).toBe(false);
  });

  it('advance on a click', () => {
    setup(modelOf(testDeck(slides(3))));
    const surface = document.body.querySelector('.sp-surface')!;
    for (const type of ['pointerdown', 'pointerup']) act(() => void surface.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: 50, clientY: 50, button: 0 })));
    expect(shownSlide()).toBe('Slide 2 of 3.');
  });
});

describe('leaving', () => {
  it('on Escape, and the editor is on the slide the show ended on', () => {
    const { close, select } = setup(modelOf(testDeck(slides(5))));
    keydown('ArrowRight');
    keydown('ArrowRight');
    keydown('Escape');
    expect(select).toHaveBeenCalledTimes(1);
    expect(select).toHaveBeenCalledWith('s3');
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('after the end of the show, on the press after it', () => {
    const { close, select } = setup(modelOf(testDeck(slides(2))), 1);
    keydown('ArrowRight');
    expect(document.body.querySelector('.sp-screen')!.getAttribute('data-screen')).toBe('end');
    expect(close).not.toHaveBeenCalled();
    keydown('ArrowRight');
    expect(close).toHaveBeenCalledTimes(1);
    expect(select).toHaveBeenCalledWith('s2');
  });

  it('with no slides in the deck, at once', () => {
    const { close } = setup(modelOf(testDeck([])));
    expect(close).toHaveBeenCalledTimes(1);
  });
});

describe('full screen', () => {
  it('is asked for when the show opens, on its own element', async () => {
    const fs = stubFullscreen(true);
    setup(modelOf(testDeck(slides(2))));
    await act(async () => void (await Promise.resolve()));
    expect(fs.request).toHaveBeenCalledTimes(1);
    expect(fs.request.mock.contexts[0]).toBe(show());
  });

  it('ends the show when the browser leaves full screen, as Escape does there', async () => {
    const fs = stubFullscreen(true);
    const { close, select } = setup(modelOf(testDeck(slides(3))));
    await act(async () => void (await Promise.resolve()));
    keydown('ArrowRight');
    act(() => fs.leaveByBrowser());
    expect(close).toHaveBeenCalledTimes(1);
    expect(select).toHaveBeenCalledWith('s2');
  });

  it('is left and entered by F without ending the show', async () => {
    const fs = stubFullscreen(true);
    const { close } = setup(modelOf(testDeck(slides(3))));
    await act(async () => void (await Promise.resolve()));
    keydown('f');
    await act(async () => void (await Promise.resolve()));
    expect(fs.exit).toHaveBeenCalledTimes(1);
    expect(close).not.toHaveBeenCalled();
    keydown('f');
    await act(async () => void (await Promise.resolve()));
    expect(fs.request).toHaveBeenCalledTimes(2);
    expect(close).not.toHaveBeenCalled();
    // And Escape, once it is windowed, is the show's own.
    act(() => void stubFullscreen(false));
    keydown('Escape');
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('is only the window where the browser has none, and Escape is the show’s', () => {
    stubFullscreen(false);
    const { close } = setup(modelOf(testDeck(slides(2))));
    expect(show()).not.toBeNull();
    keydown('Escape');
    expect(close).toHaveBeenCalledTimes(1);
  });
});
