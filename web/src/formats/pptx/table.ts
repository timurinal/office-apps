/**
 * A table: `a:tbl` as the deck's `TableElement` pieces.
 *
 * The grid is the table's size: PowerPoint draws it from `gridCol` and `tr h`, and rewrites the
 * frame's extent from them, so the frame is not trusted. A merge keeps its top-left cell with the
 * spans and the cells it covers as `{ merged: true }`, as the deck says. Borders are read for the
 * table as a whole (the first the file states); a cell's own border is not kept. The table style
 * (banding, the header row's look) is not read: `firstRow` and `bandRows` are, and the deck draws
 * them from its theme.
 */

import { DECK_LIMITS, type Line, type TableCell, type TableElement } from '../../slides/model/deck';
import { plural } from '../types';
import { child, elements, type XNode } from '../xml';
import type { PartCtx } from './ctx';
import { fillElement, readFill, readLine } from './fill';
import { flag, int, pick } from './part';
import { readLevels, readTextBody } from './text';
import { toLen } from './units';

const ANCHORS: Record<string, NonNullable<TableCell['anchor']>> = { t: 'top', ctr: 'middle', b: 'bottom' };

const emptyCell = (): TableCell => ({ text: { type: 'doc', content: [{ type: 'paragraph' }] } });

type TableParts = Pick<TableElement, 'cols' | 'rows' | 'firstRow' | 'bandRows' | 'border'>;

export function readTable(tbl: XNode, pc: PartCtx): TableParts | null {
  const space = pc.deck.space;
  const grid = child(tbl, 'a:tblGrid');
  // A grid wider than the cell limit is cut to it: a table of 5000 columns is not a table.
  const cols = grid ? elements(grid).filter((c) => c.name === 'a:gridCol').slice(0, DECK_LIMITS.tableCells).map((c) => toLen(space, int(c, 'w', 0))) : [];
  const trs = elements(tbl).filter((c) => c.name === 'a:tr');
  if (cols.length === 0 || trs.length === 0) return null;

  let border: Line | undefined;
  const rows: TableParts['rows'] = [];
  let capped = false;
  for (const tr of trs) {
    if ((rows.length + 1) * cols.length > DECK_LIMITS.tableCells) {
      capped = true;
      break;
    }
    const cells: TableCell[] = [];
    for (const tc of elements(tr)) {
      if (tc.name !== 'a:tc' || cells.length >= cols.length) continue;
      const tcPr = child(tc, 'a:tcPr');
      if (flag(tc, 'hMerge') || flag(tc, 'vMerge')) {
        cells.push({ ...emptyCell(), merged: true });
        continue;
      }
      const tx = child(tc, 'a:txBody');
      const cell: TableCell = { text: readTextBody(tx, { pc, defaults: readLevels(child(tx, 'a:lstStyle'), pc) }) };
      const fill = fillElement(tcPr) ? readFill(tcPr, pc) : undefined;
      if (fill) cell.fill = fill;
      const colSpan = int(tc, 'gridSpan', 1);
      const rowSpan = int(tc, 'rowSpan', 1);
      if (colSpan > 1) cell.colSpan = Math.min(colSpan, cols.length);
      if (rowSpan > 1) cell.rowSpan = Math.min(rowSpan, trs.length);
      const anchor = pick(ANCHORS, tcPr?.attrs.anchor);
      if (anchor) cell.anchor = anchor;
      cells.push(cell);
      if (!border && tcPr) {
        for (const side of ['a:lnL', 'a:lnT', 'a:lnR', 'a:lnB']) {
          const ln = readLine(child(tcPr, side), pc);
          if (ln && ln.width > 0) {
            border = ln;
            break;
          }
        }
      }
    }
    while (cells.length < cols.length) cells.push(emptyCell());
    rows.push({ h: toLen(space, int(tr, 'h', 0)), cells });
  }
  if (rows.length === 0) return null;
  if (capped) pc.deck.warnings.add('table-size', (n) => `${plural(n, 'table')} past ${DECK_LIMITS.tableCells} cells ${n === 1 ? 'was' : 'were'} cut short.`);
  const pr = child(tbl, 'a:tblPr');
  const out: TableParts = { cols, rows };
  if (flag(pr, 'firstRow')) out.firstRow = true;
  if (flag(pr, 'bandRow')) out.bandRows = true;
  if (border) out.border = border;
  return out;
}
