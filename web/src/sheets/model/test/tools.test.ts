/**
 * What the formatting and data tools added to the model: a batch that is one step, a format that
 * leaves nothing behind when it is switched off, a warning rule, an input prompt, data bars, the
 * text and blank filters with the lists a filter menu shows, and Show formulas.
 */

import { describe, expect, it } from 'vitest';
import type { Rect } from '../../grid/types';
import { type ModelNotice, type SheetModel, toIdRect } from '../index';
import { grid, room, text, type } from './helpers';

const two = (build?: Parameters<typeof room>[0]) => {
  const r = room(build);
  return { ...r, a: r.people[0]!.model, b: r.people[1]!.model };
};

const notices = (m: SheetModel) => {
  const out: ModelNotice[] = [];
  m.onNotice((n) => out.push(n));
  return out;
};

const rect = (r1: number, c1: number, r2 = r1, c2 = c1): Rect => ({ r1, r2, c1, c2 });

const ids = (m: SheetModel, sheet: string, r: Rect) => toIdRect(m.engine.sheet(sheet)!, r)!;

describe('a batch', () => {
  it('is one step: one undo entry, one frame, and the other person sees all of it', () => {
    const { a, b, room: r, sheet } = two();
    type(a, sheet, 'A1', 'Title');
    a.batch(() => {
      a.merge(sheet, rect(0, 0, 0, 3));
      a.setStyle(sheet, rect(0, 0, 0, 3), { h: 'center', bold: true });
    });
    r.flush();
    expect(b.view(sheet).merges()).toEqual([rect(0, 0, 0, 3)]);
    expect(b.view(sheet).cell(0, 0)?.style).toMatchObject({ h: 'center', bold: true });
    // The typing is one step and the batch another.
    expect(a.undo()).toBe(true);
    r.flush();
    for (const m of [a, b]) {
      expect(m.view(sheet).merges()).toEqual([]);
      expect(m.view(sheet).cell(0, 0)?.style.bold).toBeUndefined();
      expect(text(m, sheet, 'A1')).toBe('Title');
    }
    expect(a.redo()).toBe(true);
    expect(a.view(sheet).merges()).toHaveLength(1);
  });

  it('keeps what an earlier call did when a later one is refused, as inside any step', () => {
    const { a, sheet } = two();
    const seen = notices(a);
    a.batch(() => {
      a.setStyle(sheet, rect(0, 0), { bold: true });
      a.deleteRows(sheet, 0, 5000);
      a.setStyle(sheet, rect(1, 0), { italic: true });
    });
    expect(seen.some((n) => n.kind === 'refused')).toBe(true);
    expect(a.view(sheet).cell(0, 0)?.style.bold).toBe(true);
    expect(a.view(sheet).cell(1, 0)?.style.italic).toBeUndefined();
  });

  it('is refused whole for a reader', () => {
    const { a, sheet } = two();
    a.setReadOnly(true);
    const seen = notices(a);
    expect(a.batch(() => a.setStyle(sheet, rect(0, 0), { bold: true }))).toBeUndefined();
    expect(seen.map((n) => n.kind)).toEqual(['read-only']);
    expect(a.view(sheet).cell(0, 0)).toBeNull();
  });
});

describe('switching a format off', () => {
  it('leaves no format on a cell that had no other', () => {
    const { a, sheet } = two();
    a.setStyle(sheet, rect(2, 2), { bold: true });
    expect(a.status().cells).toBe(1);
    a.setStyle(sheet, rect(2, 2), { bold: null });
    expect(a.status().cells).toBe(0);
    expect(a.stored(sheet, a.engine.sheet(sheet)!.rowOrder[2]!, a.engine.sheet(sheet)!.colOrder[2]!)).toBeNull();
    expect(a.view(sheet).cell(2, 2)).toBeNull();
  });

  it('keeps the content when the format goes', () => {
    const { a, sheet } = two();
    type(a, sheet, 'A1', '7');
    a.setStyle(sheet, rect(0, 0), { italic: true });
    a.setStyle(sheet, rect(0, 0), { italic: null });
    expect(a.view(sheet).cell(0, 0)).toMatchObject({ text: '7', style: {} });
    expect(a.status().cells).toBe(1);
  });

  it('keeps a null where a column or row format says otherwise, so the cell can differ from it', () => {
    const { a, sheet } = two();
    a.setStyle(sheet, rect(0, 1, 999, 1), { bold: true });
    expect(a.view(sheet).cell(4, 1)?.style.bold).toBe(true);
    a.setStyle(sheet, rect(4, 1), { bold: null });
    expect(a.view(sheet).cell(4, 1)?.style.bold).toBeUndefined();
    expect(a.view(sheet).cell(5, 1)?.style.bold).toBe(true);
  });

  it('takes a whole column format away with nothing left behind', () => {
    const { a, sheet } = two();
    a.setStyle(sheet, rect(0, 3, 999, 3), { fill: '#ffeb9c' });
    a.setStyle(sheet, rect(0, 3, 999, 3), { fill: null });
    expect(a.view(sheet).cell(10, 3)).toBeNull();
  });
});

