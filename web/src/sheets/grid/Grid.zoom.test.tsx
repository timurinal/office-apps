// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Grid } from './Grid';
import { GridSession } from './session';
import { FakeSheet } from './testing/fake';
import { budgetSheet } from './testing/samples';
import type { GridView } from './view';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** happy-dom has no layout: the grid is given an 800 by 500 box at the window's origin. */
const VIEW = { w: 800, h: 500 };

const origClientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
const origClientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight');
const origRect = Element.prototype.getBoundingClientRect;

let host: HTMLDivElement;
let root: Root;
let sheet: FakeSheet;
let session: GridSession;
let views: GridView[];

function mount(zoom: number, zoomAt?: { x: number; y: number } | null) {
  act(() =>
    root.render(
      <div style={{ position: 'relative', width: VIEW.w, height: VIEW.h }}>
        <Grid session={session} data={sheet} onIntent={() => undefined} zoom={zoom} {...(zoomAt !== undefined ? { zoomAt } : {})} />
      </div>
    )
  );
}

const frame = () =>
  act(
    () =>
      new Promise<void>((done) => {
        requestAnimationFrame(() => requestAnimationFrame(() => done()));
      })
  );
const scroller = () => host.querySelector<HTMLElement>('.sg-scroller')!;
const view = () => views.at(-1)!;

/** The cell under a point of the grid's box, and how far into it the point is, as fractions. */
function under(x: number, y: number) {
  const L = view().fresh()!;
  const row = L.rowAtY(y);
  const col = L.colAtX(x);
  const box = L.cellBox(row, col);
  return { row, col, fx: (x - box.x) / box.w, fy: (y - box.y) / box.h };
}

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => VIEW.w });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => VIEW.h });
  Element.prototype.getBoundingClientRect = function () {
    return { left: 0, top: 0, right: VIEW.w, bottom: VIEW.h, width: VIEW.w, height: VIEW.h, x: 0, y: 0, toJSON: () => ({}) };
  };
  if (typeof ResizeObserver === 'undefined') {
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {}
      disconnect() {}
      unobserve() {}
    };
  }
  views = [];
  (globalThis as { __sgViews?: GridView[] }).__sgViews = views;
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  sheet = budgetSheet();
  sheet.rows = 1000;
  sheet.cols = 60;
  session = new GridSession();
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  delete (globalThis as { __sgViews?: GridView[] }).__sgViews;
  Element.prototype.getBoundingClientRect = origRect;
  if (origClientWidth) Object.defineProperty(HTMLElement.prototype, 'clientWidth', origClientWidth);
  if (origClientHeight) Object.defineProperty(HTMLElement.prototype, 'clientHeight', origClientHeight);
});

describe('zooming the grid', () => {
  it('keeps the cell under the pointer under it, to the same point inside it', async () => {
    mount(100);
    await frame();
    act(() => {
      scroller().scrollTop = 26 * 100;
      scroller().scrollLeft = 300;
      scroller().dispatchEvent(new Event('scroll'));
    });
    await frame();
    const at = { x: 430, y: 290 };
    const before = under(at.x, at.y);
    expect(before.row).toBeGreaterThan(100);

    mount(170, at);
    await frame();
    const after = under(at.x, at.y);
    expect([after.row, after.col]).toEqual([before.row, before.col]);
    expect(after.fx).toBeCloseTo(before.fx, 6);
    expect(after.fy).toBeCloseTo(before.fy, 6);

    // And back out.
    mount(80, at);
    await frame();
    const out = under(at.x, at.y);
    expect([out.row, out.col]).toEqual([before.row, before.col]);
    expect(out.fy).toBeCloseTo(before.fy, 6);
  });

  it('holds the centre of the grid for a zoom with no pointer', async () => {
    mount(100);
    await frame();
    act(() => {
      scroller().scrollTop = 26 * 200;
      scroller().dispatchEvent(new Event('scroll'));
    });
    await frame();
    const before = under(VIEW.w / 2, VIEW.h / 2);
    mount(150, null);
    await frame();
    const after = under(VIEW.w / 2, VIEW.h / 2);
    expect([after.row, after.col]).toEqual([before.row, before.col]);
    expect(after.fy).toBeCloseTo(before.fy, 6);
  });

  it('keeps the first visible row and column, as before, when the footer zooms', async () => {
    mount(100);
    await frame();
    act(() => {
      scroller().scrollTop = 26 * 100;
      scroller().dispatchEvent(new Event('scroll'));
    });
    await frame();
    const top = view().fresh()!.scrolledRows()?.[0];
    mount(150);
    await frame();
    expect(view().fresh()!.scrolledRows()?.[0]).toBe(top);
  });
});
