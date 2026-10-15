// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import {
  BARS,
  SCALES,
  addBars,
  addQuick,
  addRule,
  addScale,
  clearRules,
  describe as describeRule,
  moveRule,
  removeRule,
  rangesText,
  rulesOf,
  showFormula,
  storeFormula,
  updateRule
} from './conditionalActions';
import { rect, setup, table } from './testkit';

const scores = table(['Name', 'Score', 'Team'], ['Ada', '10', 'Red'], ['Ben', '25', 'Blue'], ['Cai', '25', 'Red'], ['Dee', '40', 'Blue'], ['Eli', '', 'Red']);
const RED = { fill: '#ffc7ce', color: '#9c0006' };
const cond = (t: Awaited<ReturnType<typeof setup>>, row: number, col: number) => t.ctx.data.cell(row, col)?.conditional;

describe('adding a rule', () => {
  it('marks the cells it matches, and only those', async () => {
    const t = await setup(scores);
    t.select(rect(1, 1, 5, 1));
    addRule(t.ctx, { rects: [rect(1, 1, 5, 1)], when: { kind: 'cell', op: 'gt', a: 20 }, style: RED });
    expect([1, 2, 3, 4, 5].map((r) => cond(t, r, 1)?.fill)).toEqual([undefined, '#ffc7ce', '#ffc7ce', '#ffc7ce', undefined]);
    expect(cond(t, 2, 0)).toBeUndefined();
  });

  it('is one step', async () => {
    const t = await setup(scores);
    addRule(t.ctx, { rects: [rect(1, 1, 5, 1)], when: { kind: 'blank' }, style: RED });
    expect(cond(t, 5, 1)?.fill).toBe('#ffc7ce');
    expect(t.model.undo()).toBe(true);
    expect(cond(t, 5, 1)).toBeUndefined();
    expect(t.model.canUndo()).toBe(false);
  });

  it('goes on top: a rule added later wins the fields both set, and the earlier fills in the rest', async () => {
    const t = await setup(scores);
    addRule(t.ctx, { rects: [rect(1, 1, 5, 1)], when: { kind: 'cell', op: 'gt', a: 5 }, style: { fill: '#c6efce', bold: true } });
    addRule(t.ctx, { rects: [rect(1, 1, 5, 1)], when: { kind: 'cell', op: 'gt', a: 20 }, style: { fill: '#ffc7ce' } });
    expect(rulesOf(t.ctx).map((r) => r.rule.when)).toEqual([{ kind: 'cell', op: 'gt', a: 20 }, { kind: 'cell', op: 'gt', a: 5 }]);
    expect(cond(t, 2, 1)).toMatchObject({ fill: '#ffc7ce', bold: true });
    expect(cond(t, 1, 1)).toMatchObject({ fill: '#c6efce', bold: true });
  });

  it('stops the rules below it when it says so', async () => {
    const t = await setup(scores);
    addRule(t.ctx, { rects: [rect(1, 1, 5, 1)], when: { kind: 'cell', op: 'gt', a: 5 }, style: { bold: true } });
    addRule(t.ctx, { rects: [rect(1, 1, 5, 1)], when: { kind: 'cell', op: 'gt', a: 20 }, style: { fill: '#ffc7ce' }, stop: true });
    expect(cond(t, 2, 1)).toEqual({ fill: '#ffc7ce' });
    expect(cond(t, 1, 1)).toEqual({ bold: true });
  });

  it('does nothing for a range that is not on the sheet', async () => {
    const t = await setup(scores);
    expect(addRule(t.ctx, { rects: [rect(5000, 0)], when: { kind: 'blank' }, style: RED })).toBeUndefined();
    expect(rulesOf(t.ctx)).toEqual([]);
  });
});

