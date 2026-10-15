/**
 * A workbook as the model saves it, opened for reading: the structure document applied, the
 * engine given the sheets, names and cells, and everything calculated.
 *
 * This is what an export needs and the model's own `SheetModel` is not: no undo history, no
 * room, no views, and it runs in a worker and in a server-side exporter. It takes
 * `{ state, cells }` (`SheetFile`, sheets/model/source.ts), which is what `model.export()` and
 * the room's `readDocument()` both answer.
 *
 * A cell on a row or column the structure no longer has is an orphan (shared/cells.ts), kept
 * for an undo. It is not in the file anyone downloads.
 */

import * as Y from 'yjs';
import type { CellOp, StoredCell } from '@shared/cells';
import { Engine, type EngineOptions } from '../../sheets/engine';
import { type SheetMap, dedupe, field, namesOf, sheetIdsInOrder, sheetsOf } from '../../sheets/model/structure';
import { StyleBook } from '../../sheets/model/styles';

export interface BookSheet {
  id: string;
  name: string;
  map: SheetMap;
  rows: readonly string[];
  cols: readonly string[];
}

/** A live cell: its position, its ids and what is stored. */
export interface BookCell {
  r: number;
  c: number;
  row: string;
  col: string;
  content: StoredCell;
}

export interface Book {
  doc: Y.Doc;
  engine: Engine;
  /** In tab order, hidden ones too. */
  sheets: BookSheet[];
  /** Per sheet id, by row and then column. */
  cells: Map<string, BookCell[]>;
  styles: StyleBook;
}

export interface BookFile {
  state: Uint8Array;
  cells: readonly CellOp[];
}

export function openBook(file: BookFile, opts: EngineOptions = {}): Book {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, file.state);
  const engine = new Engine(opts);
  const sheets: BookSheet[] = [];
  for (const id of sheetIdsInOrder(doc)) {
    const map = sheetsOf(doc).get(id);
    if (!map) continue;
    const name = field(map, 'name');
    const rows = dedupe(field(map, 'rowOrder')?.toArray() ?? []).ids;
    const cols = dedupe(field(map, 'colOrder')?.toArray() ?? []).ids;
    engine.addSheet(id, typeof name === 'string' ? name : id, rows, cols);
    sheets.push({ id, name: typeof name === 'string' ? name : id, map, rows, cols });
  }
  for (const n of namesOf(doc).values()) engine.setName(n.name, n.scope, n.f);

  const cells = new Map<string, BookCell[]>(sheets.map((s) => [s.id, []]));
  for (const op of file.cells) {
    const sheet = engine.sheet(op.sheet);
    const list = cells.get(op.sheet);
    if (!sheet || !list || !op.content) continue;
    const r = sheet.rowIndex().get(op.row);
    const c = sheet.colIndex().get(op.col);
    if (r === undefined || c === undefined) continue;
    const { s: _style, ...calc } = op.content;
    void _style;
    if (calc.v !== undefined || calc.e !== undefined || calc.f !== undefined) engine.setCell(op.sheet, op.row, op.col, calc as Parameters<Engine['setCell']>[3]);
    list.push({ r, c, row: op.row, col: op.col, content: op.content });
  }
  for (const list of cells.values()) list.sort((a, b) => a.r - b.r || a.c - b.c);
  engine.recalcAll();
  return { doc, engine, sheets, cells, styles: new StyleBook(doc) };
}
