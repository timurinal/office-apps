// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GridSession } from '../grid';
import { SheetModel, applyIntent, buildSheetSeed, localSheetSource } from '../model';
import { estimateMeasure } from '../model/measure';
import type { Toast } from '../../core/ui';
import type { Rect } from '../grid/types';
import { copySelection, pasteHere, type ActionContext } from './actions';

/** What the browser's async clipboard holds, as one item of two flavours. */
let held: { text?: string; html?: string } = {};
let denied = false;

class FakeItem {
  constructor(readonly parts: Record<string, Blob>) {}
  get types() {
    return Object.keys(this.parts);
  }
  getType(t: string) {
    return Promise.resolve(this.parts[t]!);
  }
}

beforeEach(() => {
  held = {};
  denied = false;
  vi.stubGlobal('ClipboardItem', FakeItem);
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      write: async (items: FakeItem[]) => {
        if (denied) throw new Error('denied');
        const [item] = items;
        held = {};
        if (item!.parts['text/plain']) held.text = await item!.parts['text/plain'].text();
        if (item!.parts['text/html']) held.html = await item!.parts['text/html'].text();
      },
      read: async () => {
        if (denied) throw new Error('denied');
        const parts: Record<string, Blob> = {};
        if (held.text !== undefined) parts['text/plain'] = new Blob([held.text], { type: 'text/plain' });
        if (held.html !== undefined) parts['text/html'] = new Blob([held.html], { type: 'text/html' });
        return [new FakeItem(parts)];
      },
      readText: async () => {
        if (denied) throw new Error('denied');
        return held.text ?? '';
      }
    }
  });
});

afterEach(() => vi.unstubAllGlobals());

async function setup() {
  const seed = buildSheetSeed((b) => {
    const s = b.addSheet('Sheet1');
    s.cell(0, 0, { value: 'Rent' }).cell(0, 1, { value: 950 }).cell(1, 0, { value: 'Food' }).cell(1, 1, { value: 300 });
  });
  const model = new SheetModel(localSheetSource({ state: seed.state, cells: seed.cells }), { measure: estimateMeasure() });
  await Promise.resolve();
  await Promise.resolve();
  const sheetId = model.sheets()[0]!.id;
  const session = new GridSession();
  const toasts: Toast[] = [];
  const data = model.view(sheetId);
  const ctx: ActionContext = { model, sheetId, data, session, selection: () => ({ rect: session.rect(), active: session.sel.active }), notify: (t) => toasts.push(t) };
  session.bind({ data, onIntent: (i) => void applyIntent(model, sheetId, i), readOnly: () => false, layout: () => null, focusGrid: () => undefined });
  const text = (row: number, col: number) => data.cell(row, col)?.text ?? '';
  const select = (r: Rect) => session.selectRect(r);
  return { ctx, session, toasts, text, select, model };
}

describe('copying', () => {
  it('puts the selection on the clipboard as text and as a table, and marks it', async () => {
    const t = await setup();
    t.select({ r1: 0, r2: 1, c1: 0, c2: 1 });
    await copySelection(t.ctx, false);
    expect(held.text).toBe('Rent\t950\nFood\t300');
    expect(held.html).toContain('<table');
    expect(t.session.clip).toMatchObject({ cut: false, rect: { r1: 0, r2: 1, c1: 0, c2: 1 } });
  });

  it('says how to copy where the browser will not let the page', async () => {
    const t = await setup();
    denied = true;
    // No async clipboard and no command either: the page asks for the key.
    (document as unknown as { execCommand: () => boolean }).execCommand = () => false;
    t.select({ r1: 0, r2: 0, c1: 0, c2: 0 });
    await copySelection(t.ctx, false);
    expect(t.toasts).toEqual([{ text: 'Copy with Ctrl+C.' }]);
    expect(t.session.clip).toBeNull();
  });
});