describe('the rules the menu adds without a question', () => {
  it('highlights duplicate values and unique ones', async () => {
    const t = await setup(scores);
    t.select(rect(1, 1, 5, 1));
    addQuick(t.ctx, { kind: 'duplicate' });
    expect([1, 2, 3, 4].map((r) => !!cond(t, r, 1))).toEqual([false, true, true, false]);
  });

  it('highlights the top and bottom, by number and by percent', async () => {
    const t = await setup(scores);
    t.select(rect(1, 1, 5, 1));
    addQuick(t.ctx, { kind: 'top', n: 2 });
    expect([1, 2, 3, 4].map((r) => !!cond(t, r, 1))).toEqual([false, true, true, true]);
    const id = rulesOf(t.ctx)[0]!.id;
    removeRule(t.ctx, id);
    addQuick(t.ctx, { kind: 'top', n: 1, bottom: true });
    expect([1, 2, 3, 4].map((r) => !!cond(t, r, 1))).toEqual([true, false, false, false]);
  });

  it('highlights above and below the average', async () => {
    const t = await setup(scores);
    t.select(rect(1, 1, 5, 1));
    addQuick(t.ctx, { kind: 'average' });
    // The average of 10, 25, 25, 40 is 25.
    expect([1, 2, 3, 4].map((r) => !!cond(t, r, 1))).toEqual([false, false, false, true]);
  });

  it('puts a data bar in every number, a colour scale across them', async () => {
    const t = await setup(scores);
    t.select(rect(1, 1, 5, 1));
    addBars(t.ctx, BARS[0]!);
    expect(cond(t, 4, 1)?.bar).toEqual({ from: 0, to: 1, color: '#638ec6' });
    expect(cond(t, 5, 1)).toBeUndefined();
    removeRule(t.ctx, rulesOf(t.ctx)[0]!.id);
    addScale(t.ctx, SCALES[4]!);
    expect(cond(t, 1, 1)?.fill).toBe('#ffffff');
    expect(cond(t, 4, 1)?.fill).toBe('#63be7b');
  });
});

describe('a rule with a formula', () => {
  it('reads A1 the way a cell does, and is written for the top-left cell of the range', async () => {
    const t = await setup(scores);
    const f = storeFormula(t.ctx, '=$B2>$B3');
    expect(f.ok).toBe(true);
    if (!f.ok) return;
    addRule(t.ctx, { rects: [rect(1, 0, 4, 2)], when: { kind: 'formula', f: f.f }, style: RED });
    // Each row reads its own B and the one below: 10 > 25, 25 > 25 and 25 > 40 are not, and 40 > blank is.
    expect([1, 2, 3, 4].map((r) => !!cond(t, r, 0))).toEqual([false, false, false, true]);
    expect(showFormula(t.ctx, f.f)).toBe('=$B2>$B3');
  });

  it('says why a formula does not read', async () => {
    const t = await setup(scores);
    expect(storeFormula(t.ctx, '')).toEqual({ ok: false, message: 'Type a formula.' });
    const bad = storeFormula(t.ctx, '=SUM(');
    expect(bad.ok).toBe(false);
  });
});

