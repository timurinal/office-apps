/**
 * The contract between the grid and the model, written before either.
 *
 * The grid (`sheets/grid/`) is a view: a canvas that draws what `GridData` answers and
 * says what the person did as a `GridIntent`. It never sees a `Y.Doc`, a row id, the room
 * or the engine. The model (`sheets/model/`) owns all of those and implements `GridData`
 * for one sheet at a time (its adapter), so the grid can be tested against a plain fake and
 * the desktop's local file and the cloud room look the same to it.
 *
 * Positions here are **today's indexes**, 0-based, because that is what a person sees. The
 * model maps them to ids at the moment of the intent; an intent is never held across a
 * change, so an index in one is always current.
 *
 * Change this file only additively, and change both sides in the same commit.
 */

/** An inclusive rectangle of today's indexes. Same shape as the engine's `Rect`. */
export interface Rect {
  r1: number;
  r2: number;
  c1: number;
  c2: number;
}

export interface Cellpos {
  row: number;
  col: number;
}

export type BorderLine = 'thin' | 'medium' | 'thick' | 'dashed' | 'dotted' | 'double';

export interface BorderSide {
  line: BorderLine;
  /** CSS colour; absent is the default ink. */
  color?: string;
}

/**
 * A cell's look. Every field is optional; absent means the sheet's default (Inter 11pt,
 * ink, no fill, general alignment). The model hands out **interned** objects: two cells
 * that look the same get the same object, so the grid may compare by identity.
 */
export interface CellStyle {
  font?: string;
  /** Points. */
  size?: number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  /** CSS colour of the text. */
  color?: string;
  /** CSS colour of the background. */
  fill?: string;
  /** `general` puts numbers right and text left, as Excel does. */
  h?: 'general' | 'left' | 'center' | 'right';
  v?: 'top' | 'middle' | 'bottom';
  wrap?: boolean;
  /** Steps of about three characters. */
  indent?: number;
  /** An Excel number format code: `0.00`, `#,##0 [$€-x-euro2]`, `dd/mm/yyyy`. */
  numFmt?: string;
  borderTop?: BorderSide;
  borderRight?: BorderSide;
  borderBottom?: BorderSide;
  borderLeft?: BorderSide;
}

/** What the grid draws in one cell. */
export interface GridCell {
  /** The formatted text, after the number format. Empty for an empty cell with a style. */
  text: string;
  /**
   * The number behind `text` when `kind` is `number`. Optional: the status line sums a
   * selection from it, and falls back to reading `text` (`£48,000`) without it.
   */
  value?: number;
  /** Picks the default alignment and lets text overflow into empty neighbours. */
  kind: 'empty' | 'text' | 'number' | 'boolean' | 'error';
  style: CellStyle;
  /** A colour the number format asked for (`[Red]`); wins over `style.color`. */
  color?: string;
  /** A conditional format's override, already decided by the model. */
  conditional?: {
    fill?: string;
    color?: string;
    bold?: boolean;
    italic?: boolean;
    strike?: boolean;
    /** A data bar: the part of the cell's width it covers, as fractions from its left edge (0 to 1), and its colour. */
    bar?: { from: number; to: number; color: string };
  };
  /** A validation list: the grid draws a dropdown arrow when the cell is selected. */
  hasList?: boolean;
  /** An error's explanation for a hover ("Circular dependency"). The cell is marked with a red corner. */
  note?: string;
  /** Hover text with no mark on the cell: a validation prompt ("Pick a level."). */
  tip?: string;
  /** The cell has a comment thread. */
  commented?: boolean;
}

/** Another person's selection, for the coloured outline and the name flag. */
export interface PeerSelection {
  clientId: number;
  name: string;
  color: string;
  rect: Rect;
  /** The cell they are on inside it. */
  active: Cellpos;
}

/**
 * One sheet, read synchronously and often: the grid calls `cell` for every cell on screen
 * on every frame it draws, so each call must be a lookup, not a computation. `version`
 * changes whenever anything this interface answers could have changed; the grid redraws
 * when it does and caches nothing across a version.
 */
