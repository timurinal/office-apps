/**
 * The Sheets grid's public surface. The model builds a `GridData` and handles the
 * `GridIntent`s (`types.ts`); the editor puts these on the page:
 *
 *   const session = useGridSession(sheetId);
 *   <FormulaBar session={session} data={data} />
 *   <Grid session={session} data={data} onIntent={apply} zoom={zoom} />
 *   <SheetTabs sheets={tabs} active={sheetId} onSelect={...} ... />
 *   <SelectionStatus session={session} data={data} format={formatForStatus} />
 */

export { Grid, type GridProps } from './Grid';
export { FormulaBar, type FormulaBarProps } from './FormulaBar';
export { SheetTabs, reorderTo, SHEET_NAME_MAX, TAB_COLORS, type SheetTab, type SheetTabsProps } from './SheetTabs';
export { SelectionStatus } from './SelectionStatus';
export { GridSession, useGridSession, useSession } from './session';
export type { GridLayer } from './layer';
export { parseDisplayed, selectionStats, selectionStatsAsync, statusText, type SelectionStats, type StatKind } from './stats';
export type * from './types';
