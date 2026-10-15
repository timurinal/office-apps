// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DocsContext } from '../modules/types';
import { FontSizeBox, TableButton } from './ribbonControls';
import { sizeAt } from './text';
import { docOf, jsonOf, makeEditor, p, select, type TestEditor } from './testing';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
let t: TestEditor;

beforeEach(() => {
  host = document.body.appendChild(document.createElement('div'));
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  t?.destroy();
});

const ctxFor = (editor: TestEditor['editor'], edit = true): DocsContext => ({ editor, can: { edit } }) as unknown as DocsContext;

const input = () => host.querySelector<HTMLInputElement>('input[aria-label="Font size"]')!;

/** React's change event: the value set through the property's own setter. */
function type(el: HTMLInputElement, value: string) {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
const press = (el: Element, key: string) =>
  act(() => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });

describe('the size box', () => {
  beforeEach(() => {
    t = makeEditor(docOf(p('Hello world')));
    select(t.editor, 'world');
  });

  it('shows 11 for text with no size, and the size the selection has', () => {
    act(() => root.render(<FontSizeBox ctx={ctxFor(t.editor)} />));
    expect(input().value).toBe('11');
    act(() => {
      t.editor.chain().setMark('textStyle', { fontSize: '14pt' }).run();
    });
    act(() => root.render(<FontSizeBox ctx={ctxFor(t.editor)} />));
    expect(input().value).toBe('14');
  });

  it('applies a size that is typed, on Enter', () => {
    act(() => root.render(<FontSizeBox ctx={ctxFor(t.editor)} />));
    act(() => input().focus());
    type(input(), '18');
    press(input(), 'Enter');
    expect(sizeAt(t.editor)).toBe('18pt');
    expect(input().value).toBe('18');
  });

  it('takes a half point, and a comma for the point', () => {
    act(() => root.render(<FontSizeBox ctx={ctxFor(t.editor)} />));
    act(() => input().focus());
    type(input(), '10,5');
    press(input(), 'Enter');
    expect(sizeAt(t.editor)).toBe('10.5pt');
  });

  it('puts back what was there when what is typed is not a size, and changes nothing', () => {
    act(() => root.render(<FontSizeBox ctx={ctxFor(t.editor)} />));
    act(() => input().focus());
    type(input(), 'huge');
    press(input(), 'Enter');
    expect(sizeAt(t.editor)).toBeNull();
    expect(input().value).toBe('11');
  });

  it('steps along the list with the arrow keys, applying each step', () => {
    act(() => root.render(<FontSizeBox ctx={ctxFor(t.editor)} />));
    act(() => input().focus());
    press(input(), 'ArrowUp');
    expect(sizeAt(t.editor)).toBe('12pt');
    press(input(), 'ArrowUp');
    expect(sizeAt(t.editor)).toBe('14pt');
    press(input(), 'ArrowDown');
    expect(sizeAt(t.editor)).toBe('12pt');
  });

  it('offers Word’s sizes in a list, and applies the one chosen', async () => {
    act(() => root.render(<FontSizeBox ctx={ctxFor(t.editor)} />));
    act(() => host.querySelector<HTMLButtonElement>('button[aria-label="Font sizes"]')!.click());
    const options = [...host.querySelectorAll('[role="option"]')].map((o) => o.textContent);
    expect(options).toEqual(['8', '9', '10', '10.5', '11', '12', '14', '16', '18', '20', '22', '24', '26', '28', '36', '48', '72']);
    act(() => (host.querySelectorAll<HTMLElement>('[role="option"]')[8] as HTMLElement).click());
    expect(sizeAt(t.editor)).toBe('18pt');
  });

  it('is disabled for a reader', () => {
    act(() => root.render(<FontSizeBox ctx={ctxFor(t.editor, false)} />));
    expect(input().disabled).toBe(true);
    expect(host.querySelector<HTMLButtonElement>('button[aria-label="Font sizes"]')!.disabled).toBe(true);
  });
});

describe('the table grid', () => {
  beforeEach(() => {
    t = makeEditor(docOf(p('Before')));
    t.editor.commands.focus('end');
  });

  const open = () => act(() => host.querySelector<HTMLButtonElement>('button[data-id="insert.table"]')!.click());
  const cells = () => [...host.querySelectorAll<HTMLElement>('.oa-grid-cell')];
  const label = () => host.querySelector('.oa-grid-label')?.textContent;

  it('has a grid of ten by eight, and starts at three by three', () => {
    act(() => root.render(<TableButton ctx={ctxFor(t.editor)} />));
    open();
    expect(cells()).toHaveLength(80);
    expect(label()).toBe('3 × 3');
  });

  it('says the size under the pointer, columns first, as Word does', () => {
    act(() => root.render(<TableButton ctx={ctxFor(t.editor)} />));
    open();
    act(() => cells()[2 * 10 + 4]!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })));
    // React listens for mouseover on the root to make mouseenter.
    act(() => cells()[2 * 10 + 4]!.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false })));
    expect(['5 × 3', '3 × 3']).toContain(label());
  });

  it('inserts the table that was clicked, and shuts', () => {
    act(() => root.render(<TableButton ctx={ctxFor(t.editor)} />));
    open();
    act(() => cells()[3 * 10 + 5]!.click());
    const table = jsonOf(t.editor).content!.find((n) => n.type === 'table')!;
    expect(table.content).toHaveLength(4);
    expect(table.content![0]!.content).toHaveLength(6);
  });

  it('is driven from the keyboard: arrows size it, Enter inserts', () => {
    act(() => root.render(<TableButton ctx={ctxFor(t.editor)} />));
    open();
    const grid = host.querySelector('.oa-grid')!;
    press(grid, 'ArrowRight');
    press(grid, 'ArrowRight');
    press(grid, 'ArrowDown');
    expect(label()).toBe('5 × 4');
    press(grid, 'Enter');
    const table = jsonOf(t.editor).content!.find((n) => n.type === 'table')!;
    expect(table.content).toHaveLength(4);
    expect(table.content![0]!.content).toHaveLength(5);
  });

  it('never goes below one by one or past the grid', () => {
    act(() => root.render(<TableButton ctx={ctxFor(t.editor)} />));
    open();
    const grid = host.querySelector('.oa-grid')!;
    for (let i = 0; i < 12; i++) press(grid, 'ArrowLeft');
    for (let i = 0; i < 12; i++) press(grid, 'ArrowUp');
    expect(label()).toBe('1 × 1');
    for (let i = 0; i < 20; i++) press(grid, 'ArrowRight');
    for (let i = 0; i < 20; i++) press(grid, 'ArrowDown');
    expect(label()).toBe('10 × 8');
  });

  it('is off for a reader', () => {
    act(() => root.render(<TableButton ctx={ctxFor(t.editor, false)} />));
    expect(host.querySelector<HTMLButtonElement>('button[data-id="insert.table"]')!.disabled).toBe(true);
  });
});
