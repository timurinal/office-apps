/**
 * A table's own options: its header row and bands, which cells are chosen, and what to do to them.
 *
 * The map is the table in small: a button for every cell that is not covered by a merge, laid out as
 * the table is. A click chooses a cell and a Shift+click chooses the range from the last one chosen,
 * which is how more than one cell is chosen for a merge, a fill or a delete (typing in a cell chooses
 * it too). The buttons below act on the chosen cells and are the ribbon's own
 * (insert/tableActions.ts); a cell's fill and vertical alignment are set for the whole range in one
 * step.
 */

import { Icon } from '../../../core/icons';
import { arrowsMergeIcon, arrowsSplitIcon, columnsIcon, columnsPlusLeftIcon, columnsPlusRightIcon, rowsIcon, rowsPlusBottomIcon, rowsPlusTopIcon } from '../../modules/insert/icons';
import {
  addColumn,
  addRow,
  mergeable,
  mergeChosen,
  removeColumns,
  removeRows,
  setTableLook,
  splittable,
  splitChosen,
  type TableHost
} from '../../modules/insert/tableActions';
import { expandRange, positionsIn, setCellLook, type CellPos } from '../../modules/insert/tableOps';
import { chooseCells, chosenRange, useTables } from '../../modules/insert/tables';
import type { TableElement } from '../../model/deck';
import { ColorPicker } from './ColorPicker';
import { common } from './edits';
import type { PaneEnv } from './env';
import { Check, Row, Seg, Stack } from './fields';

const ANCHORS = [
  { value: 'top', label: 'Top' },
  { value: 'middle', label: 'Middle' },
  { value: 'bottom', label: 'Bottom' }
] as const;

const span = (n: number | undefined): number => Math.max(1, Math.round(n ?? 1));

function TableMap({ table, env }: { table: TableElement; env: PaneEnv }) {
  const tables = useTables(env.model);
  const cols = table.cols.length;
  const range = chosenRange(tables, table.id!);
  const shown = range ? expandRange(table, range) : null;
  const choose = (p: CellPos, extend: boolean) => {
    const from = tables.chosen && tables.chosen.elId === table.id ? tables.chosen.a : p;
    chooseCells(env.model, env.slide, table.id!, extend ? from : p, p);
  };
  return (
    <div className="sl-fp-map" role="group" aria-label="Cells" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
      {table.rows.map((row, r) =>
        row.cells.map((cell, c) => {
          if (cell.merged || c >= cols) return null;
          const rs = span(cell.rowSpan);
          const cs = span(cell.colSpan);
          const on = !!shown && r <= shown.r2 && r + rs - 1 >= shown.r1 && c <= shown.c2 && c + cs - 1 >= shown.c1;
          return (
            <button
              key={`${r}.${c}`}
              type="button"
              className="sl-fp-mapcell"
              aria-pressed={on}
              aria-label={`Row ${r + 1}, column ${c + 1}${rs > 1 || cs > 1 ? `, merged ${rs} by ${cs}` : ''}`}
              style={{ gridRow: `${r + 1} / span ${rs}`, gridColumn: `${c + 1} / span ${cs}` }}
              onClick={(e) => choose({ r, c }, e.shiftKey)}
            />
          );
        })
      )}
    </div>
  );
}

export function TableTab({ env }: { env: PaneEnv }) {
  const { els, ctx, model, slide, theme, edit } = env;
  const table = els.length === 1 && els[0]!.type === 'table' ? els[0]! : null;
  const tables = useTables(model);
  if (!table) return null;
  const host: TableHost = { model, selection: ctx.selection, notify: ctx.notify };
  const range = chosenRange(tables, table.id!) ?? { r1: 0, c1: 0, r2: 0, c2: 0 };
  const shown = expandRange(table, range);
  const cells = positionsIn(shown)
    .map((p) => table.rows[p.r]?.cells[p.c])
    .filter((c): c is NonNullable<typeof c> => !!c && !c.merged);
  const fill = common(cells.map((c) => (c.fill?.kind === 'solid' ? c.fill.color : null)));
  const anchor = common(cells.map((c) => c.anchor ?? 'top'));
  const look = (key: 'firstRow' | 'bandRows') => (on: boolean) => void setTableLook(host, key, on);
  const btn = (label: string, icon: string, run: () => void, disabled = false) => (
    <button type="button" className="sl-fp-act" disabled={!edit || disabled} onClick={run}>
      <Icon icon={icon} size={14} />
      {label}
    </button>
  );
  return (
    <div className="sl-fp-group">
      <Check label="Header row" value={!!table.firstRow} disabled={!edit} onChange={look('firstRow')} />
      <Check label="Banded rows" value={!!table.bandRows} disabled={!edit} onChange={look('bandRows')} />
      <TableMap table={table} env={env} />
      <div className="sl-fp-acts">
        {btn('Row above', rowsPlusTopIcon, () => void addRow(host, false))}
        {btn('Row below', rowsPlusBottomIcon, () => void addRow(host, true))}
        {btn('Column left', columnsPlusLeftIcon, () => void addColumn(host, false))}
        {btn('Column right', columnsPlusRightIcon, () => void addColumn(host, true))}
        {btn('Delete rows', rowsIcon, () => void removeRows(host))}
        {btn('Delete columns', columnsIcon, () => void removeColumns(host))}
        {btn('Merge cells', arrowsMergeIcon, () => void mergeChosen(host), !mergeable(host))}
        {btn('Split cell', arrowsSplitIcon, () => void splitChosen(host), !splittable(host))}
      </div>
      <Row label="Cell fill">
        <ColorPicker
          label="Cell fill"
          value={fill?.value ?? null}
          empty={fill ? 'Table style' : 'Mixed'}
          theme={theme}
          disabled={!edit}
          clear={{ label: 'Table style', run: () => void setCellLook(model, slide, table.id!, shown, { fill: null }) }}
          onPick={(c) => void setCellLook(model, slide, table.id!, shown, { fill: { kind: 'solid', color: c } })}
        />
      </Row>
      <Stack label="Cell alignment">
        <Seg label="Vertical alignment of cells" value={anchor?.value ?? null} options={ANCHORS} disabled={!edit} onChange={(a) => void setCellLook(model, slide, table.id!, shown, { anchor: a })} />
      </Stack>
    </div>
  );
}
