// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import {
  applyValidation,
  clearFilters,
  clearValidation,
  detectHeader,
  filterActive,
  filterOn,
  filterRect,
  parseItems,
  parseSource,
  regionFor,
  removeDuplicates,
  setCriterion,
  setValuesFilter,
  showSource,
  sortBy,
  sortCustom,
  sortFilterColumn,
  splitText,
  splitTarget,
  textToColumns,
  toggleFilter,
  updateValidation,
  validationAt,
  validationRules
} from './dataActions';
import { toIdRect } from '../model';
import { rect, setup, table, type Kit } from './testkit';

const people = table(
  ['Name', 'Team', 'Score'],
  ['Ada', 'Red', '30'],
  ['Ben', 'Blue', '10'],
  ['Cai', 'Red', '20'],
  ['Dee', 'Blue', '40']
);

const column = (t: Kit, col: number, rows = 5) => Array.from({ length: rows }, (_, r) => t.text(r, col));

describe('the block a command works on', () => {
  it('is the data around one selected cell, and the selection when there are several', async () => {
    const t = await setup(people);
    t.select(rect(2, 1));
    expect(regionFor(t.ctx)).toEqual(rect(0, 0, 4, 2));
    t.select(rect(1, 0, 2, 1));
    expect(regionFor(t.ctx)).toEqual(rect(1, 0, 2, 1));
  });

  it('is the whole filter when the cell is inside it', async () => {
    const t = await setup(people);
    t.select(rect(1, 0, 4, 2));
    toggleFilter(t.ctx);
    t.select(rect(3, 2));
    expect(regionFor(t.ctx)).toEqual(rect(1, 0, 4, 2));
  });

  it('finds a heading by a number under text, or by bold over plain', async () => {
    const t = await setup(people);
    expect(detectHeader(t.ctx, rect(0, 0, 4, 2))).toBe(true);
    expect(detectHeader(t.ctx, rect(1, 0, 4, 2))).toBe(false);
    const names = await setup(table(['Name', 'Team'], ['Ada', 'Red'], ['Ben', 'Blue']));
    expect(detectHeader(names.ctx, rect(0, 0, 2, 1))).toBe(false);
    names.model.setStyle(names.ctx.sheetId, rect(0, 0, 0, 1), { bold: true });
    expect(detectHeader(names.ctx, rect(0, 0, 2, 1))).toBe(true);
    expect(detectHeader(names.ctx, rect(0, 0, 0, 1))).toBe(false);
  });
});

describe('sorting', () => {
  it('sorts the data under its heading by the active column, A to Z and Z to A', async () => {
    const t = await setup(people);
    t.select(rect(1, 2));
    sortBy(t.ctx, false);
    expect(column(t, 2)).toEqual(['Score', '10', '20', '30', '40']);
    expect(column(t, 0)).toEqual(['Name', 'Ben', 'Cai', 'Ada', 'Dee']);
    sortBy(t.ctx, true);
    expect(column(t, 0)).toEqual(['Name', 'Dee', 'Ada', 'Cai', 'Ben']);
  });

  it('is one undo', async () => {
    const t = await setup(people);
    t.select(rect(1, 2));
    sortBy(t.ctx, false);
    t.model.undo();
    expect(column(t, 0)).toEqual(['Name', 'Ada', 'Ben', 'Cai', 'Dee']);
    expect(t.model.canUndo()).toBe(false);
  });

  it('sorts a selection as it stands, by the active cell’s column', async () => {
    const t = await setup(people);
    t.select(rect(1, 0, 4, 1));
    t.session.setSel({ ...t.session.sel, active: { row: 1, col: 1 } });
    sortBy(t.ctx, false);
    expect(column(t, 1)).toEqual(['Team', 'Blue', 'Blue', 'Red', 'Red']);
    expect(column(t, 0)).toEqual(['Name', 'Ben', 'Dee', 'Ada', 'Cai']);
    // The column outside the selection did not move.
    expect(column(t, 2)).toEqual(['Score', '30', '10', '20', '40']);
  });

  it('sorts by several keys, the first the most important, and leaves the heading', async () => {
    const t = await setup(people);
    sortCustom(
      t.ctx,
      rect(0, 0, 4, 2),
      [
        { col: 1, descending: false },
        { col: 2, descending: true }
      ],
      true
    );
    expect(column(t, 0)).toEqual(['Name', 'Dee', 'Ben', 'Ada', 'Cai']);
    expect(t.text(0, 1)).toBe('Team');
  });

  it('sorts the heading with the rest when it is said not to be one', async () => {
    const t = await setup(people);
    sortCustom(t.ctx, rect(0, 0, 4, 0), [{ col: 0, descending: false }], false);
    expect(column(t, 0)).toEqual(['Ada', 'Ben', 'Cai', 'Dee', 'Name']);
  });

  it('refuses merged cells, with a notice', async () => {
    const t = await setup(people);
    t.model.merge(t.ctx.sheetId, rect(2, 0, 3, 0));
    t.select(rect(1, 2));
    sortBy(t.ctx, false);
    expect(t.notices.at(-1)?.message).toBe('Unmerge the cells to sort them.');
  });
});

