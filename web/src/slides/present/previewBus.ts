/**
 * "Preview this slide's transition", from a button to the canvas. The button is in the ribbon and
 * the preview is drawn over the slide, two places that share no component, so a request is a
 * counter: the layer over the canvas plays one for every time it goes up.
 *
 * A request may name the slide, as the rail's marker does: it is the slide the person pressed, which
 * may not be the one on the canvas yet. Without a name it is the slide on the canvas.
 */

let requests = 0;
let named: string | null = null;
const listeners = new Set<() => void>();

export const previewRequests = (): number => requests;

/** The slide the last request named, or null for the slide on the canvas. */
export const previewSlide = (): string | null => named;

export function requestPreview(slide?: string): void {
  requests += 1;
  named = slide ?? null;
  for (const l of [...listeners]) l();
}

export function subscribePreview(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