describe('a warning rule', () => {
  const column = (a: SheetModel, sheet: string, strict: boolean) =>
    a.setRule(sheet, 'validation', null, { ranges: [ids(a, sheet, rect(0, 0, 9, 0))], check: { kind: 'number', op: 'between', a: 1, b: 10 }, strict });

  it('keeps the value and says so', () => {
    const { a, sheet } = two();
    column(a, sheet, false);
    const seen = notices(a);
    expect(type(a, sheet, 'A1', '50')).toBe(true);
    expect(text(a, sheet, 'A1')).toBe('50');
    expect(seen.map((n) => n.kind)).toEqual(['validation']);
    expect(seen[0]!.message).toBe('That value is not one this cell expects.');
  });

  it('says nothing about a value that passes, and refuses one under a stop rule', () => {
    const { a, sheet } = two();
    column(a, sheet, false);
    const seen = notices(a);
    type(a, sheet, 'A1', '5');
    expect(seen).toEqual([]);
    a.setRule(sheet, 'validation', a.rules(sheet, 'validation')[0]!.id, { ...a.rules(sheet, 'validation')[0]!.rule, strict: true, message: 'One to ten.' });
    expect(type(a, sheet, 'A2', '50')).toBe(false);
    expect(seen.at(-1)).toMatchObject({ kind: 'validation', message: 'One to ten.' });
  });

  it('shows a prompt as the cell note, on a cell that holds nothing', () => {
    const { a, sheet } = two();
    a.setRule(sheet, 'validation', null, {
      ranges: [ids(a, sheet, rect(0, 0, 9, 0))],
      check: { kind: 'integer', op: 'ge', a: 0 },
      prompt: { title: 'Quantity', text: 'A whole number.' }
    });
    expect(a.view(sheet).cell(3, 0)?.tip).toBe('Quantity\nA whole number.');
    expect(a.view(sheet).cell(30, 0)).toBeNull();
  });
});

describe('data bars', () => {
  const column = (a: SheetModel, sheet: string) =>
    a.setRule(sheet, 'cf', null, { ranges: [ids(a, sheet, rect(0, 0, 3, 0))], priority: 0, when: { kind: 'bar', color: '#638ec6', negative: '#f8696b' }, style: {} });

  it('run from zero, as long as the number is next to the largest', () => {
    const { a, sheet } = two();
    for (const [i, v] of [10, 20, 40, 0].entries()) type(a, sheet, `A${i + 1}`, String(v));
    column(a, sheet);
    const bar = (row: number) => a.view(sheet).cell(row, 0)?.conditional?.bar;
    expect(bar(0)).toEqual({ from: 0, to: 0.25, color: '#638ec6' });
    expect(bar(1)).toEqual({ from: 0, to: 0.5, color: '#638ec6' });
    expect(bar(2)).toEqual({ from: 0, to: 1, color: '#638ec6' });
    expect(bar(3)).toBeUndefined();
  });

  it('send a negative the other way, in its own colour', () => {
    const { a, sheet } = two();
    for (const [i, v] of [-10, 30].entries()) type(a, sheet, `A${i + 1}`, String(v));
    column(a, sheet);
    const neg = a.view(sheet).cell(0, 0)?.conditional?.bar;
    const pos = a.view(sheet).cell(1, 0)?.conditional?.bar;
    expect(neg).toMatchObject({ color: '#f8696b', from: 0, to: 0.25 });
    expect(pos).toMatchObject({ color: '#638ec6', from: 0.25, to: 1 });
  });

  it('draw nothing when every number is the same zero, or the cell is not a number', () => {
    const { a, sheet } = two();
    type(a, sheet, 'A1', '0');
    type(a, sheet, 'A2', 'words');
    column(a, sheet);
    expect(a.view(sheet).cell(0, 0)?.conditional?.bar).toBeUndefined();
    expect(a.view(sheet).cell(1, 0)?.conditional?.bar).toBeUndefined();
  });
});

