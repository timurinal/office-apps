// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { modelOf } from '../model/testing';
import { LayoutGrid } from './LayoutGallery';

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

describe('the layout gallery', () => {
  it('names each layout by its name alone, not by the prompts drawn in its picture', () => {
    const m = modelOf();
    const design = m.design()!;
    act(() => root.render(<LayoutGrid design={design} current={null} onPick={() => undefined} />));
    const names = [...host.querySelectorAll('.sl-layout')].map((b) => b.getAttribute('aria-label'));
    expect(names).toEqual(design.layouts.map((l) => l.name));
    m.destroy();
  });
});
