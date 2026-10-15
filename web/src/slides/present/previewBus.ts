/**
 * "Preview this slide's transition", from a button to the canvas. The button is in the ribbon and
 * the preview is drawn over the slide, two places that share no component, so a request is a
 * counter: the layer over the canvas plays one for every time it goes up.
 */

let requests = 0;
const listeners = new Set<() => void>();

export const previewRequests = (): number => requests;

export function requestPreview(): void {
  requests += 1;
  for (const l of [...listeners]) l();
}

export function subscribePreview(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
