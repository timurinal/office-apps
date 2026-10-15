/**
 * Page setup: the paper, its orientation, the margins, and whether the document is
 * shown as pages at all.
 *
 * It lives in the document, in a `Y.Map` named `page` beside the body, so everyone sees
 * the same pages and a version restore brings it back. Each value is its own key, so two
 * people changing the margins and the paper at once both keep their change. Lengths are
 * millimetres, the unit the paper sizes are defined in; a pixel value would change
 * meaning with the screen.
 *
 *   size            'A4' | 'Letter' | 'Legal' | 'A5'
 *   orientation     'portrait' | 'landscape'
 *   marginTop, marginRight, marginBottom, marginLeft     mm
 *   headerDistance, footerDistance                      mm from the paper edge
 *   differentFirst  boolean: the first page has its own header and footer
 *   paged           boolean: print layout (true) or web layout (false)
 *
 * A missing key is its default. The paper's default is A4, or Letter where the browser
 * says en-US, and it is written once by the first edit after sync (extension.ts), so
 * two people in two countries do not see two different documents.
 *
 * Every write carries `PAGE_ORIGIN`, so it can be told from the body's own updates.
 */

import type * as Y from 'yjs';
import type { Setup } from './layout';

export const PAGE_MAP = 'page';
export const PAGE_ORIGIN = 'page-setup';

export type PaperSize = 'A4' | 'Letter' | 'Legal' | 'A5';
export type Orientation = 'portrait' | 'landscape';

/** Portrait width and height, in millimetres. */
export const PAPER: Record<PaperSize, { label: string; w: number; h: number }> = {
  A4: { label: 'A4', w: 210, h: 297 },
  Letter: { label: 'Letter', w: 215.9, h: 279.4 },
  Legal: { label: 'Legal', w: 215.9, h: 355.6 },
  A5: { label: 'A5', w: 148, h: 210 }
};
export const PAPER_SIZES = Object.keys(PAPER) as PaperSize[];

