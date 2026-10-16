/**
 * The colours the canvas draws with. A canvas cannot read a stylesheet, so they are read once
 * from the grid's own custom properties (grid.css, which take the app tokens and the
 * dark theme) and again when the theme changes. The fallbacks are the light values from the
 * Sheets board, so a test or a page without the stylesheet still draws it.
 */

export interface GridTheme {
  paper: string;
  ink: string;
  /** The gridlines between cells. */
  line: string;
  headBg: string;
  headLine: string;
  headInk: string;
  /** The header of a selected row or column. */
  headOnBg: string;
  headOnInk: string;
  /** A header of a whole selected row or column. */
  headSolid: string;
  headSolidInk: string;
  /** The app colour, for the header's underline and the filter's active state. */
  accent: string;
  frozen: string;
  danger: string;
  comment: string;
  /**
   * Dark cells: draw the fills and text colours a person set the way a dark page draws a document's
   * (core/darkColors.ts), for a reader on the dark theme who asked for it. Only ever a view: nothing
   * written to the sheet or exported changes.
   */
  darkCells: boolean;
}

export const FALLBACK_THEME: GridTheme = {
  paper: '#ffffff',
  ink: '#292b31',
  line: '#eceef7',
  headBg: '#f3f5fe',
  headLine: '#e4e7f5',
  headInk: '#75798c',
  headOnBg: '#e7f5ee',
  headOnInk: '#176842',
  headSolid: '#1e8255',
  headSolidInk: '#ffffff',
  accent: '#1e8255',
  frozen: '#b2b6ca',
  danger: '#d1423b',
  comment: '#e8a23a',
  darkCells: false
};

const VARS: Record<Exclude<keyof GridTheme, 'darkCells'>, string> = {
  paper: '--sg-paper',
  ink: '--sg-ink',
  line: '--sg-line',
  headBg: '--sg-head-bg',
  headLine: '--sg-head-line',
  headInk: '--sg-head-ink',
  headOnBg: '--sg-head-on-bg',
  headOnInk: '--sg-head-on-ink',
  headSolid: '--sg-head-solid',
  headSolidInk: '--sg-head-solid-ink',
  accent: '--sg-accent',
  frozen: '--sg-frozen',
  danger: '--sg-danger',
  comment: '--sg-comment'
};

export function readTheme(el: Element): GridTheme {
  const cs = getComputedStyle(el);
  const out = { ...FALLBACK_THEME };
  for (const k of Object.keys(VARS) as (keyof typeof VARS)[]) {
    const v = cs.getPropertyValue(VARS[k]).trim();
    if (v) out[k] = v;
  }
  // grid.css turns it on for the option and the dark theme together.
  out.darkCells = cs.getPropertyValue('--sg-dark-cells').trim() === '1';
  return out;
}

/** Inter, with the same fallbacks the rest of the app has. */
export const FONT_FAMILY = "Inter, 'Helvetica Neue', Arial, sans-serif";

/** Points. The sheet's default size, and what the board's size box reads for an unformatted cell. */
export const DEFAULT_FONT_PT = 10;
