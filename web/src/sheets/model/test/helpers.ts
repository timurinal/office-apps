/** What the model's tests share: a room with people in it, and A1 addressing. */

import { FakeRoom, type FakeClient } from '../testing/fakeRoom';
import { SheetModel } from '../model';
import { type SheetSeedBuilder, buildSheetSeed } from '../seed';
import { estimateMeasure } from '../measure';

export interface Person {
  model: SheetModel;
  client: FakeClient;
}

/** A room seeded by `build`, with `n` people in it, joined. */
export function room(build?: (b: SheetSeedBuilder) => void, n = 2, id?: string): { room: FakeRoom; people: Person[]; sheet: string } {
  const r = new FakeRoom(buildSheetSeed(build), id);
  const people: Person[] = [];
  for (let i = 0; i < n; i++) {
    const client = r.client(String.fromCharCode(97 + i));
    people.push({ client, model: new SheetModel(client.source, { measure: estimateMeasure() }) });
  }
  r.flush();
  return { room: r, people, sheet: people[0]!.model.sheets()[0]!.id };
}

/** `B3` → row 2, column 1. */
export function at(ref: string): { row: number; col: number } {
  const m = /^([A-Z]+)(\d+)$/.exec(ref);
  if (!m) throw new Error(ref);
  let col = 0;
  for (const ch of m[1]!) col = col * 26 + (ch.charCodeAt(0) - 64);
  return { row: Number(m[2]) - 1, col: col - 1 };
}

/** The value a cell shows, as the grid would ask for it: its formatted text. */
export function text(m: SheetModel, sheet: string, ref: string): string {
  const { row, col } = at(ref);
  return m.view(sheet).cell(row, col)?.text ?? '';
}

/** What the formula bar shows. */
export function edit(m: SheetModel, sheet: string, ref: string): string {
  const { row, col } = at(ref);
  return m.view(sheet).editText(row, col);
}

export function type(m: SheetModel, sheet: string, ref: string, value: string): boolean {
  return m.input(sheet, at(ref), value);
}

/** Each row's texts over the first `cols` columns, for comparing two people's view at a glance. */
export function grid(m: SheetModel, sheet: string, rows: number, cols: number): string[][] {
  const v = m.view(sheet);
  const out: string[][] = [];
  for (let r = 0; r < rows; r++) {
    const line: string[] = [];
    for (let c = 0; c < cols; c++) line.push(v.cell(r, c)?.text ?? '');
    out.push(line);
  }
  return out;
}
