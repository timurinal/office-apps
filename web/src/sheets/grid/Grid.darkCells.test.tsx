// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Grid } from './Grid';
import { GridSession } from './session';
import { FakeSheet } from './testing/fake';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 800 });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 500 });
  host = document.body.appendChild(document.createElement('div'));
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const mount = (darkCells?: boolean) =>
  act(() => root.render(<Grid session={new GridSession()} data={new FakeSheet({ rows: 20, cols: 6 })} onIntent={() => undefined} zoom={100} {...(darkCells === undefined ? {} : { darkCells })} />));
const sgRoot = () => host.querySelector<HTMLElement>('.sg-root')!;

describe('Dark cells on the grid', () => {
  it('is off unless the prop says so', () => {
    mount();
    expect(sgRoot().dataset.darkCells).toBe('off');
  });

  it('follows the prop', () => {
    mount(true);
    expect(sgRoot().dataset.darkCells).toBe('on');
    mount(false);
    expect(sgRoot().dataset.darkCells).toBe('off');
  });
});

describe('grid.css', () => {
  const css = readFileSync(join(process.cwd(), 'web/src/sheets/grid/grid.css'), 'utf8');

  it('turns the option into a variable for the dark theme only', () => {
    expect(css).toMatch(/\[data-theme='dark'\] \.sg-root\[data-dark-cells='on'\]\s*\{\s*--sg-dark-cells: 1;/);
    expect(css).not.toMatch(/(^|\n)\.sg-root\[data-dark-cells='on'\]/);
  });

  it('gives the selected header on the dark theme the app’s solid and its ink, and not Slides’ orange', () => {
    const dark = /\[data-theme='dark'\] \.sg-root \{([^}]*)\}/.exec(css)![1]!;
    expect(dark).toMatch(/--sg-head-solid:\s*var\(--app-solid/);
    expect(dark).toMatch(/--sg-head-solid-ink:\s*var\(--app-on-solid/);
    expect(dark).not.toMatch(/249,\s*168,\s*116/);
  });
});
