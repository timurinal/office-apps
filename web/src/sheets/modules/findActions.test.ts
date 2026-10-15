// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { DEFAULT_FIND, findAll, matches, replaceIn, replaceMatches, replacedText, stepMatch, type FindOptions } from './findActions';
import { rect, setup, table, type Kit } from './testkit';

const opts = (o: Partial<FindOptions> = {}): FindOptions => ({ ...DEFAULT_FIND, ...o });

const sheet = table(
  ['Item', 'Cost', 'Note'],
  ['Rent', '950', 'paid in advance'],
  ['Food', '400', 'Paid late'],
  ['Travel', '=B2+B3', 'PAID'],
  ['Pad', '48000', '']
);

const at = (m: { row: number; col: number }) => `${'ABC'[m.col]}${m.row + 1}`;
const found = async (t: Kit, o: Partial<FindOptions>) => (await findAll(t.ctx, opts(o)))!.map(at);

describe('matching', () => {
  it('ignores case unless it is asked not to, and takes part of a cell unless it is asked for all', () => {
    expect(matches('Paid late', opts({ query: 'paid' }))).toBe(true);
    expect(matches('Paid late', opts({ query: 'paid', matchCase: true }))).toBe(false);
    expect(matches('Paid late', opts({ query: 'Paid', matchCase: true }))).toBe(true);
    expect(matches('Paid late', opts({ query: 'paid', wholeCell: true }))).toBe(false);
    expect(matches('PAID', opts({ query: 'paid', wholeCell: true }))).toBe(true);
    expect(matches('anything', opts({ query: '' }))).toBe(false);
    expect(matches('', opts({ query: 'a' }))).toBe(false);
  });

  it('replaces every occurrence, however the case falls, and a whole cell as a whole', () => {
    expect(replaceIn('paid, Paid and PAID', opts({ query: 'paid' }), 'due')).toBe('due, due and due');
    expect(replaceIn('paid, Paid', opts({ query: 'Paid', matchCase: true }), 'due')).toBe('paid, due');
    expect(replaceIn('aaaa', opts({ query: 'aa' }), 'b')).toBe('bb');
    expect(replaceIn('PAID', opts({ query: 'paid', wholeCell: true }), 'due')).toBe('due');
    expect(replaceIn('PAID late', opts({ query: 'paid', wholeCell: true }), 'due')).toBe('PAID late');
    expect(replaceIn('a.b', opts({ query: '.' }), '-')).toBe('a-b');
  });
});

describe('finding', () => {
  it('lists the cells in reading order, by what they show', async () => {
    const t = await setup(sheet);
    expect(await found(t, { query: 'paid' })).toEqual(['C2', 'C3', 'C4']);
    expect(await found(t, { query: 'paid', matchCase: true })).toEqual(['C2']);
    expect(await found(t, { query: 'PAID', matchCase: true })).toEqual(['C4']);
    expect(await found(t, { query: 'paid', wholeCell: true })).toEqual(['C4']);
    // A formula shows its result.
    expect(await found(t, { query: '1350' })).toEqual(['B4']);
    expect(await found(t, { query: 'nothing here' })).toEqual([]);
    expect(await found(t, { query: '' })).toEqual([]);
  });

  it('reads the formulas themselves when asked', async () => {
    const t = await setup(sheet);
    expect(await found(t, { query: 'b2+b3', inFormulas: true })).toEqual(['B4']);
    expect(await found(t, { query: 'b2+b3' })).toEqual([]);
    expect(await found(t, { query: '48000', inFormulas: true })).toEqual(['B5']);
  });

  it('finds a number by the way it is shown', async () => {
    const t = await setup(sheet);
    t.model.setStyle(t.ctx.sheetId, rect(4, 1), { numFmt: '"£"#,##0.00' });
    expect(await found(t, { query: '£48,000.00' })).toEqual(['B5']);
    expect(await found(t, { query: '48000' })).toEqual([]);
  });

  it('searches every sheet of a workbook, in tab order', async () => {
    const t = await setup((b) => {
      b.addSheet('One').cell(0, 0, { value: 'cat' }).cell(5, 0, { value: 'cat' });
      b.addSheet('Two').cell(1, 1, { value: 'category' });
    });
    const all = (await findAll(t.ctx, opts({ query: 'cat', scope: 'workbook' })))!;
    expect(all.map((m) => `${t.model.sheets().find((s) => s.id === m.sheet)!.name}!${at(m)}`)).toEqual(['One!A1', 'One!A6', 'Two!B2']);
    expect(await findAll(t.ctx, opts({ query: 'cat' })).then((l) => l!.length)).toBe(2);
  });

  it('stops when it is told it is out of date', async () => {
    const t = await setup(sheet);
    expect(await findAll(t.ctx, opts({ query: 'a' }), () => true)).toBeNull();
  });

  it('takes a large sheet without holding up the page, and still finds every match', async () => {
    const t = await setup((b) => {
      const s = b.addSheet('Big', { rows: 50_000 });
      for (let r = 0; r < 50_000; r++) s.cell(r, 0, { value: r % 1000 === 0 ? 'needle' : `hay ${r}` });
    });
    const list = (await findAll(t.ctx, opts({ query: 'needle' })))!;
    expect(list).toHaveLength(50);
    expect(list[1]).toEqual({ sheet: t.ctx.sheetId, row: 1000, col: 0 });
  });
});

