/**
 * The slide on the desk: drawn at `scale`, with what is chosen framed over it, and the pointer and
 * the keys turned into steps.
 *
 *   choose     click, Shift or Ctrl and click for one more or one fewer, drag on the background for
 *              a marquee, Escape to let go (from a group's child to the group first). A second click
 *              on a chosen group goes into it; on a chosen shape it puts the caret where it landed.
 *   move       drag what is chosen; Shift keeps to one axis, Alt turns snapping off
 *   resize     eight handles; Shift keeps the proportions, Ctrl (Option on a Mac, or Alt) resizes from
 *              the centre, and the two together do both, as in PowerPoint. A line has a handle at each
 *              end instead.
 *   turn       the handle above the box; Shift turns in steps of 15 degrees
 *   keys       arrows nudge (Shift for 10 px), Delete deletes, Tab goes to the next element, Enter or
 *              F2 or a typed character goes into the text, Page Up and Page Down change slide
 *
 * A drag is previewed, never written, until the pointer comes up; then it is one step. Nothing on
 * the canvas animates: a drag follows the pointer, and the text follows the keys.
 */

import type { Editor } from '@tiptap/core';
import { memo, useLayoutEffect, useRef, useState, type MutableRefObject, type ReactNode, type RefObject } from 'react';
import type React from 'react';
import type { Awareness } from 'y-protocols/awareness';
import { Button } from '../../core/controls';
import type { ElementJSON, ShapeElement, SlideJSON } from '../model/deck';
import { boundsOf, unionOf, type Box, type SlideModel } from '../model/model';
import type { CanvasDrag, CanvasFrame, Guide, SnapResult } from '../modules/types';
import { SlideView } from '../render/SlideView';
import { useDeckSlice, useOrder, useSlide } from '../useSlideModel';
import { deleteElements, NUDGE, NUDGE_FAR, nudge, stepSlide } from './actions';
import { clickTarget, DRAG_THRESHOLD, elementIndex, movePreview, resizePreview, rotatePreview, withChanges, type Preview } from './drag';
import { HANDLES, handleCursor, HIT_PX, hitTest, lineEndAt, marqueeHits, normalised, type Handle, type Pt } from './geometry';
import type { PeerView } from './presence';
import { useSelection, type SelectionStore } from './selection';
import { TextEditor, type TextStart } from './TextEditor';

/** Where the caret goes when a box is entered: read once, when its editor is made. */
export interface EditStart {
  el: string;
  start: TextStart;
  type?: string;
}

/** Screen px between the top of a box and its rotate handle. */
const ROTATE_GAP = 24;

export interface CanvasProps {
  model: SlideModel;
  selection: SelectionStore;
  /** Change the deck: false for a reader, in Viewing mode, in a preview. */
  editable: boolean;
  /** Screen px per slide px. */
  scale: number;
  fit: boolean;
  peers: readonly PeerView[];
  awareness: Awareness | null;
  desk: RefObject<HTMLDivElement | null>;
  editStart: MutableRefObject<EditStart | null>;
  onDeskSize: (w: number, h: number) => void;
  /** The modules' snap rules, then core's. */
  snap: (box: Box, drag: CanvasDrag, slide: SlideJSON) => SnapResult | null;
  /** The modules' canvas layers. */
  layers: (frame: CanvasFrame) => ReactNode;
  onEditor: (editor: Editor | null) => void;
  onActivity: () => void;
  onNewSlide: () => void;
  /** A key that would change the slide, pressed where it cannot be changed. */
  onReadOnlyEdit?: () => void;
}

type Press =
  | { kind: 'element'; pointer: number; client: Pt; at: Pt; ids: string[]; target: string; depth: number; path: string[]; wasSole: boolean }
  | { kind: 'handle'; pointer: number; client: Pt; at: Pt; ids: string[]; handle: Handle | 'rotate' }
  | { kind: 'marquee'; pointer: number; client: Pt; at: Pt; base: readonly string[] };

type Live = { kind: 'preview'; preview: Preview } | { kind: 'marquee'; rect: Box };

const isShape = (el: ElementJSON | null | undefined): el is ShapeElement => el?.type === 'shape';

