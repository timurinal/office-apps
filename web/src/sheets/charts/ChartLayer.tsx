/**
 * The charts of the sheet on screen, put into the grid's own overlay layer.
 *
 * It is a module overlay (modules/charts.tsx), so it renders where the editor renders every module's
 * overlays, and it reaches into the grid only through `session.layer` (grid/layer.ts): a portal into
 * the layer's element, which begins at the first cell and clips at the headers and the scrollbars,
 * and one `follow` per card.
 *
 * Which cards exist, and when each changes, comes from the store (store.ts), so a card is rendered
 * when its own chart or its own data changed and not when somebody moves a cursor. A chart that is new
 * since the sheet was shown pops in, and one that goes fades out for the length of an exit; a sheet
 * that is opened with charts on it does neither, because nothing on it is new.
 */

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { DUR } from '../../motion';
import { ChartCard } from './ChartCard';
import { type ChartEntry, useChartStore } from './store';
import type { SheetsContext } from '../modules/types';
import './charts.css';

interface Shown {
  entry: ChartEntry;
  motion: 'none' | 'in' | 'out';
}

/**
 * The charts to draw: those on the sheet, those that have just arrived, and those still leaving.
 * `scope` is what the list belongs to (the workbook on screen, and its sheet): a new scope is a new
 * list, with nothing new on it and nothing leaving it.
 */
export function useShown(list: readonly ChartEntry[], scope: readonly unknown[]): Shown[] {
  const seen = useRef<{ scope: readonly unknown[]; ids: ReadonlySet<string> } | null>(null);
  const before = useRef<{ scope: readonly unknown[]; list: readonly ChartEntry[] } | null>(null);
  const [leaving, setLeaving] = useState<readonly ChartEntry[]>([]);
  const same = (a: readonly unknown[] | undefined) => !!a && a.length === scope.length && a.every((v, i) => Object.is(v, scope[i]));

  // The first render of a sheet has nothing new on it; later ones have whatever was not there before.
  const known = same(seen.current?.scope) ? seen.current!.ids : null;
  const arrived = useMemo(() => new Set(list.filter((e) => known && !known.has(e.id)).map((e) => e.id)), [list, known]);

  useEffect(() => {
    seen.current = { scope, ids: new Set(list.map((e) => e.id)) };
    const prev = before.current;
    before.current = { scope, list };
    if (!prev || !same(prev.scope)) {
      setLeaving([]);
      return;
    }
    const gone = prev.list.filter((e) => !list.some((x) => x.id === e.id));
    if (gone.length === 0) return;
    setLeaving((l) => [...l, ...gone]);
    const t = setTimeout(() => setLeaving((l) => l.filter((e) => !gone.includes(e))), DUR.fast + 20);
    return () => clearTimeout(t);
    // `scope` is an array made afresh each render: its members are what counts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list, ...scope]);

  return [
    ...list.map((entry): Shown => ({ entry, motion: arrived.has(entry.id) ? 'in' : 'none' })),
    ...leaving.filter((e) => !list.some((x) => x.id === e.id)).map((entry): Shown => ({ entry, motion: 'out' }))
  ];
}

export function ChartLayer({ ctx }: { ctx: Pick<SheetsContext, 'model' | 'sheetId' | 'session' | 'can' | 'panes' | 'actions' | 'notify'> }) {
  const { model, sheetId, session, can } = ctx;
  const store = useChartStore(model);
  const layer = useSyncExternalStore(session.subscribe, () => session.layer, () => null);
  const shown = useShown(store.chartsOn(sheetId), [model, sheetId]);
  // The page makes new `panes` and `actions` objects with every render; the cards should not see that.
  const latest = useRef(ctx);
  latest.current = ctx;
  const edit = useCallback(() => latest.current.panes.open('chart'), []);
  const focusGrid = useCallback(() => latest.current.actions.focusGrid(), []);
  const notify = useCallback((t: Parameters<typeof ctx.notify>[0]) => latest.current.notify(t), []);

  // A press on the grid, outside every chart, lets go of the selected one.
  useEffect(() => {
    const root = layer?.el.parentElement;
    if (!root) return;
    const down = (e: PointerEvent) => {
      if (!(e.target as Element).closest('.oac-card')) store.select(null);
    };
    root.addEventListener('pointerdown', down, true);
    return () => root.removeEventListener('pointerdown', down, true);
  }, [layer, store]);

  if (!layer) return null;
  return createPortal(
    <div className="oac-layer">
      {shown.map(({ entry, motion }) => (
        <ChartCard
          key={entry.id}
          entry={entry}
          model={model}
          layer={layer}
          store={store}
          selected={motion !== 'out' && store.selected === entry.id}
          editable={can.edit && motion !== 'out'}
          downloadable={can.download && motion !== 'out'}
          motion={motion}
          onEdit={edit}
          onFocusGrid={focusGrid}
          notify={notify}
        />
      ))}
    </div>,
    layer.el
  );
}
