/**
 * What something that sits on the grid, and is not the grid's own (a chart), needs of it. The grid
 * hands one `GridLayer` to its session while it is mounted (`session.layer`), and takes it back
 * when it goes, so a thing that follows the cells never reaches into the grid's elements.
 */

import type { Box, GridLayout } from './geometry';

export interface GridLayer {
  /**
   * The grid's overlay layer. Its origin is the first cell, it clips at the headers and the
   * scrollbars, and it does not take the pointer: what is put in it that should, says so with
   * `pointer-events`.
   */
  readonly el: HTMLElement;
  /**
   * Keeps `el`, a child of the layer placed at its origin, on the box `at` answers, in the viewport's
   * own coordinates (headers included), on every frame the grid draws: scrolling moves it in the
   * same task as the canvas, never a frame behind. `null` hides it. Returns the way to stop. The box's
   * size reaches the element as `--cw` and `--ch`.
   */
  follow(el: HTMLElement, at: () => Box | null): () => void;
  /** The layout of the frame last drawn: where every line is, and the zoom. */
  layout(): GridLayout | null;
  /** Draw a frame now: something that is followed has moved. */
  refresh(): void;
  /** Scroll the grid, in native pixels, for a wheel that landed on something sitting over it. */
  scrollBy(dx: number, dy: number): void;
}
