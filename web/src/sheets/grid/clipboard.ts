/**
 * The clipboard, both ways. Copy and cut write two flavours the model made, text for
 * everything and HTML for Excel and Google Sheets; paste reads both and sends them on
 * untouched, because working out what a pasted table means (a range of numbers, a styled
 * table, a formula that wants its references moved) is the model's.
 *
 * Cut does not remove anything. As in Excel the cells stay until the paste lands, and the paste
 * says where they came from; if it never lands, nothing was lost.
 */

import type { Cellpos, GridData, GridIntent, Rect } from './types';

export interface ClipMark {
  rect: Rect;
  cut: boolean;
  /** What went onto the clipboard, to know a later paste is of this copy and not another's. */
  text: string;
}

const lf = (s: string) => s.replace(/\r\n?/g, '\n');

/** Put a rectangle on the clipboard from a copy or cut event. */
export function writeClipboard(data: DataTransfer, grid: GridData, rect: Rect, cut: boolean): ClipMark {
  const { text, html } = grid.copy(rect);
  data.setData('text/plain', text);
  if (html) data.setData('text/html', html);
  return { rect, cut, text };
}

/** The paste intent for a paste event's data, or null when there is nothing to paste. */
export function pasteFrom(data: Pick<DataTransfer, 'getData'>, at: Cellpos, mark: ClipMark | null): GridIntent | null {
  const text = data.getData('text/plain');
  const html = data.getData('text/html');
  if (text === '' && html === '') return null;
  const intent: GridIntent = { type: 'paste', at, text };
  if (html !== '') intent.html = html;
  if (mark?.cut && lf(mark.text) === lf(text)) intent.cut = mark.rect;
  return intent;
}
