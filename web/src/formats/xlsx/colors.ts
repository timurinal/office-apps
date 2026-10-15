/**
 * A colour as a workbook states it, as a CSS colour.
 *
 * Excel names a colour three ways: its RGB value, a slot of the workbook's theme with a tint
 * ("Accent 1, lighter 40%"), or an index into a fixed 64-colour palette from before themes.
 * The theme is a part of the file (`xl/theme/theme1.xml`), so a theme colour can only be
 * resolved with it; without one the Office palette is used.
 */

/** The Office theme, by the names a theme part gives its colours. */
const OFFICE: Record<string, string> = {
  dk1: '000000',
  lt1: 'FFFFFF',
  dk2: '44546A',
  lt2: 'E7E6E6',
  accent1: '4472C4',
  accent2: 'ED7D31',
  accent3: 'A5A5A5',
  accent4: 'FFC000',
  accent5: '5B9BD5',
  accent6: '70AD47',
  hlink: '0563C1',
  folHlink: '954F72'
};

/** The colours of a theme part, which a cell's `theme="n"` numbers lt1, dk1, lt2, dk2, then the rest: the XML's first four pairs are swapped. */
const SLOT_NAMES = ['lt1', 'dk1', 'lt2', 'dk2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink'] as const;

/** A theme's twelve colours as `theme="n"` indexes them. A colour the part leaves out is the Office one. */
export function themeSlots(byName: Readonly<Record<string, string>>): string[] {
  return SLOT_NAMES.map((n) => byName[n] ?? OFFICE[n]!);
}

export const OFFICE_THEME: readonly string[] = themeSlots({});

const INDEXED = [
  '000000', 'FFFFFF', 'FF0000', '00FF00', '0000FF', 'FFFF00', 'FF00FF', '00FFFF', '000000', 'FFFFFF', 'FF0000', '00FF00', '0000FF', 'FFFF00', 'FF00FF', '00FFFF',
  '800000', '008000', '000080', '808000', '800080', '008080', 'C0C0C0', '808080', '9999FF', '993366', 'FFFFCC', 'CCFFFF', '660066', 'FF8080', '0066CC', 'CCCCFF',
  '000080', 'FF00FF', 'FFFF00', '00FFFF', '800080', '800000', '008080', '0000FF', '00CCFF', 'CCFFFF', 'CCFFCC', 'FFFF99', '99CCFF', 'FF99CC', 'CC99FF', 'FFCC99',
  '3366FF', '33CCCC', '99CC00', 'FFCC00', 'FF9900', 'FF6600', '666699', '969696', '003366', '339966', '003300', '333300', '993300', '993366', '333399', '333333'
];

export interface ExcelColor {
  argb?: string;
  theme?: number;
  tint?: number;
  indexed?: number;
  auto?: boolean;
}

const HEX6 = /^[0-9a-f]{6}$/i;

function rgbOf(hex: string): [number, number, number] {
  const n = parseInt(hex, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const toHex = (r: number, g: number, b: number): string =>
  `#${[r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;

function rgbToHls(r: number, g: number, b: number): [number, number, number] {
  const R = r / 255;
  const G = g / 255;
  const B = b / 255;
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  if (max === min) return [0, l, 0];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === R) h = (G - B) / d + (G < B ? 6 : 0);
  else if (max === G) h = (B - R) / d + 2;
  else h = (R - G) / d + 4;
  return [h / 6, l, s];
}

function hlsToRgb(h: number, l: number, s: number): [number, number, number] {
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t: number) => {
    let x = t;
    if (x < 0) x += 1;
    if (x > 1) x -= 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
}

/** Excel's tint: lightness moves toward white for a positive tint and toward black for a negative one. */
export function tinted(hex: string, tint: number): string {
  const [r, g, b] = rgbOf(hex);
  const [h, l, s] = rgbToHls(r, g, b);
  const l2 = tint < 0 ? l * (1 + tint) : l * (1 - tint) + tint;
  const [r2, g2, b2] = hlsToRgb(h, Math.max(0, Math.min(1, l2)), s);
  return toHex(r2, g2, b2);
}

/** A workbook colour as `#rrggbb`, or null when it is "automatic" or cannot be read. */
export function resolveColor(color: ExcelColor | undefined | null, theme: readonly string[]): string | null {
  if (!color || typeof color !== 'object' || color.auto) return null;
  let hex: string | undefined;
  if (typeof color.argb === 'string') {
    const raw = color.argb.replace(/^#/, '');
    const six = raw.length === 8 ? raw.slice(2) : raw;
    if (HEX6.test(six)) hex = six;
  } else if (typeof color.theme === 'number') {
    hex = theme[color.theme] ?? OFFICE_THEME[color.theme];
  } else if (typeof color.indexed === 'number') {
    // 64 and 65 are the system's foreground and background, which a workbook uses to say "automatic".
    hex = color.indexed >= 0 && color.indexed < INDEXED.length ? INDEXED[color.indexed] : undefined;
  }
  if (!hex) return null;
  const tint = typeof color.tint === 'number' && color.tint !== 0 ? color.tint : 0;
  return tint ? tinted(hex, tint) : `#${hex.toLowerCase()}`;
}
