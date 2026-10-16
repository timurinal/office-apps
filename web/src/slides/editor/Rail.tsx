/**
 * The slide rail: every slide as a thumbnail, numbered, at the left of the slide.
 *
 *   choose      a click shows a slide; Shift chooses a range, Ctrl (Cmd) one more or one fewer
 *   keys        arrows step, Home and End jump, Delete deletes, Enter makes a new slide after
 *   reorder     drag the chosen slides; a line shows where they will land, the rail scrolls near
 *               its edges, and the drop is one step. The others glide to their places after it.
 *   menu        right-click: the slide menu (modules/menus.tsx), asked for through `onMenu`
 *
 * It follows the model itself, not the page: a slide added, deleted or moved is drawn at once, and a
 * change inside a slide (a keystroke on the canvas) is drawn a moment later, in a transition, so the
 * thumbnail of the slide being typed on is never redrawn in the keystroke's own frame.
 */

import { memo, startTransition, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type React from 'react';
import { eyeSlashIcon, Icon } from '../../core/icons';
import { useFlipList } from '../../motion/flip';
import type { Aspect, SlideJSON } from '../model/deck';
import type { SlideModel } from '../model/model';
import type { Design } from '../model/styles';
import { Thumbnail } from '../render/Thumbnail';
import { deleteSlides, newSlide, stepSlide } from './actions';
import type { PeerView } from './presence';
import { useSelection, type SelectionStore } from './selection';

/** How long a change inside a slide waits before its thumbnail is redrawn. */
export const RAIL_DELAY_MS = 160;
/** CSS px. */
export const THUMB_WIDTH = 146;
const DRAG_THRESHOLD = 5;
const EDGE = 40;

interface RailDeck {
  order: readonly string[];
  design: Design & { size: Aspect };
  slides: readonly (SlideJSON | null)[];
}

const readRail = (m: SlideModel): RailDeck => {
  const order = m.order();
  return { order, design: m.design(), slides: order.map((id) => m.slide(id)) };
};

/** The deck as the rail draws it: order and design at once, a slide's content after `RAIL_DELAY_MS`. */
export function useRailDeck(model: SlideModel): RailDeck {
  const [deck, setDeck] = useState(() => readRail(model));
  useEffect(() => {
    setDeck(readRail(model));
    let timer: ReturnType<typeof setTimeout> | undefined;
    const off = model.subscribe((c) => {
      if (c.order || c.design) {
        clearTimeout(timer);
        timer = undefined;
        setDeck(readRail(model));
        return;
      }
      if (!c.slides.size || timer) return;
      timer = setTimeout(() => {
        timer = undefined;
        startTransition(() => setDeck(readRail(model)));
      }, RAIL_DELAY_MS);
    });
    return () => {
      off();
      clearTimeout(timer);
    };
  }, [model]);
  return deck;
}

interface ItemProps {
  id: string;
  index: number;
  slide: SlideJSON;
  design: Design & { size: Aspect };
  active: boolean;
  chosen: boolean;
  dragging: boolean;
  /** Other people's colours on this slide, joined, so the item stays memoised. */
  peers: string;
  flip: (el: HTMLElement | null) => void;
}

const RailItem = memo(function RailItem({ id, index, slide, design, active, chosen, dragging, peers, flip }: ItemProps) {
  const hidden = slide.hidden === true;
  return (
    <li
      ref={flip}
      className="sl-rail-item"
      data-slide={id}
      data-active={active || undefined}
      data-chosen={chosen || undefined}
      data-hidden={hidden || undefined}
      data-dragging={dragging || undefined}
      role="option"
      aria-selected={chosen}
      aria-label={`Slide ${index + 1}${hidden ? ', hidden' : ''}`}
    >
      <span className="sl-rail-num" aria-hidden="true">
        {index + 1}
        {hidden && <Icon icon={eyeSlashIcon} size={12} />}
        {peers && (
          <span className="sl-rail-dots">
            {peers.split(',').map((c, i) => (
              <span key={i} className="sl-rail-dot" style={{ background: c }} />
            ))}
          </span>
        )}
      </span>
      <span className="sl-rail-thumb">
        <Thumbnail design={design} slide={slide} width={THUMB_WIDTH} number={index + 1} eager={index < 8} />
      </span>
    </li>
  );
});

export interface RailProps {
  model: SlideModel;
  selection: SelectionStore;
  editable: boolean;
  peers: readonly PeerView[];
  /** The keyboard goes to the slide: after Enter on a new slide. */
  focusCanvas: () => void;
  /**
   * Ask for the slide menu for these slides at a point in window pixels. False when there is none to
   * show, and the browser's own is left alone. Without it the rail has no menu.
   */
  onMenu?: (ids: readonly string[], at: { x: number; y: number }, from: Element) => boolean;
}

interface Drag {
  ids: string[];
  /** Before the slide at this index now (the end when it is the length). */
  drop: number;
  /** List px. */
  line: number;
}

export function Rail({ model, selection, editable, peers, focusCanvas, onMenu }: RailProps) {
  const deck = useRailDeck(model);
  const active = useSelection(selection, (s) => s.slide);
  const chosen = useSelection(selection, (s) => s.slides);
  const rail = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLOListElement | null>(null);
  const flip = useFlipList(deck.order);
  const [drag, setDrag] = useState<Drag | null>(null);
  const press = useRef<{ id: string; x: number; y: number; pointer: number; deferred: boolean; tops: number[]; heights: number[] } | null>(null);
  const scroll = useRef<{ frame: number; speed: number }>({ frame: 0, speed: 0 });
  const target = { model, selection };

  // The slide on the canvas stays in sight: after a step, a new slide, an undo.
  useLayoutEffect(() => {
    if (!active) return;
    const el = list.current?.querySelector<HTMLElement>(`[data-slide="${CSS.escape(active)}"]`);
    el?.scrollIntoView?.({ block: 'nearest' });
  }, [active, deck.order]);

  useEffect(() => () => cancelAnimationFrame(scroll.current.frame), []);

  const peerColours = new Map<string, string[]>();
  for (const p of peers) if (p.slide) peerColours.set(p.slide, [...(peerColours.get(p.slide) ?? []), p.color]);

  const itemAt = (e: { target: EventTarget | null }): string | null => (e.target instanceof Element ? (e.target.closest('[data-slide]')?.getAttribute('data-slide') ?? null) : null);

  const dropAt = (clientY: number): { drop: number; line: number } => {
    const p = press.current!;
    const top = list.current!.getBoundingClientRect().top;
    const y = clientY - top;
    let drop = p.tops.length;
    for (let i = 0; i < p.tops.length; i++) {
      if (y < p.tops[i]! + p.heights[i]! / 2) {
        drop = i;
        break;
      }
    }
    const last = p.tops.length - 1;
    const line = drop <= last ? p.tops[drop]! - 6 : p.tops[last]! + p.heights[last]! + 6;
    return { drop, line };
  };

  const autoscroll = (clientY: number) => {
    const r = rail.current!.getBoundingClientRect();
    const speed = clientY < r.top + EDGE ? -Math.ceil((r.top + EDGE - clientY) / 4) : clientY > r.bottom - EDGE ? Math.ceil((clientY - (r.bottom - EDGE)) / 4) : 0;
    scroll.current.speed = speed;
    if (speed && !scroll.current.frame) {
      const tick = () => {
        if (!scroll.current.speed || !rail.current) {
          scroll.current.frame = 0;
          return;
        }
        rail.current.scrollTop += scroll.current.speed;
        scroll.current.frame = requestAnimationFrame(tick);
      };
      scroll.current.frame = requestAnimationFrame(tick);
    }
  };

  const onPointerDown = (e: React.PointerEvent<HTMLOListElement>) => {
    const id = itemAt(e);
    if (!id || e.button !== 0) return;
    rail.current?.focus({ preventScroll: true });
    const order = deck.order;
    const sel = selection.get();
    let deferred = false;
    if (e.shiftKey) selection.showSlide(id, order, 'range');
    else if (e.ctrlKey || e.metaKey) selection.showSlide(id, order, 'toggle');
    else if (sel.slides.includes(id) && sel.slides.length > 1) deferred = true;
    else selection.showSlide(id, order);
    selection.set({ focus: 'rail' });
    const items = [...(list.current?.querySelectorAll<HTMLElement>('[data-slide]') ?? [])];
    press.current = { id, x: e.clientX, y: e.clientY, pointer: e.pointerId, deferred, tops: items.map((el) => el.offsetTop), heights: items.map((el) => el.offsetHeight) };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLOListElement>) => {
    const p = press.current;
    if (!p || p.pointer !== e.pointerId) return;
    if (!drag) {
      if (!editable || Math.hypot(e.clientX - p.x, e.clientY - p.y) < DRAG_THRESHOLD) return;
      const s = selection.get();
      const ids = deck.order.filter((id) => s.slides.includes(id));
      setDrag({ ids: ids.includes(p.id) ? ids : [p.id], ...dropAt(e.clientY) });
      return;
    }
    const at = dropAt(e.clientY);
    if (at.drop !== drag.drop) setDrag({ ...drag, ...at });
    autoscroll(e.clientY);
  };

  const finish = (e: React.PointerEvent<HTMLOListElement>, cancelled: boolean) => {
    const p = press.current;
    if (!p || p.pointer !== e.pointerId) return;
    press.current = null;
    scroll.current.speed = 0;
    if (drag) {
      setDrag(null);
      if (!cancelled) model.moveSlides(drag.ids, drag.drop);
      return;
    }
    if (p.deferred && !cancelled) selection.showSlide(p.id, deck.order);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.target !== e.currentTarget) return;
    const order = deck.order;
    const s = selection.get();
    const at = s.slide ? order.indexOf(s.slide) : -1;
    const range = e.shiftKey ? 'range' : undefined;
    let handled = true;
    switch (e.key) {
      case 'ArrowUp':
      case 'ArrowLeft':
        stepSlide(target, -1, range);
        break;
      case 'ArrowDown':
      case 'ArrowRight':
        stepSlide(target, 1, range);
        break;
      case 'PageUp':
        stepSlide(target, -5, range);
        break;
      case 'PageDown':
        stepSlide(target, 5, range);
        break;
      case 'Home':
        stepSlide(target, -at, range);
        break;
      case 'End':
        stepSlide(target, order.length - 1 - at, range);
        break;
      case 'Delete':
      case 'Backspace':
        if (editable) deleteSlides(target);
        break;
      case 'Enter':
        if (editable) {
          newSlide(target);
          focusCanvas();
        }
        break;
      case 'ContextMenu': {
        const el = s.slide ? list.current?.querySelector<HTMLElement>(`[data-slide="${CSS.escape(s.slide)}"]`) : null;
        const r = el?.getBoundingClientRect();
        if (r && rail.current) onMenu?.(s.slides, { x: r.left + 24, y: r.top + 24 }, rail.current);
        break;
      }
      default:
        handled = false;
    }
    if (handled) {
      e.preventDefault();
      if (selection.get().focus !== 'rail') selection.set({ focus: 'rail' });
    }
  };

  const onContextMenu = (e: React.MouseEvent) => {
    // Shift asks for the browser's own menu.
    const id = itemAt(e);
    if (!id || !onMenu || e.shiftKey || !rail.current) return;
    if (!selection.get().slides.includes(id)) selection.showSlide(id, deck.order);
    selection.set({ focus: 'rail' });
    if (onMenu(selection.get().slides, { x: e.clientX, y: e.clientY }, rail.current)) e.preventDefault();
  };

  return (
    <div ref={rail} className="sl-rail" tabIndex={0} aria-label="Slides" onKeyDown={onKeyDown} onFocus={(e) => e.target === e.currentTarget && selection.set({ focus: 'rail' })}>
      <ol
        ref={(el) => {
          list.current = el;
          flip.container.current = el;
        }}
        className="sl-rail-list"
        role="listbox"
        aria-label="Slides"
        aria-multiselectable="true"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(e) => finish(e, false)}
        onPointerCancel={(e) => finish(e, true)}
        onContextMenu={onContextMenu}
      >
        {deck.order.map((id, i) => {
          const slide = deck.slides[i];
          if (!slide) return null;
          return (
            <RailItem
              key={id}
              id={id}
              index={i}
              slide={slide}
              design={deck.design}
              active={id === active}
              chosen={chosen.includes(id)}
              dragging={!!drag && drag.ids.includes(id)}
              peers={peerColours.get(id)?.join(',') ?? ''}
              flip={flip.item(id)}
            />
          );
        })}
        {drag && <li className="sl-rail-drop" aria-hidden="true" style={{ top: drag.line }} />}
      </ol>
    </div>
  );
}
