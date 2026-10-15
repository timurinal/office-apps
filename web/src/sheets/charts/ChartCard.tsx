/**
 * A chart as a card floating over the grid: white, radius 16, on the cell it is anchored to.
 *
 * The grid draws a frame and, in the same task, moves everything `layer.follow` was given, so the
 * card is never a frame behind the cells under it (grid/layer.ts). What the card does with the
 * pointer:
 *
 *   a press        selects it (a ring in the app's colour) and, on an editor, starts a drag
 *   a drag         moves it; one of the eight handles sizes it, and the chart is laid out again as it grows
 *   release        one model step: the cell under its top-left corner, the offset into it, and the size
 *   Delete         removes it; Escape lets go of it; the arrow keys move it; Enter opens the pane
 *   a right click, or the button in the corner, opens its menu
 *   the wheel      scrolls the grid under it, which a card over a canvas would otherwise swallow
 *
 * Nothing animates under a drag: the position is written to the element as the pointer moves, the
 * chart is laid out afresh at the size being dragged, and `animate.ts` ignores a change of size.
 */

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Icon, dotsThreeIcon, pencilSimpleIcon, trashIcon } from '../../core/icons';
import type { Toast } from '../../core/ui';
import type { MenuItem } from '../../core/ui';
import type { Box } from '../grid/geometry';
import type { GridLayer } from '../grid/layer';
import { defaultMeasure } from '../model/measure';
import type { SheetModel } from '../model';
import { ChartMenu, type MenuAt } from './ChartMenu';
import { ChartView } from './ChartView';
import { deleteChart, setBox } from './edit';
import { downloadChart } from './export';
import { downloadSimpleIcon } from './icons';
import { MIN_H, MIN_W, layoutChart, resolveInput } from './layout';
import { MAX_H, MAX_W, anchorFor, boxOf } from './place';
import type { ChartEntry, ChartStore } from './store';
import type { ChartData } from './types';

const EMPTY: ChartData = { labels: [], x: null, xDate: false, series: [], every: 1, total: 0 };

