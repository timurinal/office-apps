/**
 * The slide on screen, and the transition from one slide to the next.
 *
 * It draws the slide it is given. When that is a different slide from the one it drew, it keeps the
 * old one for as long as the transition takes, under the new one, and animates the two with the
 * plan from `transitions.ts`: transform and opacity on the compositor, nothing that lays out. The
 * old slide is dropped when the animations have finished, or at once when another change arrives
 * first (the show never queues transitions: a presenter who presses Next three times is three
 * slides on, not three animations behind).
 *
 * The slide on screen is live, not a copy: the deck changes under a show and the new slide follows
 * it. Only the slide that is leaving is frozen at what it was.
 *
 * The same component plays the Transitions tab's preview on the canvas.
 */

import { memo, useLayoutEffect, useRef, useState, type CSSProperties, type Ref } from 'react';
import { animate, finished, motionOff, type AnimateOptions } from '../../motion';
import type { Aspect, SlideJSON, Transition } from '../model/deck';
import type { Design } from '../model/styles';
import { SlideView, slideHeight, type RenderMode } from '../render/SlideView';
import { plan, resolve } from './transitions';

/** A slide as it is shown: which, where in the deck, and what it is. */
export interface Shown {
  id: string;
  /** From 0. */
  index: number;
  slide: SlideJSON;
}

/** `animate` from motion/index.ts. A test hands in its own and watches what it is asked to run. */
export type Animator = (el: Element, frames: Keyframe[], options: AnimateOptions) => Animation | null;

export interface StageProps {
  design: Design & { size: Aspect };
  shown: Shown;
  /** CSS px: how wide the slide is drawn. */
  width: number;
  mode?: RenderMode;
  /** False draws the slide and plays nothing: the presenter's own copy of the slide. */
  animated?: boolean;
  /** What to play from one slide to another, if not the deck's own (the slide that arrives, or when going back the one that leaves). */
  transitionFor?: (from: Shown, to: Shown, backward: boolean) => Transition | null | undefined;
  /** Called when a transition has finished and one slide is left. */
  onSettled?: () => void;
  animator?: Animator;
  className?: string;
  style?: CSSProperties;
}

interface Run {
  seq: number;
  from: Shown;
  to: Shown;
}

const same = (a: Shown, b: Shown): boolean => a.id === b.id && a.index === b.index && a.slide === b.slide;

/** Forward plays the transition of the slide that arrives; back plays the one of the slide that leaves. */
export const deckTransition = (from: Shown, to: Shown, backward: boolean): Transition | undefined => (backward ? from.slide.transition : to.slide.transition);

interface LayerProps {
  design: Design & { size: Aspect };
  shown: Shown;
  width: number;
  mode: RenderMode;
  role: 'rest' | 'out' | 'in';
  layerRef?: Ref<HTMLDivElement>;
  innerRef?: Ref<HTMLDivElement>;
}

const Layer = memo(function Layer({ design, shown, width, mode, role, layerRef, innerRef }: LayerProps) {
  return (
    <div ref={layerRef} className="sp-layer" data-role={role}>
      <div ref={innerRef} className="sp-inner">
        <SlideView design={design} slide={shown.slide} width={width} number={shown.index + 1} mode={mode} />
      </div>
    </div>
  );
});

export function Stage({ design, shown, width, mode = 'present', animated = true, transitionFor = deckTransition, onSettled, animator = animate, className, style }: StageProps) {
  const [last, setLast] = useState(shown);
  const [run, setRun] = useState<Run | null>(null);

  // The slide on screen changed: remember it, and if it is another slide, start a transition from
  // the last one. (Set during render, as React asks for state derived from the last render.)
  if (!same(shown, last)) {
    setLast(shown);
    if (shown.id !== last.id && animated) setRun({ seq: (run?.seq ?? 0) + 1, from: last, to: shown });
  }

  const outRef = useRef<HTMLDivElement>(null);
  const inRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const latest = useRef({ transitionFor, onSettled, animator });
  latest.current = { transitionFor, onSettled, animator };

  useLayoutEffect(() => {
    if (!run) return;
    const backward = run.to.index < run.from.index;
    const resolved = resolve(latest.current.transitionFor(run.from, run.to, backward), { backward, reduced: motionOff() });
    const p = resolved ? plan(resolved) : null;
    const running: Animation[] = [];
    if (p) {
      const opts: AnimateOptions = { duration: p.duration, easing: p.easing, fill: 'both' };
      for (const [el, frames] of [
        [outRef.current, p.out],
        [inRef.current, p.in],
        [innerRef.current, p.inner]
      ] as const) {
        if (!el || !frames) continue;
        const a = latest.current.animator(el, frames, opts);
        if (a) running.push(a);
      }
    }
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stop = () => {
      live = false;
      clearTimeout(timer);
      for (const a of running) a.cancel();
    };
    const finish = () => {
      if (!live) return;
      stop();
      setRun(null);
      latest.current.onSettled?.();
    };
    if (!running.length) {
      finish();
      return stop;
    }
    void Promise.all(running.map((a) => finished(a))).then(finish);
    // An animation a hidden tab never runs must not leave the old slide on screen.
    timer = setTimeout(finish, (p?.duration ?? 0) + 1000);
    return stop;
  }, [run]);

  const height = (slideHeight(design.size) * width) / 1920;
  return (
    <div className={className ? `sp-box ${className}` : 'sp-box'} style={{ ...style, width, height }}>
      {run ? (
        <>
          <Layer key={run.from.id} design={design} shown={run.from} width={width} mode={mode} role="out" layerRef={outRef} />
          <Layer key={shown.id} design={design} shown={shown} width={width} mode={mode} role="in" layerRef={inRef} innerRef={innerRef} />
        </>
      ) : (
        <Layer key={shown.id} design={design} shown={shown} width={width} mode={mode} role="rest" />
      )}
    </div>
  );
}