describe('changing the rules', () => {
  it('replaces a rule and keeps its place', async () => {
    const t = await setup(scores);
    const a = addRule(t.ctx, { rects: [rect(1, 1, 5, 1)], when: { kind: 'cell', op: 'gt', a: 5 }, style: RED })!;
    addRule(t.ctx, { rects: [rect(1, 1, 5, 1)], when: { kind: 'blank' }, style: { bold: true } });
    updateRule(t.ctx, a, { rects: [rect(1, 1, 3, 1)], when: { kind: 'cell', op: 'lt', a: 30 }, style: { fill: '#ffeb9c' }, stop: true });
    const list = rulesOf(t.ctx);
    expect(list.map((r) => r.id)).toEqual([list[0]!.id, a]);
    expect(list[1]!.rule).toMatchObject({ when: { kind: 'cell', op: 'lt', a: 30 }, stop: true });
    expect(rangesText(list[1]!.rects)).toBe('B2:B4');
    expect(cond(t, 4, 1)?.fill).toBeUndefined();
  });

  it('moves a rule up and down, renumbering the list in one step', async () => {
    const t = await setup(scores);
    const ids = [1, 2, 3].map((n) => addRule(t.ctx, { rects: [rect(1, 1, 5, 1)], when: { kind: 'cell', op: 'gt', a: n }, style: {} })!);
    expect(rulesOf(t.ctx).map((r) => r.id)).toEqual([ids[2], ids[1], ids[0]]);
    moveRule(t.ctx, ids[0]!, -1);
    expect(rulesOf(t.ctx).map((r) => r.id)).toEqual([ids[2], ids[0], ids[1]]);
    expect(rulesOf(t.ctx).map((r) => r.rule.priority)).toEqual([0, 1, 2]);
    moveRule(t.ctx, ids[2]!, -1);
    expect(rulesOf(t.ctx).map((r) => r.id)).toEqual([ids[2], ids[0], ids[1]]);
    t.model.undo();
    expect(rulesOf(t.ctx).map((r) => r.id)).toEqual([ids[2], ids[1], ids[0]]);
  });

  it('removes a rule, and the cells go back to plain', async () => {
    const t = await setup(scores);
    const id = addRule(t.ctx, { rects: [rect(1, 1, 5, 1)], when: { kind: 'blank' }, style: RED })!;
    removeRule(t.ctx, id);
    expect(cond(t, 5, 1)).toBeUndefined();
  });

  it('clears the selection from a rule and keeps it for the rest of its range', async () => {
    const t = await setup(scores);
    addRule(t.ctx, { rects: [rect(1, 1, 5, 1)], when: { kind: 'notBlank' }, style: RED });
    t.select(rect(2, 1, 3, 1));
    expect(clearRules(t.ctx, 'selection')).toBe(1);
    expect([1, 2, 3, 4].map((r) => !!cond(t, r, 1))).toEqual([true, false, false, true]);
    expect(rulesOf(t.ctx)[0]!.rects).toHaveLength(2);
    t.model.undo();
    expect([1, 2, 3, 4].map((r) => !!cond(t, r, 1))).toEqual([true, true, true, true]);
  });

  it('drops a rule that lies wholly inside the selection, and clears the sheet', async () => {
    const t = await setup(scores);
    addRule(t.ctx, { rects: [rect(2, 1, 3, 1)], when: { kind: 'notBlank' }, style: RED });
    addRule(t.ctx, { rects: [rect(1, 2, 5, 2)], when: { kind: 'notBlank' }, style: RED });
    t.select(rect(0, 0, 9, 1));
    expect(clearRules(t.ctx, 'selection')).toBe(1);
    expect(rulesOf(t.ctx)).toHaveLength(1);
    expect(clearRules(t.ctx, 'sheet')).toBe(1);
    expect(rulesOf(t.ctx)).toEqual([]);
  });

  it('follows its cells when rows are inserted above them', async () => {
    const t = await setup(scores);
    addRule(t.ctx, { rects: [rect(1, 1, 5, 1)], when: { kind: 'cell', op: 'gt', a: 20 }, style: RED });
    t.model.insertRows(t.ctx.sheetId, 0, 2);
    expect(rangesText(rulesOf(t.ctx)[0]!.rects)).toBe('B4:B8');
    expect(cond(t, 4, 1)?.fill).toBe('#ffc7ce');
  });
});

describe('describing a rule', () => {
  it('says what it looks for, in one line', async () => {
    const t = await setup(scores);
    const d = (when: Parameters<typeof describeRule>[0]) => describeRule(when, t.ctx);
    expect(d({ kind: 'cell', op: 'gt', a: 20 })).toBe('Cell value greater than 20');
    expect(d({ kind: 'cell', op: 'between', a: 1, b: 9 })).toBe('Cell value between 1 and 9');
    expect(d({ kind: 'cell', op: 'eq', a: 'Red' })).toBe('Cell value equal to “Red”');
    expect(d({ kind: 'text', op: 'begins', text: 'A' })).toBe('Text begins with “A”');
    expect(d({ kind: 'top', n: 10, percent: true })).toBe('Top 10%');
    expect(d({ kind: 'top', n: 3, bottom: true })).toBe('Bottom 3');
    expect(d({ kind: 'average', below: true })).toBe('Below average');
    expect(d({ kind: 'scale', min: '#fff', max: '#000' })).toBe('Two-colour scale');
    expect(d({ kind: 'scale', min: '#fff', mid: '#888', max: '#000' })).toBe('Three-colour scale');
    expect(d({ kind: 'duplicate' })).toBe('Duplicate values');
  });
});
