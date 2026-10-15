/**
 * A workbook for tests, addressed in A1 the way a person types. It plays the
 * model's part: it owns the id orders, grows a grid when the engine asks, and
 * applies a delete plan in the same step as the delete.
 */

import { Engine, type EngineOptions, type WriteResult } from '../engine';
import { parseCellAddress } from '../parser';
import type { CellContent, Sheet } from '../sheet';
import { CellError, type Scalar } from '../values';

export const err = (v: unknown): unknown => (v instanceof CellError ? v.code : v);

export class Book {
  readonly e: Engine;
  private seq = 0;

  constructor(sheets: Record<string, [rows: number, cols: number]>, opts?: EngineOptions) {
    this.e = new Engine(opts);
    for (const [name, [rows, cols]] of Object.entries(sheets)) this.addSheet(name, rows, cols);
  }

  ids(prefix: string, n: number): string[] {
    return Array.from({ length: n }, () => `${prefix}${++this.seq}`);
  }

  addSheet(name: string, rows: number, cols: number, id = `s${++this.seq}`): Sheet {
    return this.e.addSheet(id, name, this.ids('r', rows), this.ids('c', cols));
  }

  sheet(name: string): Sheet {
    const s = this.e.sheetByName(name);
    if (!s) throw new Error(`No sheet ${name}`);
    return s;
  }

  at(name: string, a1: string): { sheet: Sheet; rowId: string; colId: string } {
    const sheet = this.sheet(name);
    const p = parseCellAddress(a1);
    if (!p) throw new Error(`Bad address ${a1}`);
    const rowId = sheet.rowOrder[p.row];
    const colId = sheet.colOrder[p.col];
    if (!rowId || !colId) throw new Error(`${a1} is outside ${name}`);
    return { sheet, rowId, colId };
  }

  /** Grows a sheet to at least rows by cols, adding lines at the end. */
  grow(sheetId: string, rows: number, cols: number): void {
    const s = this.e.sheet(sheetId)!;
    if (rows > s.rowOrder.length) this.e.insertRows(sheetId, s.rowOrder.length, this.ids('r', rows - s.rowOrder.length));
    if (cols > s.colOrder.length) this.e.insertCols(sheetId, s.colOrder.length, this.ids('c', cols - s.colOrder.length));
  }

  /** Types text into a cell, as the formula bar would. Returns the format hint. */
  input(name: string, a1: string, text: string): string | undefined {
    const sheet = this.sheet(name);
    for (;;) {
      const r = this.e.contentFromInput(sheet.id, text);
      if (r.kind === 'error') throw new Error(`${text}: ${r.message} at ${r.at}`);
      if (r.kind === 'grow') {
        for (const g of r.sheets) this.grow(g.sheetId, g.rows, g.cols);
        continue;
      }
      const { rowId, colId } = this.at(name, a1);
      this.e.setCell(sheet.id, rowId, colId, r.content);
      return r.format;
    }
  }

  set(name: string, a1: string, content: CellContent | null): void {
    const { sheet, rowId, colId } = this.at(name, a1);
    this.e.setCell(sheet.id, rowId, colId, content);
  }

  define(name: string, text: string, scope?: string): void {
    const r = this.e.nameFromInput(name, scope, text);
    if (r.kind !== 'content' || !r.content?.f) throw new Error(`Cannot define ${name}`);
    this.e.setName(name, scope, r.content.f);
  }

  get(name: string, a1: string): Scalar {
    const { sheet, rowId, colId } = this.at(name, a1);
    return this.e.getValue(sheet.id, rowId, colId);
  }

  formula(name: string, a1: string): string | undefined {
    const { sheet, rowId, colId } = this.at(name, a1);
    return this.e.displayFormula(sheet.id, rowId, colId);
  }

  stored(name: string, a1: string): string | undefined {
    const { sheet, rowId, colId } = this.at(name, a1);
    return this.e.getContent(sheet.id, rowId, colId)?.f;
  }

  /** Every stored formula on a sheet, sorted, to show that nothing was rewritten. */
  allStored(name: string): string[] {
    const s = this.sheet(name);
    const out: string[] = [];
    for (const col of s.cols.values()) for (const c of col.values()) if (c.content.f) out.push(c.content.f);
    return out.sort();
  }

  insertRows(name: string, at: number, n: number): string[] {
    const ids = this.ids('r', n);
    this.e.insertRows(this.sheet(name).id, at, ids);
    return ids;
  }

  insertCols(name: string, at: number, n: number): string[] {
    const ids = this.ids('c', n);
    this.e.insertCols(this.sheet(name).id, at, ids);
    return ids;
  }

  /** A delete as the deleting client makes it: the plan's writes go with the delete. */
  deleteRows(name: string, at: number, n: number): void {
    const id = this.sheet(name).id;
    const plan = this.e.planDeleteRows(id, at, n);
    this.e.deleteRows(id, at, n);
    for (const w of plan.cells) this.e.setCell(w.sheetId, w.rowId, w.colId, w.content);
    for (const w of plan.names) this.e.setName(w.name, w.scope, w.formula);
  }

  deleteCols(name: string, at: number, n: number): void {
    const id = this.sheet(name).id;
    const plan = this.e.planDeleteCols(id, at, n);
    this.e.deleteCols(id, at, n);
    for (const w of plan.cells) this.e.setCell(w.sheetId, w.rowId, w.colId, w.content);
    for (const w of plan.names) this.e.setName(w.name, w.scope, w.formula);
  }

  /** Applies a paste or fill result, growing first if asked. */
  apply(result: () => WriteResult): void {
    for (;;) {
      const r = result();
      if (r.kind === 'grow') {
        for (const g of r.sheets) this.grow(g.sheetId, g.rows, g.cols);
        continue;
      }
      for (const w of r.cells) this.e.setCell(w.sheetId, w.rowId, w.colId, w.content);
      return;
    }
  }
}
