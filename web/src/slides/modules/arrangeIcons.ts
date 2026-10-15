/**
 * Icons Arrange draws that `core/icons.tsx` and `modules/icons.ts` do not export (it takes
 * `arrowCounterClockwiseIcon` from the first and `arrowsDownUpIcon` from the second). Phosphor, regular
 * weight, each its own `?raw` import so a bundle carries only the ones used.
 */

import { ph } from '../../core/icons';

import alignBottomRaw from '@phosphor-icons/core/assets/regular/align-bottom.svg?raw';
import alignCenterHorizontalRaw from '@phosphor-icons/core/assets/regular/align-center-horizontal.svg?raw';
import alignCenterVerticalRaw from '@phosphor-icons/core/assets/regular/align-center-vertical.svg?raw';
import alignLeftRaw from '@phosphor-icons/core/assets/regular/align-left.svg?raw';
import alignRightRaw from '@phosphor-icons/core/assets/regular/align-right.svg?raw';
import alignTopRaw from '@phosphor-icons/core/assets/regular/align-top.svg?raw';
import arrowClockwiseRaw from '@phosphor-icons/core/assets/regular/arrow-clockwise.svg?raw';
import arrowDownRaw from '@phosphor-icons/core/assets/regular/arrow-down.svg?raw';
import arrowLineDownRaw from '@phosphor-icons/core/assets/regular/arrow-line-down.svg?raw';
import arrowLineUpRaw from '@phosphor-icons/core/assets/regular/arrow-line-up.svg?raw';
import arrowUpRaw from '@phosphor-icons/core/assets/regular/arrow-up.svg?raw';
import arrowsLeftRightRaw from '@phosphor-icons/core/assets/regular/arrows-left-right.svg?raw';
import flipHorizontalRaw from '@phosphor-icons/core/assets/regular/flip-horizontal.svg?raw';
import flipVerticalRaw from '@phosphor-icons/core/assets/regular/flip-vertical.svg?raw';
import stackRaw from '@phosphor-icons/core/assets/regular/stack.svg?raw';
import subtractSquareRaw from '@phosphor-icons/core/assets/regular/subtract-square.svg?raw';
import uniteSquareRaw from '@phosphor-icons/core/assets/regular/unite-square.svg?raw';

export const alignBottomIcon = ph(alignBottomRaw);
export const alignCenterHorizontalIcon = ph(alignCenterHorizontalRaw);
export const alignCenterVerticalIcon = ph(alignCenterVerticalRaw);
export const alignLeftIcon = ph(alignLeftRaw);
export const alignRightIcon = ph(alignRightRaw);
export const alignTopIcon = ph(alignTopRaw);
export const arrowClockwiseIcon = ph(arrowClockwiseRaw);
export const arrowDownIcon = ph(arrowDownRaw);
export const arrowLineDownIcon = ph(arrowLineDownRaw);
export const arrowLineUpIcon = ph(arrowLineUpRaw);
export const arrowUpIcon = ph(arrowUpRaw);
export const arrowsLeftRightIcon = ph(arrowsLeftRightRaw);
export const flipHorizontalIcon = ph(flipHorizontalRaw);
export const flipVerticalIcon = ph(flipVerticalRaw);
export const stackIcon = ph(stackRaw);
export const subtractSquareIcon = ph(subtractSquareRaw);
export const uniteSquareIcon = ph(uniteSquareRaw);
