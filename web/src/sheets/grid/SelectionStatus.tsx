/**
 * The footer's "Sum: £273,000": the sum, average or count of the numbers in the selection.
 * A press moves to the next of Sum, Average and Count; Min and Max follow, for the keyboard
 * and the screen reader alike, since it is one button.
 *
 * A small selection is added up in the render. A big one (a whole column at a hundred
 * thousand rows) is read in slices after the selection has stopped changing for a moment, so
 * dragging over it never waits for the sum.
 */

import { useEffect, useMemo, useState } from 'react';
import { cellsIn } from './selection';
import { useSession, type GridSession } from './session';
import { selectionStats, selectionStatsAsync, STAT_KINDS, statusText, type SelectionStats, type StatKind } from './stats';
import type { GridData } from './types';
import './grid.css';

const SMALL = 20_000;

export function SelectionStatus(props: {
  session: GridSession;
  data: GridData;
  /** Writes a number as the cells write it: `format(273000, '£#,##0')` is `£273,000`. */
  format?: (n: number, numFmt?: string) => string;
}) {
  const { session, data, format } = props;
  useSession(session);
  const rect = session.rect();
  const small = cellsIn(rect) <= SMALL;
  const [kind, setKind] = useState<StatKind>('sum');
  const [big, setBig] = useState<SelectionStats | null>(null);

  const sync = useMemo(
    () => (small ? selectionStats(data, rect) : null),
    // The rectangle is read by value; `version` is what says the cells changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [small, data, data.version, rect.r1, rect.r2, rect.c1, rect.c2]
  );

  useEffect(() => {
    if (small) return;
    const ctl = new AbortController();
    setBig(null);
    const t = setTimeout(() => void selectionStatsAsync(data, rect, ctl.signal).then((s) => s && setBig(s)), 150);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [small, data, data.version, rect.r1, rect.r2, rect.c1, rect.c2]);

  const stats = small ? sync : big;
  if (!stats) return null;
  const text = statusText(stats, kind, format) ?? statusText(stats, 'count', format);
  if (!text) return null;
  const next = () => {
    const at = STAT_KINDS.indexOf(kind);
    setKind(STAT_KINDS[(at + 1) % STAT_KINDS.length]!);
  };
  return (
    <button type="button" className="sg-status" title="Change what the status shows" onMouseDown={(e) => e.preventDefault()} onClick={next}>
      {text}
    </button>
  );
}
