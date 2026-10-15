// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeTool, openNow } from '../panes/tools';
import { rulesOf } from './conditionalActions';
import { PainterHost } from './painterHost';
import { arm, disarm, painterNow } from './painter';
import { BordersButton, CellStylesButton, ConditionalButton, PainterButton, SizeBox } from './ribbonControls';
import { activeStyle, lift, toggle } from './formatActions';
import { rect, setup, table } from './testkit';
import type { SheetsContext } from './types';

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
  disarm();
  closeTool();
  document.body.innerHTML = '';
});

const frame = () =>
  act(
    () =>
      new Promise<void>((done) => {
        requestAnimationFrame(() => requestAnimationFrame(() => done()));
      })
  );

async function page(edit = true) {
  const t = await setup(table(['Name', 'Qty'], ['Rent', '950'], ['Food', '400'], ['Rent', '950']));
  const panes: string[] = [];
  let focused = 0;
  const ctx = {
    ...t.ctx,
    can: { edit, share: true, history: true, copy: true, trash: true, star: true, rename: true, create: true, download: true },
    source: { kind: 'cloud' },
    actions: { focusGrid: () => void focused++, focusPalette: () => undefined },
    panes: { isOpen: () => false, open: (id: string) => void panes.push(id), close: () => undefined, toggle: () => undefined }
  } as unknown as SheetsContext;
  return { t, ctx, panes, focused: () => focused };
}

const q = <T extends Element>(sel: string) => document.body.querySelector<T>(sel)!;
const all = <T extends Element>(sel: string) => [...document.body.querySelectorAll<T>(sel)];
const click = (el: Element) => act(() => (el as HTMLElement).click());

const set = (el: HTMLInputElement, value: string) =>
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });

const key = (el: Element, k: string) =>
  act(() => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  });

describe('the size box', () => {
  it('shows the size of the active cell, and applies a typed one on Enter, back to the grid', async () => {
    const { t, ctx, focused } = await page();
    act(() => root.render(<SizeBox ctx={ctx} />));
    await frame();
    const box = q<HTMLInputElement>('input[data-id="home.size"]');
    expect(box.value).toBe('10');
    act(() => box.focus());
    set(box, '14');
    key(box, 'Enter');
    await frame();
    expect(t.style(0, 0).size).toBe(14);
    expect(box.value).toBe('14');
    expect(focused()).toBeGreaterThan(0);
  });

  it('steps with the arrows, along the list, and goes back to the cell’s own on Escape', async () => {
    const { t, ctx } = await page();
    act(() => root.render(<SizeBox ctx={ctx} />));
    await frame();
    const box = q<HTMLInputElement>('input[data-id="home.size"]');
    act(() => box.focus());
    key(box, 'ArrowUp');
    await frame();
    expect(t.style(0, 0).size).toBe(11);
    key(box, 'ArrowUp');
    key(box, 'ArrowDown');
    await frame();
    expect(t.style(0, 0).size).toBe(11);
    set(box, '40');
    key(box, 'Escape');
    await frame();
    expect(box.value).toBe('11');
  });

  it('ignores what is not a size, and reaches every cell of the selection', async () => {
    const { t, ctx } = await page();
    t.select(rect(1, 0, 2, 1));
    act(() => root.render(<SizeBox ctx={ctx} />));
    await frame();
    const box = q<HTMLInputElement>('input[data-id="home.size"]');
    act(() => box.focus());
    set(box, 'big');
    key(box, 'Enter');
    await frame();
    expect(t.style(1, 0).size).toBeUndefined();
    act(() => box.focus());
    set(box, '12');
    key(box, 'Enter');
    await frame();
    expect([t.style(1, 0).size, t.style(2, 1).size]).toEqual([12, 12]);
  });

  it('is off for a reader', async () => {
    const { ctx } = await page(false);
    act(() => root.render(<SizeBox ctx={ctx} />));
    expect(q<HTMLInputElement>('input[data-id="home.size"]').disabled).toBe(true);
  });
});

