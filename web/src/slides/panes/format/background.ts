/**
 * A slide's background: what Design › Background changes.
 *
 * A background is a `Fill` on the slide itself (deck.ts `SlideJSON.bg`), over its layout's and the
 * master's: a solid colour, a gradient or a picture. Choosing one sets it on the slides chosen in the
 * rail, or on every slide ("Apply to all slides"), in one step; Reset takes the slide's own away so
 * its layout's shows again. Colours and gradients are theme slots, so a theme change recolours them.
 *
 * Pure: no DOM.
 */

import type { Fill } from '../../model/deck';
import type { SlideModel } from '../../model/model';
import type { Target } from '../../editor/actions';
import { common } from './edits';

export interface GradientPreset {
  id: string;
  label: string;
  fill: Extract<Fill, { kind: 'gradient' }>;
}

const stop = (at: number, theme: 'accent1' | 'accent2' | 'accent3' | 'accent4' | 'accent5' | 'lt1' | 'lt2' | 'dk1' | 'dk2', lum?: number) => ({ at, color: lum === undefined ? { theme } : { theme, lum } });

/** Six gradients drawn from the theme, from a wash to a deep ground. */
export const GRADIENTS: readonly GradientPreset[] = [
  { id: 'wash', label: 'Wash', fill: { kind: 'gradient', angle: 90, stops: [stop(0, 'accent1', 0.85), stop(1, 'lt1')] } },
  { id: 'dawn', label: 'Dawn', fill: { kind: 'gradient', angle: 45, stops: [stop(0, 'accent4', 0.7), stop(1, 'accent1', 0.7)] } },
  { id: 'sky', label: 'Sky', fill: { kind: 'gradient', angle: 90, stops: [stop(0, 'accent5', 0.6), stop(1, 'accent1', 0.85)] } },
  { id: 'accent', label: 'Accent', fill: { kind: 'gradient', angle: 45, stops: [stop(0, 'accent1'), stop(1, 'accent2')] } },
  { id: 'dusk', label: 'Dusk', fill: { kind: 'gradient', angle: 90, stops: [stop(0, 'dk2'), stop(1, 'dk1')] } },
  { id: 'mist', label: 'Mist', fill: { kind: 'gradient', angle: 0, stops: [stop(0, 'lt2'), stop(1, 'lt1')] } }
];

/** The slides a background goes to: every one, or the ones chosen in the rail. */
export function backgroundTargets(t: Target, all: boolean): readonly string[] {
  return all ? t.model.order() : t.selection.get().slides;
}

/** One step: `bg` on the slides, or the slides' own taken away (null). False where there is nothing to do. */
export function setBackground(t: Target, bg: Fill | null, all: boolean): boolean {
  return t.model.setSlides(backgroundTargets(t, all), { bg });
}

/** The background the chosen slides share: the fill, none when they have no own, or null when they differ. */
export function readBackground(model: SlideModel, ids: readonly string[]): { value: Fill | null } | null {
  return common(ids.map((id) => model.slide(id)?.bg ?? null));
}
