/**
 * The formula bar, kept current.
 *
 * The bar sits in the banner, outside the grid, and shows the active cell's content. It re-renders
 * when the selection or the edit moves (the session), but not when the cell's content changes under
 * a still selection: somebody else typing into it, an undo, a restore. The grid is told by the
 * data (`subscribe`); this is the same for the bar, so what it shows is never older than the cell.
 */

import { useSyncExternalStore } from 'react';
import { FormulaBar, type GridSession } from './grid';
import type { SheetView } from './model';
import { openTool } from './panes/tools';

export function FormulaRow({ session, data, readOnly }: { session: GridSession; data: SheetView; readOnly: boolean }) {
  useSyncExternalStore(
    (cb) => data.subscribe(cb),
    () => data.version,
    () => data.version
  );
  // `fx` is Insert function, as the board's is.
  return <FormulaBar session={session} data={data} readOnly={readOnly} onInsertFunction={() => openTool({ id: 'function' })} />;
}
