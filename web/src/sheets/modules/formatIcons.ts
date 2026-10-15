/**
 * Icons the formatting and data tools draw that the shell's set does not have: Phosphor ones under
 * their own names, and a few made here (a glyph in a square, the border presets), as the inner
 * markup of a 256-unit SVG like every other icon (`core/icons.tsx`).
 */

import { type PhIcon, ph } from '../../core/icons';

import arrowElbowDownLeftRaw from '@phosphor-icons/core/assets/regular/arrow-elbow-down-left.svg?raw';
import arrowsMergeRaw from '@phosphor-icons/core/assets/regular/arrows-merge.svg?raw';
import arrowsSplitRaw from '@phosphor-icons/core/assets/regular/arrows-split.svg?raw';
import alignBottomRaw from '@phosphor-icons/core/assets/regular/align-bottom.svg?raw';
import alignCenterVerticalRaw from '@phosphor-icons/core/assets/regular/align-center-vertical.svg?raw';
import alignTopRaw from '@phosphor-icons/core/assets/regular/align-top.svg?raw';
import calculatorRaw from '@phosphor-icons/core/assets/regular/calculator.svg?raw';
import chartBarHorizontalRaw from '@phosphor-icons/core/assets/regular/chart-bar-horizontal.svg?raw';
import copyRaw from '@phosphor-icons/core/assets/regular/copy.svg?raw';
import functionRaw from '@phosphor-icons/core/assets/regular/function.svg?raw';
import funnelRaw from '@phosphor-icons/core/assets/regular/funnel.svg?raw';
import funnelXRaw from '@phosphor-icons/core/assets/regular/funnel-x.svg?raw';
import gradientRaw from '@phosphor-icons/core/assets/regular/gradient.svg?raw';
import listChecksRaw from '@phosphor-icons/core/assets/regular/list-checks.svg?raw';
import listMagnifyingGlassRaw from '@phosphor-icons/core/assets/regular/list-magnifying-glass.svg?raw';
import paintBrushRaw from '@phosphor-icons/core/assets/regular/paint-brush-broad.svg?raw';
import rowsRaw from '@phosphor-icons/core/assets/regular/rows.svg?raw';
import selectionRaw from '@phosphor-icons/core/assets/regular/selection.svg?raw';
import sortAscendingRaw from '@phosphor-icons/core/assets/regular/sort-ascending.svg?raw';
import sortDescendingRaw from '@phosphor-icons/core/assets/regular/sort-descending.svg?raw';
import swatchesRaw from '@phosphor-icons/core/assets/regular/swatches.svg?raw';
import tagRaw from '@phosphor-icons/core/assets/regular/tag.svg?raw';
import textAlignCenterRaw from '@phosphor-icons/core/assets/regular/text-align-center.svg?raw';
import textAlignLeftRaw from '@phosphor-icons/core/assets/regular/text-align-left.svg?raw';
import textAlignRightRaw from '@phosphor-icons/core/assets/regular/text-align-right.svg?raw';
import textColumnsRaw from '@phosphor-icons/core/assets/regular/text-columns.svg?raw';
import textTRaw from '@phosphor-icons/core/assets/regular/text-t.svg?raw';
import textTSlashRaw from '@phosphor-icons/core/assets/regular/text-t-slash.svg?raw';