describe('the borders panel', () => {
  it('applies the preset it is given with the pen it has, and remembers the pen', async () => {
    const { t, ctx } = await page();
    t.select(rect(1, 0, 2, 1));
    act(() => root.render(<BordersButton ctx={ctx} />));
    click(q('button[data-id="home.borders"]'));
    click(q('button[aria-label="Dashed"]'));
    click(q('button[aria-label="Outside borders"]'));
    expect(t.style(1, 0)).toMatchObject({ borderTop: { line: 'dashed' }, borderLeft: { line: 'dashed' } });
    expect(t.style(2, 1)).toMatchObject({ borderBottom: { line: 'dashed' }, borderRight: { line: 'dashed' } });
    // One step, and it closed.
    expect(t.model.undo()).toBe(true);
    expect(t.style(1, 0).borderTop).toBeUndefined();
    expect(q('button[data-id="home.borders"]').getAttribute('aria-expanded')).toBe('false');
    await act(async () => void (await new Promise((r) => setTimeout(r, 200))));
    expect(document.body.querySelector('.sx-border-panel')).toBeNull();
    // The pen is kept for the next time, and for the next time the ribbon is drawn (another tab and back).
    act(() => root.render(<div />));
    act(() => root.render(<BordersButton ctx={ctx} />));
    click(q('button[data-id="home.borders"]'));
    expect(q('button[aria-label="Dashed"]').getAttribute('aria-pressed')).toBe('true');
    click(q('button[aria-label="Thin"]'));
  });

  it('offers every side and a border off', async () => {
    const { ctx } = await page();
    act(() => root.render(<BordersButton ctx={ctx} />));
    click(q('button[data-id="home.borders"]'));
    const labels = all<HTMLButtonElement>('.sx-border-grid button').map((b) => b.getAttribute('aria-label'));
    expect(labels).toEqual(
      expect.arrayContaining(['Bottom border', 'Top border', 'Left border', 'Right border', 'No border', 'All borders', 'Outside borders', 'Thick outside borders', 'Inside borders', 'Double bottom border'])
    );
  });
});

describe('cell styles', () => {
  it('lays a named style on the selection, and clears the formats from the gallery', async () => {
    const { t, ctx } = await page();
    t.select(rect(1, 0, 1, 1));
    act(() => root.render(<CellStylesButton ctx={ctx} />));
    click(q('button[data-id="home.cell-styles"]'));
    click(all<HTMLButtonElement>('.sx-styles-grid button').find((b) => b.textContent === 'Bad')!);
    expect(t.style(1, 1)).toMatchObject({ fill: '#ffc7ce', color: '#9c0006' });
    click(q('button[data-id="home.cell-styles"]'));
    click(all<HTMLButtonElement>('.sx-styles-grid button').find((b) => b.textContent === 'Clear formats')!);
    expect(t.style(1, 1)).toEqual({});
  });
});

describe('the conditional formatting menu', () => {
  const open = async () => {
    const p = await page();
    p.t.select(rect(1, 1, 3, 1));
    act(() => root.render(<ConditionalButton ctx={p.ctx} />));
    click(q('button[data-id="home.conditional"]'));
    return p;
  };
  const row = (text: string) => all<HTMLButtonElement>('.sx-cf-menu button[role="menuitem"]').find((b) => b.textContent === text)!;

  it('adds a rule without a question for duplicates, and above and below average', async () => {
    const { ctx } = await open();
    click(row('Duplicate values'));
    expect(rulesOf(ctx).map((r) => r.rule.when)).toEqual([{ kind: 'duplicate' }]);
    click(q('button[data-id="home.conditional"]'));
    click(row('Below average'));
    expect(rulesOf(ctx)[0]!.rule.when).toEqual({ kind: 'average', below: true });
  });

  it('puts a data bar or a colour scale on the selection from its swatch', async () => {
    const { ctx, t } = await open();
    click(q('button[aria-label="Orange data bars"]'));
    expect(rulesOf(ctx)[0]!.rule.when).toMatchObject({ kind: 'bar', color: '#ffb628' });
    expect(t.ctx.data.cell(1, 1)?.conditional?.bar?.color).toBe('#ffb628');
    click(q('button[data-id="home.conditional"]'));
    click(q('button[aria-label="Red, white, blue colour scale"]'));
    expect(rulesOf(ctx)[0]!.rule.when).toMatchObject({ kind: 'scale', min: '#f8696b', max: '#5a8ac6' });
  });

  it('opens the rule dialog on the kind chosen, the pane for the manager, and clears rules', async () => {
    const { ctx, panes } = await open();
    click(row('Between…'));
    expect(openNow()).toMatchObject({ id: 'cf', initial: { kind: 'cell', op: 'between' } });
    click(q('button[data-id="home.conditional"]'));
    click(row('Manage rules'));
    expect(panes).toEqual(['cf-rules']);
    click(q('button[data-id="home.conditional"]'));
    click(row('Duplicate values'));
    expect(rulesOf(ctx)).toHaveLength(1);
    click(q('button[data-id="home.conditional"]'));
    click(row('Clear rules from the sheet'));
    expect(rulesOf(ctx)).toEqual([]);
  });

  it('is off for a reader', async () => {
    const { ctx } = await page(false);
    act(() => root.render(<ConditionalButton ctx={ctx} />));
    expect(q<HTMLButtonElement>('button[data-id="home.conditional"]').disabled).toBe(true);
  });
});