/** The keys a typed character goes into the text with: one printable character and no Ctrl or Cmd. */
const typedKey = (e: React.KeyboardEvent): string | null => (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey ? e.key : null);

export const Canvas = memo(function Canvas(p: CanvasProps) {
  const { model, selection, editable, scale: s, fit } = p;
  const sel = useSelection(selection);
  const order = useOrder(model);
  const design = useDeckSlice(model, (m) => m.design(), (c) => c.design)!;
  const slide = useSlide(model, sel.slide);
  const canvas = useRef<HTMLDivElement>(null);
  const press = useRef<Press | null>(null);
  const [live, setLiveState] = useState<Live | null>(null);
  // Over something that a press would move: the same hit test as the press.
  const [overMovable, setOverMovable] = useState(false);
  // Set with the state, not at render: a release can come before the last move is drawn, and it
  // drops the box where that move put it.
  const liveRef = useRef(live);
  const setLive = (next: Live | null) => {
    liveRef.current = next;
    setLiveState(next);
  };
  const target = { model, selection };

  const W = model.width;
  const H = model.height;
  const empty = !order.length || !slide || !design;

  // The desk's size, for Fit. The empty desk is another element, so it is observed again.
  useLayoutEffect(() => {
    const el = p.desk.current;
    if (!el) return;
    const report = () => p.onDeskSize(el.clientWidth, el.clientHeight);
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.desk, empty]);

  if (empty) {
    return (
      <div ref={p.desk as RefObject<HTMLDivElement>} className="sl-desk" tabIndex={0}>
        <div className="sl-desk-inner">
          <div className="sl-empty">
            {order.length ? null : <span>This presentation has no slides.</span>}
            {!order.length && editable && (
              <Button variant="primary" onClick={p.onNewSlide}>
                New slide
              </Button>
            )}
          </div>
        </div>
      </div>
    );
  }

  const slideId = slide.id!;
  const preview = live?.kind === 'preview' ? live.preview : null;
  const shown = preview ? withChanges(slide, preview.changed) : slide;
  const index = elementIndex(shown.elements);

  const editingEl = sel.editing ? index.get(sel.editing) : null;
  const textEditing = editable && isShape(editingEl) && !preview ? editingEl : null;

  // ── coordinates ───────────────────────────────────────────────────────────

  const toSlide = (e: { clientX: number; clientY: number }): Pt => {
    const r = canvas.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / s, y: (e.clientY - r.top) / s };
  };

  const snapper = (alt: boolean) => (alt ? null : (b: Box, drag: CanvasDrag) => p.snap(b, drag, slide));

  const movable = (ids: readonly string[]): ElementJSON[] =>
    ids.map((id) => model.element(slideId, id)).filter((e): e is ElementJSON => !!e && !e.locked);

  // ── the pointer ───────────────────────────────────────────────────────────

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const desk = p.desk.current;
    if (desk && e.target === desk) {
      // A press on the desk's own scroll bar scrolls.
      const r = desk.getBoundingClientRect();
      if (e.clientX - r.left > desk.clientWidth || e.clientY - r.top > desk.clientHeight) return;
    }
    desk?.focus({ preventScroll: true });
    const at = toSlide(e);
    const now = selection.get();
    const client = { x: e.clientX, y: e.clientY };
    const handleEl = e.target instanceof Element ? e.target.closest<HTMLElement>('[data-handle]') : null;
    e.currentTarget.setPointerCapture?.(e.pointerId);

    if (handleEl && editable) {
      const handle = handleEl.dataset.handle as Handle | 'rotate';
      selection.set({ editing: null, focus: 'canvas' });
      press.current = { kind: 'handle', pointer: e.pointerId, client, at, ids: [...now.els], handle };
      return;
    }

    const hit = hitTest(slide.elements, at, HIT_PX / s);
    if (!hit) {
      const base = e.shiftKey || e.ctrlKey || e.metaKey ? now.els : [];
      selection.set({ els: base, editing: null, focus: 'canvas' });
      press.current = { kind: 'marquee', pointer: e.pointerId, client, at, base };
      return;
    }

    const { id, depth } = clickTarget(hit.path, now.els, (x) => model.parentOf(slideId, x));
    const wasSole = now.els.length === 1 && now.els[0] === id;
    let els: string[];
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      const siblings = now.els.filter((x) => model.parentOf(slideId, x) === model.parentOf(slideId, id));
      els = siblings.includes(id) ? siblings.filter((x) => x !== id) : [...siblings, id];
    } else els = now.els.includes(id) ? [...now.els] : [id];
    selection.set({ els, editing: now.editing === id ? now.editing : null, focus: 'canvas' });
    press.current = { kind: 'element', pointer: e.pointerId, client, at, ids: els.includes(id) ? els : [], target: id, depth, path: hit.path, wasSole };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const pr = press.current;
    if (!pr) {
      const hit = editable && e.target instanceof Element && !e.target.closest('[data-handle]') ? hitTest(slide.elements, toSlide(e), HIT_PX / s) : null;
      setOverMovable(!!hit && !model.element(slideId, hit.id)?.locked);
      return;
    }
    if (pr.pointer !== e.pointerId) return;
    if (!liveRef.current && Math.hypot(e.clientX - pr.client.x, e.clientY - pr.client.y) < DRAG_THRESHOLD) return;
    const at = toSlide(e);
    const delta = { x: at.x - pr.at.x, y: at.y - pr.at.y };

    if (pr.kind === 'marquee') {
      setLive({ kind: 'marquee', rect: { x: pr.at.x, y: pr.at.y, w: delta.x, h: delta.y } });
      return;
    }
    if (!editable) return;
    if (pr.kind === 'element') {
      const els = movable(pr.ids);
      if (!els.length) return;
      if (selection.get().editing) selection.set({ editing: null });
      setLive({ kind: 'preview', preview: movePreview(els, delta, { axis: e.shiftKey, snap: snapper(e.altKey) }) });
      return;
    }
    const els = movable(pr.ids);
    if (!els.length) return;
    if (pr.handle === 'rotate') {
      if (els.length === 1) setLive({ kind: 'preview', preview: rotatePreview(els[0]!, at, e.shiftKey) });
      return;
    }
    setLive({ kind: 'preview', preview: resizePreview(els, pr.handle, delta, { keepAspect: e.shiftKey, fromCentre: e.ctrlKey || e.altKey, snap: snapper(e.altKey) }) });
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>, cancelled = false) => {
    const pr = press.current;
    if (!pr || pr.pointer !== e.pointerId) return;
    press.current = null;
    const done = liveRef.current;
    setLive(null);
    if (cancelled) return;
    if (done?.kind === 'preview') {
      model.updateElements(slideId, done.preview.patches);
      return;
    }
    if (done?.kind === 'marquee' && pr.kind === 'marquee') {
      const hits = marqueeHits(slide.elements, done.rect).filter((h) => !pr.base.includes(h));
      selection.set({ els: [...pr.base, ...hits] });
      return;
    }
    // A click with no drag.
    if (pr.kind !== 'element' || e.shiftKey || e.ctrlKey || e.metaKey) return;
    const el = model.element(slideId, pr.target);
    if (!pr.wasSole) {
      // A click on one of several chosen chooses it alone.
      if (selection.get().els.length > 1) selection.set({ els: [pr.target] });
      return;
    }
    const deeper = pr.path[pr.depth + 1];
    if (el?.type === 'group' && deeper) selection.set({ els: [deeper] });
    else if (editable && isShape(el) && !el.locked) enterText(pr.target, { x: e.clientX, y: e.clientY });
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    if (!editable) return;
    const hit = hitTest(slide.elements, toSlide(e), HIT_PX / s);
    if (!hit) return;
    const id = hit.path[hit.path.length - 1]!;
    const el = model.element(slideId, id);
    if (isShape(el) && !el.locked) enterText(id, { x: e.clientX, y: e.clientY });
  };

  const enterText = (id: string, start: TextStart, type?: string) => {
    p.editStart.current = type === undefined ? { el: id, start } : { el: id, start, type };
    selection.set({ els: [id], editing: id, focus: 'canvas' });
  };

  // ── the keys ──────────────────────────────────────────────────────────────

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.target instanceof Element && e.target.closest('[contenteditable="true"], input, textarea')) return;
    const now = selection.get();
    const far = e.shiftKey ? NUDGE_FAR : NUDGE;
    const arrows: Record<string, Pt> = { ArrowLeft: { x: -far, y: 0 }, ArrowRight: { x: far, y: 0 }, ArrowUp: { x: 0, y: -far }, ArrowDown: { x: 0, y: far } };
    let handled = true;
    const arrow = arrows[e.key];
    if (arrow && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (now.els.length) {
        if (editable) nudge(target, arrow.x, arrow.y);
      } else stepSlide(target, arrow.x + arrow.y > 0 ? 1 : -1);
    } else if (e.key === 'PageDown' || e.key === 'PageUp') stepSlide(target, e.key === 'PageDown' ? 1 : -1);
    else if ((e.key === 'Delete' || e.key === 'Backspace') && now.els.length) {
      if (editable) deleteElements(target);
      else p.onReadOnlyEdit?.();
    } else if (e.key === 'Escape' && now.els.length) {
      const parent = model.parentOf(slideId, now.els[0]!);
      selection.set({ els: parent ? [parent] : [], editing: null });
    } else if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey) {
      const ids = slide.elements.map((x) => x.id!);
      if (!ids.length) handled = false;
      else {
        const at = now.els.length ? ids.indexOf(model.topOf(slideId, now.els[now.els.length - 1]!)) : -1;
        const next = e.shiftKey ? (at <= 0 ? ids.length - 1 : at - 1) : (at + 1) % ids.length;
        selection.set({ els: [ids[next]!], editing: null });
      }
    } else if ((e.key === 'Enter' || e.key === 'F2') && now.els.length === 1) {
      const el = model.element(slideId, now.els[0]!);
      if (editable && isShape(el) && !el.locked) enterText(el.id!, 'all');
      else if (el?.type === 'group' && el.children[0]?.id) selection.set({ els: [el.children[0].id] });
      else if (!editable && isShape(el)) p.onReadOnlyEdit?.();
      else handled = false;
    } else {
      const ch = typedKey(e);
      const el = now.els.length === 1 ? model.element(slideId, now.els[0]!) : null;
      if (ch && editable && isShape(el) && !el.locked) enterText(el.id!, 'all', ch);
      else if (ch && !editable && isShape(el)) p.onReadOnlyEdit?.();
      else handled = false;
    }
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  // ── what is drawn over the slide ──────────────────────────────────────────

  const px = (v: number) => v * s;
  const frameStyle = (b: Box & { rot?: number }): React.CSSProperties => ({
    left: px(b.x),
    top: px(b.y),
    width: px(b.w),
    height: px(b.h),
    transform: b.rot ? `rotate(${b.rot}deg)` : undefined
  });

  const chosen = sel.els.map((id) => index.get(id)).filter((e): e is ElementJSON => !!e);
  const single = chosen.length === 1 ? chosen[0]! : null;
  const showHandles = editable && live?.kind !== 'marquee' && chosen.length > 0 && chosen.every((e) => !e.locked);

  const handles = (b: Box & { rot?: number }, only: Handle[] | null, rotate: boolean): ReactNode => (
    <>
      {rotate && (
        <>
          <span className="sl-rot-stalk" style={{ left: px(b.w) / 2, top: -ROTATE_GAP, height: ROTATE_GAP }} />
          <span className="sl-rot" data-handle="rotate" style={{ left: px(b.w) / 2, top: -ROTATE_GAP }} aria-hidden="true" />
        </>
      )}
      {HANDLES.filter((h) => !only || only.includes(h)).map((h) => {
        const sx = h.includes('w') ? 0 : h.includes('e') ? 1 : 0.5;
        const sy = h.startsWith('n') ? 0 : h.startsWith('s') ? 1 : 0.5;
        return <span key={h} className="sl-handle" data-handle={h} data-end={only ? '' : undefined} style={{ left: px(b.w) * sx, top: px(b.h) * sy, cursor: handleCursor(h, b.rot ?? 0) }} aria-hidden="true" />;
      })}
    </>
  );

  const lineEnds = (el: ElementJSON): Handle[] => HANDLES.filter((h) => lineEndAt(el, h));

  const frames: ReactNode[] = [];
  if (single) {
    const isLine = single.type === 'line';
    frames.push(
      <div
        key={single.id}
        className="sl-sel"
        data-locked={single.locked || undefined}
        data-editing={sel.editing === single.id || undefined}
        style={{ ...frameStyle(single), ...(isLine ? { boxShadow: 'none' } : {}) }}
      >
        {showHandles && handles(single, isLine ? lineEnds(single) : null, !isLine)}
      </div>
    );
  } else if (chosen.length > 1) {
    for (const el of chosen) frames.push(<div key={el.id} className="sl-sel" data-soft="" data-locked={el.locked || undefined} style={frameStyle(el)} />);
    const union = unionOf(chosen.map(boundsOf));
    if (union) frames.push(<div key="union" className="sl-sel" data-soft="" style={{ ...frameStyle(union), boxShadow: 'none' }}>{showHandles && handles(union, null, false)}</div>);
  }

  const peerFrames: ReactNode[] = [];
  for (const peer of p.peers) {
    if (peer.slide !== slideId) continue;
    peer.els.forEach((id, i) => {
      const el = index.get(id);
      if (!el) return;
      peerFrames.push(
        <div key={`${peer.clientId}:${id}`} className="sl-peer" style={{ ...frameStyle(el), ['--peer' as string]: peer.color }}>
          {i === 0 && <span className="sl-peer-tag">{peer.name}</span>}
        </div>
      );
    });
  }

  const guides: Guide[] = preview?.guides ?? [];
  const marquee = live?.kind === 'marquee' ? normalised(live.rect) : null;
  const dragInfo: CanvasDrag | null = preview ? preview.drag : marquee ? { kind: 'marquee', ids: [], box: marquee, handle: null } : null;

  let start: TextStart = 'end';
  let typed: string | undefined;
  const pending = p.editStart.current;
  if (textEditing && pending && pending.el === textEditing.id) {
    start = pending.start;
    typed = pending.type;
  }

  return (
    <div
      ref={p.desk as RefObject<HTMLDivElement>}
      className="sl-desk"
      data-fit={fit || undefined}
      tabIndex={0}
      aria-label="Slide"
      style={overMovable ? { cursor: 'move' } : undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerLeave={() => setOverMovable(false)}
      onPointerUp={(e) => onPointerUp(e)}
      onPointerCancel={(e) => onPointerUp(e, true)}
      onDoubleClick={onDoubleClick}
      onKeyDown={onKeyDown}
      onFocus={(e) => e.target === e.currentTarget && selection.get().focus !== 'canvas' && selection.set({ focus: 'canvas' })}
    >
      <div className="sl-desk-inner">
        <div ref={canvas} className="sl-canvas" style={{ width: px(W), height: px(H) }}>
          <SlideView design={design} slide={shown} width={px(W)} number={order.indexOf(slideId) + 1} mode="edit" editing={textEditing?.id ?? null} />
          {textEditing && (
            <div className="sl-logical" style={{ width: W, height: H, transform: `scale(${s})`, ['--sl-scale' as string]: s }}>
              <TextEditor
                key={`${slideId}/${textEditing.id}`}
                model={model}
                slideId={slideId}
                el={textEditing}
                theme={design.theme}
                awareness={p.awareness}
                start={start}
                type={typed}
                readOnly={false}
                onEditor={(ed) => {
                  if (ed) p.editStart.current = null;
                  p.onEditor(ed);
                }}
                onExit={() => {
                  selection.set({ editing: null });
                  p.desk.current?.focus({ preventScroll: true });
                }}
                onActivity={p.onActivity}
              />
            </div>
          )}
          <div className="sl-overlay">
            {p.layers({ slide: shown, scale: s, width: W, height: H, drag: dragInfo })}
            {peerFrames}
            {frames}
            {marquee && <div className="sl-marquee" style={frameStyle(marquee)} />}
            {guides.map((g, i) =>
              g.axis === 'x' ? (
                <div key={i} className="sl-guide" data-axis="x" style={{ left: px(g.at), top: px(g.from), height: px(g.to - g.from) }} />
              ) : (
                <div key={i} className="sl-guide" data-axis="y" style={{ top: px(g.at), left: px(g.from), width: px(g.to - g.from) }} />
              )
            )}
          </div>
        </div>
      </div>
    </div>
  );
});
