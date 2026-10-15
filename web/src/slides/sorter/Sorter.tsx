/**
 * The slide sorter: every slide as a thumbnail in a grid, in place of Normal view.
 *
 *   size        follows the footer's zoom (`sorter.ts`, `thumbWidth`)
 *   choose      a click chooses a slide and shows it; Shift chooses a range, Ctrl (Cmd) one more or one
 *               fewer. The choice is the rail's, so Normal view comes back to the same slides.
 *   open        double click, or Enter: the slide, in Normal view
 *   reorder     drag the chosen slides; a line shows where they will land and the view scrolls near its
 *               edges. The drop is one step, and the others glide to their places after it (FLIP).
 *               Alt with an arrow moves the chosen slides one place, for a keyboard.
 *   keys        arrows, Home and End move; Delete deletes; Ctrl+D copies, Ctrl+A chooses all (the
 *               page's, since the sorter has the slide list's focus)
 *   menu        right-click: New slide, Duplicate, Delete, Hide or Show
 *
 * Like the rail it follows the model itself and draws a slide's content a moment after it changes.
 * Nothing animates under a drag: the line and the dimmed slides follow the pointer.
 */

import { memo, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type React from 'react';
import { eyeSlashIcon, Icon } from '../../core/icons';
import { MenuList, Popover, type MenuItem } from '../../core/ui';
import { boxOf, flip, type Box } from '../../motion/flip';
import { chosenHidden, deleteSlides, duplicateSlides, newSlide, toggleHidden } from '../editor/actions';
import { useRailDeck } from '../editor/Rail';
import { useSelection } from '../editor/selection';
import type { Aspect, SlideJSON } from '../model/deck';
import type { Design } from '../model/styles';
import type { SlidesContext } from '../modules/types';
import { Thumbnail } from '../render/Thumbnail';
import { columnsOf, dropAt, nudgeTarget, stepIndex, thumbWidth, type Drop, type Rect, type StepKey } from './sorter';
import './sorter.css';

/** CSS px the pointer moves before a press becomes a drag. */
const DRAG_THRESHOLD = 5;
/** CSS px from the view's top and bottom edges where a drag scrolls it. */
const EDGE = 48;
/** CSS px between thumbnails, as `sorter.css` lays them out. */
const GAP = 20;

const STEP_KEYS: ReadonlySet<string> = new Set<StepKey>(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']);

interface ItemProps {
  id: string;
  index: number;
  slide: SlideJSON;
  design: Design & { size: Aspect };
  width: number;
  active: boolean;
  chosen: boolean;
  dragging: boolean;
}

const Item = memo(function Item({ id, index, slide, design, width, active, chosen, dragging }: ItemProps) {
  const hidden = slide.hidden === true;
  return (
    <li
      className="sl-sort-item"
      data-slide={id}
      data-active={active || undefined}
      data-chosen={chosen || undefined}
      data-hidden={hidden || undefined}
      data-dragging={dragging || undefined}
      role="option"
      aria-selected={chosen}
      aria-label={`Slide ${index + 1}${hidden ? ', hidden' : ''}`}
    >
      <span className="sl-sort-thumb">
        <Thumbnail design={design} slide={slide} width={width} number={index + 1} eager={index < 12} />
      </span>
      <span className="sl-sort-num" aria-hidden="true">
        {index + 1}
        {hidden && <Icon icon={eyeSlashIcon} size={12} />}
      </span>
    </li>
  );
});

/**
 * After the slides are in a new order, each one that moved slides from where it was to where it is: the
 * layout changes at once and the difference is played back as a transform (motion/flip.ts). A change
 * of size, or of how many fit a row, moves them too and is not a reorder: it is measured and plays
 * nothing, so a zoom being dragged or a window being resized is never animated.
 */
function useReorderGlide(list: RefObject<HTMLElement | null>, order: readonly string[], layout: string): void {
  const before = useRef(new Map<string, Box>());
  const laidOut = useRef(layout);
  useLayoutEffect(() => {
    const box = list.current;
    if (!box) return;
    const resized = laidOut.current !== layout;
    laidOut.current = layout;
    const next = new Map<string, Box>();
    for (const el of box.querySelectorAll<HTMLElement>('[data-slide]')) {
      const id = el.getAttribute('data-slide')!;
      next.set(id, boxOf(el, box));
      const from = before.current.get(id);
      if (from && !resized) flip(el, from, { container: box });
    }
    before.current = next;
    // The order and the layout are what ask for it; the list is the same element throughout.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order.join('\u0000'), layout]);
}

interface Press {
  id: string;
  x: number;
  y: number;
  pointer: number;
  /** A press on one of several chosen slides waits to see if it is a drag before it chooses that one alone. */
  deferred: boolean;
  rects: Rect[];
}

interface Drag {
  ids: string[];
  drop: Drop;
}

export function Sorter({ ctx }: { ctx: SlidesContext }) {
  const { model, selection } = ctx;
  const editable = ctx.can.edit;
  const deck = useRailDeck(model);
  const active = useSelection(selection, (s) => s.slide);
  const chosen = useSelection(selection, (s) => s.slides);
  const scroller = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLOListElement | null>(null);
  const width = thumbWidth(ctx.zoom, ctx.fit);

  // How wide the room is, so a window resized is told apart from slides reordered.
  const [room, setRoom] = useState(0);
  useReorderGlide(list, deck.order, `${width}:${room}`);
  useLayoutEffect(() => {
    const box = scroller.current;
    if (!box) return;
    setRoom(box.clientWidth);
    if (typeof ResizeObserver !== 'function') return;
    const ro = new ResizeObserver(() => setRoom(box.clientWidth));
    ro.observe(box);
    return () => ro.disconnect();
  }, []);

  const [drag, setDrag] = useState<Drag | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const press = useRef<Press | null>(null);
  const pointer = useRef({ x: 0, y: 0 });
  const scroll = useRef<{ frame: number; speed: number }>({ frame: 0, speed: 0 });
  const latest = useRef({ drag, deck });
  latest.current = { drag, deck };
  const target = { model, selection };

  // The sorter has the slide list's keys: Ctrl+D copies slides and Ctrl+A chooses them all.
  useEffect(() => {
    selection.set({ focus: 'rail', editing: null });
    scroller.current?.focus({ preventScroll: true });
  }, [selection]);

  // The slide on the canvas stays in sight: after a step, an undo, an arrow key.
  useLayoutEffect(() => {
    if (!active) return;
    const el = list.current?.querySelector<HTMLElement>(`[data-slide="${CSS.escape(active)}"]`);
    el?.scrollIntoView?.({ block: 'nearest' });
  }, [active, deck.order]);

  useEffect(() => () => cancelAnimationFrame(scroll.current.frame), []);

  const itemAt = (e: { target: EventTarget | null }): string | null => (e.target instanceof Element ? (e.target.closest('[data-slide]')?.getAttribute('data-slide') ?? null) : null);

  /** Every thumbnail's box in the list's own coordinates, in order. */
  const measure = (): Rect[] =>
    [...(list.current?.querySelectorAll<HTMLElement>('[data-slide]') ?? [])].map((el) => ({ left: el.offsetLeft, top: el.offsetTop, width: el.offsetWidth, height: el.offsetHeight }));

  const inList = (clientX: number, clientY: number): { x: number; y: number } => {
    const r = list.current!.getBoundingClientRect();
    return { x: clientX - r.left, y: clientY - r.top };
  };

  const moveTo = (clientX: number, clientY: number) => {
    const p = press.current;
    const d = latest.current.drag;
    if (!p || !d) return;
    const at = inList(clientX, clientY);
    const drop = dropAt(p.rects, at.x, at.y, GAP);
    if (drop.index !== d.drop.index || drop.line.y !== d.drop.line.y) setDrag({ ...d, drop });
  };

  const autoscroll = (clientY: number) => {
    const box = scroller.current;
    if (!box) return;
    const r = box.getBoundingClientRect();
    const speed = clientY < r.top + EDGE ? -Math.ceil((r.top + EDGE - clientY) / 4) : clientY > r.bottom - EDGE ? Math.ceil((clientY - (r.bottom - EDGE)) / 4) : 0;
    scroll.current.speed = speed;
    if (speed && !scroll.current.frame) {
      const tick = () => {
        if (!scroll.current.speed || !scroller.current) {
          scroll.current.frame = 0;
          return;
        }
        scroller.current.scrollTop += scroll.current.speed;
        // The pointer has not moved, but what is under it has.
        moveTo(pointer.current.x, pointer.current.y);
        scroll.current.frame = requestAnimationFrame(tick);
      };
      scroll.current.frame = requestAnimationFrame(tick);
    }
  };

  const open = (id: string) => {
    selection.showSlide(id, model.order());
    ctx.setView('normal');
    requestAnimationFrame(() => ctx.actions.focusCanvas());
  };

  const onPointerDown = (e: React.PointerEvent<HTMLOListElement>) => {
    const id = itemAt(e);
    if (!id || e.button !== 0) return;
    scroller.current?.focus({ preventScroll: true });
    const order = deck.order;
    const sel = selection.get();
    let deferred = false;
    if (e.shiftKey) selection.showSlide(id, order, 'range');
    else if (e.ctrlKey || e.metaKey) selection.showSlide(id, order, 'toggle');
    else if (sel.slides.includes(id) && sel.slides.length > 1) deferred = true;
    else selection.showSlide(id, order);
    selection.set({ focus: 'rail' });
    press.current = { id, x: e.clientX, y: e.clientY, pointer: e.pointerId, deferred, rects: measure() };
    pointer.current = { x: e.clientX, y: e.clientY };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLOListElement>) => {
    const p = press.current;
    if (!p || p.pointer !== e.pointerId) return;
    pointer.current = { x: e.clientX, y: e.clientY };
    if (!drag) {
      if (!editable || Math.hypot(e.clientX - p.x, e.clientY - p.y) < DRAG_THRESHOLD) return;
      const s = selection.get();
      const ids = deck.order.filter((id) => s.slides.includes(id));
      const at = inList(e.clientX, e.clientY);
      setDrag({ ids: ids.includes(p.id) ? ids : [p.id], drop: dropAt(p.rects, at.x, at.y, GAP) });
      return;
    }
    moveTo(e.clientX, e.clientY);
    autoscroll(e.clientY);
  };

  const finish = (e: React.PointerEvent<HTMLOListElement>, cancelled: boolean) => {
    const p = press.current;
    if (!p || p.pointer !== e.pointerId) return;
    press.current = null;
    scroll.current.speed = 0;
    if (drag) {
      setDrag(null);
      if (!cancelled) model.moveSlides(drag.ids, drag.drop.index);
      return;
    }
    if (p.deferred && !cancelled) selection.showSlide(p.id, deck.order);
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    const id = itemAt(e);
    if (id) open(id);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.target !== e.currentTarget) return;
    const order = deck.order;
    const s = selection.get();
    const at = s.slide ? order.indexOf(s.slide) : -1;
    let handled = true;
    if (e.altKey && !e.ctrlKey && !e.metaKey && STEP_KEYS.has(e.key) && e.key.startsWith('Arrow')) {
      // A keyboard's way of dragging: the chosen slides one place on.
      const to = nudgeTarget(order, s.slides, e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1);
      if (editable && to !== null) model.moveSlides(s.slides, to);
    } else if (STEP_KEYS.has(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (order.length) {
        const i = stepIndex(Math.max(0, at), e.key as StepKey, columnsOf(measure()), order.length);
        selection.showSlide(order[i]!, order, e.shiftKey ? 'range' : undefined);
      }
    } else if (e.key === 'Enter' && s.slide) open(s.slide);
    else if ((e.key === 'Delete' || e.key === 'Backspace') && !e.ctrlKey && !e.metaKey) {
      if (editable) deleteSlides(target);
    } else if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
      const el = s.slide ? list.current?.querySelector<HTMLElement>(`[data-slide="${CSS.escape(s.slide)}"]`) : null;
      const r = el?.getBoundingClientRect();
      if (r && editable) setMenu({ x: r.left + 24, y: r.top + 24 });
    } else handled = false;
    if (handled) {
      e.preventDefault();
      if (selection.get().focus !== 'rail') selection.set({ focus: 'rail' });
    }
  };

  const onContextMenu = (e: React.MouseEvent) => {
    const id = itemAt(e);
    if (!id || !editable) return;
    e.preventDefault();
    if (!selection.get().slides.includes(id)) selection.showSlide(id, deck.order);
    selection.set({ focus: 'rail' });
    setMenu({ x: e.clientX, y: e.clientY });
  };

  const many = chosen.length > 1;
  const menuItems: MenuItem[] = [
    { label: 'New slide', onSelect: () => newSlide(target) },
    { label: many ? 'Duplicate slides' : 'Duplicate slide', onSelect: () => void duplicateSlides(target) },
    { label: many ? 'Delete slides' : 'Delete slide', danger: true, disabled: chosen.length >= deck.order.length, onSelect: () => void deleteSlides(target) },
    { label: chosenHidden(target) ? (many ? 'Show slides' : 'Show slide') : many ? 'Hide slides' : 'Hide slide', separated: true, onSelect: () => void toggleHidden(target) }
  ];

  return (
    <div
      ref={scroller}
      className="sl-sorter"
      data-drag={drag ? '' : undefined}
      tabIndex={0}
      aria-label="Slide sorter"
      onKeyDown={onKeyDown}
      onFocus={(e) => e.target === e.currentTarget && selection.set({ focus: 'rail' })}
    >
      <ol
        ref={list}
        className="sl-sort-list"
        role="listbox"
        aria-label="Slides"
        aria-multiselectable="true"
        style={{ ['--sl-sort-w' as string]: `${width}px`, ['--sl-sort-gap' as string]: `${GAP}px` }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(e) => finish(e, false)}
        onPointerCancel={(e) => finish(e, true)}
        onDoubleClick={onDoubleClick}
        onContextMenu={onContextMenu}
      >
        {deck.order.map((id, i) => {
          const slide = deck.slides[i];
          if (!slide) return null;
          return (
            <Item
              key={id}
              id={id}
              index={i}
              slide={slide}
              design={deck.design}
              width={width}
              active={id === active}
              chosen={chosen.includes(id)}
              dragging={!!drag && drag.ids.includes(id)}
            />
          );
        })}
        {drag && <li className="sl-sort-drop" aria-hidden="true" style={{ left: drag.drop.line.x, top: drag.drop.line.y, height: drag.drop.line.height }} />}
      </ol>
      {menu && (
        <div className="sl-ctx oa-pop-wrap" style={{ left: menu.x, top: menu.y }}>
          <Popover open onClose={() => setMenu(null)} role="menu" label="Slide">
            <MenuList items={menuItems} onDone={() => setMenu(null)} />
          </Popover>
        </div>
      )}
    </div>
  );
}
