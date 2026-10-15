/**
 * The Transitions tab's controls that a ribbon button cannot be: the gallery of the five kinds, each
 * with a small preview that plays when it is pointed at, and the Duration field.
 *
 * They follow the deck and the selection themselves (`useCurrentTransition`): the ribbon re-reads
 * a button's state, but a custom control is drawn from what it is given, and a transition changed
 * by someone else or by an undo has to show here too.
 */

import { useEffect, useLayoutEffect, useRef } from 'react';
import type { Transition } from '../model/deck';
import { useSelection } from '../editor/selection';
import type { SlidesContext } from '../modules/types';
import { useDeckSlice } from '../useSlideModel';
import { requestPreview } from './previewBus';
import { currentTransition, durationSeconds, setDuration, setKind, type TransitionTarget } from './transitionEdit';
import { kindOf, TRANSITION_KINDS, TRANSITION_LABELS } from './transitions';
import './present.css';

const targetOf = (c: SlidesContext): TransitionTarget => ({ model: c.model, selection: c.selection });

const same = (a: Transition | null, b: Transition | null): boolean => JSON.stringify(a) === JSON.stringify(b);

/** The transition of the slide on the canvas, kept current. */
export function useCurrentTransition(ctx: SlidesContext): Transition | null {
  const slide = useSelection(ctx.selection, (s) => s.slide);
  return useDeckSlice(
    ctx.model,
    (m) => (slide ? (m.slide(slide)?.transition ?? null) : null),
    (c) => c.order || (slide !== null && c.slides.has(slide)),
    same,
    slide
  );
}

export function TransitionGallery({ ctx }: { ctx: SlidesContext }) {
  const cur = useCurrentTransition(ctx);
  const kind = kindOf(cur);
  const off = !ctx.can.edit || !ctx.slideId;
  return (
    <span role="radiogroup" aria-label="Transition to this slide" className="sp-gallery">
      {TRANSITION_KINDS.map((k) => (
        <button
          key={k}
          type="button"
          role="radio"
          data-rb-item
          data-id={`transitions.${k}`}
          aria-checked={kind === k}
          className="sp-opt"
          disabled={off}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            if (setKind(targetOf(ctx), k) && k !== 'none') requestPreview();
          }}
        >
          <span className="sp-tile" data-kind={k} aria-hidden="true">
            <i className="a">
              <b />
            </i>
            <i className="b">
              <b />
            </i>
          </span>
          {TRANSITION_LABELS[k]}
        </button>
      ))}
    </span>
  );
}

/** Seconds, as PowerPoint's field. It is committed when it is left or Enter is pressed, or a spinner is used, not on every digit. */
export function DurationField({ ctx }: { ctx: SlidesContext }) {
  const cur = useCurrentTransition(ctx);
  const seconds = durationSeconds(cur);
  const input = useRef<HTMLInputElement>(null);
  const latest = useRef({ ctx });
  latest.current = { ctx };

  // The field shows the deck's number whenever the person is not typing in it.
  useLayoutEffect(() => {
    const el = input.current;
    if (el && document.activeElement !== el) el.value = seconds === null ? '' : String(seconds);
  }, [seconds]);

  // `change` is the native event: Enter, leaving the field, and the spinner. A typed digit is `input`.
  useEffect(() => {
    const el = input.current;
    if (!el) return;
    const commit = () => {
      const c = latest.current.ctx;
      const v = el.value.trim() === '' ? Number.NaN : Number(el.value);
      if (Number.isFinite(v)) setDuration(targetOf(c), v * 1000);
      // What the deck holds now: a number past the range comes back as the end of it.
      const now = durationSeconds(currentTransition(targetOf(c)));
      el.value = now === null ? '' : String(now);
    };
    el.addEventListener('change', commit);
    return () => el.removeEventListener('change', commit);
  }, []);

  return (
    <label className="sp-duration">
      Duration
      <input ref={input} type="number" min={0.1} max={10} step={0.05} inputMode="decimal" disabled={!ctx.can.edit || seconds === null} defaultValue={seconds ?? ''} aria-label="Duration in seconds" />
      s
    </label>
  );
}
