/**
 * The Insert module: what a presentation is built from beyond text.
 *
 *   Insert › Tables         Table ▾ (a grid up to 10 by 8); with a table chosen, Rows and columns ▾,
 *                           Merge cells and Split cell
 *   Insert › Images         Picture, from a file: made smaller, stored as an asset of the document
 *   Insert › Illustrations  Shapes ▾ (every preset, with the text box, line and arrow), Line, Arrow,
 *                           and Chart ▾ (column, bar, line, pie and scatter, with sample data)
 *   Home › Drawing          the shapes used most as a gallery of small tiles with a button for the rest, while
 *                           the strip has room, and the same Shapes ▾ when it has not; in the slot types.ts
 *                           reserves for it
 *
 * A shape, a text box or a line is drawn: choosing it arms a tool, and the next click on the slide
 * places it at a default size and a drag draws it (insert/DrawLayer.tsx). A table's cells are typed
 * in on the canvas (insert/TableLayer.tsx). A chart's data is edited in the Format pane
 * (panes/format). The command box can make each of them without a pointer, in the middle of the
 * slide, for a keyboard that cannot drag.
 *
 * Every insert is one model step and so one undo entry (insert/place.ts); a control that changes the
 * deck is off for a reader by `can.edit`, never by a role.
 */

import { Icon } from '../../core/icons';
import type { Command, MenuEntry, RibbonGroup } from '../../core/shell/types';
import { DrawLayer } from './insert/DrawLayer';
import { CHART_KINDS, CHART_NAMES, type ChartKind } from './insert/defaults';
import { arrowUpRightIcon, arrowsMergeIcon, arrowsSplitIcon, chartBarHorizontalIcon, chartBarIcon, chartLineIcon, chartPieIcon, chartScatterIcon, columnsIcon, columnsPlusLeftIcon, columnsPlusRightIcon, imageIcon, lineSegmentIcon, rowsIcon, rowsPlusBottomIcon, rowsPlusTopIcon, shapesIcon, tableIcon } from './insert/icons';
import { keepSelection } from './insert/menus';
import { addPictures, pickPictureFiles } from './insert/picture';
import { insertChart, insertLine, insertShape, insertTable } from './insert/place';
import { GALLERY_KINDS, HomeShapes, ShapesButton, SHAPE_NAMES } from './insert/ShapeGallery';
import { addColumn, addRow, mergeable, mergeChosen, removeColumns, removeRows, selectedTable, splittable, splitChosen, type TableHost } from './insert/tableActions';
import { TableButton } from './insert/TablePicker';
import { TableLayer } from './insert/TableLayer';
import { arm, sameTool, useArmed, type Tool } from './insert/tool';
import type { SlidesContext, SlidesModule } from './types';

const target = (c: SlidesContext) => ({ model: c.model, selection: c.selection });
const host = (c: SlidesContext): TableHost => ({ model: c.model, selection: c.selection, notify: c.notify });

/** Everything that changes the deck is off for a reader, and for a deck with no slide to put it on. */
const cannotInsert = (c: SlidesContext): boolean => !c.can.edit || !c.slideId;
/** A table is the only thing chosen. (A context without a selection yet has none.) */
const hasTable = (c: SlidesContext): boolean => !!c.selection && selectedTable(host(c)) !== null;

const CHART_ICONS: Record<ChartKind, string> = { column: chartBarIcon, bar: chartBarHorizontalIcon, line: chartLineIcon, pie: chartPieIcon, scatter: chartScatterIcon };

/** Picture, from a file picker. Only a document on a server has assets to put it in. */
export function addPictureFromFile(c: SlidesContext): void {
  pickPictureFiles((files) => void addPictures({ target: target(c), documentId: c.meta.id, notify: c.notify }, files));
}

/** Line and Arrow: a ribbon button that arms the drawing tool and shows that it is armed. */
function ToolButton({ ctx, id, label, icon, tool, now }: { ctx: SlidesContext; id: string; label: string; icon: string; tool: Tool; now: () => void }) {
  const armed = useArmed(ctx.model);
  return (
    <button
      type="button"
      data-rb-item
      data-id={id}
      className="oa-rb-tl"
      title={label}
      aria-pressed={sameTool(armed, tool)}
      disabled={cannotInsert(ctx)}
      onMouseDown={keepSelection}
      // A click the keyboard made (detail 0) cannot be followed by a drag, so it places the line at once.
      onClick={(e) => (e.detail === 0 ? now() : arm(ctx.model, tool))}
    >
      <Icon icon={icon} size={16} />
      {label}
    </button>
  );
}