describe('the filter', () => {
  it('goes on the block of data and comes off with its criteria', async () => {
    const t = await setup(people);
    t.select(rect(1, 1));
    toggleFilter(t.ctx);
    expect(filterOn(t.ctx)).toBe(true);
    expect(filterRect(t.ctx)).toEqual(rect(0, 0, 4, 2));
    expect(t.ctx.data.filter()).toMatchObject({ headerRow: 0, cols: [0, 1, 2], active: [] });
    setCriterion(t.ctx, 1, { kind: 'values', hidden: ['Red'] });
    toggleFilter(t.ctx);
    expect(filterOn(t.ctx)).toBe(false);
    expect(t.model.undo()).toBe(true);
    expect(t.ctx.data.filter()?.active).toEqual([1]);
  });

  it('hides rows for the criteria, and shows them as they are cleared, in one step', async () => {
    const t = await setup(people);
    t.select(rect(1, 1));
    toggleFilter(t.ctx);
    setCriterion(t.ctx, 1, { kind: 'values', hidden: ['Red'] });
    setCriterion(t.ctx, 2, { kind: 'condition', op: 'gt', a: 15 });
    const visible = () => [0, 1, 2, 3, 4].filter((r) => t.ctx.data.rowHeight(r) > 0).map((r) => t.text(r, 0));
    expect(visible()).toEqual(['Name', 'Dee']);
    expect(filterActive(t.ctx)).toBe(true);
    clearFilters(t.ctx);
    expect(visible()).toEqual(['Name', 'Ada', 'Ben', 'Cai', 'Dee']);
    expect(filterActive(t.ctx)).toBe(false);
    expect(filterOn(t.ctx)).toBe(true);
    t.model.undo();
    expect(visible()).toEqual(['Name', 'Dee']);
  });

  it('keeps what is ticked, and no criterion when everything is', async () => {
    const t = await setup(people);
    t.select(rect(1, 1));
    toggleFilter(t.ctx);
    const all = ['Blue', 'Red'];
    setValuesFilter(t.ctx, 1, new Set(['Blue']), all);
    expect(t.ctx.data.filter()?.active).toEqual([1]);
    expect([1, 2, 3, 4].map((r) => t.ctx.data.rowHeight(r) > 0)).toEqual([false, true, false, true]);
    setValuesFilter(t.ctx, 1, new Set(all), all);
    expect(t.ctx.data.filter()?.active).toEqual([]);
  });

  it('sorts a column from its menu, under the header', async () => {
    const t = await setup(people);
    t.select(rect(1, 1));
    toggleFilter(t.ctx);
    sortFilterColumn(t.ctx, 2, true);
    expect(column(t, 2)).toEqual(['Score', '40', '30', '20', '10']);
  });

  it('says so when there is nothing to filter', async () => {
    const t = await setup();
    toggleFilter(t.ctx);
    expect(t.toasts.at(-1)?.text).toBe('Select cells that hold data to filter them.');
    expect(filterOn(t.ctx)).toBe(false);
  });
});