describe('pasting', () => {
  it('pastes at the selection as Ctrl+V would, and selects what landed', async () => {
    const t = await setup();
    t.select({ r1: 0, r2: 1, c1: 0, c2: 1 });
    await copySelection(t.ctx, false);
    t.select({ r1: 4, r2: 4, c1: 2, c2: 2 });
    await pasteHere(t.ctx);
    expect([t.text(4, 2), t.text(4, 3), t.text(5, 2), t.text(5, 3)]).toEqual(['Rent', '950', 'Food', '300']);
    expect(t.session.rect()).toEqual({ r1: 4, r2: 5, c1: 2, c2: 3 });
    // The source stays: a copy is not a cut.
    expect(t.text(0, 0)).toBe('Rent');
  });

  it('moves the cells after a cut, once, and the marker goes', async () => {
    const t = await setup();
    t.select({ r1: 0, r2: 1, c1: 0, c2: 1 });
    await copySelection(t.ctx, true);
    expect(t.text(0, 0)).toBe('Rent');
    t.select({ r1: 4, r2: 4, c1: 0, c2: 0 });
    await pasteHere(t.ctx);
    expect([t.text(0, 0), t.text(4, 0), t.text(5, 1)]).toEqual(['', 'Rent', '300']);
    expect(t.session.clip).toBeNull();
  });

  it('reads plain text from another program', async () => {
    const t = await setup();
    held = { text: 'a\tb\nc\td' };
    t.select({ r1: 8, r2: 8, c1: 0, c2: 0 });
    await pasteHere(t.ctx);
    expect([t.text(8, 0), t.text(8, 1), t.text(9, 0), t.text(9, 1)]).toEqual(['a', 'b', 'c', 'd']);
  });

  it('asks for Ctrl+V where the browser will not hand the clipboard over', async () => {
    const t = await setup();
    denied = true;
    await pasteHere(t.ctx);
    expect(t.toasts).toEqual([{ text: 'Paste with Ctrl+V.' }]);
  });
});

describe('pasting values', () => {
  async function styled() {
    const seed = buildSheetSeed((b) => {
      const sh = b.addSheet('Sheet1');
      sh.cell(0, 0, { value: 'Rent', style: { bold: true } }).cell(0, 1, { value: 950, style: { numFmt: '£#,##0' } }).cell(1, 1, { formula: 'B1*2' });
    });
    const model = new SheetModel(localSheetSource({ state: seed.state, cells: seed.cells }), { measure: estimateMeasure() });
    await Promise.resolve();
    await Promise.resolve();
    const sheetId = model.sheets()[0]!.id;
    const session = new GridSession();
    const data = model.view(sheetId);
    const ctx: ActionContext = { model, sheetId, data, session, selection: () => ({ rect: session.rect(), active: session.sel.active }), notify: () => undefined };
    session.bind({ data, onIntent: (i) => void applyIntent(model, sheetId, i), readOnly: () => false, layout: () => null, focusGrid: () => undefined });
    return { ctx, session, data, model };
  }

  it('lands the text as it was shown and leaves the formats and the formula behind', async () => {
    const t = await styled();
    t.session.selectRect({ r1: 0, r2: 1, c1: 0, c2: 1 });
    await copySelection(t.ctx, false);
    t.session.selectRect({ r1: 4, r2: 4, c1: 0, c2: 0 });
    await pasteHere(t.ctx, 'values');
    expect(t.data.cell(4, 0)?.text).toBe('Rent');
    expect(t.data.cell(4, 0)?.style.bold).toBeUndefined();
    expect(t.data.cell(4, 1)?.style.numFmt).toBeUndefined();
    expect(t.data.editText(5, 1)).not.toContain('=');
    // A plain paste of the same copy keeps all three.
    t.session.selectRect({ r1: 8, r2: 8, c1: 0, c2: 0 });
    await pasteHere(t.ctx);
    expect(t.data.cell(8, 0)?.style.bold).toBe(true);
    expect(t.data.cell(8, 1)?.style.numFmt).toBe('£#,##0');
    expect(t.data.editText(9, 1)).toContain('=');
  });

  it('is one step, and is not a move after a cut', async () => {
    const t = await styled();
    t.session.selectRect({ r1: 0, r2: 0, c1: 0, c2: 0 });
    await copySelection(t.ctx, true);
    t.session.selectRect({ r1: 4, r2: 4, c1: 0, c2: 0 });
    await pasteHere(t.ctx, 'values');
    expect(t.data.cell(4, 0)?.text).toBe('Rent');
    // The source stays where it was, and the cut is still waiting for a paste that moves it.
    expect(t.data.cell(0, 0)?.text).toBe('Rent');
    expect(t.session.clip).not.toBeNull();
    t.model.undo();
    expect(t.data.cell(4, 0)).toBeNull();
    expect(t.data.cell(0, 0)?.text).toBe('Rent');
  });
});
