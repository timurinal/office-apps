/**
 * Icons the Docs modules draw that `web/src/core/icons.tsx` (the shell's) does not export.
 * Phosphor, regular weight, each its own `?raw` import so a bundle carries only the ones
 * used (see that file). Other Docs modules import from here too, so a name that is not used
 * by the core module may still be somebody else's: look before removing one.
 */

import { ph } from '../../core/icons';

import textAlignCenterRaw from '@phosphor-icons/core/assets/regular/text-align-center.svg?raw';
import textAlignRightRaw from '@phosphor-icons/core/assets/regular/text-align-right.svg?raw';
import textAlignJustifyRaw from '@phosphor-icons/core/assets/regular/text-align-justify.svg?raw';
import listChecksRaw from '@phosphor-icons/core/assets/regular/list-checks.svg?raw';
import treeStructureRaw from '@phosphor-icons/core/assets/regular/tree-structure.svg?raw';
import imageSquareRaw from '@phosphor-icons/core/assets/regular/image-square.svg?raw';
import atRaw from '@phosphor-icons/core/assets/regular/at.svg?raw';
import arrowsVerticalRaw from '@phosphor-icons/core/assets/regular/arrows-vertical.svg?raw';
import rowsPlusTopRaw from '@phosphor-icons/core/assets/regular/rows-plus-top.svg?raw';
import rowsPlusBottomRaw from '@phosphor-icons/core/assets/regular/rows-plus-bottom.svg?raw';
import columnsPlusLeftRaw from '@phosphor-icons/core/assets/regular/columns-plus-left.svg?raw';
import columnsPlusRightRaw from '@phosphor-icons/core/assets/regular/columns-plus-right.svg?raw';
import arrowsMergeRaw from '@phosphor-icons/core/assets/regular/arrows-merge.svg?raw';
import arrowsSplitRaw from '@phosphor-icons/core/assets/regular/arrows-split.svg?raw';
import listMagnifyingGlassRaw from '@phosphor-icons/core/assets/regular/list-magnifying-glass.svg?raw';
import sigmaRaw from '@phosphor-icons/core/assets/regular/sigma.svg?raw';
import listDashesRaw from '@phosphor-icons/core/assets/regular/list-dashes.svg?raw';
import checkSquareRaw from '@phosphor-icons/core/assets/regular/check-square.svg?raw';
import textHRaw from '@phosphor-icons/core/assets/regular/text-h.svg?raw';
import asteriskRaw from '@phosphor-icons/core/assets/regular/asterisk.svg?raw';
import calendarPlusRaw from '@phosphor-icons/core/assets/regular/calendar-plus.svg?raw';
import xSquareRaw from '@phosphor-icons/core/assets/regular/x-square.svg?raw';
import minusCircleRaw from '@phosphor-icons/core/assets/regular/minus-circle.svg?raw';
import selectionAllRaw from '@phosphor-icons/core/assets/regular/selection-all.svg?raw';
import arrowsInLineHorizontalRaw from '@phosphor-icons/core/assets/regular/arrows-in-line-horizontal.svg?raw';

export const textAlignCenterIcon = /* @__PURE__ */ ph(textAlignCenterRaw);
export const textAlignRightIcon = /* @__PURE__ */ ph(textAlignRightRaw);
export const textAlignJustifyIcon = /* @__PURE__ */ ph(textAlignJustifyRaw);
export const listChecksIcon = /* @__PURE__ */ ph(listChecksRaw);
export const treeStructureIcon = /* @__PURE__ */ ph(treeStructureRaw);
export const imageSquareIcon = /* @__PURE__ */ ph(imageSquareRaw);
export const atIcon = /* @__PURE__ */ ph(atRaw);
export const arrowsVerticalIcon = /* @__PURE__ */ ph(arrowsVerticalRaw);
export const rowsPlusTopIcon = /* @__PURE__ */ ph(rowsPlusTopRaw);
export const rowsPlusBottomIcon = /* @__PURE__ */ ph(rowsPlusBottomRaw);
export const columnsPlusLeftIcon = /* @__PURE__ */ ph(columnsPlusLeftRaw);
export const columnsPlusRightIcon = /* @__PURE__ */ ph(columnsPlusRightRaw);
export const arrowsMergeIcon = /* @__PURE__ */ ph(arrowsMergeRaw);
export const arrowsSplitIcon = /* @__PURE__ */ ph(arrowsSplitRaw);
export const listMagnifyingGlassIcon = /* @__PURE__ */ ph(listMagnifyingGlassRaw);
export const sigmaIcon = /* @__PURE__ */ ph(sigmaRaw);
export const listDashesIcon = /* @__PURE__ */ ph(listDashesRaw);
export const checkSquareIcon = /* @__PURE__ */ ph(checkSquareRaw);
export const textHIcon = /* @__PURE__ */ ph(textHRaw);
export const asteriskIcon = /* @__PURE__ */ ph(asteriskRaw);
export const calendarPlusIcon = /* @__PURE__ */ ph(calendarPlusRaw);
export const xSquareIcon = /* @__PURE__ */ ph(xSquareRaw);
export const minusCircleIcon = /* @__PURE__ */ ph(minusCircleRaw);
export const selectionAllIcon = /* @__PURE__ */ ph(selectionAllRaw);
export const arrowsInLineHorizontalIcon = /* @__PURE__ */ ph(arrowsInLineHorizontalRaw);