describe('data validation', () => {
  const list = { check: { kind: 'list' as const, items: ['Red', 'Blue'] }, strict: true, allowBlank: true };

  it('puts a rule on the selected cells, as one step', async () => {
    const t = await setup(people);
    applyValidation(t.ctx, [rect(1, 1, 4, 1)], list);
    expect(validationRules(t.ctx)).toHaveLength(1);
    expect(t.ctx.data.listChoices(2, 1)).toEqual(['Red', 'Blue']);
    expect(t.ctx.data.listChoices(2, 0)).toBeNull();
    expect(t.model.input(t.ctx.sheetId, { row: 2, col: 1 }, 'Green')).toBe(false);
    expect(t.model.input(t.ctx.sheetId, { row: 2, col: 1 }, 'Blue')).toBe(true);
    t.model.undo();
    t.model.undo();
    expect(t.ctx.data.listChoices(2, 1)).toBeNull();
  });

  it('replaces what was there: a cell never answers to two rules', async () => {
    const t = await setup(people);
    applyValidation(t.ctx, [rect(1, 1, 4, 1)], list);
    applyValidation(t.ctx, [rect(2, 1, 3, 1)], { check: { kind: 'number', op: 'gt', a: 5 }, strict: true, allowBlank: true });
    const rules = validationRules(t.ctx);
    expect(rules).toHaveLength(2);
    expect(rules.find((r) => r.rule.check.kind === 'list')!.rects).toEqual([rect(1, 1, 1, 1), rect(4, 1, 4, 1)]);
    expect(validationAt(t.ctx, { row: 2, col: 1 })?.rule.check.kind).toBe('number');
    expect(validationAt(t.ctx, { row: 1, col: 1 })?.rule.check.kind).toBe('list');
  });

  it('is cleared from the selection alone, leaving the rest of the range', async () => {
    const t = await setup(people);
    applyValidation(t.ctx, [rect(1, 1, 4, 1)], list);
    expect(clearValidation(t.ctx, [rect(2, 1, 3, 1)])).toBe(1);
    expect(validationAt(t.ctx, { row: 2, col: 1 })).toBeUndefined();
    expect(validationAt(t.ctx, { row: 4, col: 1 })).toBeDefined();
    expect(clearValidation(t.ctx, [rect(0, 0, 9, 9)])).toBe(1);
    expect(validationRules(t.ctx)).toEqual([]);
    expect(clearValidation(t.ctx, [rect(0, 0, 9, 9)])).toBe(0);
  });

  it('stops or warns by how it is set, with its own message', async () => {
    const t = await setup(people);
    applyValidation(t.ctx, [rect(1, 2, 4, 2)], { check: { kind: 'integer', op: 'between', a: 0, b: 100 }, strict: false, allowBlank: false, message: 'Whole numbers to a hundred.' });
    expect(t.model.input(t.ctx.sheetId, { row: 1, col: 2 }, '12.5')).toBe(true);
    expect(t.notices.at(-1)).toMatchObject({ kind: 'validation', message: 'Whole numbers to a hundred.' });
    const id = validationRules(t.ctx)[0]!.id;
    updateValidation(t.ctx, id, { check: { kind: 'integer', op: 'between', a: 0, b: 100 }, strict: true, allowBlank: false, message: 'Whole numbers to a hundred.' });
    expect(t.model.input(t.ctx.sheetId, { row: 2, col: 2 }, '12.5')).toBe(false);
    expect(validationRules(t.ctx)[0]!.rule).toMatchObject({ strict: true, allowBlank: false });
    expect(validationRules(t.ctx)[0]!.rects).toEqual([rect(1, 2, 4, 2)]);
  });

  it('takes its list from a range, on this sheet or another', async () => {
    const t = await setup((b) => {
      const s = b.addSheet('Sheet1');
      s.cell(0, 0, { value: 'x' });
      const lists = b.addSheet('Lists');
      lists.cell(0, 0, { value: 'Yes' }).cell(1, 0, { value: 'No' }).cell(2, 0, { value: 'Maybe' });
    });
    const here = parseSource(t.ctx, 'A1:A3');
    expect(here).toEqual({ sheet: t.ctx.sheetId, rect: rect(0, 0, 2, 0) });
    const there = parseSource(t.ctx, '=Lists!$A$1:$A$3')!;
    expect(there.rect).toEqual(rect(0, 0, 2, 0));
    expect(there.sheet).not.toBe(t.ctx.sheetId);
    expect(parseSource(t.ctx, 'Nowhere!A1:A3')).toBeNull();
    expect(parseSource(t.ctx, 'not a range')).toBeNull();
    const range = toIdRect(t.model.engine.sheet(there.sheet)!, there.rect)!;
    applyValidation(t.ctx, [rect(0, 2, 5, 2)], { check: { kind: 'listRange', sheet: there.sheet, range }, strict: true, allowBlank: true });
    expect(t.ctx.data.listChoices(1, 2)).toEqual(['Yes', 'No', 'Maybe']);
    const check = validationAt(t.ctx, { row: 1, col: 2 })!.rule.check;
    if (check.kind !== 'listRange') throw new Error('expected a list range');
    expect(showSource(t.ctx, check)).toBe('Lists!$A$1:$A$3');
  });

  it('reads a typed list: commas between, empty and repeated items dropped', () => {
    expect(parseItems('Red, Blue,,Red , Green ')).toEqual(['Red', 'Blue', 'Green']);
    expect(parseItems('')).toEqual([]);
  });

  it('shows its prompt as the cell’s note, with no content in it', async () => {
    const t = await setup(people);
    applyValidation(t.ctx, [rect(8, 0)], { check: { kind: 'textLength', op: 'le', a: 5 }, strict: false, allowBlank: true, prompt: { title: 'Short', text: 'Five characters at most.' } });
    expect(t.ctx.data.cell(8, 0)?.tip).toBe('Short\nFive characters at most.');
  });
});

