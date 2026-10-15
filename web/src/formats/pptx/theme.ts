/**
 * The theme part: twelve colours, two fonts, and the format scheme that `p:style` refers to by
 * number (`fillRef idx=2`, `lnRef idx=1`, `bgRef idx=1001`).
 */

import type { ThemeJSON } from '../../slides/model/deck';
import { canonicalFamily } from '../../docs/core/fonts';
import { child, elements, type XNode } from '../xml';
import { isHex6, OFFICE_HEX, SLOT_NAMES, type SlotName, type ThemeHex } from './color';

export interface ParsedTheme {
  json: ThemeJSON;
  hex: ThemeHex;
  /** The fill styles, line styles and background fill styles of the format scheme, in order. */
  fills: XNode[];
  lines: XNode[];
  bgFills: XNode[];
}

const DEFAULT_MAJOR = 'Calibri Light';
const DEFAULT_MINOR = 'Calibri';

const kids = (n: XNode | null): XNode[] => (n ? elements(n) : []);

const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'imported';

function fontOf(group: XNode | null, fallback: string): string {
  const typeface = child(group, 'a:latin')?.attrs.typeface?.trim();
  if (!typeface || typeface.startsWith('+')) return fallback;
  return canonicalFamily(typeface) ?? fallback;
}

export function parseTheme(root: XNode | null, fallbackName = 'Imported'): ParsedTheme {
  const hex: ThemeHex = { ...OFFICE_HEX };
  const scheme = child(child(root, 'a:themeElements'), 'a:clrScheme');
  for (const slot of kids(scheme)) {
    const name = slot.name.replace(/^a:/, '') as SlotName;
    if (!(SLOT_NAMES as readonly string[]).includes(name)) continue;
    const c = elements(slot)[0];
    if (!c) continue;
    const v = c.name === 'a:srgbClr' ? c.attrs.val : c.name === 'a:sysClr' ? c.attrs.lastClr : undefined;
    if (isHex6(v)) hex[name] = `#${v.toLowerCase()}`;
    else if (c.name === 'a:sysClr') hex[name] = c.attrs.val === 'window' ? '#ffffff' : '#000000';
  }
  const fonts = child(child(root, 'a:themeElements'), 'a:fontScheme');
  const name = root?.attrs.name?.trim() || fallbackName;
  const fmt = child(child(root, 'a:themeElements'), 'a:fmtScheme');
  const { folHlink, ...slots } = hex;
  return {
    json: {
      id: slug(name),
      name: name.slice(0, 80),
      colors: { ...slots, folHlink },
      fonts: { major: fontOf(child(fonts, 'a:majorFont'), DEFAULT_MAJOR), minor: fontOf(child(fonts, 'a:minorFont'), DEFAULT_MINOR) }
    },
    hex,
    fills: kids(child(fmt, 'a:fillStyleLst')),
    lines: kids(child(fmt, 'a:lnStyleLst')),
    bgFills: kids(child(fmt, 'a:bgFillStyleLst'))
  };
}

/** Whether two themes would draw the same: same twelve colours and the same two fonts. */
export function sameTheme(a: ParsedTheme, b: ParsedTheme): boolean {
  return SLOT_NAMES.every((s) => a.hex[s] === b.hex[s]) && a.json.fonts.major === b.json.fonts.major && a.json.fonts.minor === b.json.fonts.minor;
}
