/**
 * Tables: the nodes, cell shading, and the commands the ribbon's table menu calls.
 *
 * Tiptap's table is prosemirror-tables: rows, cells, header cells, column widths
 * (`colwidth`, set by dragging a column's edge), merged and split cells. The one
 * addition is a cell's fill, `backgroundColor`, written as a checked colour like every
 * other attribute that reaches a `style` (sanitize.ts).
 */

import type { Editor } from '@tiptap/core';
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table';
import { darkFill } from '../../core/darkColors';
import { safeColor } from './sanitize';

/** The grid picker's size: Word's is 10 across and 8 down. */
export const GRID = { cols: 10, rows: 8 } as const;

const shading = {
  backgroundColor: {
    default: null,
    parseHTML: (el: HTMLElement) => safeColor(el.getAttribute('data-bg') ?? el.style.backgroundColor),
    renderHTML: (attrs: Record<string, unknown>) => {
      const color = safeColor(attrs.backgroundColor);
      // `--oa-dk-fill` is the dark page's variant, for the screen's stylesheet alone (see text.ts).
      return color ? { 'data-bg': color, class: 'oa-dk-f', style: `background-color: ${color}; --oa-dk-fill: ${darkFill(color)}` } : {};
    }
  }
};

const cell = TableCell.extend({
  addAttributes() {
    return { ...this.parent?.(), ...shading };
  }
});

const header = TableHeader.extend({
  addAttributes() {
    return { ...this.parent?.(), ...shading };
  }
});

/** Columns can be dragged by their edge. */
export const tableNodes = [Table.configure({ resizable: true, cellMinWidth: 48, lastColumnResizable: true }), TableRow, header, cell];

export const inTable = (editor: Editor): boolean => editor.isActive('table');

/** A plain grid, as Word makes one. The header row is a toggle in the table menu. */
export const insertTable = (editor: Editor, rows: number, cols: number): boolean =>
  editor
    .chain()
    .focus()
    .insertTable({ rows: Math.max(1, Math.min(50, rows)), cols: Math.max(1, Math.min(20, cols)), withHeaderRow: false })
    .run();

/** The fill of the cell the selection is in. */
export const shadingAt = (editor: Editor): string | null =>
  (editor.getAttributes('tableCell').backgroundColor as string | null | undefined) ??
  (editor.getAttributes('tableHeader').backgroundColor as string | null | undefined) ??
  null;

/** `null` clears the fill; a colour that is not one is refused and changes nothing. */
export function setShading(editor: Editor, color: string | null): boolean {
  const safe = color === null ? null : safeColor(color);
  if (color !== null && safe === null) return false;
  return editor.chain().focus().setCellAttribute('backgroundColor', safe).run();
}