describe('filters', () => {
  const table = (a: SheetModel, sheet: string) => {
    const rows = [
      ['Name', 'Team', 'Score'],
      ['Ada', 'Red', '10'],
      ['Ben', 'Blue', '20'],
      ['Cai', 'Red', '30'],
      ['Dee', '', '40'],
      ['Eli', 'Blue', '50']
    ];
    rows.forEach((r, i) => r.forEach((v, j) => v && type(a, sheet, `${'ABC'[j]}${i + 1}`, v)));
    a.setFilter(sheet, rect(0, 0, 5, 2));
  };
  const shown = (m: SheetModel, sheet: string) =>
    grid(m, sheet, 6, 1)
      .map((r, i) => (m.view(sheet).rowHeight(i) > 0 ? r[0] : null))
      .filter((x): x is string => x !== null);

  it('hides the rows a text condition leaves out, for everybody', () => {
    const { a, b, room: r, sheet } = two();
    table(a, sheet);
    a.setFilterCriterion(sheet, 0, { kind: 'text', op: 'begins', text: 'b' });
    r.flush();
    for (const m of [a, b]) expect(shown(m, sheet)).toEqual(['Name', 'Ben']);
    a.setFilterCriterion(sheet, 0, { kind: 'text', op: 'notContains', text: 'a' });
    expect(shown(a, sheet)).toEqual(['Name', 'Ben', 'Cai', 'Dee', 'Eli'].filter((n) => !/a/i.test(n) || n === 'Name'));
    a.setFilterCriterion(sheet, 0, { kind: 'text', op: 'ends', text: 'I' });
    expect(shown(a, sheet)).toEqual(['Name', 'Cai', 'Eli']);
  });

  it('keeps only the blanks, or only what is not blank', () => {
    const { a, sheet } = two();
    table(a, sheet);
    a.setFilterCriterion(sheet, 1, { kind: 'blank' });
    expect(shown(a, sheet)).toEqual(['Name', 'Dee']);
    a.setFilterCriterion(sheet, 1, { kind: 'blank', not: true });
    expect(shown(a, sheet)).toEqual(['Name', 'Ada', 'Ben', 'Cai', 'Eli']);
  });

  it('keeps a number condition and a value list together, and says which columns are filtered', () => {
    const { a, sheet } = two();
    table(a, sheet);
    a.setFilterCriterion(sheet, 2, { kind: 'condition', op: 'gt', a: 15 });
    a.setFilterCriterion(sheet, 1, { kind: 'values', hidden: ['Blue'] });
    expect(shown(a, sheet)).toEqual(['Name', 'Cai', 'Dee']);
    expect(a.view(sheet).filter()).toMatchObject({ headerRow: 0, cols: [0, 1, 2], active: [1, 2] });
  });

  it('lists a column the way the menu shows it: counted, in order, blanks last', () => {
    const { a, sheet } = two();
    table(a, sheet);
    const list = (col: number) => a.view(sheet).features()!.columnValues(col).map((v) => `${v.text || '(blank)'}:${v.count}`);
    expect(list(1)).toEqual(['Blue:2', 'Red:2', '(blank):1']);
    expect(list(2)).toEqual(['10:1', '20:1', '30:1', '40:1', '50:1']);
    // Narrowing the team narrows the scores on offer, and leaves the teams: a column's own filter is not applied to its list.
    a.setFilterCriterion(sheet, 1, { kind: 'values', hidden: ['Blue', ''] });
    expect(list(1)).toEqual(['Blue:2', 'Red:2', '(blank):1']);
    expect(list(2)).toEqual(['10:1', '30:1']);
    a.setFilterCriterion(sheet, 2, { kind: 'values', hidden: ['10'] });
    expect(list(1)).toEqual(['Blue:2', 'Red:1', '(blank):1']);
    expect(list(2)).toEqual(['10:1', '30:1']);
  });

  it('lists numbers as numbers, not as text', () => {
    const { a, sheet } = two();
    ['Score', '9', '100', '20'].forEach((v, i) => type(a, sheet, `A${i + 1}`, v));
    a.setFilter(sheet, rect(0, 0, 3, 0));
    expect(a.view(sheet).features()!.columnValues(0).map((v) => v.text)).toEqual(['9', '20', '100']);
  });
});

describe('Show formulas', () => {
  it('draws a formula as its text for this viewer only, and not in the other one', () => {
    const { a, b, room: r, sheet } = two();
    type(a, sheet, 'A1', '2');
    type(a, sheet, 'A2', '=A1*3');
    r.flush();
    const seen = grid(a, sheet, 2, 1);
    expect(seen).toEqual([['2'], ['6']]);
    a.setShowFormulas(true);
    expect(grid(a, sheet, 2, 1)).toEqual([['2'], ['=A1*3']]);
    expect(a.view(sheet).cell(1, 0)).toMatchObject({ kind: 'text' });
    expect(grid(b, sheet, 2, 1)).toEqual([['2'], ['6']]);
    a.setShowFormulas(false);
    expect(grid(a, sheet, 2, 1)).toEqual(seen);
    // It is not a step.
    expect(a.undo()).toBe(true);
    expect(grid(a, sheet, 2, 1)).toEqual([['2'], ['']]);
  });
});

describe('rules', () => {
  it('lists each rule with the id it is stored under', () => {
    const { a, sheet } = two();
    const id = a.setRule(sheet, 'cf', null, { ranges: [ids(a, sheet, rect(0, 0, 2, 0))], priority: 3, when: { kind: 'blank' }, style: { fill: '#ffc7ce' } })!;
    expect(a.rules(sheet, 'cf')).toEqual([{ id, rule: expect.objectContaining({ priority: 3 }) }]);
    expect(a.rules(sheet, 'validation')).toEqual([]);
    a.setRule(sheet, 'cf', id, null);
    expect(a.rules(sheet, 'cf')).toEqual([]);
  });
});
