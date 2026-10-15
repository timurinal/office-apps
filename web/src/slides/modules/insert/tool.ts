/**
 * The drawing tool a button has armed: the next press on the slide draws a shape, a text box or a
 * line, by a click at a default size or by a drag. It is one value for the page, held outside React
 * so the ribbon's buttons, the canvas layer and the Escape key agree on it without the page
 * re-rendering, and it names the model it was armed for, so a tool armed in one presentation is not
 * still armed in the next.
 */

import { useSyncExternalStore } from 'react';
import type { ShapeKind } from '../../model/deck';
import type { SlideModel } from '../../model/model';

export type Tool = { kind: 'shape'; shape: ShapeKind } | { kind: 'text' } | { kind: 'line'; arrow: boolean };

interface Armed {
  model: SlideModel;
  tool: Tool;
}

let current: Armed | null = null;
const listeners = new Set<() => void>();
const emit = (): void => listeners.forEach((l) => l());
const subscribe = (cb: () => void): (() => void) => {
  listeners.add(cb);
  return () => void listeners.delete(cb);
};

export function sameTool(a: Tool | null, b: Tool | null): boolean {
  if (!a || !b || a.kind !== b.kind) return false;
  if (a.kind === 'shape') return a.shape === (b as typeof a).shape;
  if (a.kind === 'line') return a.arrow === (b as typeof a).arrow;
  return true;
}

/** Arms `tool`; arming the one that is armed puts it away, as a second press on a button does. */
export function arm(model: SlideModel, tool: Tool): void {
  current = current && current.model === model && sameTool(current.tool, tool) ? null : { model, tool };
  emit();
}

export function disarm(): void {
  if (!current) return;
  current = null;
  emit();
}

export const armedFor = (model: SlideModel): Tool | null => (current && current.model === model ? current.tool : null);

/** The tool armed for this model, re-rendering when it changes. */
export function useArmed(model: SlideModel): Tool | null {
  return useSyncExternalStore(subscribe, () => armedFor(model), () => null);
}
