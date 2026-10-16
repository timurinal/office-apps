// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { chooseCombo, comboValue, isCombobox } from '../../core/selectTestkit';
import { ToastHost } from '../../core/ui';
import { toggleFilter, validationRules } from '../modules/dataActions';
import { rulesOf } from '../modules/conditionalActions';
import { listNames } from '../modules/formulaActions';
import { rect, setup, table } from '../modules/testkit';
import type { SheetsContext } from '../modules/types';
import CfDialog from './CfDialog';
import DuplicatesDialog from './DuplicatesDialog';
import FilterMenu from './FilterMenu';
import FindBar from './FindBar';
import { closeFind, findNow, openFind } from './findStore';
import InsertFunctionDialog from './InsertFunctionDialog';
import NameManager from './NameManager';
import NumberFormatDialog from './NumberFormatDialog';
import SortDialog from './SortDialog';
import TextToColumnsDialog from './TextToColumnsDialog';
import { ToolsHost } from './ToolsHost';
import { closeTool, openNow, openTool } from './tools';
import ValidationDialog from './ValidationDialog';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  if (typeof ResizeObserver === 'undefined') {
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {}
      disconnect() {}
      unobserve() {}
    };
  }
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  closeTool();
  closeFind();
  document.body.innerHTML = '';
});

const wait = (ms = 0) => act(async () => void (await new Promise((r) => setTimeout(r, ms))));

const people = table(['Name', 'Team', 'Score'], ['Ada', 'Red', '30'], ['Ben', 'Blue', '10'], ['Cai', 'Red', '20'], ['Dee', 'Blue', '40']);

/** What the page hands a tool, over a real workbook. */
async function page(rows = people) {
  const t = await setup(rows);
  const toasts: string[] = [];
  const closed: (() => void)[] = [];
  const ctx = {
    ...t.ctx,
    can: { edit: true, share: true, history: true, copy: true, trash: true, star: true, rename: true, create: true, download: true },
    source: { kind: 'cloud' },
    actions: { focusGrid: () => undefined, focusPalette: () => undefined },
    panes: { isOpen: () => false, open: () => undefined, close: () => undefined, toggle: () => undefined },
    notify: (x: { text: string }) => toasts.push(x.text),
    showSheet: t.ctx.showSheet
  } as unknown as SheetsContext;
  const onClose = (after?: () => void) => {
    closed.push(() => undefined);
    after?.();
  };
  return { t, ctx, toasts, closed, onClose };
}

const render = (node: React.ReactNode) => act(() => root.render(<ToastHost>{node}</ToastHost>));

const q = <T extends Element>(sel: string): T => document.body.querySelector<T>(sel)!;
const all = <T extends Element>(sel: string): T[] => [...document.body.querySelectorAll<T>(sel)];

const labelled = (text: string): HTMLInputElement => {
  const label = all<HTMLLabelElement>('label').find((l) => l.textContent === text);
  if (!label) throw new Error(`no field labelled ${text}`);
  return document.getElementById(label.htmlFor) as HTMLInputElement;
};

