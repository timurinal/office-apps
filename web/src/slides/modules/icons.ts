/**
 * Icons the Slides modules draw that `web/src/core/icons.tsx` (the shell's) does not export.
 * Phosphor, regular weight, each its own `?raw` import so a bundle carries only the ones used
 * (see that file). Other Slides modules may import from here too, so a name core.tsx does not use
 * may still be somebody else's: look before removing one.
 */

import { ph } from '../../core/icons';

import arrowsDownUpRaw from '@phosphor-icons/core/assets/regular/arrows-down-up.svg?raw';
import cornersOutRaw from '@phosphor-icons/core/assets/regular/corners-out.svg?raw';
import layoutRaw from '@phosphor-icons/core/assets/regular/layout.svg?raw';
import magnifyingGlassMinusRaw from '@phosphor-icons/core/assets/regular/magnifying-glass-minus.svg?raw';
import magnifyingGlassPlusRaw from '@phosphor-icons/core/assets/regular/magnifying-glass-plus.svg?raw';
import playRaw from '@phosphor-icons/core/assets/regular/play.svg?raw';
import plusSquareRaw from '@phosphor-icons/core/assets/regular/plus-square.svg?raw';
import scissorsRaw from '@phosphor-icons/core/assets/regular/scissors.svg?raw';
import selectionAllRaw from '@phosphor-icons/core/assets/regular/selection-all.svg?raw';
import textAlignCenterRaw from '@phosphor-icons/core/assets/regular/text-align-center.svg?raw';
import textAlignJustifyRaw from '@phosphor-icons/core/assets/regular/text-align-justify.svg?raw';
import textAlignRightRaw from '@phosphor-icons/core/assets/regular/text-align-right.svg?raw';
import textTRaw from '@phosphor-icons/core/assets/regular/text-t.svg?raw';

export const arrowsDownUpIcon = ph(arrowsDownUpRaw);
export const cornersOutIcon = ph(cornersOutRaw);
export const layoutIcon = ph(layoutRaw);
export const magnifyingGlassMinusIcon = ph(magnifyingGlassMinusRaw);
export const magnifyingGlassPlusIcon = ph(magnifyingGlassPlusRaw);
export const playIcon = ph(playRaw);
export const plusSquareIcon = ph(plusSquareRaw);
export const scissorsIcon = ph(scissorsRaw);
export const selectionAllIcon = ph(selectionAllRaw);
export const textAlignCenterIcon = ph(textAlignCenterRaw);
export const textAlignJustifyIcon = ph(textAlignJustifyRaw);
export const textAlignRightIcon = ph(textAlignRightRaw);
export const textTIcon = ph(textTRaw);
