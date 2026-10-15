/**
 * The colours, fonts and sizes the Home tab offers.
 *
 * A cell's colours are the document's, not the app's: they are written as hex into the format,
 * they do not change with the theme, and they are the same on every screen that opens the file.
 * Six to a row to match the ribbon's palette grid (`.oa-rb-palette`).
 */

import type { Choice, Swatch } from '../../core/shell/types';

/** Text: the inks first, then a pale and a strong hue to a row. */
export const TEXT_COLORS: Swatch[] = [
  { value: '#000000', label: 'Black' },
  { value: '#434343', label: 'Dark grey' },
  { value: '#666666', label: 'Grey' },
  { value: '#999999', label: 'Light grey' },
  { value: '#cccccc', label: 'Silver' },
  { value: '#ffffff', label: 'White' },

  { value: '#c0392b', label: 'Red' },
  { value: '#d9622b', label: 'Orange' },
  { value: '#c99a06', label: 'Gold' },
  { value: '#1e8255', label: 'Green' },
  { value: '#1a8a8a', label: 'Teal' },
  { value: '#3d6cd0', label: 'Blue' },

  { value: '#7b4ec2', label: 'Purple' },
  { value: '#c2468f', label: 'Pink' },
  { value: '#8a4b2a', label: 'Brown' },
  { value: '#2f55a6', label: 'Dark blue' },
  { value: '#176842', label: 'Dark green' },
  { value: '#8e1f1f', label: 'Dark red' }
];

/** A fill: greys, pale tints that text stays readable on, then strong ones. */
export const FILL_COLORS: Swatch[] = [
  { value: '#ffffff', label: 'White' },
  { value: '#f3f5fe', label: 'Mist' },
  { value: '#e5e7eb', label: 'Light grey' },
  { value: '#cfd3e5', label: 'Silver' },
  { value: '#9397ab', label: 'Grey' },
  { value: '#292b31', label: 'Ink' },

  { value: '#ffc7ce', label: 'Light red' },
  { value: '#ffd9a8', label: 'Light orange' },
  { value: '#ffeb9c', label: 'Light yellow' },
  { value: '#c6efce', label: 'Light green' },
  { value: '#bdebff', label: 'Light blue' },
  { value: '#dcd0ff', label: 'Light purple' },

  { value: '#f8696b', label: 'Red' },
  { value: '#ea7a3f', label: 'Orange' },
  { value: '#ffb628', label: 'Gold' },
  { value: '#1e8255', label: 'Green' },
  { value: '#3d6cd0', label: 'Blue' },
  { value: '#7b4ec2', label: 'Purple' }
];

export interface SheetFont {
  name: string;
  stack: string;
}

/**
 * The families a cell can use. The page serves only Inter and JetBrains Mono itself, so the rest are
 * the reader's own, each with the metric-compatible stand-ins Linux and Android ship, which keeps
 * column widths from one machine to another close. A cell stores the *name*.
 */
export const FONTS: readonly SheetFont[] = [
  { name: 'Inter', stack: '"Inter", system-ui, -apple-system, "Segoe UI", sans-serif' },
  { name: 'Arial', stack: 'Arial, "Liberation Sans", Arimo, Helvetica, sans-serif' },
  { name: 'Calibri', stack: 'Calibri, Carlito, "Segoe UI", Candara, sans-serif' },
  { name: 'Cambria', stack: 'Cambria, Caladea, "Palatino Linotype", Georgia, serif' },
  { name: 'Georgia', stack: 'Georgia, "DejaVu Serif", Gelasio, "Times New Roman", serif' },
  { name: 'Times New Roman', stack: '"Times New Roman", "Liberation Serif", Tinos, Times, serif' },
  { name: 'Trebuchet MS', stack: '"Trebuchet MS", "Lucida Grande", "Lucida Sans Unicode", sans-serif' },
  { name: 'Verdana', stack: 'Verdana, "DejaVu Sans", Geneva, sans-serif' },
  { name: 'Courier New', stack: '"Courier New", "Liberation Mono", Cousine, Courier, monospace' },
  { name: 'JetBrains Mono', stack: '"JetBrains Mono", ui-monospace, Menlo, Consolas, monospace' }
];

/** The ribbon's font list, each name drawn in its own font. */
export const FONT_CHOICES: Choice[] = FONTS.map((f) => ({ value: f.name, label: f.name, style: { fontFamily: f.stack } }));

/** Excel's size list. */
export const SIZES: readonly number[] = [8, 9, 10, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 36, 48, 72];
