// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { checkName, deleteName, insertFunction, listNames, saveName, selectionRef } from './formulaActions';
import { rect, setup, table } from './testkit';

const data = table(['Rate', '0.2'], ['Net', '100'], ['Tax', '=B2*B1']);

describe('inserting a function', () => {
  it('starts editing the active cell with the call open', async () => {
    const t = await setup(data);
    t.select(rect(5, 0));
    expect(insertFunction(t.ctx, 'SUM')).toBe(true);
    expect(t.session.edit?.text).toBe('=SUM(');
    expect(t.session.edit).toMatchObject({ selStart: 5, selEnd: 5 });
  });

  it('goes in at the caret of an edit, over what is selected', async () => {
    const t = await setup(data);
    t.select(rect(5, 0));
    t.session.beginEdit('type', '=1+');
    expect(insertFunction(t.ctx, 'ROUND')).toBe(true);
    expect(t.session.edit?.text).toBe('=1+ROUND(');
    t.session.input('=1+XX+2', 3, 5, 'cell');
    insertFunction(t.ctx, 'MAX');
    expect(t.session.edit?.text).toBe('=1+MAX(+2');
    expect(t.session.edit).toMatchObject({ selStart: 7, selEnd: 7 });
  });

  it('takes `=` over an empty edit', async () => {
    const t = await setup(data);
    t.select(rect(5, 0));
    t.session.beginEdit('bar');
    t.session.input('', 0, 0, 'bar');
    insertFunction(t.ctx, 'AVERAGE');
    expect(t.session.edit?.text).toBe('=AVERAGE(');
  });

  it('is refused where the sheet cannot be edited', async () => {
    const t = await setup(data);
    t.session.bind({ get data() { return t.ctx.data; }, onIntent: () => undefined, readOnly: () => true, layout: () => null, focusGrid: () => undefined });
    expect(insertFunction(t.ctx, 'SUM')).toBe(false);
    expect(t.session.edit).toBeNull();
  });
});

describe('defined names', () => {
  it('defines a name for a range and reads it back as A1', async () => {
    const t = await setup(data);
    expect(saveName(t.ctx, { name: 'Net', refersTo: '=Sheet1!$B$2' })).toEqual({ ok: true });
    expect(listNames(t.ctx)).toEqual([{ name: 'Net', refersTo: '=Sheet1!$B$2', scopeLabel: 'Workbook' }]);
    t.model.input(t.ctx.sheetId, { row: 6, col: 0 }, '=Net*2');
    expect(t.text(6, 0)).toBe('200');
  });

  it('is one step, and the name goes in one undo', async () => {
    const t = await setup(data);
    saveName(t.ctx, { name: 'Net', refersTo: '=Sheet1!$B$2' });
    expect(t.model.undo()).toBe(true);
    expect(listNames(t.ctx)).toEqual([]);
  });

  it('can be a constant or a formula, and one for a sheet alone', async () => {
    const t = await setup(data);
    saveName(t.ctx, { name: 'Vat', refersTo: '=0.2' });
    saveName(t.ctx, { name: 'Local', scope: t.ctx.sheetId, refersTo: '=Sheet1!$A$1:$B$3' });
    const rows = listNames(t.ctx);
    expect(rows.map((r) => `${r.name}:${r.scopeLabel}:${r.refersTo}`)).toEqual(['Local:Sheet1:=Sheet1!$A$1:$B$3', 'Vat:Workbook:=0.2']);
    t.model.input(t.ctx.sheetId, { row: 7, col: 0 }, '=Vat*100');
    expect(t.text(7, 0)).toBe('20');
  });

  it('keeps a name pointing at its cells when rows are inserted above them', async () => {
    const t = await setup(data);
    saveName(t.ctx, { name: 'Net', refersTo: '=Sheet1!$B$2' });
    t.model.insertRows(t.ctx.sheetId, 0, 3);
    expect(listNames(t.ctx)[0]!.refersTo).toBe('=Sheet1!$B$5');
  });

  it('edits a name: a rename, a new target and a change of scope are one step', async () => {
    const t = await setup(data);
    saveName(t.ctx, { name: 'Net', refersTo: '=Sheet1!$B$2' });
    const res = saveName(t.ctx, { name: 'Subtotal', scope: t.ctx.sheetId, refersTo: '=Sheet1!$B$3', replaces: { name: 'Net' } });
    expect(res).toEqual({ ok: true });
    expect(listNames(t.ctx).map((r) => [r.name, r.scopeLabel, r.refersTo])).toEqual([['Subtotal', 'Sheet1', '=Sheet1!$B$3']]);
    t.model.undo();
    expect(listNames(t.ctx).map((r) => [r.name, r.scopeLabel])).toEqual([['Net', 'Workbook']]);
  });

  it('saves a name over itself without a clash, and refuses one that is taken', async () => {
    const t = await setup(data);
    saveName(t.ctx, { name: 'Net', refersTo: '=Sheet1!$B$2' });
    expect(saveName(t.ctx, { name: 'Net', refersTo: '=Sheet1!$B$3', replaces: { name: 'Net' } })).toEqual({ ok: true });
    expect(listNames(t.ctx)).toHaveLength(1);
    expect(checkName(t.ctx, { name: 'net', refersTo: '=Sheet1!$B$3' })).toBe('There is already a name called net.');
    // The same name for a sheet alone is another name.
    expect(checkName(t.ctx, { name: 'Net', scope: t.ctx.sheetId, refersTo: '=Sheet1!$B$3' })).toBeNull();
  });

  it('says why a name or what it stands for will not do, and writes nothing', async () => {
    const t = await setup(data);
    expect(checkName(t.ctx, { name: '', refersTo: '=1' })).toBe('Type a name.');
    expect(checkName(t.ctx, { name: 'x', refersTo: '' })).toBe('Say what the name stands for.');
    expect(checkName(t.ctx, { name: 'A1', refersTo: '=1' })).toMatch(/cannot be a name/);
    expect(checkName(t.ctx, { name: '2fast', refersTo: '=1' })).toMatch(/cannot be a name/);
    expect(checkName(t.ctx, { name: 'Bad', refersTo: '=SUM(' })).toBeTruthy();
    expect(saveName(t.ctx, { name: 'Bad', refersTo: '=SUM(' }).ok).toBe(false);
    expect(listNames(t.ctx)).toEqual([]);
    expect(t.model.canUndo()).toBe(false);
  });

  it('is deleted, and a formula that used it says so', async () => {
    const t = await setup(data);
    saveName(t.ctx, { name: 'Net', refersTo: '=Sheet1!$B$2' });
    t.model.input(t.ctx.sheetId, { row: 6, col: 0 }, '=Net*2');
    deleteName(t.ctx, 'Net');
    expect(listNames(t.ctx)).toEqual([]);
    expect(t.text(6, 0)).toBe('#NAME?');
    t.model.undo();
    expect(t.text(6, 0)).toBe('200');
  });

  it('writes the selection as a reference to type into a name', async () => {
    const t = await setup(data);
    expect(selectionRef(t.ctx, rect(1, 1, 2, 1))).toBe('=Sheet1!$B$2:$B$3');
    expect(selectionRef(t.ctx, rect(0, 0))).toBe('=Sheet1!$A$1');
    t.model.renameSheet(t.ctx.sheetId, 'My costs');
    expect(selectionRef(t.ctx, rect(0, 0, 0, 1))).toBe("='My costs'!$A$1:$B$1");
  });
});