const tableEntries: MenuEntry<SlidesContext>[] = [
  { label: 'Insert row above', icon: rowsPlusTopIcon, disabled: (c) => !c.can.edit, run: (c) => void addRow(host(c), false) },
  { label: 'Insert row below', icon: rowsPlusBottomIcon, disabled: (c) => !c.can.edit, run: (c) => void addRow(host(c), true) },
  { label: 'Insert column left', icon: columnsPlusLeftIcon, disabled: (c) => !c.can.edit, run: (c) => void addColumn(host(c), false) },
  { label: 'Insert column right', icon: columnsPlusRightIcon, disabled: (c) => !c.can.edit, run: (c) => void addColumn(host(c), true) },
  { label: 'Delete rows', icon: rowsIcon, danger: true, separated: true, disabled: (c) => !c.can.edit, run: (c) => void removeRows(host(c)) },
  { label: 'Delete columns', icon: columnsIcon, danger: true, disabled: (c) => !c.can.edit, run: (c) => void removeColumns(host(c)) }
];

const ribbon: RibbonGroup<SlidesContext>[] = [
  // Home's Drawing group, as the board draws it: the shapes, before Arrange. The strip shows the ones used most while it
  // has room, and the Shapes button when it has not.
  { id: 'home.drawing', tab: 'home', order: 500, label: 'Drawing', items: [{ type: 'custom', id: 'home.shapes', render: (c) => <HomeShapes ctx={c} /> }] },
  {
    id: 'insert.tables',
    tab: 'insert',
    order: 200,
    label: 'Tables',
    items: [
      { type: 'custom', id: 'insert.table', render: (c) => <TableButton ctx={c} id="insert.table" /> },
      { type: 'menu', id: 'insert.table-rows', label: 'Rows and columns', icon: rowsIcon, showLabel: true, visible: hasTable, disabled: (c) => !c.can.edit, entries: tableEntries },
      { type: 'button', id: 'insert.table-merge', label: 'Merge cells', icon: arrowsMergeIcon, showLabel: true, visible: hasTable, disabled: (c) => !c.can.edit || !mergeable(host(c)), run: (c) => void mergeChosen(host(c)) },
      { type: 'button', id: 'insert.table-split', label: 'Split cell', icon: arrowsSplitIcon, showLabel: true, visible: hasTable, disabled: (c) => !c.can.edit || !splittable(host(c)), run: (c) => void splitChosen(host(c)) }
    ]
  },
  {
    id: 'insert.images',
    tab: 'insert',
    order: 300,
    label: 'Images',
    items: [{ type: 'button', id: 'insert.picture', label: 'Picture', icon: imageIcon, showLabel: true, visible: (c) => c.source.kind === 'cloud', disabled: cannotInsert, run: addPictureFromFile }]
  },
  {
    id: 'insert.illustrations',
    tab: 'insert',
    order: 400,
    label: 'Illustrations',
    items: [
      { type: 'custom', id: 'insert.shapes', render: (c) => <ShapesButton ctx={c} id="insert.shapes" /> },
      {
        type: 'custom',
        id: 'insert.line',
        render: (c) => <ToolButton ctx={c} id="insert.line" label="Line" icon={lineSegmentIcon} tool={{ kind: 'line', arrow: false }} now={() => void insertLine(target(c), false)} />
      },
      {
        type: 'custom',
        id: 'insert.arrow',
        render: (c) => <ToolButton ctx={c} id="insert.arrow" label="Arrow" icon={arrowUpRightIcon} tool={{ kind: 'line', arrow: true }} now={() => void insertLine(target(c), true)} />
      },
      {
        type: 'menu',
        id: 'insert.chart',
        label: 'Chart',
        icon: chartBarIcon,
        showLabel: true,
        disabled: cannotInsert,
        entries: CHART_KINDS.map((k): MenuEntry<SlidesContext> => ({ label: CHART_NAMES[k], icon: CHART_ICONS[k], run: (c) => void insertChart(target(c), k) }))
      }
    ]
  }
];

const canInsert = (c: SlidesContext): boolean => c.can.edit && !!c.slideId;