export interface Margins {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** Word's presets, in millimetres (they are whole and half inches). */
export const MARGIN_PRESETS: readonly { id: string; label: string; margins: Margins }[] = [
  { id: 'normal', label: 'Normal', margins: { top: 25.4, right: 25.4, bottom: 25.4, left: 25.4 } },
  { id: 'narrow', label: 'Narrow', margins: { top: 12.7, right: 12.7, bottom: 12.7, left: 12.7 } },
  { id: 'moderate', label: 'Moderate', margins: { top: 25.4, right: 19.05, bottom: 25.4, left: 19.05 } },
  { id: 'wide', label: 'Wide', margins: { top: 25.4, right: 50.8, bottom: 25.4, left: 50.8 } }
];

export interface PageSetup {
  size: PaperSize;
  orientation: Orientation;
  margins: Margins;
  headerDistance: number;
  footerDistance: number;
  differentFirst: boolean;
  paged: boolean;
}

/** The smallest body a page may be left with, either way, in millimetres. */
export const MIN_BODY_MM = 25;
const MAX_MARGIN_MM = 200;

export function defaultSize(locale: string | undefined = typeof navigator === 'undefined' ? undefined : navigator.language): PaperSize {
  return locale?.toLowerCase() === 'en-us' ? 'Letter' : 'A4';
}

export function defaultSetup(size: PaperSize = defaultSize()): PageSetup {
  return {
    size,
    orientation: 'portrait',
    margins: { ...MARGIN_PRESETS[0]!.margins },
    headerDistance: 12.7,
    footerDistance: 12.7,
    differentFirst: false,
    paged: true
  };
}

/** Width and height of the paper as laid, in millimetres. */
export function paperMM(s: Pick<PageSetup, 'size' | 'orientation'>): { w: number; h: number } {
  const p = PAPER[s.size];
  return s.orientation === 'landscape' ? { w: p.h, h: p.w } : { w: p.w, h: p.h };
}

/**
 * CSS pixels are 1/96 inch. Rounded to 1/64 px, the unit the browser lays out in, so a
 * page height is a length the printer's page and the screen's agree on exactly.
 */
export const mmToPx = (mm: number): number => Math.round(((mm * 96) / 25.4) * 64) / 64;

/** Whether the margins leave a body on this paper. */
export function marginsFit(s: Pick<PageSetup, 'size' | 'orientation'>, m: Margins): boolean {
  const { w, h } = paperMM(s);
  const ok = (v: number) => Number.isFinite(v) && v >= 0 && v <= MAX_MARGIN_MM;
  return ok(m.top) && ok(m.right) && ok(m.bottom) && ok(m.left) && w - m.left - m.right >= MIN_BODY_MM && h - m.top - m.bottom >= MIN_BODY_MM;
}

export function presetOf(m: Margins): string | null {
  const same = (a: number, b: number) => Math.abs(a - b) < 0.05;
  const p = MARGIN_PRESETS.find((x) => same(x.margins.top, m.top) && same(x.margins.right, m.right) && same(x.margins.bottom, m.bottom) && same(x.margins.left, m.left));
  return p?.id ?? null;
}

// ── the map ─────────────────────────────────────────────────────────────────

const isSize = (v: unknown): v is PaperSize => typeof v === 'string' && v in PAPER;
const num = (v: unknown, fallback: number, max = MAX_MARGIN_MM): number =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max ? v : fallback;

/**
 * What the map says, with anything missing or out of range read as its default. A value
 * written by an older or a hostile client never reaches the layout as NaN.
 */
export function readSetup(map: Pick<Y.Map<unknown>, 'get'> | null, fallbackSize: PaperSize = defaultSize()): PageSetup {
  const d = defaultSetup(fallbackSize);
  if (!map) return d;
  const size = isSize(map.get('size')) ? (map.get('size') as PaperSize) : d.size;
  const orientation: Orientation = map.get('orientation') === 'landscape' ? 'landscape' : 'portrait';
  const margins: Margins = {
    top: num(map.get('marginTop'), d.margins.top),
    right: num(map.get('marginRight'), d.margins.right),
    bottom: num(map.get('marginBottom'), d.margins.bottom),
    left: num(map.get('marginLeft'), d.margins.left)
  };
  const paper = { size, orientation };
  return {
    size,
    orientation,
    margins: marginsFit(paper, margins) ? margins : d.margins,
    headerDistance: num(map.get('headerDistance'), d.headerDistance, 100),
    footerDistance: num(map.get('footerDistance'), d.footerDistance, 100),
    differentFirst: map.get('differentFirst') === true,
    paged: map.get('paged') !== false
  };
}

export type SetupPatch = Partial<Omit<PageSetup, 'margins'>> & { margins?: Margins };

const round = (v: number) => Math.round(v * 100) / 100;

/** The map's keys and values for a change. Only what changes is written. */
export function patchEntries(patch: SetupPatch): [string, unknown][] {
  const out: [string, unknown][] = [];
  if (patch.size !== undefined) out.push(['size', patch.size]);
  if (patch.orientation !== undefined) out.push(['orientation', patch.orientation]);
  if (patch.margins) {
    out.push(['marginTop', round(patch.margins.top)], ['marginRight', round(patch.margins.right)]);
    out.push(['marginBottom', round(patch.margins.bottom)], ['marginLeft', round(patch.margins.left)]);
  }
  if (patch.headerDistance !== undefined) out.push(['headerDistance', round(patch.headerDistance)]);
  if (patch.footerDistance !== undefined) out.push(['footerDistance', round(patch.footerDistance)]);
  if (patch.differentFirst !== undefined) out.push(['differentFirst', patch.differentFirst]);
  if (patch.paged !== undefined) out.push(['paged', patch.paged]);
  return out;
}

/** Write a change in one Yjs transaction, under `PAGE_ORIGIN`. Values equal to the map's are skipped. */
export function writeSetup(doc: Y.Doc, patch: SetupPatch): boolean {
  const map = doc.getMap<unknown>(PAGE_MAP);
  const entries = patchEntries(patch).filter(([k, v]) => map.get(k) !== v);
  if (!entries.length) return false;
  doc.transact(() => {
    for (const [k, v] of entries) map.set(k, v);
  }, PAGE_ORIGIN);
  return true;
}

// ── to pixels ───────────────────────────────────────────────────────────────

/** Heights of the rendered headers and footers, in CSS pixels. 0 is empty. */
export interface ChromeHeights {
  headerFirst: number;
  headerRest: number;
  footerFirst: number;
  footerRest: number;
}

export const NO_CHROME: ChromeHeights = { headerFirst: 0, headerRest: 0, footerFirst: 0, footerRest: 0 };

/** Space between a header or footer and the body, when the header reaches past the margin. */
const CHROME_CLEARANCE = 6;
export const GAP = 28;
export const NOTE_SEP = 16;

export interface PageGeometry {
  setup: Setup;
  /** Margins in pixels, for the root's padding and the chrome. */
  left: number;
  right: number;
  headerDistance: number;
  footerDistance: number;
}

/** A header taller than the space the margin leaves pushes the body down, as in Word. */
export function insetFor(margin: number, distance: number, contentHeight: number): number {
  return contentHeight > 0 ? Math.max(margin, distance + contentHeight + CHROME_CLEARANCE) : margin;
}

export function geometry(ps: PageSetup, chrome: ChromeHeights = NO_CHROME): PageGeometry {
  const { w, h } = paperMM(ps);
  const top = mmToPx(ps.margins.top);
  const bottom = mmToPx(ps.margins.bottom);
  const hd = mmToPx(ps.headerDistance);
  const fd = mmToPx(ps.footerDistance);
  return {
    setup: {
      pageW: mmToPx(w),
      pageH: mmToPx(h),
      gap: GAP,
      topFirst: insetFor(top, hd, chrome.headerFirst),
      topRest: insetFor(top, hd, chrome.headerRest),
      bottomFirst: insetFor(bottom, fd, chrome.footerFirst),
      bottomRest: insetFor(bottom, fd, chrome.footerRest),
      widows: 2,
      orphans: 2,
      noteSep: NOTE_SEP
    },
    left: mmToPx(ps.margins.left),
    right: mmToPx(ps.margins.right),
    headerDistance: hd,
    footerDistance: fd
  };
}

/** The `@page` rule that makes the printer's page the layout's page. */
export function pageRule(ps: PageSetup, paged: boolean): string {
  const { w, h } = paperMM(ps);
  const m = ps.margins;
  const margin = paged ? '0' : `${m.top}mm ${m.right}mm ${m.bottom}mm ${m.left}mm`;
  return `@page { size: ${w}mm ${h}mm; margin: ${margin}; }`;
}