describe('removing duplicates', () => {
  const rows = table(['Name', 'Team'], ['Ada', 'Red'], ['ben', 'Blue'], ['Ada', 'Red'], ['Ben', 'Blue'], ['Ada', 'Blue'], ['', ''], ['Cai', 'Red']);

  it('keeps the first of each, compared without regard to case, and closes the gaps', async () => {
    const t = await setup(rows);
    const res = removeDuplicates(t.ctx, rect(0, 0, 7, 1), [0, 1], true);
    expect(res).toEqual({ removed: 2, unique: 5 });
    expect(column(t, 0, 8)).toEqual(['Name', 'Ada', 'ben', 'Ada', '', 'Cai', '', '']);
    expect(column(t, 1, 8)).toEqual(['Team', 'Red', 'Blue', 'Blue', '', 'Red', '', '']);
  });

  it('compares only the columns it is given', async () => {
    const t = await setup(rows);
    const res = removeDuplicates(t.ctx, rect(0, 0, 7, 1), [1], true);
    expect(res).toEqual({ removed: 4, unique: 3 });
    expect(column(t, 0, 8)).toEqual(['Name', 'Ada', 'ben', '', '', '', '', '']);
  });

  it('counts the heading as data when it is said not to be one', async () => {
    const t = await setup(table(['a'], ['a'], ['b']));
    expect(removeDuplicates(t.ctx, rect(0, 0, 2, 0), [0], false)).toEqual({ removed: 1, unique: 2 });
    expect(column(t, 0, 3)).toEqual(['a', 'b', '']);
  });

  it('is one undo, and none at all when nothing repeats', async () => {
    const t = await setup(rows);
    removeDuplicates(t.ctx, rect(0, 0, 7, 1), [0, 1], true);
    t.model.undo();
    expect(column(t, 0, 8)).toEqual(['Name', 'Ada', 'ben', 'Ada', 'Ben', 'Ada', '', 'Cai']);
    const single = await setup(table(['a'], ['b']));
    expect(removeDuplicates(single.ctx, rect(0, 0, 1, 0), [0], false)).toEqual({ removed: 0, unique: 2 });
    expect(single.model.canUndo()).toBe(false);
  });

  it('moves numbers as numbers', async () => {
    const t = await setup(table(['x', '1'], ['x', '1'], ['y', '2.5']));
    removeDuplicates(t.ctx, rect(0, 0, 2, 1), [0, 1], false);
    expect(t.ctx.data.cell(1, 1)).toMatchObject({ kind: 'number', value: 2.5 });
  });
});

