/**
 * A show's surface, joined to its deck: reads the slide the state names from the model, live, and
 * gives `Surface` what it draws. The editor's window, the audience's window and the presenter's
 * own copy of the slide all use it.
 */

import { useMemo } from 'react';
import type { Aspect } from '../model/deck';
import type { SlideModel } from '../model/model';
import type { Design } from '../model/styles';
import { useSlide } from '../useSlideModel';
import { announcement } from './announce';
import type { Animator, Shown } from './Stage';
import { Surface } from './Surface';
import type { ShowHandle } from './useShow';

export interface LiveProps {
  model: SlideModel;
  design: Design & { size: Aspect };
  show: ShowHandle;
  /** The presenter's own copy plays no transitions and a click does not advance it. */
  mirror?: boolean;
  hint?: string | null;
  animator?: Animator;
  className?: string;
}

export function Live({ model, design, show, mirror = false, hint, animator, className }: LiveProps) {
  const id = show.state.slide;
  const slide = useSlide(model, id);
  const shown = useMemo<Shown | null>(() => (id && slide ? { id, index: show.index, slide } : null), [id, slide, show.index]);
  return (
    <Surface
      design={design}
      shown={shown}
      screen={show.state.screen}
      laser={show.state.laser}
      remote={show.remote}
      onPointer={show.pointer}
      onAct={mirror ? undefined : show.act}
      animated={!mirror}
      overlay={!mirror}
      digits={show.digits}
      announce={shown ? announcement(show.index, show.count, slide) : ''}
      hint={hint}
      animator={animator}
      className={className}
    />
  );
}
