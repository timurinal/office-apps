// @vitest-environment happy-dom
import { act, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RouterProvider } from '../../router';
import { fileTextIcon } from '../icons';
import { EditorShell } from './EditorShell';
import { FOOTER_STEPS, HEADER_STEPS, overflows, useSqueeze } from './squeeze';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * happy-dom has no layout, so a box's widths are given here: a bar is `room` wide, and what it
 * holds is as wide as `need` says for the steps it is at. The shell's title is 60px wide and holds
 * `titleText` px of text.
 */
const BARS = '.bar, .oa-hd, .oa-footer';
let room = 0;
let need: (steps: string, el: HTMLElement) => number = () => 0;
let titleText = 60;
const sizes = { scrollWidth: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollWidth'), clientWidth: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth') };

let observed: (() => void)[] = [];
let host: HTMLDivElement;
let root: Root;

function Bar({ steps, tight }: { steps: readonly string[]; tight?: (el: HTMLElement) => boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useSqueeze(ref, steps, tight);
  return (
    <div ref={ref} className="bar">
      <span className="part">Connected</span>
    </div>
  );
}

const bar = () => host.querySelector<HTMLElement>('.bar')!;
const resize = (w: number) => {
  room = w;
  act(() => observed.forEach((f) => f()));
};
const frame = () => act(() => new Promise<void>((done) => requestAnimationFrame(() => done())));

beforeEach(() => {
  room = 400;
  need = () => 0;
  titleText = 60;
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get(this: HTMLElement) {
      return this.matches(BARS) ? room : this.matches('.oa-hd-title') ? 60 : 0;
    }
  });
  Object.defineProperty(HTMLElement.prototype, 'scrollWidth', {
    configurable: true,
    get(this: HTMLElement) {
      return this.matches(BARS) ? Math.max(room, need(this.dataset.squeeze ?? '', this)) : this.matches('.oa-hd-title') ? titleText : 0;
    }
  });
  observed = [];
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(private cb: () => void) {}
      observe() {
        observed.push(this.cb);
      }
      disconnect() {
        observed = observed.filter((f) => f !== this.cb);
      }
      unobserve() {}
    }
  );
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  for (const [k, d] of Object.entries(sizes)) if (d) Object.defineProperty(HTMLElement.prototype, k, d);
});

describe('squeezing a bar', () => {
  /** Each step saves 100px from 600. */
  const byStep = (steps: string) => 600 - (steps ? steps.split(' ').length : 0) * 100;

  it('takes the fewest steps, lowest first, that leave nothing overflowing', () => {
    need = byStep;
    room = 650;
    act(() => root.render(<Bar steps={['slider', 'words', 'extras']} />));
    expect(bar().dataset.squeeze).toBeUndefined();
    resize(480);
    expect(bar().dataset.squeeze).toBe('slider words');
    resize(300);
    // Past the last step there is nothing more to take.
    expect(bar().dataset.squeeze).toBe('slider words extras');
  });

  it('gives the steps back when there is room again', () => {
    need = byStep;
    room = 300;
    act(() => root.render(<Bar steps={['slider', 'words', 'extras']} />));
    expect(bar().dataset.squeeze).toBe('slider words extras');
    resize(520);
    expect(bar().dataset.squeeze).toBe('slider');
    resize(1000);
    expect(bar().dataset.squeeze).toBeUndefined();
  });

  it('measures again when what the bar holds changes, once a frame', async () => {
    let wide = false;
    need = (s) => (wide && !s ? 500 : 0);
    act(() => root.render(<Bar steps={['words']} />));
    expect(bar().dataset.squeeze).toBeUndefined();
    wide = true;
    act(() => {
      bar().querySelector('.part')!.textContent = 'Connecting to the room';
    });
    await frame();
    expect(bar().dataset.squeeze).toBe('words');
  });

  it('takes a step for a caller’s own reason as well as for an overflow', () => {
    need = () => 0;
    let cut = true;
    act(() => root.render(<Bar steps={['search', 'words']} tight={(el) => cut && !el.dataset.squeeze} />));
    expect(bar().dataset.squeeze).toBe('search');
    cut = false;
    resize(400);
    expect(bar().dataset.squeeze).toBeUndefined();
  });
});

describe('what counts as overflowing', () => {
  it('is the bar, or any of its parts, holding more than its width', () => {
    const el = document.createElement('div');
    const part = document.createElement('span');
    el.appendChild(part);
    const box = (e: HTMLElement, client: number, scroll: number) => {
      Object.defineProperty(e, 'clientWidth', { configurable: true, value: client });
      Object.defineProperty(e, 'scrollWidth', { configurable: true, value: scroll });
    };
    box(el, 300, 300);
    box(part, 100, 100);
    expect(overflows(el)).toBe(false);
    // A part that has shrunk under its content, as the footer's left half does.
    box(part, 0, 164);
    expect(overflows(el)).toBe(true);
    // Half a pixel is rounding, not an overlap.
    box(part, 100, 101);
    expect(overflows(el)).toBe(false);
  });
});

describe('the shell’s steps', () => {
  it('drop the least needed first', () => {
    expect(HEADER_STEPS).toEqual(['title', 'words', 'extras']);
    expect(FOOTER_STEPS).toEqual(['slider', 'words', 'extras', 'zoom']);
  });

  const shell = () => (
    <RouterProvider>
      <EditorShell
        kind="docs"
        header={{ title: 'Quarterly plan', titleEditable: false, onRename: () => undefined, badgeIcon: fileTextIcon, people: [] }}
        search={null}
        ribbon={{ tabs: [{ id: 'home', label: 'Home' }], groups: [], ctx: {}, active: 'home', onActive: () => undefined, fileMenu: null, subscribe: () => () => undefined }}
        statusLeft={<span className="oa-status">0 words</span>}
      >
        <div />
      </EditorShell>
    </RouterProvider>
  );
  const squeezed = (sel: string) => host.querySelector<HTMLElement>(sel)!.dataset.squeeze;

  it('are taken by the header and the footer as each runs out of room', () => {
    const taken = (steps: string) => (steps ? steps.split(' ').length : 0);
    need = (steps, el) => 900 - taken(steps) * (el.matches('.oa-hd') ? 200 : 150);
    room = 1000;
    act(() => root.render(shell()));
    expect(squeezed('.oa-hd')).toBeUndefined();
    expect(squeezed('.oa-footer')).toBeUndefined();
    resize(500);
    expect(squeezed('.oa-hd')).toBe('title words');
    expect(squeezed('.oa-footer')).toBe('slider words extras');
  });

  it('gives a title cut short the room first, and takes nothing more for it', () => {
    titleText = 240;
    act(() => root.render(shell()));
    expect(squeezed('.oa-hd')).toBe('title');
    expect(squeezed('.oa-footer')).toBeUndefined();
  });
});