const setValue = (el: HTMLElement, value: string) => {
  // A dropdown is the page's own: a button that opens a list.
  if (isCombobox(el)) return chooseCombo(el, value);
  return act(() => {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

const press = (text: string) => {
  const b = all<HTMLButtonElement>('button').find((x) => x.textContent?.trim() === text && !x.disabled);
  if (!b) throw new Error(`no button ${text}`);
  act(() => b.click());
};

const pressStarting = (text: string) => {
  const b = all<HTMLButtonElement>('button').find((x) => x.textContent?.trim().startsWith(text) && !x.disabled);
  if (!b) throw new Error(`no button starting ${text}`);
  act(() => b.click());
};

const tick = (el: HTMLInputElement) => act(() => el.click());

describe('Sort', () => {
  it('sorts by the keys it is given, under a heading, as one step', async () => {
    const { t, ctx, onClose } = await page();
    t.select(rect(1, 2));
    render(<SortDialog ctx={ctx} onClose={onClose} />);
    expect(q('.oa-dialog-desc').textContent).toBe('A1:C5, 4 rows.');
    setValue(labelled('Order'), 'desc');
    press('Add a key');
    expect(all('.sx-level')).toHaveLength(2);
    press('Sort');
    expect([1, 2, 3, 4].map((r) => t.text(r, 2))).toEqual(['40', '30', '20', '10']);
    expect(t.text(0, 2)).toBe('Score');
    t.model.undo();
    expect(t.text(1, 2)).toBe('30');
  });

  it('takes a column of text as data, until it is said to have a heading', async () => {
    const { t, ctx, onClose } = await page();
    t.select(rect(0, 0, 4, 0));
    render(<SortDialog ctx={ctx} onClose={onClose} />);
    expect(q<HTMLButtonElement>('button[role="switch"]').getAttribute('aria-checked')).toBe('false');
    press('Sort');
    expect([0, 1, 2, 3, 4].map((r) => t.text(r, 0))).toEqual(['Ada', 'Ben', 'Cai', 'Dee', 'Name']);
    t.model.undo();
    act(() => root.render(<ToastHost><SortDialog ctx={ctx} onClose={onClose} key="head" /></ToastHost>));
    act(() => q<HTMLButtonElement>('button[role="switch"]').click());
    press('Sort');
    expect([0, 1, 2, 3, 4].map((r) => t.text(r, 0))).toEqual(['Name', 'Ada', 'Ben', 'Cai', 'Dee']);
  });
});

describe('the filter menu', () => {
  it('lists the values with their counts, and keeps the ones left ticked', async () => {
    const { t, ctx, onClose } = await page();
    t.select(rect(1, 1));
    toggleFilter(ctx);
    render(<FilterMenu ctx={ctx} onClose={onClose} col={1} />);
    const rows = all('.sx-menu-values .sx-check').map((c) => c.textContent);
    expect(rows).toEqual(['Select all', 'Blue2', 'Red2']);
    tick(all<HTMLInputElement>('.sx-menu-values input')[1]!);
    press('OK');
    expect(ctx.data.filter()?.active).toEqual([1]);
    expect([1, 2, 3, 4].map((r) => ctx.data.rowHeight(r) > 0)).toEqual([true, false, true, false]);
    expect(t.model.filterCriterion(ctx.sheetId, 1)).toEqual({ kind: 'values', hidden: ['Blue'] });
  });

  it('does nothing when closed on an untouched list, so a condition is left alone', async () => {
    const { t, ctx, onClose } = await page();
    t.select(rect(1, 1));
    toggleFilter(ctx);
    t.model.setFilterCriterion(ctx.sheetId, 2, { kind: 'condition', op: 'gt', a: 15 });
    render(<FilterMenu ctx={ctx} onClose={onClose} col={2} />);
    press('OK');
    expect(t.model.filterCriterion(ctx.sheetId, 2)).toEqual({ kind: 'condition', op: 'gt', a: 15 });
  });

  it('stays open while a choice is made in its dropdown, whose list is drawn outside it', async () => {
    const { t, ctx, onClose, closed } = await page();
    t.select(rect(1, 1));
    toggleFilter(ctx);
    render(<FilterMenu ctx={ctx} onClose={onClose} col={0} />);
    pressStarting('Text filters');
    const trigger = labelled('Keep rows where the value');
    act(() => trigger.click());
    const list = document.getElementById(trigger.getAttribute('aria-controls')!)!;
    const option = list.querySelector<HTMLElement>('[role="option"][data-value="begins"]')!;
    // The menu ignores a press that began before it opened; these are later ones.
    const press = (target: Element) => {
      const e = new MouseEvent('pointerdown', { bubbles: true });
      Object.defineProperty(e, 'timeStamp', { value: performance.now() + 10_000 });
      act(() => void target.dispatchEvent(e));
    };
    // A press on the list is a press inside the menu that holds the dropdown.
    press(option);
    expect(document.body.querySelector('.sx-menu')!.getAttribute('data-state')).toBe('open');
    act(() => option.click());
    expect(comboValue(trigger)).toBe('begins');
    expect(closed).toHaveLength(0);
    // A press anywhere else still closes it.
    press(document.body);
    expect(document.body.querySelector('.sx-menu')!.getAttribute('data-state')).toBe('closed');
  });

  it('keeps rows by a condition on text, and by one on numbers', async () => {
    const { t, ctx, onClose } = await page();
    t.select(rect(1, 1));
    toggleFilter(ctx);
    render(<FilterMenu ctx={ctx} onClose={onClose} col={0} />);
    pressStarting('Text filters');
    setValue(labelled('Keep rows where the value'), 'begins');
    setValue(document.body.querySelector<HTMLInputElement>('input[aria-label="Value"]')!, 'c');
    press('Apply condition');
    expect(t.model.filterCriterion(ctx.sheetId, 0)).toEqual({ kind: 'text', op: 'begins', text: 'c' });
    expect([1, 2, 3, 4].map((r) => ctx.data.rowHeight(r) > 0)).toEqual([false, false, true, false]);

    act(() => root.render(<ToastHost><FilterMenu ctx={ctx} onClose={onClose} col={2} key="n" /></ToastHost>));
    pressStarting('Number filters');
    setValue(labelled('Keep rows where the value'), 'between');
    setValue(document.body.querySelector<HTMLInputElement>('input[aria-label="Value"]')!, '15');
    setValue(document.body.querySelector<HTMLInputElement>('input[aria-label="Second value"]')!, '35');
    press('Apply condition');
    expect(t.model.filterCriterion(ctx.sheetId, 2)).toEqual({ kind: 'condition', op: 'between', a: 15, b: 35 });
  });

  it('sorts the column from its menu and clears its filter', async () => {
    const { t, ctx, onClose } = await page();
    t.select(rect(1, 1));
    toggleFilter(ctx);
    render(<FilterMenu ctx={ctx} onClose={onClose} col={2} />);
    press('Sort Z to A');
    expect([1, 2, 3, 4].map((r) => t.text(r, 2))).toEqual(['40', '30', '20', '10']);
    t.model.setFilterCriterion(ctx.sheetId, 2, { kind: 'blank' });
    act(() => root.render(<ToastHost><FilterMenu ctx={ctx} onClose={onClose} col={2} key="again" /></ToastHost>));
    press('Clear filter from Score');
    expect(t.model.filterCriterion(ctx.sheetId, 2)).toBeNull();
  });

  it('keeps hidden a value that the other columns’ filters have taken out of its list', async () => {
    const { t, ctx, onClose } = await page(table(['Name', 'Team', 'Score'], ['Ada', 'Red', '30'], ['Ben', 'Blue', '40'], ['Cai', 'Gold', '5']));
    t.select(rect(1, 1));
    toggleFilter(ctx);
    t.model.setFilterCriterion(ctx.sheetId, 1, { kind: 'values', hidden: ['Gold'] });
    // Cai is the only Gold, and the score filter takes Cai out of the team list as well.
    t.model.setFilterCriterion(ctx.sheetId, 2, { kind: 'condition', op: 'gt', a: 10 });
    render(<FilterMenu ctx={ctx} onClose={onClose} col={1} />);
    expect(all('.sx-menu-values .sx-check').map((c) => c.textContent)).toEqual(['Select all', 'Blue1', 'Red1']);
    tick(all<HTMLInputElement>('.sx-menu-values input')[1]!);
    press('OK');
    expect(t.model.filterCriterion(ctx.sheetId, 1)).toEqual({ kind: 'values', hidden: ['Blue', 'Gold'] });
  });

  it('closes itself when the filter has gone', async () => {
    const { ctx, onClose, closed } = await page();
    render(<FilterMenu ctx={ctx} onClose={onClose} col={1} />);
    expect(closed.length).toBeGreaterThan(0);
    expect(document.body.querySelector('.sx-menu')).toBeNull();
  });
});

describe('conditional formatting rules', () => {
  it('adds a rule from the form, on the selection, and opens the pane that lists it', async () => {
    const { t, ctx, onClose } = await page();
    const opened: string[] = [];
    (ctx.panes as { open: (id: string) => void }).open = (id) => opened.push(id);
    t.select(rect(1, 2, 4, 2));
    render(<CfDialog ctx={ctx} onClose={onClose} initial={{ kind: 'cell', op: 'between', a: '', b: '' }} />);
    setValue(labelled('From'), '15');
    setValue(labelled('To'), '35');
    expect((labelled('Applies to') as HTMLInputElement).value).toBe('C2:C5');
    press('Add rule');
    const [rule] = rulesOf(ctx);
    expect(rule!.rule.when).toEqual({ kind: 'cell', op: 'between', a: 15, b: 35 });
    expect(rule!.rule.style).toMatchObject({ fill: '#ffc7ce' });
    expect(opened).toEqual(['cf-rules']);
    expect([1, 2, 3, 4].map((r) => !!ctx.data.cell(r, 2)?.conditional)).toEqual([true, false, true, false]);
  });

  it('says what is wrong and writes nothing', async () => {
    const { t, ctx, onClose } = await page();
    t.select(rect(1, 2));
    render(<CfDialog ctx={ctx} onClose={onClose} />);
    press('Add rule');
    expect(q('[role="alert"]').textContent).toBe('Type a value to compare with.');
    expect(rulesOf(ctx)).toEqual([]);
    setValue(labelled('Applies to'), 'ZZZ9999');
    setValue(labelled('Value'), '1');
    press('Add rule');
    expect(q('[role="alert"]').textContent).toBe('ZZZ9999 is not a range on this sheet.');
  });

  it('edits a rule it is given, keeping its place', async () => {
    const { t, ctx, onClose } = await page();
    t.select(rect(1, 2, 4, 2));
    render(<CfDialog ctx={ctx} onClose={onClose} initial={{ kind: 'cell', op: 'gt', a: '' }} />);
    setValue(labelled('Value'), '25');
    press('Add rule');
    const id = rulesOf(ctx)[0]!.id;
    act(() => root.render(<ToastHost><CfDialog ctx={ctx} onClose={onClose} ruleId={id} key={id} /></ToastHost>));
    expect((labelled('Value') as HTMLInputElement).value).toBe('25');
    setValue(labelled('Value'), '5');
    setValue(labelled('Format'), 'bold');
    press('Save');
    expect(rulesOf(ctx)).toHaveLength(1);
    expect(rulesOf(ctx)[0]).toMatchObject({ id, rule: { when: { kind: 'cell', op: 'gt', a: 5 }, style: { bold: true } } });
  });

  it('makes a colour scale and a data bar, which take no look of their own', async () => {
    const { t, ctx, onClose } = await page();
    t.select(rect(1, 2, 4, 2));
    render(<CfDialog ctx={ctx} onClose={onClose} />);
    setValue(labelled('Format cells with'), 'scale');
    expect(all('label').some((l) => l.textContent === 'Format')).toBe(false);
    press('Add rule');
    expect(rulesOf(ctx)[0]!.rule.when).toMatchObject({ kind: 'scale', mid: '#ffeb84' });
    expect(ctx.data.cell(1, 2)?.conditional?.fill).toBeTruthy();
  });
});

describe('data validation', () => {
  it('makes a list from typed items, with a message and a warning', async () => {
    const { t, ctx, onClose } = await page();
    t.select(rect(1, 1, 4, 1));
    render(<ValidationDialog ctx={ctx} onClose={onClose} />);
    setValue(labelled('Items'), 'Red, Blue, Gold');
    setValue(labelled('Title'), 'Team');
    setValue(document.body.querySelectorAll<HTMLTextAreaElement>('textarea')[0]!, 'Pick one.');
    press('Apply');
    const [rule] = validationRules(ctx);
    expect(rule!.rule).toMatchObject({ check: { kind: 'list', items: ['Red', 'Blue', 'Gold'] }, prompt: { title: 'Team', text: 'Pick one.' } });
    // A stop rule is the default, as Excel's is.
    expect(rule!.rule.strict).toBe(true);
    expect(ctx.data.listChoices(2, 1)).toEqual(['Red', 'Blue', 'Gold']);
    expect(ctx.data.cell(2, 1)?.tip).toBe('Team\nPick one.');
  });

  it('reads a number range, refuses what is outside it, and loads the rule back', async () => {
    const { t, ctx, onClose } = await page();
    t.select(rect(1, 2, 4, 2));
    render(<ValidationDialog ctx={ctx} onClose={onClose} />);
    setValue(labelled('Allow'), 'integer');
    setValue(labelled('Minimum'), '0');
    setValue(labelled('Maximum'), '100');
    setValue(labelled('Then'), 'stop');
    press('Apply');
    expect(t.model.input(ctx.sheetId, { row: 1, col: 2 }, '150')).toBe(false);
    expect(t.model.input(ctx.sheetId, { row: 1, col: 2 }, '75')).toBe(true);
    act(() => root.render(<ToastHost><ValidationDialog ctx={ctx} onClose={onClose} key="again" /></ToastHost>));
    expect(comboValue(labelled('Allow'))).toBe('integer');
    expect((labelled('Minimum') as HTMLInputElement).value).toBe('0');
    expect((labelled('Maximum') as HTMLInputElement).value).toBe('100');
  });

  it('says what is missing, and writes nothing', async () => {
    const { t, ctx, onClose } = await page();
    t.select(rect(1, 2));
    render(<ValidationDialog ctx={ctx} onClose={onClose} />);
    press('Apply');
    expect(q('[role="alert"]').textContent).toBe('Type at least one item.');
    expect(validationRules(ctx)).toEqual([]);
  });

  it('clears the rule from the selection', async () => {
    const { t, ctx, onClose } = await page();
    t.select(rect(1, 1, 4, 1));
    render(<ValidationDialog ctx={ctx} onClose={onClose} />);
    setValue(labelled('Items'), 'Red, Blue');
    press('Apply');
    expect(validationRules(ctx)).toHaveLength(1);
    act(() => root.render(<ToastHost><ValidationDialog ctx={ctx} onClose={onClose} key="clear" /></ToastHost>));
    press('Clear all');
    expect(validationRules(ctx)).toEqual([]);
  });
});

describe('remove duplicates', () => {
  it('removes the rows that repeat the ticked columns, and says how many', async () => {
    const { t, ctx, onClose, toasts } = await page(table(['Name', 'Team'], ['Ada', 'Red'], ['Ben', 'Blue'], ['Cai', 'Red'], ['Dee', 'Blue']));
    t.select(rect(0, 0));
    render(<DuplicatesDialog ctx={ctx} onClose={onClose} />);
    // Heading found by the text over text and bold over plain? Not here: say so.
    act(() => q<HTMLButtonElement>('button[role="switch"]').click());
    const boxes = all<HTMLInputElement>('.sx-list input');
    tick(boxes[0]!);
    press('Remove');
    expect(toasts).toEqual(['Removed 2 duplicates. 2 unique rows remain.']);
    expect([0, 1, 2, 3, 4].map((r) => t.text(r, 0))).toEqual(['Name', 'Ada', 'Ben', '', '']);
  });

  it('says when there is nothing to remove', async () => {
    const { t, ctx, onClose, toasts } = await page(table(['a'], ['b'], ['c']));
    t.select(rect(0, 0));
    render(<DuplicatesDialog ctx={ctx} onClose={onClose} />);
    press('Remove');
    expect(toasts).toEqual(['No duplicates found.']);
  });
});

describe('text to columns', () => {
  it('splits at what is ticked, shows a preview, and warns of what it would replace', async () => {
    const { t, ctx, onClose } = await page(table(['a,b;c', 'keep'], ['d,e;f']));
    t.select(rect(0, 0, 1, 0));
    render(<TextToColumnsDialog ctx={ctx} onClose={onClose} />);
    expect(all('.sx-list td').map((c) => c.textContent)).toEqual(['a', 'b;c', 'd', 'e;f']);
    expect(q('.sx-note[data-tone="danger"]').textContent).toBe('Replaces what is in B1:B2.');
    act(() => all<HTMLInputElement>('.sx-check input')[1]!.click());
    expect(all('.sx-list td')).toHaveLength(6);
    press('Split');
    expect([0, 1].map((r) => [t.text(r, 0), t.text(r, 1), t.text(r, 2)])).toEqual([['a', 'b', 'c'], ['d', 'e', 'f']]);
  });

  it('asks for one column when more are selected', async () => {
    const { t, ctx, onClose } = await page();
    t.select(rect(0, 0, 3, 1));
    render(<TextToColumnsDialog ctx={ctx} onClose={onClose} />);
    expect(q('.oa-dialog-desc').textContent).toBe('Select one column to split.');
    expect(all<HTMLButtonElement>('button').find((b) => b.textContent === 'Split')!.disabled).toBe(true);
  });
});

describe('insert function', () => {
  it('finds a function by what it does, shows its arguments, and starts the formula once the dialog has gone', async () => {
    const { t, ctx, onClose } = await page();
    t.select(rect(8, 0));
    render(<InsertFunctionDialog ctx={ctx} onClose={onClose} />);
    setValue(q<HTMLInputElement>('input[aria-label="Search functions"]'), 'standard deviation');
    const names = all('[role="option"]').map((o) => o.textContent);
    expect(names).toEqual(expect.arrayContaining(['STDEV', 'STDEV.S']));
    setValue(q<HTMLInputElement>('input[aria-label="Search functions"]'), 'vlookup');
    expect(q('.sx-fn-sig').textContent).toBe('VLOOKUP(lookup_value, table_array, col_index_num, [range_lookup])');
    expect(all('.sx-fn-arg b').map((b) => b.textContent)).toEqual(['lookup_value', 'table_array', 'col_index_num', 'range_lookup optional']);
    press('Insert');
    await wait(200);
    expect(ctx.session.edit?.text).toBe('=VLOOKUP(');
  });

  it('lists a function it has no help for, and says so', async () => {
    const { ctx, onClose } = await page();
    render(<InsertFunctionDialog ctx={ctx} onClose={onClose} />);
    setValue(q<HTMLInputElement>('input[aria-label="Search functions"]'), 'GAMMALN.PRECISE');
    expect(q('.sx-fn-sig').textContent).toBe('GAMMALN.PRECISE(…)');
    expect(q('.sx-fn-right p').textContent).toBe('There is no description of this function yet.');
  });
});

describe('the name manager', () => {
  it('defines a name for the selection, lists it, edits it and deletes it', async () => {
    const { t, ctx, onClose } = await page();
    t.select(rect(1, 2, 4, 2));
    render(<NameManager ctx={ctx} onClose={onClose} fromSelection />);
    expect((labelled('Stands for') as HTMLInputElement).value).toBe('=Sheet1!$C$2:$C$5');
    setValue(labelled('Name'), 'Scores');
    act(() => q<HTMLButtonElement>('form button[type="submit"]').click());
    expect(listNames(ctx).map((n) => [n.name, n.refersTo])).toEqual([['Scores', '=Sheet1!$C$2:$C$5']]);
    expect(all('[role="row"]').at(-1)!.textContent).toContain('Scores');

    act(() => q<HTMLButtonElement>('button[aria-label="Edit Scores"]').click());
    setValue(labelled('Name'), 'Points');
    act(() => q<HTMLButtonElement>('form button[type="submit"]').click());
    expect(listNames(ctx).map((n) => n.name)).toEqual(['Points']);

    act(() => q<HTMLButtonElement>('button[aria-label="Delete Points"]').click());
    expect(listNames(ctx)).toEqual([]);
  });

  it('shows what is wrong beside the form', async () => {
    const { t, ctx, onClose } = await page();
    t.select(rect(1, 2));
    render(<NameManager ctx={ctx} onClose={onClose} fromSelection />);
    setValue(labelled('Name'), 'A1');
    act(() => q<HTMLButtonElement>('form button[type="submit"]').click());
    expect(q('[role="alert"]').textContent).toMatch(/cannot be a name/);
    expect(listNames(ctx)).toEqual([]);
  });
});

describe('number format', () => {
  it('builds a code from a category and its options, shows a sample, and applies it', async () => {
    const { t, ctx, onClose } = await page();
    t.select(rect(1, 2));
    render(<NumberFormatDialog ctx={ctx} onClose={onClose} />);
    act(() => all<HTMLButtonElement>('[role="option"]').find((b) => b.textContent === 'Currency')!.click());
    expect((labelled('Format code') as HTMLInputElement).value).toBe('"£"#,##0.00');
    expect(q('.sx-sample').textContent).toBe('£30.00');
    setValue(labelled('Symbol'), '€');
    setValue(labelled('Decimal places'), '0');
    expect(q('.sx-sample').textContent).toBe('€30');
    press('Apply');
    expect(t.text(1, 2)).toBe('€30');
  });

  it('takes a code typed by hand', async () => {
    const { t, ctx, onClose } = await page();
    t.select(rect(1, 2));
    render(<NumberFormatDialog ctx={ctx} onClose={onClose} />);
    setValue(labelled('Format code'), '0.0" pts"');
    press('Apply');
    expect(t.text(1, 2)).toBe('30.0 pts');
  });
});

describe('the find bar', () => {
  it('counts matches as they are typed, steps through them, and replaces them all as one step', async () => {
    const { t, ctx } = await page(table(['red', 'Red team'], ['blue', 'REDDISH'], ['green', '']));
    render(<FindBar ctx={ctx} />);
    expect(document.body.querySelector('.sx-find')).toBeNull();
    act(() => openFind({ replace: true }));
    await wait(0);
    setValue(q<HTMLInputElement>('input[aria-label="Find"]'), 'red');
    await wait(250);
    expect(q('.sx-find-count').textContent).toBe('3 found');
    // From the cell the person is on (A1), the next match is the one after it.
    act(() => q<HTMLButtonElement>('button[aria-label="Next match"]').click());
    expect(q('.sx-find-count').textContent).toBe('2 of 3');
    expect(ctx.session.sel.active).toEqual({ row: 0, col: 1 });
    act(() => q<HTMLButtonElement>('button[aria-label="Next match"]').click());
    expect(ctx.session.sel.active).toEqual({ row: 1, col: 1 });
    act(() => q<HTMLButtonElement>('button[aria-label="Next match"]').click());
    expect(ctx.session.sel.active).toEqual({ row: 0, col: 0 });
    setValue(q<HTMLInputElement>('input[aria-label="Replace with"]'), 'pink');
    press('Replace all');
    expect([t.text(0, 0), t.text(0, 1), t.text(1, 1)]).toEqual(['pink', 'pink team', 'pinkDISH']);
    t.model.undo();
    expect([t.text(0, 0), t.text(0, 1), t.text(1, 1)]).toEqual(['red', 'Red team', 'REDDISH']);
    expect(t.model.canUndo()).toBe(false);
  });

  it('replaces the match it is on and moves to the next', async () => {
    const { t, ctx } = await page(table(['red', 'Red team'], ['blue', 'REDDISH'], ['green', '']));
    render(<FindBar ctx={ctx} />);
    act(() => openFind({ replace: true }));
    await wait(0);
    setValue(q<HTMLInputElement>('input[aria-label="Find"]'), 'red');
    await wait(250);
    setValue(q<HTMLInputElement>('input[aria-label="Replace with"]'), 'x');
    act(() => q<HTMLButtonElement>('button[aria-label="Next match"]').click());
    expect(ctx.session.sel.active).toEqual({ row: 0, col: 1 });
    press('Replace');
    await wait(250);
    expect([t.text(0, 0), t.text(0, 1), t.text(1, 1)]).toEqual(['red', 'x team', 'REDDISH']);
    // Moved on to the next match, and the count is of what is left.
    expect(ctx.session.sel.active).toEqual({ row: 1, col: 1 });
    expect(q('.sx-find-count').textContent).toBe('2 of 2');
    expect(t.model.undo()).toBe(true);
    expect(t.text(0, 1)).toBe('Red team');
  });

  it('keeps what was typed when it is closed and opened again, and closes on Escape', async () => {
    const { ctx } = await page();
    render(<FindBar ctx={ctx} />);
    act(() => openFind());
    await wait(0);
    setValue(q<HTMLInputElement>('input[aria-label="Find"]'), 'abc');
    act(() => {
      q<HTMLInputElement>('input[aria-label="Find"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(findNow().open).toBe(false);
    await wait(200);
    act(() => openFind());
    await wait(0);
    expect(q<HTMLInputElement>('input[aria-label="Find"]').value).toBe('abc');
  });

  it('has no replace row for a reader', async () => {
    const { ctx } = await page();
    const reader = { ...ctx, can: { ...ctx.can, edit: false } } as SheetsContext;
    render(<FindBar ctx={reader} />);
    act(() => openFind({ replace: true }));
    await wait(0);
    expect(document.body.querySelector('input[aria-label="Replace with"]')).toBeNull();
  });
});

describe('the host', () => {
  it('mounts the dialog a tool asks for, fetched when it is wanted, and closes it with the tool', async () => {
    const { ctx } = await page();
    render(<ToolsHost ctx={ctx} />);
    expect(document.body.querySelector('.oa-dialog')).toBeNull();
    act(() => openTool({ id: 'sort' }));
    await wait(100);
    expect(q('.oa-dialog h2').textContent).toBe('Sort');
    expect(openNow()?.id).toBe('sort');
    act(() => closeTool());
    await wait(0);
    expect(document.body.querySelector('.oa-dialog')).toBeNull();
  });

  it('gives the keyboard to what the dialog was closed for only once the dialog has gone', async () => {
    const { t, ctx } = await page();
    t.select(rect(8, 0));
    const seen: boolean[] = [];
    const begin = ctx.session.beginEdit.bind(ctx.session);
    ctx.session.beginEdit = (...a: Parameters<typeof begin>) => {
      // The dialog gives the focus back as it goes: whatever starts typing must start after that.
      seen.push(document.body.querySelector('.oa-dialog') !== null);
      return begin(...a);
    };
    render(<ToolsHost ctx={ctx} />);
    act(() => openTool({ id: 'function' }));
    await wait(100);
    setValue(q<HTMLInputElement>('input[aria-label="Search functions"]'), 'sumif');
    press('Insert');
    await wait(400);
    expect(seen).toEqual([false]);
    expect(ctx.session.edit?.text).toBe('=SUMIF(');
  });

  it('closes what is open when the page is left', async () => {
    const { ctx } = await page();
    render(<ToolsHost ctx={ctx} />);
    act(() => openTool({ id: 'duplicates' }));
    act(() => root.render(<div />));
    expect(openNow()).toBeNull();
  });
});
