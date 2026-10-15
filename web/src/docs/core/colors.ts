/**
 * The palettes behind text colour, highlight and cell shading.
 *
 * A document's colours are the document's: they are not the app's blue and they do not
 * change with the theme, so they are written as hex into the mark. Six to a row to match
 * the ribbon's palette grid (`.oa-rb-palette`).
 */

import type { Swatch } from '../../core/shell/types';

/** Text. Black, then the greys, then a strong hue to a row. */
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

/** Highlighter pens: bright enough to read as marking, light enough to read through. */
export const HIGHLIGHT_COLORS: Swatch[] = [
  { value: '#fff2a8', label: 'Yellow' },
  { value: '#c8f2c2', label: 'Green' },
  { value: '#bdebff', label: 'Cyan' },
  { value: '#ffc9e0', label: 'Pink' },
  { value: '#ffd9a8', label: 'Orange' },
  { value: '#dcd0ff', label: 'Lavender' },
  { value: '#ffb3b3', label: 'Red' },
  { value: '#b8cdfa', label: 'Blue' },
  { value: '#e5e7eb', label: 'Grey' },
  { value: '#d6f5e3', label: 'Mint' },
  { value: '#fde4cf', label: 'Peach' },
  { value: '#f3d9fa', label: 'Orchid' }
];

/** A table cell's fill: pale, so the text on it keeps its contrast. */
export const SHADING_COLORS: Swatch[] = [
  { value: '#f1f3f9', label: 'Slate' },
  { value: '#e5e7eb', label: 'Grey' },
  { value: '#ebf1fe', label: 'Blue' },
  { value: '#e7f5ee', label: 'Green' },
  { value: '#fdefe7', label: 'Orange' },
  { value: '#fff7d6', label: 'Yellow' },
  { value: '#fde2e2', label: 'Red' },
  { value: '#f0e8fc', label: 'Purple' },
  { value: '#dbe7fd', label: 'Strong blue' },
  { value: '#cdeedd', label: 'Strong green' },
  { value: '#fdd9bf', label: 'Strong orange' },
  { value: '#ffecaa', label: 'Strong yellow' }
];
