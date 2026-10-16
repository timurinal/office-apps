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
/** Phosphor has no minus forms of these two: its plus glyphs with the plus drawn as a minus. */
export const rowsMinusIcon = /* @__PURE__ */ ph(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M208,112H48a16,16,0,0,0-16,16v24a16,16,0,0,0,16,16H208a16,16,0,0,0,16-16V128A16,16,0,0,0,208,112Zm0,40H48V128H208v24Zm0-112H48A16,16,0,0,0,32,56V80A16,16,0,0,0,48,96H208a16,16,0,0,0,16-16V56A16,16,0,0,0,208,40Zm0,40H48V56H208V80ZM160,216a8,8,0,0,1-8,8H104a8,8,0,0,1,0-16h48A8,8,0,0,1,160,216Z"/></svg>'
);
export const columnsMinusIcon = /* @__PURE__ */ ph(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M80,32H56A16,16,0,0,0,40,48V208a16,16,0,0,0,16,16H80a16,16,0,0,0,16-16V48A16,16,0,0,0,80,32Zm0,176H56V48H80ZM152,32H128a16,16,0,0,0-16,16V208a16,16,0,0,0,16,16h24a16,16,0,0,0,16-16V48A16,16,0,0,0,152,32Zm0,176H128V48h24Zm96-80a8,8,0,0,1-8,8H192a8,8,0,0,1,0-16h48A8,8,0,0,1,248,128Z"/></svg>'
);
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