describe('stepping through the matches', () => {
  const m = (row: number, col = 0, sheet = 'a') => ({ sheet, row, col });
  const list = [m(1), m(3), m(3, 2), m(0, 0, 'b')];
  const order = ['a', 'b'];

  it('goes to the next after a place, wrapping round at the end', () => {
    expect(stepMatch(list, order, null, 1)).toBe(0);
    expect(stepMatch(list, order, m(0), 1)).toBe(0);
    expect(stepMatch(list, order, m(1), 1)).toBe(1);
    expect(stepMatch(list, order, m(2, 5), 1)).toBe(1);
    expect(stepMatch(list, order, m(3), 1)).toBe(2);
    expect(stepMatch(list, order, m(0, 0, 'b'), 1)).toBe(0);
  });

  it('goes the other way too', () => {
    expect(stepMatch(list, order, null, -1)).toBe(3);
    expect(stepMatch(list, order, m(3, 2), -1)).toBe(1);
    expect(stepMatch(list, order, m(1), -1)).toBe(3);
    expect(stepMatch([], order, m(1), 1)).toBe(-1);
  });
});

describe('replacing', () => {
  it('replaces in every match as one step, and the other cells are not touched', async () => {
    const t = await setup(sheet);
    const o = opts({ query: 'paid' });
    const list = (await findAll(t.ctx, o))!;
    const res = replaceMatches(t.ctx, list, o, 'settled');
    expect(res).toEqual({ cells: 3, skipped: 0 });
    expect([t.text(1, 2), t.text(2, 2), t.text(3, 2)]).toEqual(['settled in advance', 'settled late', 'settled']);
    expect(t.text(1, 0)).toBe('Rent');
    expect(t.model.undo()).toBe(true);
    expect([t.text(1, 2), t.text(2, 2), t.text(3, 2)]).toEqual(['paid in advance', 'Paid late', 'PAID']);
    expect(t.model.canUndo()).toBe(false);
  });

  it('types a number as a number, and keeps its format', async () => {
    const t = await setup(sheet);
    t.model.setStyle(t.ctx.sheetId, rect(4, 1), { numFmt: '"£"#,##0' });
    const o = opts({ query: '48' });
    const res = replaceMatches(t.ctx, (await findAll(t.ctx, opts({ query: '£48' })))!, o, '50');
    expect(res).toEqual({ cells: 1, skipped: 0 });
    expect(t.ctx.data.cell(4, 1)).toMatchObject({ text: '£50,000', kind: 'number', value: 50000 });
  });

  it('leaves a formula alone unless it is read as a formula, and counts what it left', async () => {
    const t = await setup(sheet);
    const values = opts({ query: '1350' });
    expect(replaceMatches(t.ctx, (await findAll(t.ctx, values))!, values, '1')).toEqual({ cells: 0, skipped: 1 });
    expect(t.edit(3, 1)).toBe('=B2+B3');
    const formulas = opts({ query: 'B3', inFormulas: true });
    expect(replaceMatches(t.ctx, (await findAll(t.ctx, formulas))!, formulas, 'B1')).toEqual({ cells: 1, skipped: 0 });
    expect(t.edit(3, 1)).toBe('=B2+B1');
  });

  it('leaves a formula alone even when the formula’s own text has the match in it', async () => {
    const t = await setup(table(['=1350+0', '1350']));
    const o = opts({ query: '1350' });
    expect(await found(t, { query: '1350' })).toEqual(['A1', 'B1']);
    expect(replaceMatches(t.ctx, (await findAll(t.ctx, o))!, o, '7')).toEqual({ cells: 1, skipped: 1 });
    expect(t.edit(0, 0)).toBe('=1350+0');
    expect(t.text(0, 1)).toBe('7');
  });

  it('skips a match that is only in how a number is shown', async () => {
    const t = await setup(sheet);
    t.model.setStyle(t.ctx.sheetId, rect(4, 1), { numFmt: '"£"#,##0' });
    const o = opts({ query: '£' });
    expect(replaceMatches(t.ctx, (await findAll(t.ctx, o))!, o, '$')).toEqual({ cells: 0, skipped: 1 });
  });

  it('replaces across sheets as one step', async () => {
    const t = await setup((b) => {
      b.addSheet('One').cell(0, 0, { value: 'x1' });
      b.addSheet('Two').cell(0, 0, { value: 'x2' });
    });
    const o = opts({ query: 'x', scope: 'workbook' });
    expect(replaceMatches(t.ctx, (await findAll(t.ctx, o))!, o, 'y')).toEqual({ cells: 2, skipped: 0 });
    expect(t.model.view(t.model.sheets()[1]!.id).cell(0, 0)?.text).toBe('y2');
    t.model.undo();
    expect(t.model.view(t.model.sheets()[1]!.id).cell(0, 0)?.text).toBe('x2');
    expect(t.text(0, 0)).toBe('x1');
  });

  it('is refused whole for a reader', async () => {
    const t = await setup(sheet);
    const o = opts({ query: 'paid' });
    const list = (await findAll(t.ctx, o))!;
    t.model.setReadOnly(true);
    expect(replaceMatches(t.ctx, list, o, 'x').cells).toBe(0);
    expect(t.text(1, 2)).toBe('paid in advance');
  });

  it('says what happened, once', () => {
    expect(replacedText({ cells: 1, skipped: 0 })).toBe('Replaced in 1 cell.');
    expect(replacedText({ cells: 12, skipped: 0 })).toBe('Replaced in 12 cells.');
    expect(replacedText({ cells: 12, skipped: 3 })).toBe('Replaced in 12 cells. 3 left as they are.');
    expect(replacedText({ cells: 0, skipped: 2 })).toBe('Nothing could be replaced here.');
    expect(replacedText({ cells: 0, skipped: 0 })).toBe('Nothing to replace.');
  });
});