const commands: Command<SlidesContext>[] = [
  ...GALLERY_KINDS.map(
    (kind): Command<SlidesContext> => ({
      id: `insert.shape.${kind}`,
      title: `Shape: ${SHAPE_NAMES[kind]}`,
      section: 'Insert',
      icon: shapesIcon,
      keywords: ['shape', 'draw', SHAPE_NAMES[kind]],
      visible: canInsert,
      run: (c) => void insertShape(target(c), kind)
    })
  ),
  { id: 'insert.cmd-line', title: 'Line', section: 'Insert', icon: lineSegmentIcon, keywords: ['draw', 'connector'], visible: canInsert, run: (c) => void insertLine(target(c), false) },
  { id: 'insert.cmd-arrow', title: 'Arrow', section: 'Insert', icon: arrowUpRightIcon, keywords: ['draw', 'line', 'connector'], visible: canInsert, run: (c) => void insertLine(target(c), true) },
  {
    id: 'insert.cmd-table',
    title: 'Table',
    section: 'Insert',
    icon: tableIcon,
    keywords: ['grid', 'rows', 'columns'],
    visible: canInsert,
    run: (c) => void insertTable(target(c), 3, 3)
  },
  ...CHART_KINDS.map(
    (kind): Command<SlidesContext> => ({
      id: `insert.chart.${kind}`,
      title: `Chart: ${CHART_NAMES[kind]}`,
      section: 'Insert',
      icon: CHART_ICONS[kind],
      keywords: ['chart', 'graph', 'plot'],
      visible: canInsert,
      run: (c) => void insertChart(target(c), kind)
    })
  ),
  { id: 'insert.cmd-picture', title: 'Picture', section: 'Insert', icon: imageIcon, keywords: ['image', 'photo', 'upload'], visible: (c) => canInsert(c) && c.source.kind === 'cloud', run: addPictureFromFile },

  { id: 'table.row-above', title: 'Insert row above', section: 'Insert', icon: rowsPlusTopIcon, keywords: ['table'], visible: (c) => c.can.edit && hasTable(c), run: (c) => void addRow(host(c), false) },
  { id: 'table.row-below', title: 'Insert row below', section: 'Insert', icon: rowsPlusBottomIcon, keywords: ['table'], visible: (c) => c.can.edit && hasTable(c), run: (c) => void addRow(host(c), true) },
  { id: 'table.column-left', title: 'Insert column left', section: 'Insert', icon: columnsPlusLeftIcon, keywords: ['table'], visible: (c) => c.can.edit && hasTable(c), run: (c) => void addColumn(host(c), false) },
  { id: 'table.column-right', title: 'Insert column right', section: 'Insert', icon: columnsPlusRightIcon, keywords: ['table'], visible: (c) => c.can.edit && hasTable(c), run: (c) => void addColumn(host(c), true) },
  { id: 'table.delete-rows', title: 'Delete table rows', section: 'Insert', icon: rowsIcon, keywords: ['table', 'remove'], visible: (c) => c.can.edit && hasTable(c), run: (c) => void removeRows(host(c)) },
  { id: 'table.delete-columns', title: 'Delete table columns', section: 'Insert', icon: columnsIcon, keywords: ['table', 'remove'], visible: (c) => c.can.edit && hasTable(c), run: (c) => void removeColumns(host(c)) },
  { id: 'table.merge', title: 'Merge cells', section: 'Insert', icon: arrowsMergeIcon, keywords: ['table', 'join'], visible: (c) => c.can.edit && hasTable(c), disabled: (c) => !mergeable(host(c)), run: (c) => void mergeChosen(host(c)) },
  { id: 'table.split', title: 'Split cell', section: 'Insert', icon: arrowsSplitIcon, keywords: ['table', 'unmerge'], visible: (c) => c.can.edit && hasTable(c), disabled: (c) => !splittable(host(c)), run: (c) => void splitChosen(host(c)) }
];

export const insertModule: SlidesModule = {
  id: 'insert',
  ribbon,
  commands,
  // The table's cell editor under the drawing tool's catcher: a tool that is armed wins the press.
  canvas: [
    { id: 'insert.table', render: (c, frame) => <TableLayer c={c} frame={frame} /> },
    { id: 'insert.draw', render: (c, frame) => <DrawLayer c={c} frame={frame} /> }
  ]
};
