/** A CSS colour as the `FFRRGGBB` a workbook wants. Hex and `rgb()` are exact; a few names are known; anything else has no answer. */

const NAMED: Record<string, string> = {
  black: '000000',
  white: 'FFFFFF',
  red: 'FF0000',
  green: '008000',
  blue: '0000FF',
  yellow: 'FFFF00',
  orange: 'FFA500',
  purple: '800080',
  gray: '808080',
  grey: '808080',
  silver: 'C0C0C0',
  maroon: '800000',
  navy: '000080',
  teal: '008080',
  lime: '00FF00',
  aqua: '00FFFF',
  cyan: '00FFFF',
  fuchsia: 'FF00FF',
  magenta: 'FF00FF',
  pink: 'FFC0CB',
  brown: 'A52A2A'
};

const byte = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0').toUpperCase();

export function cssToArgb(css: string): string | undefined {
  const t = css.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3,8})$/.exec(t)?.[1];
  if (hex) {
    if (hex.length === 3 || hex.length === 4) return `FF${[...hex.slice(0, 3)].map((c) => (c + c).toUpperCase()).join('')}`;
    if (hex.length === 6 || hex.length === 8) return `FF${hex.slice(0, 6).toUpperCase()}`;
    return undefined;
  }
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(t);
  if (rgb) return `FF${byte(Number(rgb[1]))}${byte(Number(rgb[2]))}${byte(Number(rgb[3]))}`;
  const named = NAMED[t];
  return named ? `FF${named}` : undefined;
}
