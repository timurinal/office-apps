/**
 * What the tools' tests share: a workbook on a local source, a grid session on its first sheet, and
 * the part of the page's context that the actions read. Not a test file: it is imported by them.
 */

import { GridSession } from '../grid';
import type { Rect } from '../grid/types';
import { SheetModel, applyIntent, buildSheetSeed, localSheetSource, type ModelNotice, type SheetSeedBuilder } from '../model';
import { estimateMeasure } from '../model/measure';
import type { Toast } from '../../core/ui';
import type { SheetsContext } from './types';

export const rect = (r1: number, c1: number, r2 = r1, c2 = c1): Rect => ({ r1, r2, c1, c2 });

/** The columns of a table as typed text, row by row, from A1. An empty string leaves the cell empty. */
export function table(...rows: string[][]): (b: SheetSeedBuilder) => void {
  return (b) => {
    const s = b.addSheet('Sheet1');
    rows.forEach((row, r) =>
      row.forEach((text, c) => {
        if (text === '') return;
        if (text.startsWith('=')) s.cell(r, c, { formula: text });
        else {
          const n = Number(text);
          s.cell(r, c, { value: text.trim() !== '' && Number.isFinite(n) ? n : text });
        }
      })
    );
  };
}

export async function setup(build?: (b: SheetSeedBuilder) => void) {
  const seed = buildSheetSeed(build);
  const model = new SheetModel(localSheetSource({ state: seed.state, cells: seed.cells }), { measure: estimateMeasure() });
  // The source's snapshot arrives on a microtask, and a big one is taken in in slices that give the page back
  // between them (model.ts, `applyInSlices`): wait until the workbook says it is here.
  await Promise.resolve();
  await Promise.resolve();
  while (!model.status().loaded) await new Promise((r) => setTimeout(r, 0));
  let sheetId = model.sheets()[0]!.id;
  const session = new GridSession();
  const toasts: Toast[] = [];
  const notices: ModelNotice[] = [];
  model.onNotice((n) => notices.push(n));
  const ctx = {
    model,
    get sheetId() {
      return sheetId;
    },
    get data() {
      return model.view(sheetId);
    },
    session,
    selection: () => ({ rect: session.rect(), active: session.sel.active }),
    notify: (t: Toast) => toasts.push(t),
    get sheets() {
      return model.sheets();
    },
    showSheet: (id: string) => {
      sheetId = id;
    },
    can: { edit: true }
  };
  session.bind({
    get data() {
      return ctx.data;
    },
    onIntent: (i) => void applyIntent(model, sheetId, i),
    readOnly: () => false,
    layout: () => null,
    focusGrid: () => undefined
  });
  const text = (row: number, col: number) => ctx.data.cell(row, col)?.text ?? '';
  const edit = (row: number, col: number) => ctx.data.editText(row, col);
  const style = (row: number, col: number) => ctx.data.cell(row, col)?.style ?? {};
  const select = (r: Rect) => session.selectRect(r);
  /** Selects `r` with the cursor on its top left, as a drag does. */
  return { model, ctx: ctx as typeof ctx & Pick<SheetsContext, 'sheets' | 'showSheet'>, session, toasts, notices, text, edit, style, select };
}

export type Kit = Awaited<ReturnType<typeof setup>>;