export const arrowElbowDownLeftIcon = /* @__PURE__ */ ph(arrowElbowDownLeftRaw);
export const arrowsMergeIcon = /* @__PURE__ */ ph(arrowsMergeRaw);
export const arrowsSplitIcon = /* @__PURE__ */ ph(arrowsSplitRaw);
export const alignBottomIcon = /* @__PURE__ */ ph(alignBottomRaw);
export const alignCenterVerticalIcon = /* @__PURE__ */ ph(alignCenterVerticalRaw);
export const alignTopIcon = /* @__PURE__ */ ph(alignTopRaw);
export const calculatorIcon = /* @__PURE__ */ ph(calculatorRaw);
export const chartBarHorizontalIcon = /* @__PURE__ */ ph(chartBarHorizontalRaw);
export const copyOutlineIcon = /* @__PURE__ */ ph(copyRaw);
export const functionIcon = /* @__PURE__ */ ph(functionRaw);
export const funnelIcon = /* @__PURE__ */ ph(funnelRaw);
export const funnelXIcon = /* @__PURE__ */ ph(funnelXRaw);
export const gradientIcon = /* @__PURE__ */ ph(gradientRaw);
export const listChecksIcon = /* @__PURE__ */ ph(listChecksRaw);
export const listMagnifyingGlassIcon = /* @__PURE__ */ ph(listMagnifyingGlassRaw);
export const paintBrushBroadIcon = /* @__PURE__ */ ph(paintBrushRaw);
export const rowsIcon = /* @__PURE__ */ ph(rowsRaw);
export const selectionIcon = /* @__PURE__ */ ph(selectionRaw);
export const sortAscendingIcon = /* @__PURE__ */ ph(sortAscendingRaw);
export const sortDescendingIcon = /* @__PURE__ */ ph(sortDescendingRaw);
export const swatchesIcon = /* @__PURE__ */ ph(swatchesRaw);
export const tagIcon = /* @__PURE__ */ ph(tagRaw);
export const textAlignCenterIcon = /* @__PURE__ */ ph(textAlignCenterRaw);
export const textAlignLeftIcon = /* @__PURE__ */ ph(textAlignLeftRaw);
export const textAlignRightIcon = /* @__PURE__ */ ph(textAlignRightRaw);
export const textColumnsIcon = /* @__PURE__ */ ph(textColumnsRaw);
export const textTIcon = /* @__PURE__ */ ph(textTRaw);
export const textTSlashIcon = /* @__PURE__ */ ph(textTSlashRaw);

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

/** A few characters as an icon: `£`, `%`, `.00`. Mono for the decimals buttons, which the board draws that way. */
export function glyph(text: string, o: { size?: number; mono?: boolean; weight?: number } = {}): PhIcon {
  const size = o.size ?? 176;
  const family = o.mono ? "'JetBrains Mono', ui-monospace, monospace" : "Inter, system-ui, sans-serif";
  return `<text x="128" y="${128 + size * 0.36}" font-size="${size}" text-anchor="middle" font-family="${family}" font-weight="${o.weight ?? 600}" fill="currentColor">${esc(text)}</text>`;
}

export const poundIcon = /* @__PURE__ */ glyph('£');
export const percentGlyphIcon = /* @__PURE__ */ glyph('%', { size: 168 });
export const commaIcon = /* @__PURE__ */ glyph(',', { size: 200 });
export const moreDecimalsIcon = /* @__PURE__ */ glyph('.00', { size: 110, mono: true, weight: 500 });
export const fewerDecimalsIcon = /* @__PURE__ */ glyph('.0', { size: 110, mono: true, weight: 500 });

// ── borders: a square with the edges that are drawn bold ────────────────────

const FRAME = 'M48 48h160v160H48z';
const dim = (d: string) => `<path d="${d}" fill="none" stroke="currentColor" stroke-width="12" stroke-dasharray="5 15" opacity=".6"/>`;
const bold = (d: string) => `<path d="${d}" fill="none" stroke="currentColor" stroke-width="22" stroke-linecap="square"/>`;

/** One edge of the square, bold, over the faint square. */
const edge = (d: string) => dim(FRAME) + bold(d);

export const BORDER_ICONS = {
  all: `<path d="${FRAME}M128 48v160M48 128h160" fill="none" stroke="currentColor" stroke-width="18" stroke-linejoin="miter"/>`,
  outside: bold(FRAME),
  'thick-outside': `<path d="${FRAME}" fill="none" stroke="currentColor" stroke-width="34"/>`,
  inside: dim(FRAME) + bold('M128 48v160M48 128h160'),
  'inside-h': dim(FRAME) + bold('M48 128h160'),
  'inside-v': dim(FRAME) + bold('M128 48v160'),
  top: edge('M48 48h160'),
  bottom: edge('M48 208h160'),
  left: edge('M48 48v160'),
  right: edge('M208 48v160'),
  'top-bottom': edge('M48 48h160M48 208h160'),
  'bottom-double': dim(FRAME) + bold('M48 190h160M48 214h160').replace('stroke-width="22"', 'stroke-width="12"'),
  'bottom-thick': dim(FRAME) + bold('M48 202h160').replace('stroke-width="22"', 'stroke-width="36"'),
  none: dim(FRAME)
} as const satisfies Record<string, PhIcon>;
