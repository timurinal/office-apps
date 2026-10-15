/**
 * An edit stays with the cell it was started on.
 *
 * The grid's edit is a position: "A2". When somebody else inserts a row above while a person is
 * typing into A2, the cell they started on is now A3, and the edit, committed at A2, would
 * overwrite whatever has slid into A2 (the cell above, which they never touched). So when an edit
 * begins the page notes which row and column it is on, by id, and when its text comes back as an
 * `input` intent it is applied where those ids are now, which is where the person's cell went. If
 * somebody has deleted that row or column, the typing has nowhere to go, and the edit is dropped
 * with a word.
 *
 * (The editor is still drawn over the position it began at until it is committed; only where the
 * text lands is corrected.)
 */

import type { Engine } from './engine';
import type { Cellpos, GridIntent } from './grid/types';

export interface EditAnchor {
  sheet: string;
  row: string;
  col: string;
  /** Where it was when it began: the intent that comes back names this. */
  at: Cellpos;
}

/** The ids at a position, or null where there is no such row or column. */
export function anchorAt(engine: Engine, sheet: string, at: Cellpos): EditAnchor | null {
  const sh = engine.sheet(sheet);
  const row = sh?.rowOrder[at.row];
  const col = sh?.colOrder[at.col];
  return row !== undefined && col !== undefined ? { sheet, row, col, at: { ...at } } : null;
}

/**
 * The intent as it should be applied now: the same, moved to where the anchor's cell is, or null
 * when that cell has been deleted. An intent that is not the anchor's edit comes back as it was.
 */
export function followAnchor(engine: Engine, anchor: EditAnchor | null, sheet: string, intent: GridIntent): GridIntent | null {
  if (intent.type !== 'input' || !anchor || anchor.sheet !== sheet || anchor.at.row !== intent.at.row || anchor.at.col !== intent.at.col) return intent;
  const sh = engine.sheet(sheet);
  const row = sh?.rowIndex().get(anchor.row);
  const col = sh?.colIndex().get(anchor.col);
  if (row === undefined || col === undefined) return null;
  return row === intent.at.row && col === intent.at.col ? intent : { ...intent, at: { row, col } };
}