describe('text to columns', () => {
  it('splits at a separator, honouring quotes, and merges runs of them when asked', () => {
    const comma = { chars: [','], merge: false };
    expect(splitText('a,b,,c', comma)).toEqual(['a', 'b', '', 'c']);
    expect(splitText('a,"b,c",d', comma)).toEqual(['a', 'b,c', 'd']);
    expect(splitText('say ""hi"",x', comma)).toEqual(['say ""hi""', 'x']);
    expect(splitText('"say ""hi""",x', comma)).toEqual(['say "hi"', 'x']);
    expect(splitText('a   b c', { chars: [' '], merge: true })).toEqual(['a', 'b', 'c']);
    expect(splitText('a;b,c', { chars: [';', ','], merge: false })).toEqual(['a', 'b', 'c']);
    expect(splitText('', comma)).toEqual(['']);
  });

  it('fills the cells to the right, as one step, and reads numbers as numbers', async () => {
    const t = await setup(table(['Ada,30,Red'], ['Ben,40'], ['Cai']));
    const width = textToColumns(t.ctx, rect(0, 0, 2, 0), { chars: [','], merge: false });
    expect(width).toBe(3);
    expect(column(t, 0, 3)).toEqual(['Ada', 'Ben', 'Cai']);
    expect(column(t, 1, 3)).toEqual(['30', '40', '']);
    expect(column(t, 2, 3)).toEqual(['Red', '', '']);
    expect(t.ctx.data.cell(0, 1)).toMatchObject({ kind: 'number', value: 30 });
    t.model.undo();
    expect(column(t, 0, 3)).toEqual(['Ada,30,Red', 'Ben,40', 'Cai']);
    expect(column(t, 1, 3)).toEqual(['', '', '']);
  });

  it('does nothing for more than one column, or when nothing splits', async () => {
    const t = await setup(table(['a,b', 'c']));
    expect(textToColumns(t.ctx, rect(0, 0, 0, 1), { chars: [','], merge: false })).toBe(0);
    expect(textToColumns(t.ctx, rect(0, 1, 0, 1), { chars: [','], merge: false })).toBe(0);
    expect(t.model.canUndo()).toBe(false);
  });

  it('says which cells it would replace', async () => {
    const t = await setup(table(['a,b', 'keep']));
    expect(splitTarget(t.ctx, rect(0, 0, 0, 0), 1)).toBeNull();
    expect(splitTarget(t.ctx, rect(0, 0, 0, 0), 2)).toBe('B1');
    expect(splitTarget(t.ctx, rect(0, 0, 0, 0), 3)).toBe('B1:C1');
    const free = await setup(table(['a,b']));
    expect(splitTarget(free.ctx, rect(0, 0, 0, 0), 3)).toBeNull();
  });
});