type Mode = 'move' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
const HANDLES: Mode[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
/** A press that moves less than this is a click and not a drag. */
const THRESHOLD = 3;
const NUDGE = 4;

export interface ChartCardProps {
  entry: ChartEntry;
  model: SheetModel;
  layer: GridLayer;
  store: ChartStore;
  selected: boolean;
  /** This person may change the chart: move it, size it, delete it. */
  editable: boolean;
  downloadable: boolean;
  /** `in` for a chart that has just appeared, `out` while one leaves. */
  motion: 'none' | 'in' | 'out';
  onEdit: () => void;
  onFocusGrid: () => void;
  notify: (toast: Toast) => void;
}

interface Drag {
  mode: Mode;
  sx: number;
  sy: number;
  box0: Box;
  box: Box;
  started: boolean;
  pointer: number;
}

/** The box a drag in `mode` makes of `box0` after the pointer has moved (dx, dy). */
export function dragBox(mode: Mode, box0: Box, dx: number, dy: number, zoom: number, origin: { x: number; y: number }): Box {
  if (mode === 'move') return { x: Math.max(origin.x, box0.x + dx), y: Math.max(origin.y, box0.y + dy), w: box0.w, h: box0.h };
  const minW = MIN_W * zoom;
  const minH = MIN_H * zoom;
  let x1 = box0.x;
  let y1 = box0.y;
  let x2 = box0.x + box0.w;
  let y2 = box0.y + box0.h;
  if (mode.includes('w')) x1 = Math.max(origin.x, Math.min(x1 + dx, x2 - minW), x2 - MAX_W * zoom);
  if (mode.includes('e')) x2 = Math.min(Math.max(x2 + dx, x1 + minW), x1 + MAX_W * zoom);
  if (mode.includes('n')) y1 = Math.max(origin.y, Math.min(y1 + dy, y2 - minH), y2 - MAX_H * zoom);
  if (mode.includes('s')) y2 = Math.min(Math.max(y2 + dy, y1 + minH), y1 + MAX_H * zoom);
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

export const ChartCard = memo(function ChartCard(p: ChartCardProps) {
  const { entry, model, layer, store, editable } = p;
  const spec = entry.spec;
  const el = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement | null>(null);
  const [live, setLive] = useState<{ w: number; h: number } | null>(null);
  const [menu, setMenu] = useState<MenuAt | null>(null);
  const drag = useRef<Drag | null>(null);
  const liveBox = useRef<Box | null>(null);
  const pending = useRef(0);

  // What the grid's frame reads for this card: the drag's box while there is one, the stored place otherwise.
  const latest = useRef({ entry, p });
  latest.current = { entry, p };

  useLayoutEffect(() => {
    const node = el.current;
    if (!node) return;
    return layer.follow(node, () => {
      const L = layer.layout();
      if (!L) return null;
      node.style.setProperty('--z', String(L.zoom));
      const box = liveBox.current;
      if (box) return box;
      const e = latest.current.entry;
      return boxOf(model, e.host, e.spec, L);
    });
  }, [layer, model]);

  // The chart changed place or size, here or in another tab: the frame that puts it there is asked for,
  // and a box held since the drag ended is let go, because the stored one is now the truth.
  useLayoutEffect(() => {
    liveBox.current = null;
    layer.refresh();
  }, [entry, layer]);

  const size = live ?? { w: spec.w, h: spec.h };
  const geom = useMemo(() => layoutChart(resolveInput(spec, entry.data ?? EMPTY), size, defaultMeasure()), [spec, entry.data, size.w, size.h]);

  // The wheel over a card is the grid's: the card is a sibling of the scroller, so nothing scrolls without this.
  useEffect(() => {
    const node = el.current;
    if (!node) return;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey) return;
      const k = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? node.clientHeight : 1;
      layer.scrollBy(e.deltaX * k, e.deltaY * k);
      e.preventDefault();
    };
    node.addEventListener('wheel', onWheel, { passive: false });
    return () => node.removeEventListener('wheel', onWheel);
  }, [layer]);

  const place = (box: Box) => {
    const L = layer.layout();
    const node = el.current;
    if (!L || !node) return;
    node.style.transform = `translate(${box.x - L.headerW}px, ${box.y - L.headerH}px)`;
    node.style.setProperty('--cw', `${box.w}px`);
    node.style.setProperty('--ch', `${box.h}px`);
  };

  const cancel = () => {
    drag.current = null;
    liveBox.current = null;
    cancelAnimationFrame(pending.current);
    setLive(null);
    layer.refresh();
  };

  const down = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest('.oac-opts')) return;
    store.select(entry.id);
    el.current?.focus({ preventScroll: true });
    if (!editable) return;
    const L = layer.layout();
    const box0 = L ? boxOf(model, entry.host, spec, L) : null;
    if (!box0) return;
    const mode = (target.closest<HTMLElement>('[data-h]')?.dataset.h as Mode | undefined) ?? 'move';
    drag.current = { mode, sx: e.clientX, sy: e.clientY, box0, box: box0, started: false, pointer: e.pointerId };
    try {
      el.current?.setPointerCapture(e.pointerId);
    } catch {
      // A pointer that is already gone.
    }
    e.stopPropagation();
  };

  const move = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    const L = layer.layout();
    if (!d || !L) return;
    const dx = e.clientX - d.sx;
    const dy = e.clientY - d.sy;
    if (!d.started && Math.hypot(dx, dy) < THRESHOLD) return;
    d.started = true;
    const box = dragBox(d.mode, d.box0, dx, dy, L.zoom, { x: L.headerW, y: L.headerH });
    d.box = box;
    liveBox.current = box;
    place(box);
    if (d.mode !== 'move') {
      // The chart is laid out again at the size being dragged, at most once a frame.
      cancelAnimationFrame(pending.current);
      pending.current = requestAnimationFrame(() => setLive({ w: Math.round(box.w / L.zoom), h: Math.round(box.h / L.zoom) }));
    }
  };

  const up = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    drag.current = null;
    try {
      el.current?.releasePointerCapture(e.pointerId);
    } catch {
      // Not captured.
    }
    if (!d || !d.started) return;
    cancelAnimationFrame(pending.current);
    const L = layer.layout();
    const anchor = L ? anchorFor(model, entry.host, L, d.box.x, d.box.y) : null;
    if (!L || !anchor) return cancel();
    const was = entry.spec;
    // The box stays until the stored one arrives, so the card is not put back where it was for a frame.
    liveBox.current = d.box;
    setBox(model, entry, { anchor, w: d.box.w / L.zoom, h: d.box.h / L.zoom });
    if (store.get(entry.id)?.spec === was) cancel();
    else setLive(null);
  };

  /** The chart nudged by `dx`, `dy` pixels, from the keyboard: the same step a drag makes. */
  const nudge = (dx: number, dy: number) => {
    const L = layer.layout();
    const box = L ? boxOf(model, entry.host, spec, L) : null;
    const anchor = L && box ? anchorFor(model, entry.host, L, box.x + dx * L.zoom, box.y + dy * L.zoom) : null;
    if (anchor) setBox(model, entry, { anchor, w: spec.w, h: spec.h });
  };

  const key = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    const used = () => {
      e.preventDefault();
      e.stopPropagation();
    };
    if (e.key === 'Escape') {
      used();
      if (drag.current) return cancel();
      store.select(null);
      p.onFocusGrid();
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && editable) {
      used();
      deleteChart(model, entry);
      p.onFocusGrid();
    } else if (e.key === 'Enter' && editable) {
      used();
      p.onEdit();
    } else if (editable && e.key.startsWith('Arrow')) {
      used();
      const k = e.shiftKey ? 1 : NUDGE;
      nudge(e.key === 'ArrowLeft' ? -k : e.key === 'ArrowRight' ? k : 0, e.key === 'ArrowUp' ? -k : e.key === 'ArrowDown' ? k : 0);
    }
  };

  const items: MenuItem[] = [
    ...(editable ? [{ label: 'Edit chart', icon: pencilSimpleIcon, onSelect: p.onEdit }] : []),
    ...(p.downloadable
      ? [
          { label: 'Download as PNG', icon: downloadSimpleIcon, separated: editable, onSelect: () => void download('png') },
          { label: 'Download as SVG', icon: downloadSimpleIcon, onSelect: () => void download('svg') }
        ]
      : []),
    ...(editable
      ? [
          {
            label: 'Delete chart',
            icon: trashIcon,
            danger: true,
            separated: true,
            shortcut: 'Delete',
            onSelect: () => {
              deleteChart(model, entry);
              p.onFocusGrid();
            }
          }
        ]
      : [])
  ];

  async function download(format: 'png' | 'svg') {
    const node = svg.current;
    if (!node) return;
    const ok = await downloadChart(node, spec.title ?? '', format);
    if (!ok) p.notify({ text: 'That chart could not be saved.', tone: 'danger' });
  }

  const closeMenu = useCallback(() => setMenu(null), []);
  const motionClass = p.motion === 'none' ? '' : ' oa-pop';

  return (
    <div
      ref={el}
      className="oac-card"
      role="group"
      aria-roledescription="chart"
      aria-label={`Chart${spec.title ? `: ${spec.title}` : ''}`}
      tabIndex={0}
      data-chart={entry.id}
      data-selected={p.selected ? 'true' : undefined}
      data-editable={editable ? 'true' : undefined}
      // Hidden until the grid's first frame has put it somewhere.
      style={{ visibility: 'hidden' }}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={cancel}
      onKeyDown={key}
      onDoubleClick={() => {
        if (!editable) return;
        store.select(entry.id);
        p.onEdit();
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        store.select(entry.id);
        el.current?.focus({ preventScroll: true });
        if (items.length) setMenu({ x: e.clientX, y: e.clientY });
      }}
      onFocus={(e) => e.target === e.currentTarget && store.select(entry.id)}
    >
      <div className={`oac-in${motionClass}`} data-state={p.motion === 'out' ? 'closed' : 'open'}>
        <div className="oac-clip">
          <div className="oac-scale">
            <ChartView geom={geom} svgRef={svg} />
          </div>
        </div>
        {items.length > 0 && (
          <button
            type="button"
            className="oac-opts"
            aria-label="Chart options"
            aria-haspopup="menu"
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              store.select(entry.id);
              setMenu({ x: r.right - 210, y: r.bottom + 4 });
            }}
          >
            <Icon icon={dotsThreeIcon} size={16} />
          </button>
        )}
        {p.selected && editable && HANDLES.map((h) => <span key={h} className="oac-h" data-h={h} aria-hidden="true" />)}
      </div>
      {menu && <ChartMenu at={menu} items={items} onClose={closeMenu} />}
    </div>
  );
});
