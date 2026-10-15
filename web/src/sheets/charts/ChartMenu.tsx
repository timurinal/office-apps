/**
 * A chart's menu: Edit chart, Download as PNG and SVG, Delete.
 *
 * It opens from the card's button or a right click, at a point on the page. It is a portal under its
 * own `data-app`, not a popover inside the card: the grid clips what is inside it, and a menu that
 * opens near the edge of the sheet must not be cut off. It closes on a press outside, on Escape and
 * on a scroll, takes the keyboard while open and gives it back to the chart.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MenuList, type MenuItem } from '../../core/ui';

export interface MenuAt {
  x: number;
  y: number;
}

export function ChartMenu({ at, items, onClose }: { at: MenuAt; items: readonly MenuItem[]; onClose: () => void }) {
  const root = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: at.x, top: at.y });

  // Inside the window: flipped up or left where it would run off.
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    setPos({
      left: Math.max(8, Math.min(at.x, window.innerWidth - w - 8)),
      top: Math.max(8, at.y + h + 8 > window.innerHeight ? at.y - h : at.y)
    });
  }, [at.x, at.y]);

  useEffect(() => {
    const away = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('pointerdown', away, true);
    document.addEventListener('keydown', key, true);
    window.addEventListener('blur', onClose);
    window.addEventListener('resize', onClose);
    root.current?.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)')?.focus();
    return () => {
      document.removeEventListener('pointerdown', away, true);
      document.removeEventListener('keydown', key, true);
      window.removeEventListener('blur', onClose);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);

  return createPortal(
    // React events from a portal bubble to the chart's own handlers (a press would start a drag), so they stop here.
    <div
      data-app="sheets"
      className="oac-menu"
      style={{ left: pos.left, top: pos.top }}
      ref={root}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <div role="menu" aria-label="Chart" className="oa-popover oa-rise">
        <MenuList items={items} onDone={onClose} />
      </div>
    </div>,
    document.body
  );
}
