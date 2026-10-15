// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { modelOf, testDeck } from '../model/testing';
import type { SlidesContext } from '../modules/types';
import { presenter } from './index';
import { clearLaunch, peekLaunch, PLAIN, setLaunch } from './launch';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  clearLaunch();
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  clearLaunch();
});

const ctx = () => {
  const model = modelOf(testDeck([{ id: 's1', layout: 'blank', elements: [] }, { id: 's2', layout: 'blank', elements: [] }]));
  return { model, design: model.design(), select: { slide: vi.fn() }, meta: { id: 'doc' }, notify: vi.fn() } as unknown as SlidesContext;
};
const start = (from = 0) => act(() => root.render(presenter.render(ctx(), { from, close: vi.fn() })));

describe('what the editor draws while a show runs', () => {
  it('is the show over the page when nothing else was asked', () => {
    start();
    expect(document.body.querySelector('.sp-root')).not.toBeNull();
    expect(document.body.querySelector('.sp-console')).toBeNull();
  });

  it('is the presenter’s view when a command asked for it, and uses what the command left', () => {
    setLaunch({ mode: 'presenter', show: 'tok12345', audience: null });
    start();
    expect(document.body.querySelector('.sp-console')).not.toBeNull();
    expect(document.body.querySelector('.sp-root')).toBeNull();
    // Taken: the next show starts plain.
    expect(peekLaunch()).toBe(PLAIN);
  });

  it('is a plain show when what was left has gone stale', () => {
    setLaunch({ mode: 'presenter', show: 'tok12345', audience: null }, Date.now() - 60_000);
    start();
    expect(document.body.querySelector('.sp-root')).not.toBeNull();
  });

  it('keeps its kind while the editor draws again around it', () => {
    setLaunch({ mode: 'presenter', show: 'tok12345', audience: null });
    const c = ctx();
    const close = vi.fn();
    act(() => root.render(presenter.render(c, { from: 0, close })));
    act(() => root.render(presenter.render({ ...c }, { from: 0, close })));
    expect(document.body.querySelector('.sp-console')).not.toBeNull();
  });
});
