// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ToastHost } from '../../core/ui';
import { rect, setup, table } from '../modules/testkit';
import type { SheetsContext } from '../modules/types';
import SizeDialog, { describeLines } from './SizeDialog';
import { ToolsHost } from './ToolsHost';
import { closeTool, openTool } from './tools';

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
  closeTool();
  document.body.innerHTML = '';
});

const wait = (ms = 0) => act(async () => void (await new Promise((r) => setTimeout(r, ms))));
const q = <T extends Element>(sel: string): T => document.body.querySelector<T>(sel)!;

async function page() {
  const t = await setup(table(['Item', 'Qty', 'Note'], ['pear', '3', 'x']));
  const closed: boolean[] = [];
  const ctx = Object.assign(Object.create(t.ctx), { can: { edit: true }, actions: { focusGrid: () => undefined } }) as SheetsContext;
  const show = (axis: 'col' | 'row') => act(() => root.render(<ToastHost><SizeDialog ctx={ctx} axis={axis} onClose={() => closed.push(true)} /></ToastHost>));
  return { t, ctx, closed, show };
}

const field = (): HTMLInputElement => q<HTMLInputElement>('input');
const type = (text: string) =>
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field(), text);
    field().dispatchEvent(new Event('input', { bubbles: true }));
  });
const apply = () => act(() => [...document.body.querySelectorAll<HTMLButtonElement>('button')].find((b) => /^Set (width|height)$/.test(b.textContent!))!.click());

describe('the words for the chosen lines', () => {
  it('names one or a run', () => {
    expect(describeLines('col', 1, 1)).toBe('Column B.');
    expect(describeLines('col', 1, 3)).toBe('Columns B to D.');
    expect(describeLines('row', 2, 2)).toBe('Row 3.');
    expect(describeLines('row', 2, 4)).toBe('Rows 3 to 5.');
  });
});

describe('Column width', () => {
  it('starts from the width the first chosen column has', async () => {
    const p = await page();
    p.t.select(rect(0, 1, 5, 2));
    p.show('col');
    expect(q('h2').textContent).toBe('Column width');
    expect(q('.oa-dialog-desc').textContent).toBe('Columns B to C.');
    expect(field().value).toBe('112');
    expect(q('.sx-unit').textContent).toBe('px');
  });

  it('starts from the default for a hidden column', async () => {
    const p = await page();
    p.t.model.hide(p.t.ctx.sheetId, 'col', 1, 1, true);
    p.t.select(rect(0, 1, 0, 1));
    p.show('col');
    expect(field().value).toBe('112');
  });

  it('sets every chosen column in one step, which one Undo takes back', async () => {
    const p = await page();
    p.t.select(rect(0, 0, 3, 2));
    p.show('col');
    type('200');
    apply();
    await wait(200);
    expect([0, 1, 2, 3].map((c) => p.t.ctx.data.colWidth(c))).toEqual([200, 200, 200, 112]);
    expect(p.closed).toEqual([true]);
    p.t.model.undo();
    expect([0, 1, 2].map((c) => p.t.ctx.data.colWidth(c))).toEqual([112, 112, 112]);
  });

  it('keeps the dialog open and says what is allowed, for what is not a number or is out of range', async () => {
    const p = await page();
    p.t.select(rect(0, 0, 0, 0));
    p.show('col');
    for (const bad of ['', 'abc', '0', '7', '5001', '-4', '12px']) {
      type(bad);
      apply();
      expect(q('.oa-field-note').textContent, bad).toBe('Enter a width from 8 to 5000.');
    }
    expect(p.closed).toEqual([]);
    expect(p.t.ctx.data.colWidth(0)).toBe(112);
    type('64');
    expect(document.body.querySelector('.oa-field-note')).toBeNull();
  });

  it('does not send the page anywhere when Enter submits the form', async () => {
    const p = await page();
    p.t.select(rect(0, 0, 0, 0));
    p.show('col');
    const submit = new Event('submit', { bubbles: true, cancelable: true });
    act(() => void q<HTMLFormElement>('form').dispatchEvent(submit));
    expect(submit.defaultPrevented).toBe(true);
  });
});

describe('Row height', () => {
  it('sets the chosen rows', async () => {
    const p = await page();
    p.t.select(rect(0, 0, 1, 2));
    p.show('row');
    expect(q('h2').textContent).toBe('Row height');
    expect(q('.oa-dialog-desc').textContent).toBe('Rows 1 to 2.');
    expect(field().value).toBe('26');
    type('48');
    apply();
    await wait(200);
    expect([0, 1, 2].map((r) => p.t.ctx.data.rowHeight(r))).toEqual([48, 48, 26]);
  });

  it('has its own limits, and says them', async () => {
    const p = await page();
    p.t.select(rect(0, 0, 0, 0));
    p.show('row');
    type('2001');
    apply();
    expect(q('.oa-field-note').textContent).toBe('Enter a height from 8 to 2000.');
  });
});

describe('through the tools store', () => {
  it('opens the dialog the menu asks for, with the right axis', async () => {
    const p = await page();
    p.t.select(rect(0, 1, 0, 1));
    act(() => root.render(<ToastHost><ToolsHost ctx={p.ctx} /></ToastHost>));
    openTool({ id: 'size', axis: 'col' });
    await wait(50);
    expect(q('h2').textContent).toBe('Column width');
    closeTool();
    openTool({ id: 'size', axis: 'row' });
    await wait(50);
    expect(q('h2').textContent).toBe('Row height');
  });
});