export interface GridData {
  readonly version: number;
  /**
   * Optional. Changes only when a size, a hidden line, the row or column count, the frozen
   * panes or the merges do, which is far less often than `version` (every edit). The grid
   * rebuilds its row and column sums when this changes and redraws when `version` does; without
   * it the sums are rebuilt on every `version`, a pass over every row.
   */
  readonly layoutVersion?: number;
  rowCount(): number;
  colCount(): number;
  /** CSS pixels at 100% zoom. 0 for a hidden row or column. */
  rowHeight(row: number): number;
  colWidth(col: number): number;
  /** Rows and columns frozen at the top and left. */
  frozen(): { rows: number; cols: number };
  /** Merged areas, today's indexes. The top-left cell holds the content. */
  merges(): readonly Rect[];
  /** null for a cell with no content and no style of its own, row's or column's. */
  cell(row: number, col: number): GridCell | null;
  /** What the formula bar shows and an edit starts from: `=SUM(A1:A3)`, or the value as typed. */
  editText(row: number, col: number): string;
  /** A validation list's choices, for the dropdown. */
  listChoices(row: number, col: number): readonly string[] | null;
  /** The defined names and functions, for the formula editor's autocomplete. */
  completions(prefix: string): readonly { label: string; detail?: string; kind: 'function' | 'name' }[];
  /** Other people on this sheet. */
  peers(): readonly PeerSelection[];
  /** The clipboard's two flavours for a rectangle: tab-separated text and an HTML table with styles. */
  copy(rect: Rect): { text: string; html: string };
  /** Rows hidden by a filter, and the columns with a filter button in the header row. */
  filter(): { headerRow: number; cols: readonly number[]; active: readonly number[] } | null;
  /** Read only for this person (viewer, commenter, or a protected sheet). */
  readOnly(): boolean;
  /**
   * Optional. The last row and column with any content, for Ctrl+End and the status line;
   * the grid scans for them without it, which is slow past about 100k rows of nothing.
   */
  usedRange?(): Rect | null;
  /**
   * Optional. Calls `listener` whenever `version` changes and returns the way to stop. Without
   * it the grid notices a new `version` each time its parent renders it, so the host must.
   */
  subscribe?(listener: () => void): () => void;
}

/**
 * What the person did. The grid sends it and forgets it: the model applies it as one
 * undoable step and one frame to the room, then bumps `version`. An intent the model
 * refuses (read only, past the size cap) is answered with a notice from the model, not
 * from the grid.
 */
export type GridIntent =
  /** An edit committed with Enter, Tab or a click away. `text` is what was typed. */
  | { type: 'input'; at: Cellpos; text: string }
  /** Delete or Backspace over a selection: contents go, formats stay. */
  | { type: 'clear'; rect: Rect }
  /** A paste at the selection's top-left. `html` is preferred when present (Excel, Google). */
  | { type: 'paste'; at: Cellpos; text: string; html?: string; cut?: Rect }
  /** The fill handle dragged from `source` to cover `target` (which contains it). */
  | { type: 'fill'; source: Rect; target: Rect }
  /** A drag on a header edge. `size` is CSS pixels at 100%. */
  | { type: 'resize'; axis: 'row' | 'col'; from: number; to: number; size: number }
  /** A double-click on a header edge. */
  | { type: 'autofit'; axis: 'row' | 'col'; from: number; to: number }
  /**
   * A drag of whole selected rows or columns to a new place. `to` is where the first moved
   * line is afterwards: moving rows 3 and 4 (`from: 3, count: 2`) to the top is `to: 0`, and to
   * the very end of 10 rows is `to: 8`. Never sent with `to === from`.
   */
  | { type: 'move'; axis: 'row' | 'col'; from: number; to: number; count: number }
  /** The person's selection, for awareness. Sent often; the model throttles it. */
  | { type: 'select'; rect: Rect; active: Cellpos }
  /** A choice from a validation dropdown. */
  | { type: 'choose'; at: Cellpos; value: string }
  /** A filter button in the header row was pressed. The editor opens its menu. */
  | { type: 'filterMenu'; col: number };

/**
 * What a right click (or the menu key) landed on, for the editor to open its menu for. It is not an
 * intent: nothing is changed, and the grid has already moved the selection to what was clicked (a
 * cell outside the selection, a header that was not among the chosen lines). Today's indexes.
 */
export type GridContextTarget =
  /** A cell or the range it is in. */
  | { kind: 'cell'; rect: Rect; active: Cellpos }
  /** Whole columns `from` to `to`, chosen by their header. */
  | { kind: 'col'; from: number; to: number }
  /** Whole rows `from` to `to`, chosen by their header. */
  | { kind: 'row'; from: number; to: number };