describe('the format painter', () => {
  /** A grid root the host can find by the session's id, as the real one is. */
  const gridRoot = (id: string) => {
    const el = document.createElement('div');
    el.className = 'sg-root';
    el.innerHTML = `<div data-sg-editor="${id}"></div><div class="sg-scroller" id="scroller"></div>`;
    document.body.appendChild(el);
    return el;
  };
  const sheetPage = () => {
    const el = document.createElement('div');
    el.className = 'oa-sheet-page';
    document.body.appendChild(el);
    return el;
  };
  const release = (el: Element) =>
    act(async () => {
      el.dispatchEvent(new Event('pointerup', { bubbles: true, cancelable: true }));
      await new Promise((r) => setTimeout(r, 5));
    });

  it('is pressed while it is armed, and lays the format on the next selection the pointer ends on', async () => {
    const { t, ctx } = await page();
    t.select(rect(0, 0));
    toggle(ctx, 'bold');
    const page_ = sheetPage();
    const grid = gridRoot(t.session.id);
    act(() =>
      root.render(
        <>
          <PainterButton ctx={ctx} />
          <PainterHost ctx={ctx} />
        </>
      )
    );
    click(q('button[data-id="home.painter"]'));
    expect(q('button[data-id="home.painter"]').getAttribute('aria-pressed')).toBe('true');
    expect(page_.getAttribute('data-painter')).toBe('armed');
    expect(painterNow()).toMatchObject({ bold: true });

    t.select(rect(1, 0, 3, 1));
    await release(grid.querySelector('#scroller')!);
    expect([t.style(1, 0).bold, t.style(3, 1).bold]).toEqual([true, true]);
    expect(painterNow()).toBeNull();
    expect(page_.hasAttribute('data-painter')).toBe(false);
    expect(q('button[data-id="home.painter"]').getAttribute('aria-pressed')).toBe('false');
    // It was one step.
    t.model.undo();
    expect(t.style(1, 0).bold).toBeUndefined();
  });

  it('ignores a pointer that comes up elsewhere, and goes away on Escape', async () => {
    const { t, ctx } = await page();
    t.select(rect(0, 0));
    toggle(ctx, 'italic');
    sheetPage();
    gridRoot(t.session.id);
    act(() => root.render(<PainterHost ctx={ctx} />));
    act(() => arm(lift(activeStyle(ctx))));
    t.select(rect(2, 0));
    await release(document.body);
    expect(painterNow()).not.toBeNull();
    expect(t.style(2, 0).italic).toBeUndefined();
    key(document.body, 'Escape');
    expect(painterNow()).toBeNull();
  });

  it('paints a plain cell over a formatted one, making it plain', async () => {
    const { t, ctx } = await page();
    t.select(rect(1, 0));
    toggle(ctx, 'bold');
    t.select(rect(0, 1));
    const grid = gridRoot(t.session.id);
    sheetPage();
    act(() => root.render(<PainterHost ctx={ctx} />));
    act(() => arm(lift(activeStyle(ctx))));
    t.select(rect(1, 0));
    await release(grid.querySelector('#scroller')!);
    expect(t.style(1, 0)).toEqual({});
  });
});
