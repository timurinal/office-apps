/**
 * What Insert does to the deck, one function each, over the model and the selection only: each is
 * one model step (one undo entry) and leaves the new element chosen. A click, a drag, the command
 * box and a keyboard all end here, so none of them has a way of its own.
 *
 * A text box, a table and a shape's text are entered with the caret in them by the caller; what is
 * done here is only the step and the selection.
 */

import type { ElementJSON, ShapeKind } from '../../model/deck';
import type { SlideModel } from '../../model/model';
import type { Target } from '../../editor/actions';
import {
  altFromName,
  fitPicture,
  lineFor,
  newChart,
  newLine,
  newShape,
  newTable,
  newTextBox,
  CHART_SIZE,
  defaultSize,
  rectFor,
  MIN_TEXT_HEIGHT,
  TEXT_BOX_SIZE,
  type ChartKind,
  type LineSpec,
  type Placement,
  type Size
} from './defaults';

const boundsOf = (m: SlideModel): Size => ({ w: m.width, h: m.height });

/** The slide on the canvas, or null in a deck with none. */
const slideOf = (t: Target): string | null => t.selection.get().slide;

/**
 * One element on `slide` (the one on the canvas by default). It is chosen only while that slide is
 * still on the canvas: a picture that finished uploading after the person moved on lands where it
 * was asked for and does not take the selection from where they are.
 */
function add(t: Target, el: ElementJSON, edit = false, slide: string | null = slideOf(t)): string | null {
  if (!slide) return null;
  const id = t.model.addElement(slide, el);
  if (id && slideOf(t) === slide) t.selection.set({ els: [id], editing: edit ? id : null, focus: 'canvas' });
  return id;
}

export function insertShape(t: Target, kind: ShapeKind, at: Placement = { kind: 'centre' }): string | null {
  const rect = rectFor(at, defaultSize(kind), boundsOf(t.model));
  return add(t, newShape(kind, rect, t.model.design().theme));
}

/** A text box, with the caret in it. One drawn thin is still tall enough for a line of type. */
export function insertTextBoxAt(t: Target, at: Placement = { kind: 'centre' }): string | null {
  const rect = rectFor(at, TEXT_BOX_SIZE, boundsOf(t.model));
  return add(t, newTextBox({ ...rect, h: Math.max(rect.h, MIN_TEXT_HEIGHT) }), true);
}

export function insertLine(t: Target, arrow: boolean, at: Placement | { kind: 'ends'; from: LineSpec['from']; to: LineSpec['to'] } = { kind: 'centre' }): string | null {
  return add(t, newLine(lineFor(at, boundsOf(t.model)), arrow));
}

export function insertChart(t: Target, kind: ChartKind, at: Placement = { kind: 'centre' }): string | null {
  return add(t, newChart(kind, rectFor(at, CHART_SIZE, boundsOf(t.model))));
}

export function insertTable(t: Target, rows: number, cols: number): string | null {
  return add(t, newTable(rows, cols, boundsOf(t.model)));
}

/** A picture the document already holds as an asset: the step that follows its upload. */
export function insertPicture(t: Target, asset: { id: string; name: string }, natural: Size, slide?: string | null): string | null {
  const rect = fitPicture(natural, boundsOf(t.model));
  return add(t, { type: 'image', asset: { id: asset.id }, ...rect, alt: altFromName(asset.name), lockAspect: true }, false, slide);
}
